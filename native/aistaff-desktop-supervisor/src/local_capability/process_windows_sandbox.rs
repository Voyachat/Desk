use super::contracts::{CapabilityScope, LocalCapabilityError};
use super::process_contracts::{ProcessTarget, current_process_target};
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_sandbox::{ProcessSandboxPort, SandboxedProcessChild, SandboxedProcessOutput};
use super::process_spawn_spec::SandboxedProcessSpawnSpec;
use super::process_windows_sandbox_plan::WindowsProcessSandboxPlan;
use launch::{WindowsProcessLaunchError, spawn_windows_process};
use std::ffi::c_void;
use std::fs::File;
use std::io::{Error, ErrorKind, Result as IoResult};
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::os::windows::process::ExitStatusExt;
use std::path::Path;
use std::process::ExitStatus;
use windows_sys::Win32::Foundation::{HANDLE, STILL_ACTIVE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::Security::{
    GetLengthSid, GetSidIdentifierAuthority, GetSidSubAuthority, GetSidSubAuthorityCount,
    IsValidSid, PSID, SECURITY_APP_PACKAGE_AUTHORITY,
};
use windows_sys::Win32::System::JobObjects::TerminateJobObject;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, INFINITE, ResumeThread, WaitForSingleObject,
};

const TERMINATION_EXIT_CODE: u32 = 1;
const DROP_TERMINATION_WAIT_MS: u32 = 5_000;
const APP_CONTAINER_PROFILE_SUBAUTHORITY_COUNT: u8 = 8;

mod launch;

pub(super) struct WindowsSandboxLeaseRequest<'a> {
    pub capability_id: &'static str,
    pub operation_id: &'a str,
    pub scope: &'a CapabilityScope,
    pub executable_path: &'a Path,
    pub working_directory: Option<&'a Path>,
}

pub(super) trait WindowsSandboxLease: Send {
    fn app_container_sid(&self) -> &WindowsAppContainerSid;
    fn release(self: Box<Self>) -> IoResult<()>;
    fn preserve_for_reconciliation(self: Box<Self>);
}

pub(super) trait WindowsSandboxLeaseProvider: Send {
    fn acquire(
        &mut self,
        request: WindowsSandboxLeaseRequest<'_>,
    ) -> Result<Box<dyn WindowsSandboxLease>, LocalCapabilityError>;
}

pub(super) struct WindowsProcessSandboxPort {
    lease_provider: Box<dyn WindowsSandboxLeaseProvider>,
}

pub(super) struct WindowsAppContainerSid {
    storage: Vec<usize>,
    byte_count: usize,
}

impl WindowsAppContainerSid {
    pub fn from_bytes(bytes: &[u8]) -> IoResult<Self> {
        if bytes.is_empty() || bytes.len() > u32::MAX as usize {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "invalid AppContainer SID",
            ));
        }
        let mut storage = vec![0_usize; bytes.len().div_ceil(size_of::<usize>())];
        unsafe {
            std::ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                storage.as_mut_ptr().cast::<u8>(),
                bytes.len(),
            );
        }
        let sid = Self {
            storage,
            byte_count: bytes.len(),
        };
        sid.validate()?;
        Ok(sid)
    }

    pub(super) fn as_psid(&self) -> PSID {
        self.storage.as_ptr().cast_mut().cast::<c_void>()
    }

    pub(super) fn as_bytes(&self) -> &[u8] {
        // SAFETY: storage owns at least byte_count initialized bytes copied from
        // the validated SID input and remains alive for the returned borrow.
        unsafe { std::slice::from_raw_parts(self.storage.as_ptr().cast::<u8>(), self.byte_count) }
    }

    pub(super) fn validate(&self) -> IoResult<()> {
        let sid = self.as_psid();
        if unsafe { IsValidSid(sid) } == 0
            || unsafe { GetLengthSid(sid) } as usize != self.byte_count
        {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "invalid AppContainer SID",
            ));
        }
        let authority = unsafe { GetSidIdentifierAuthority(sid) };
        let count = unsafe { GetSidSubAuthorityCount(sid) };
        if authority.is_null()
            || count.is_null()
            || unsafe { (*authority).Value } != SECURITY_APP_PACKAGE_AUTHORITY.Value
            || unsafe { *count } != APP_CONTAINER_PROFILE_SUBAUTHORITY_COUNT
        {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "non-profile AppContainer SID",
            ));
        }
        let first = unsafe { GetSidSubAuthority(sid, 0) };
        if first.is_null() || unsafe { *first } != 2 {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "non-profile AppContainer SID",
            ));
        }
        Ok(())
    }
}

