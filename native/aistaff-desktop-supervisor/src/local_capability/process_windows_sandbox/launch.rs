use super::{WindowsAppContainerSid, WindowsSandboxLease, WindowsSandboxedChild, raw_handle};
use crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use crate::local_capability::process_spawn_spec::SandboxedProcessSpawnSpec;
use crate::local_capability::process_windows_sandbox_plan::{
    WindowsProcessSandboxPlan, build_windows_command_line, build_windows_environment_block,
};
use std::ffi::c_void;
use std::fs::File;
use std::io::{Error, ErrorKind, Result as IoResult};
use std::mem::{size_of, size_of_val};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, OwnedHandle, RawHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation, TRUE,
};
use windows_sys::Win32::Security::{SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_JOB_MEMORY,
    JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute,
};
use windows_sys::Win32::System::WindowsProgramming::PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
use zeroize::Zeroizing;

const WINDOWS_STARTUP_ATTRIBUTE_COUNT: u32 = 4;
const WINDOWS_MAX_PATH_UNITS: usize = 32_767;

pub(super) fn spawn_windows_process(
    spec: SandboxedProcessSpawnSpec<'_>,
    plan: WindowsProcessSandboxPlan,
    lease: Box<dyn WindowsSandboxLease>,
) -> Result<WindowsSandboxedChild, WindowsProcessLaunchError> {
    let mut buffers = WindowsLaunchBuffers::new(&spec)
        .map_err(|error| WindowsProcessLaunchError::capture("launch_buffers", error))?;
    let job = create_job(&plan)
        .map_err(|error| WindowsProcessLaunchError::capture("create_job", error))?;
    let pipes = ChildPipes::new()
        .map_err(|error| WindowsProcessLaunchError::capture("create_pipes", error))?;
    lease
        .app_container_sid()
        .validate()
        .map_err(|error| WindowsProcessLaunchError::capture("validate_app_container_sid", error))?;
    let (process, thread) =
        create_suspended_process(&mut buffers, &job, &pipes, lease.app_container_sid())?;
    let (stdout, stderr) = pipes.into_parent_readers();
    Ok(WindowsSandboxedChild::new(
        stdout, stderr, process, thread, job, lease,
    ))
}

pub(super) struct WindowsProcessLaunchError {
    stage: &'static str,
    kind: ErrorKind,
    raw_os_error: Option<i32>,
}

impl WindowsProcessLaunchError {
    pub(super) fn capture(stage: &'static str, error: Error) -> Self {
        Self {
            stage,
            kind: error.kind(),
            raw_os_error: error.raw_os_error(),
        }
    }

    #[cfg(test)]
    pub(super) fn into_sanitized_parts(self) -> (&'static str, ErrorKind, Option<i32>) {
        (self.stage, self.kind, self.raw_os_error)
    }
}

struct WindowsLaunchBuffers {
    application: Zeroizing<Vec<u16>>,
    command_line: Zeroizing<Vec<u16>>,
    environment: Zeroizing<Vec<u16>>,
    current_directory: Option<Zeroizing<Vec<u16>>>,
}

impl WindowsLaunchBuffers {
    fn new(spec: &SandboxedProcessSpawnSpec<'_>) -> IoResult<Self> {
        if spec.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "invalid local process capability",
            ));
        }
        let application = wide_path(spec.executable_path)?;
        let executable_units = spec
            .executable_path
            .as_os_str()
            .encode_wide()
            .collect::<Vec<_>>();
        let command_line = build_windows_command_line(&executable_units, spec.argv)
            .map_err(|_| Error::new(ErrorKind::InvalidInput, "invalid command line"))?;
        let entries = windows_environment_entries(spec)?;
        let environment = build_windows_environment_block(&entries)
            .map_err(|_| Error::new(ErrorKind::InvalidInput, "invalid environment block"))?;
        let current_directory = spec.working_directory.map(wide_path).transpose()?;
        Ok(Self {
            application,
            command_line,
            environment,
            current_directory,
        })
    }

    fn current_directory_pointer(&self) -> *const u16 {
        self.current_directory
            .as_ref()
            .map_or(null(), |directory| directory.as_ptr())
    }
}

