//! Bounded Windows process observation and disposable fixture support.

use crate::local_capability::contracts::CapabilityScope;
use crate::local_capability::process_contracts::ProcessTarget;
use crate::local_capability::process_execution::inherited_environment;
use crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use crate::local_capability::process_resource_policy::{
    PROCESS_RESOURCE_POLICY_SCHEMA_VERSION, ProcessNetworkAccess, ProcessResourcePolicy,
    ProcessSandboxProfile,
};
use crate::local_capability::process_sandbox::SandboxedProcessChild;
use crate::local_capability::process_spawn_spec::{
    MaterializedProcessEnvironment, SandboxedProcessSpawnSpec,
};
use crate::local_capability::process_windows_sandbox::WindowsProcessSandboxPort;
use getrandom::fill;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{ERROR_INVALID_PARAMETER, FALSE, WAIT_OBJECT_0};
use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
use windows_sys::Win32::System::Threading::{
    CREATE_BREAKAWAY_FROM_JOB, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, WaitForSingleObject,
};
use zeroize::Zeroizing;

pub(super) const EVIDENCE_ENV: &str = "AISTAFF_WINDOWS_PROCESS_SANDBOX_EVIDENCE";
pub(super) const DENIED_FILE_ENV: &str = "AISTAFF_SANDBOX_DENIED_FILE";
pub(super) const DENIED_ENDPOINT_ENV: &str = "AISTAFF_SANDBOX_DENIED_ENDPOINT";
pub(super) const JOURNAL_ROOT_ENV: &str = "AISTAFF_SANDBOX_JOURNAL_ROOT";
pub(super) const OPERATION_ID_ENV: &str = "AISTAFF_SANDBOX_OPERATION_ID";
pub(super) const DENIAL_RESULT_PREFIX: &str = "AISTAFF_SANDBOX_DENIAL_RESULT ";
pub(super) const TREE_READY_PREFIX: &str = "AISTAFF_SANDBOX_TREE_READY ";
pub(super) const DESCENDANT_READY_PREFIX: &str = "AISTAFF_SANDBOX_DESCENDANT_READY";
pub(super) const OWNER_LOSS_READY_PREFIX: &str = "AISTAFF_SANDBOX_OWNER_LOSS_READY ";
pub(super) const TEST_CPU_TIME_LIMIT_MS: u64 = 60_000;
pub(super) const TEST_MEMORY_LIMIT_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const TEST_PROCESS_COUNT_LIMIT: u16 = 2;
pub(super) const DENIAL_FIXTURE: &str = concat!(
    "local_capability::process_windows_acl_lease::native::runtime_tests::",
    "windows_lpac_denial_fixture"
);
pub(super) const SUPERVISOR_ABORT_FIXTURE: &str = concat!(
    "local_capability::process_windows_acl_lease::native::runtime_tests::",
    "windows_owner_loss_supervisor_fixture"
);
pub(super) const TREE_FIXTURE: &str = concat!(
    "local_capability::process_windows_acl_lease::native::runtime_tests::",
    "windows_owner_loss_tree_fixture"
);
pub(super) const DESCENDANT_FIXTURE: &str = concat!(
    "local_capability::process_windows_acl_lease::native::runtime_tests::",
    "windows_owner_loss_descendant_fixture"
);
const BREAKAWAY_FIXTURE: &str = concat!(
    "local_capability::process_windows_acl_lease::native::runtime_tests::",
    "windows_breakaway_escape_fixture"
);
pub(super) const CHILD_READY_TIMEOUT: Duration = Duration::from_secs(10);
pub(super) const HELPER_TIMEOUT: Duration = Duration::from_secs(20);
const PROCESS_EXIT_TIMEOUT_MS: u32 = 5_000;