impl WindowsProcessSandboxPort {
    pub fn new(lease_provider: Box<dyn WindowsSandboxLeaseProvider>) -> Self {
        Self { lease_provider }
    }

    fn spawn_inner(
        &mut self,
        spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, WindowsProcessSpawnError> {
        if current_process_target() != Some(ProcessTarget::WindowsX64)
            || spec.target != ProcessTarget::WindowsX64
            || spec.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
        {
            return Err(WindowsProcessSpawnError::Owned(LocalCapabilityError::new(
                "LOCAL_PROCESS_SANDBOX_TARGET_MISMATCH",
            )));
        }
        let plan = WindowsProcessSandboxPlan::from_policy(spec.resource_policy)
            .map_err(WindowsProcessSpawnError::Owned)?;
        let lease = self
            .lease_provider
            .acquire(WindowsSandboxLeaseRequest {
                capability_id: spec.capability_id,
                operation_id: spec.operation_id,
                scope: spec.scope,
                executable_path: spec.executable_path,
                working_directory: spec.working_directory,
            })
            .map_err(WindowsProcessSpawnError::Owned)?;
        spawn_windows_process(spec, plan, lease)
            .map(|child| Box::new(child) as Box<dyn SandboxedProcessChild>)
            .map_err(WindowsProcessSpawnError::Native)
    }

    #[cfg(test)]
    pub(super) fn spawn_with_sanitized_diagnostic_for_test(
        &mut self,
        spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, WindowsProcessSpawnTestDiagnostic> {
        self.spawn_inner(spec)
            .map_err(WindowsProcessSpawnError::into_test_diagnostic)
    }
}

impl ProcessSandboxPort for WindowsProcessSandboxPort {
    fn spawn(
        &mut self,
        spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, LocalCapabilityError> {
        self.spawn_inner(spec)
            .map_err(WindowsProcessSpawnError::into_public_error)
    }
}

enum WindowsProcessSpawnError {
    Owned(LocalCapabilityError),
    Native(WindowsProcessLaunchError),
}

impl WindowsProcessSpawnError {
    fn into_public_error(self) -> LocalCapabilityError {
        match self {
            Self::Owned(error) => error,
            Self::Native(_) => LocalCapabilityError::new("LOCAL_PROCESS_SPAWN_FAILED"),
        }
    }

    #[cfg(test)]
    fn into_test_diagnostic(self) -> WindowsProcessSpawnTestDiagnostic {
        match self {
            Self::Owned(error) => WindowsProcessSpawnTestDiagnostic::Owned { code: error.code },
            Self::Native(error) => {
                let (stage, kind, raw_os_error) = error.into_sanitized_parts();
                WindowsProcessSpawnTestDiagnostic::Native {
                    stage,
                    kind,
                    raw_os_error,
                }
            }
        }
    }
}

#[cfg(test)]
#[derive(Debug)]
pub(super) enum WindowsProcessSpawnTestDiagnostic {
    Owned {
        code: &'static str,
    },
    Native {
        stage: &'static str,
        kind: ErrorKind,
        raw_os_error: Option<i32>,
    },
}

#[cfg(test)]
impl std::fmt::Display for WindowsProcessSpawnTestDiagnostic {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Owned { code } => write!(formatter, "stage=owned_contract code={code}"),
            Self::Native {
                stage,
                kind,
                raw_os_error,
            } => write!(
                formatter,
                "stage={stage} kind={kind:?} raw_os_error={raw_os_error:?}"
            ),
        }
    }
}

pub(super) struct WindowsSandboxedChild {
    stdout: Option<File>,
    stderr: Option<File>,
    process: Option<OwnedHandle>,
    suspended_thread: Option<OwnedHandle>,
    job: Option<OwnedHandle>,
    lease: Option<Box<dyn WindowsSandboxLease>>,
    resumed: bool,
    terminal_confirmed: bool,
}

impl WindowsSandboxedChild {
    fn new(
        stdout: File,
        stderr: File,
        process: OwnedHandle,
        suspended_thread: OwnedHandle,
        job: OwnedHandle,
        lease: Box<dyn WindowsSandboxLease>,
    ) -> Self {
        Self {
            stdout: Some(stdout),
            stderr: Some(stderr),
            process: Some(process),
            suspended_thread: Some(suspended_thread),
            job: Some(job),
            lease: Some(lease),
            resumed: false,
            terminal_confirmed: false,
        }
    }
}

impl SandboxedProcessChild for WindowsSandboxedChild {
    fn resume(&mut self) -> IoResult<()> {
        if self.resumed {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                "sandboxed process already resumed",
            ));
        }
        let thread = self
            .suspended_thread
            .take()
            .ok_or_else(|| Error::other("sandboxed process thread unavailable"))?;
        let previous_count = unsafe { ResumeThread(raw_handle(&thread)) };
        if previous_count != 1 {
            return Err(Error::last_os_error());
        }
        self.resumed = true;
        Ok(())
    }

    fn take_stdout(&mut self) -> Option<SandboxedProcessOutput> {
        self.stdout
            .take()
            .map(|stdout| Box::new(stdout) as SandboxedProcessOutput)
    }

    fn take_stderr(&mut self) -> Option<SandboxedProcessOutput> {
        self.stderr
            .take()
            .map(|stderr| Box::new(stderr) as SandboxedProcessOutput)
    }

    fn try_wait(&mut self) -> IoResult<Option<ExitStatus>> {
        let process = self
            .process
            .as_ref()
            .ok_or_else(|| Error::other("sandboxed process handle unavailable"))?;
        match unsafe { WaitForSingleObject(raw_handle(process), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let status = process_exit_status(process)?;
                self.confirm_terminal_lease()?;
                Ok(Some(status))
            }
            _ => Err(Error::last_os_error()),
        }
    }

    fn kill(&mut self) -> IoResult<()> {
        let job = self
            .job
            .as_ref()
            .ok_or_else(|| Error::other("sandboxed job handle unavailable"))?;
        if unsafe { TerminateJobObject(raw_handle(job), TERMINATION_EXIT_CODE) } == 0 {
            return Err(Error::last_os_error());
        }
        Ok(())
    }

    fn wait(&mut self) -> IoResult<ExitStatus> {
        let process = self
            .process
            .as_ref()
            .ok_or_else(|| Error::other("sandboxed process handle unavailable"))?;
        if unsafe { WaitForSingleObject(raw_handle(process), INFINITE) } != WAIT_OBJECT_0 {
            return Err(Error::last_os_error());
        }
        let status = process_exit_status(process)?;
        self.confirm_terminal_lease()?;
        Ok(status)
    }
}