fn create_suspended_process(
    buffers: &mut WindowsLaunchBuffers,
    job: &OwnedHandle,
    pipes: &ChildPipes,
    app_container_sid: &WindowsAppContainerSid,
) -> Result<(OwnedHandle, OwnedHandle), WindowsProcessLaunchError> {
    let mut security_capabilities = zero_capability_lpac(app_container_sid);
    let mut all_packages_policy = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    let mut job_list = [raw_handle(job)];
    let mut handle_list = pipes.child_handles();
    let mut attributes = ProcThreadAttributeList::new(WINDOWS_STARTUP_ATTRIBUTE_COUNT)
        .map_err(|error| WindowsProcessLaunchError::capture("initialize_attributes", error))?;
    attributes
        .update(
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            (&raw mut security_capabilities).cast(),
            size_of::<SECURITY_CAPABILITIES>(),
        )
        .map_err(|error| WindowsProcessLaunchError::capture("set_security_capabilities", error))?;
    attributes
        .update(
            PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
            (&raw mut all_packages_policy).cast(),
            size_of::<u32>(),
        )
        .map_err(|error| {
            WindowsProcessLaunchError::capture("set_all_application_packages_policy", error)
        })?;
    attributes
        .update(
            PROC_THREAD_ATTRIBUTE_JOB_LIST,
            job_list.as_mut_ptr().cast(),
            size_of_val(&job_list),
        )
        .map_err(|error| WindowsProcessLaunchError::capture("set_job_list", error))?;
    attributes
        .update(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            handle_list.as_mut_ptr().cast(),
            size_of_val(&handle_list),
        )
        .map_err(|error| WindowsProcessLaunchError::capture("set_handle_list", error))?;
    let startup = startup_information(attributes.as_mut_ptr(), handle_list)
        .map_err(|error| WindowsProcessLaunchError::capture("build_startup_info", error))?;
    let mut information = PROCESS_INFORMATION::default();
    let created = unsafe {
        CreateProcessW(
            buffers.application.as_ptr(),
            buffers.command_line.as_mut_ptr(),
            null(),
            null(),
            TRUE,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            buffers.environment.as_ptr().cast(),
            buffers.current_directory_pointer(),
            &startup.StartupInfo,
            &raw mut information,
        )
    };
    if created == 0 {
        return Err(WindowsProcessLaunchError::capture(
            "create_process",
            Error::last_os_error(),
        ));
    }
    let process = owned_handle(information.hProcess)
        .map_err(|error| WindowsProcessLaunchError::capture("own_process_handle", error));
    let thread = owned_handle(information.hThread)
        .map_err(|error| WindowsProcessLaunchError::capture("own_thread_handle", error));
    Ok((process?, thread?))
}

fn zero_capability_lpac(app_container_sid: &WindowsAppContainerSid) -> SECURITY_CAPABILITIES {
    SECURITY_CAPABILITIES {
        AppContainerSid: app_container_sid.as_psid(),
        Capabilities: null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    }
}

fn startup_information(
    attributes: LPPROC_THREAD_ATTRIBUTE_LIST,
    handles: [HANDLE; 3],
) -> IoResult<STARTUPINFOEXW> {
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = u32::try_from(size_of::<STARTUPINFOEXW>())
        .map_err(|_| Error::new(ErrorKind::InvalidInput, "startup structure too large"))?;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attributes;
    Ok(startup)
}

fn create_job(plan: &WindowsProcessSandboxPlan) -> IoResult<OwnedHandle> {
    let job = owned_handle(unsafe { CreateJobObjectW(null(), null()) })?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.PerJobUserTimeLimit = plan.job_user_time_limit_100ns;
    limits.BasicLimitInformation.ActiveProcessLimit = plan.active_process_limit;
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_TIME
        | JOB_OBJECT_LIMIT_JOB_MEMORY
        | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    limits.JobMemoryLimit = plan.job_memory_limit_bytes;
    let size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
        .map_err(|_| Error::new(ErrorKind::InvalidInput, "job limits too large"))?;
    if unsafe {
        SetInformationJobObject(
            raw_handle(&job),
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size,
        )
    } == 0
    {
        return Err(Error::last_os_error());
    }
    Ok(job)
}

fn windows_environment_entries<'a>(
    spec: &'a SandboxedProcessSpawnSpec<'a>,
) -> IoResult<Vec<(&'a str, &'a str)>> {
    let mut entries = Vec::with_capacity(
        spec.inherited_environment
            .len()
            .saturating_add(spec.environment.len()),
    );
    for (name, value) in &spec.inherited_environment {
        entries.push((name.as_str(), value.as_str()));
    }
    for entry in spec.environment {
        entries.push((entry.name.as_str(), entry.value.as_str()));
    }
    if entries.iter().enumerate().any(|(index, entry)| {
        entries[..index]
            .iter()
            .any(|other| other.0.eq_ignore_ascii_case(entry.0))
    }) {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "duplicate environment name",
        ));
    }
    Ok(entries)
}