pub(super) fn spawn_fixture(
    port: &mut WindowsProcessSandboxPort,
    operation_id: &str,
    scope: &CapabilityScope,
    policy: &ProcessResourcePolicy,
    executable: &Path,
    fixture: &str,
    environment: &[MaterializedProcessEnvironment],
) -> Box<dyn SandboxedProcessChild> {
    let argv = fixture_arguments(fixture);
    port.spawn_with_sanitized_diagnostic_for_test(SandboxedProcessSpawnSpec {
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id,
        scope,
        executable_path: executable,
        argv: &argv,
        inherited_environment: inherited_environment(std::env::vars()),
        environment,
        working_directory: None,
        target: ProcessTarget::WindowsX64,
        resource_policy: policy,
    })
    .unwrap_or_else(|error| panic!("spawn real Windows sandbox fixture: {error}"))
}

pub(super) fn fixture_command(fixture: &str) -> Command {
    let mut command = Command::new(current_executable());
    command
        .args(fixture_arguments(fixture))
        .env_clear()
        .envs(inherited_environment(std::env::vars()));
    command
}

fn fixture_arguments(fixture: &str) -> [String; 4] {
    [
        "--ignored".to_owned(),
        "--exact".to_owned(),
        fixture.to_owned(),
        "--nocapture".to_owned(),
    ]
}

pub(super) fn breakaway_spawn_is_denied() -> bool {
    let mut command = fixture_command(BREAKAWAY_FIXTURE);
    command
        .creation_flags(CREATE_BREAKAWAY_FROM_JOB)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match command.spawn() {
        Err(error) => {
            assert_eq!(
                error.kind(),
                io::ErrorKind::PermissionDenied,
                "breakaway spawn failed for a non-policy reason: {error}"
            );
            true
        }
        Ok(mut escaped) => {
            let _ = escaped.kill();
            let _ = escaped.wait();
            false
        }
    }
}

pub(super) fn wait_for_process_exit(process_id: u32) {
    let access = PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE;
    let raw = unsafe { OpenProcess(access, FALSE, process_id) };
    if raw.is_null() {
        let error = io::Error::last_os_error();
        assert_eq!(
            error.raw_os_error(),
            Some(ERROR_INVALID_PARAMETER as i32),
            "cannot observe owner-loss process {process_id}: {error}"
        );
        return;
    }
    // SAFETY: OpenProcess returned an owned, non-null kernel handle.
    let process = unsafe { OwnedHandle::from_raw_handle(raw as RawHandle) };
    assert_eq!(
        unsafe { WaitForSingleObject(process.as_raw_handle() as _, PROCESS_EXIT_TIMEOUT_MS) },
        WAIT_OBJECT_0,
        "owner-loss process {process_id} survived Job handle closure"
    );
}