impl Drop for WindowsSandboxedChild {
    fn drop(&mut self) {
        if !self.terminal_confirmed
            && let Some(process) = self.process.as_ref()
        {
            let initial_wait = unsafe { WaitForSingleObject(raw_handle(process), 0) };
            if initial_wait == WAIT_OBJECT_0 {
                self.terminal_confirmed = true;
            } else if initial_wait == WAIT_TIMEOUT
                && let Some(job) = self.job.as_ref()
                && unsafe { TerminateJobObject(raw_handle(job), TERMINATION_EXIT_CODE) } != 0
                && unsafe { WaitForSingleObject(raw_handle(process), DROP_TERMINATION_WAIT_MS) }
                    == WAIT_OBJECT_0
            {
                self.terminal_confirmed = true;
            }
        }
        self.suspended_thread.take();
        self.process.take();
        self.job.take();
        if self.terminal_confirmed {
            if let Some(lease) = self.lease.take() {
                let _ = lease.release();
            }
        } else if let Some(lease) = self.lease.take() {
            lease.preserve_for_reconciliation();
        }
    }
}

impl WindowsSandboxedChild {
    fn confirm_terminal_lease(&mut self) -> IoResult<()> {
        self.terminal_confirmed = true;
        if let Some(lease) = self.lease.take() {
            lease.release()?;
        }
        Ok(())
    }
}

fn process_exit_status(process: &OwnedHandle) -> IoResult<ExitStatus> {
    let mut exit_code = 0;
    if unsafe { GetExitCodeProcess(raw_handle(process), &raw mut exit_code) } == 0 {
        return Err(Error::last_os_error());
    }
    if exit_code == STILL_ACTIVE as u32 {
        return Err(Error::new(ErrorKind::WouldBlock, "process is still active"));
    }
    Ok(ExitStatus::from_raw(exit_code))
}