fn wide_path(path: &Path) -> IoResult<Zeroizing<Vec<u16>>> {
    let mut encoded = Zeroizing::new(path.as_os_str().encode_wide().collect::<Vec<_>>());
    if encoded.is_empty() || encoded.len() >= WINDOWS_MAX_PATH_UNITS || encoded.contains(&0) {
        return Err(Error::new(ErrorKind::InvalidInput, "invalid Windows path"));
    }
    encoded.push(0);
    Ok(encoded)
}

struct ChildPipes {
    stdin_child: OwnedHandle,
    stdout_child: OwnedHandle,
    stderr_child: OwnedHandle,
    stdout_parent: OwnedHandle,
    stderr_parent: OwnedHandle,
}

impl ChildPipes {
    fn new() -> IoResult<Self> {
        let mut attributes = inheritable_security_attributes()?;
        let stdin_child = owned_handle(unsafe {
            CreateFileW(
                windows_sys::core::w!("NUL"),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &raw mut attributes,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                null_mut(),
            )
        })?;
        let (stdout_parent, stdout_child) = inherited_pipe(&mut attributes)?;
        let (stderr_parent, stderr_child) = inherited_pipe(&mut attributes)?;
        Ok(Self {
            stdin_child,
            stdout_child,
            stderr_child,
            stdout_parent,
            stderr_parent,
        })
    }

    fn child_handles(&self) -> [HANDLE; 3] {
        [
            raw_handle(&self.stdin_child),
            raw_handle(&self.stdout_child),
            raw_handle(&self.stderr_child),
        ]
    }

    fn into_parent_readers(self) -> (File, File) {
        let Self {
            stdout_parent,
            stderr_parent,
            ..
        } = self;
        (File::from(stdout_parent), File::from(stderr_parent))
    }
}

fn inheritable_security_attributes() -> IoResult<SECURITY_ATTRIBUTES> {
    Ok(SECURITY_ATTRIBUTES {
        nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>())
            .map_err(|_| Error::new(ErrorKind::InvalidInput, "security attributes too large"))?,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: TRUE,
    })
}

fn inherited_pipe(attributes: &mut SECURITY_ATTRIBUTES) -> IoResult<(OwnedHandle, OwnedHandle)> {
    let mut read_handle = null_mut();
    let mut write_handle = null_mut();
    if unsafe { CreatePipe(&raw mut read_handle, &raw mut write_handle, attributes, 0) } == 0 {
        return Err(Error::last_os_error());
    }
    let read = owned_handle(read_handle)?;
    let write = owned_handle(write_handle)?;
    if unsafe { SetHandleInformation(raw_handle(&read), HANDLE_FLAG_INHERIT, 0) } == 0 {
        return Err(Error::last_os_error());
    }
    Ok((read, write))
}

struct ProcThreadAttributeList {
    storage: Vec<usize>,
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
}

impl ProcThreadAttributeList {
    fn new(attribute_count: u32) -> IoResult<Self> {
        let mut byte_count = 0;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &raw mut byte_count);
        }
        if byte_count == 0 {
            return Err(Error::last_os_error());
        }
        let word_count = byte_count.div_ceil(size_of::<usize>());
        let mut storage = vec![0_usize; word_count];
        let pointer = storage.as_mut_ptr().cast::<c_void>();
        if unsafe {
            InitializeProcThreadAttributeList(pointer, attribute_count, 0, &raw mut byte_count)
        } == 0
        {
            return Err(Error::last_os_error());
        }
        Ok(Self { storage, pointer })
    }

    fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.pointer
    }

    fn update(&mut self, attribute: u32, value: *const c_void, byte_count: usize) -> IoResult<()> {
        if value.is_null()
            || byte_count == 0
            || unsafe {
                UpdateProcThreadAttribute(
                    self.pointer,
                    0,
                    attribute as usize,
                    value,
                    byte_count,
                    null_mut(),
                    null(),
                )
            } == 0
        {
            return Err(Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for ProcThreadAttributeList {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            unsafe {
                DeleteProcThreadAttributeList(self.pointer);
            }
        }
        self.storage.fill(0);
    }
}

fn owned_handle(handle: HANDLE) -> IoResult<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(Error::last_os_error());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_launch_error_parts_drop_os_message() {
        let error = WindowsProcessLaunchError::capture(
            "create_process",
            Error::new(ErrorKind::PermissionDenied, r"C:\private\worker.exe"),
        );
        assert_eq!(
            error.into_sanitized_parts(),
            ("create_process", ErrorKind::PermissionDenied, None)
        );
    }
}