pub(super) fn wait_for_sandbox_child(
    child: &mut dyn SandboxedProcessChild,
    timeout: Duration,
) -> ExitStatus {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().expect("poll sandbox child") {
            return status;
        }
        if Instant::now() >= deadline {
            child.kill().expect("terminate stalled sandbox child");
            let _ = child.wait();
            panic!("sandbox child exceeded fixture deadline");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(super) fn run_helper_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> (ExitStatus, String, String) {
    let mut child = command.spawn().expect("spawn owner-loss helper");
    let stdout = child.stdout.take().expect("helper stdout");
    let stderr = child.stderr.take().expect("helper stderr");
    let stdout_reader = thread::spawn(move || read_owned_text(stdout));
    let stderr_reader = thread::spawn(move || read_owned_text(stderr));
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().expect("poll owner-loss helper") {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().expect("terminate stalled owner-loss helper");
            let _ = child.wait();
            panic!("owner-loss helper exceeded fixture deadline");
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout_reader.join().expect("join helper stdout");
    let stderr = stderr_reader.join().expect("join helper stderr");
    (status, stdout, stderr)
}

pub(super) fn read_marker_with_timeout(
    output: impl Read + Send + 'static,
    prefix: &'static str,
    timeout: Duration,
) -> String {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let result = BufReader::new(output)
            .lines()
            .map_while(Result::ok)
            .find(|line| line.starts_with(prefix));
        let _ = sender.send(result);
    });
    receiver
        .recv_timeout(timeout)
        .expect("fixture marker deadline")
        .expect("fixture marker missing")
}

pub(super) fn parse_owner_loss_ready(line: &str) -> OwnerLossReady {
    let mut parent_pid = None;
    let mut descendant_pid = None;
    let mut breakaway_denied = None;
    for field in line
        .trim_start_matches(OWNER_LOSS_READY_PREFIX)
        .split_ascii_whitespace()
    {
        if let Some(value) = field.strip_prefix("parent=") {
            parent_pid = value.parse().ok();
        } else if let Some(value) = field.strip_prefix("descendant=") {
            descendant_pid = value.parse().ok();
        } else if let Some(value) = field.strip_prefix("breakaway_denied=") {
            breakaway_denied = Some(value == "true");
        }
    }
    OwnerLossReady {
        parent_pid: parent_pid.expect("owner-loss parent PID"),
        descendant_pid: descendant_pid.expect("owner-loss descendant PID"),
        breakaway_denied: breakaway_denied.expect("owner-loss breakaway result"),
    }
}

pub(super) fn test_policy() -> ProcessResourcePolicy {
    ProcessResourcePolicy {
        schema_version: PROCESS_RESOURCE_POLICY_SCHEMA_VERSION.to_owned(),
        cpu_time_limit_ms: TEST_CPU_TIME_LIMIT_MS,
        memory_limit_bytes: TEST_MEMORY_LIMIT_BYTES,
        process_count_limit: TEST_PROCESS_COUNT_LIMIT,
        network_access: ProcessNetworkAccess::Denied,
        sandbox_profile: ProcessSandboxProfile::RestrictedProcessV1,
    }
}

pub(super) fn test_scope() -> CapabilityScope {
    CapabilityScope {
        tenant_id: "tenant-windows-native-fixture".to_owned(),
        session_id: "session-windows-native-fixture".to_owned(),
        run_id: "run-windows-native-fixture".to_owned(),
    }
}

pub(super) fn current_executable() -> PathBuf {
    std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .expect("canonical test executable")
}

pub(super) fn required_path_env(name: &str) -> PathBuf {
    PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("missing {name}")))
}

pub(super) fn materialized_path(name: &str, path: &Path) -> MaterializedProcessEnvironment {
    MaterializedProcessEnvironment {
        name: name.to_owned(),
        value: Zeroizing::new(
            path.to_str()
                .expect("fixture path must be Unicode")
                .to_owned(),
        ),
    }
}

pub(super) fn read_text(reader: &mut dyn Read, label: &str) -> String {
    let mut output = String::new();
    reader
        .read_to_string(&mut output)
        .unwrap_or_else(|error| panic!("read {label}: {error}"));
    output
}

fn read_owned_text(mut reader: impl Read) -> String {
    let mut output = String::new();
    reader
        .read_to_string(&mut output)
        .expect("read child output");
    output
}

pub(super) fn find_marker<'a>(output: &'a str, prefix: &str) -> &'a str {
    output
        .lines()
        .find(|line| line.starts_with(prefix))
        .unwrap_or_else(|| panic!("missing stable fixture marker {prefix}"))
}

pub(super) fn assert_journal_empty(root: &Path) {
    assert_eq!(
        fs::read_dir(root)
            .expect("read journal root")
            .collect::<Result<Vec<_>, _>>()
            .expect("enumerate journal root")
            .len(),
        0,
        "durable lease journal was not fully reconciled"
    );
}

pub(super) fn unique_operation_id() -> String {
    let mut bytes = [0_u8; 16];
    fill(&mut bytes).expect("generate unique operation id");
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

pub(super) struct OwnerLossReady {
    pub parent_pid: u32,
    pub descendant_pid: u32,
    pub breakaway_denied: bool,
}

pub(super) struct TestRoot(PathBuf);

impl TestRoot {
    pub(super) fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "aistaff-windows-process-{label}-{}",
            unique_operation_id()
        ));
        fs::create_dir(&root).expect("create Windows runtime fixture root");
        Self(root.canonicalize().expect("canonical runtime fixture root"))
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    pub(super) fn create_directory(&self, name: &str) -> PathBuf {
        let directory = self.0.join(name);
        fs::create_dir(&directory).expect("create runtime fixture directory");
        directory
            .canonicalize()
            .expect("canonical runtime fixture directory")
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        if thread::panicking() {
            return;
        }
        let _ = fs::remove_dir_all(&self.0);
    }
}