fn raw_handle(handle: &OwnedHandle) -> HANDLE {
    handle.as_raw_handle() as HANDLE
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_capability::process_resource_policy::{
        PROCESS_RESOURCE_POLICY_SCHEMA_VERSION, ProcessNetworkAccess, ProcessResourcePolicy,
        ProcessSandboxProfile,
    };
    use crate::local_capability::process_spawn_spec::MaterializedProcessEnvironment;

    struct DeniedLeaseProvider;

    impl WindowsSandboxLeaseProvider for DeniedLeaseProvider {
        fn acquire(
            &mut self,
            request: WindowsSandboxLeaseRequest<'_>,
        ) -> Result<Box<dyn WindowsSandboxLease>, LocalCapabilityError> {
            assert_eq!(request.operation_id, "operation");
            assert_eq!(request.capability_id, LOCAL_PROCESS_EXECUTION_CAPABILITY_ID);
            assert_eq!(request.scope.tenant_id, "tenant-test");
            assert_eq!(request.executable_path, Path::new(r"C:\AiStaff\worker.exe"));
            assert_eq!(request.working_directory, Some(Path::new(r"C:\AiStaff")));
            Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_SANDBOX_ACL_LEASE_UNAVAILABLE",
            ))
        }
    }

    #[test]
    fn windows_port_fails_before_create_process_without_acl_lease() {
        let policy = ProcessResourcePolicy {
            schema_version: PROCESS_RESOURCE_POLICY_SCHEMA_VERSION.to_string(),
            cpu_time_limit_ms: 1_000,
            memory_limit_bytes: 16 * 1024 * 1024,
            process_count_limit: 1,
            network_access: ProcessNetworkAccess::Denied,
            sandbox_profile: ProcessSandboxProfile::RestrictedProcessV1,
        };
        let environment = Vec::<MaterializedProcessEnvironment>::new();
        let argv = Vec::<String>::new();
        let mut port = WindowsProcessSandboxPort::new(Box::new(DeniedLeaseProvider));
        let scope = CapabilityScope {
            tenant_id: "tenant-test".to_owned(),
            session_id: "session-test".to_owned(),
            run_id: "run-test".to_owned(),
        };
        let result = port.spawn(SandboxedProcessSpawnSpec {
            capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            operation_id: "operation",
            scope: &scope,
            executable_path: Path::new(r"C:\AiStaff\worker.exe"),
            argv: &argv,
            inherited_environment: Vec::new(),
            environment: &environment,
            working_directory: Some(Path::new(r"C:\AiStaff")),
            target: ProcessTarget::WindowsX64,
            resource_policy: &policy,
        });
        let error = match result {
            Ok(_) => panic!("missing ACL lease must fail before CreateProcessW"),
            Err(error) => error,
        };
        assert_eq!(error.code, "LOCAL_PROCESS_SANDBOX_ACL_LEASE_UNAVAILABLE");
    }

    #[test]
    fn native_launch_failure_stays_generic_in_production() {
        let public_error = WindowsProcessSpawnError::Native(WindowsProcessLaunchError::capture(
            "create_process",
            Error::new(ErrorKind::PermissionDenied, "test-only native failure"),
        ))
        .into_public_error();
        assert_eq!(public_error.code, "LOCAL_PROCESS_SPAWN_FAILED");
    }

    #[test]
    fn app_container_sid_requires_profile_rid_shape_and_aligned_storage() {
        let valid = sid_bytes(&[2, 11, 12, 13, 14, 15, 16, 17]);
        let sid = WindowsAppContainerSid::from_bytes(&valid).expect("profile SID");
        assert_eq!(unsafe { GetLengthSid(sid.as_psid()) } as usize, valid.len());

        let any_package = sid_bytes(&[2, 1]);
        assert!(WindowsAppContainerSid::from_bytes(&any_package).is_err());
    }

    fn sid_bytes(subauthorities: &[u32]) -> Vec<u8> {
        let mut bytes = vec![1, subauthorities.len() as u8, 0, 0, 0, 0, 0, 15];
        for value in subauthorities {
            bytes.extend(value.to_le_bytes());
        }
        bytes
    }
}
