use super::contracts::{CancelReason, CapabilityScope, LocalCapabilityError, SideEffectClass};
use super::file_contracts::FileTargetKind;
use super::file_path::{FileSnapshot, reject_unsafe_absolute_components, safe_metadata, snapshot};
use super::process_contracts::{ProcessTarget, current_process_target};
use super::process_executable::validate_executable_type;
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_execution_contracts::{ProcessExecutionSideEffectState, ProcessExecutionState};
use super::process_execution_monitor::{monitor_process, running_snapshot};
use super::process_output::{OutputBudget, read_bounded_output};
use super::process_resource_policy::ProcessResourcePolicy;
use super::process_sandbox::ProcessSandboxPort;
use super::process_sandbox::SandboxedProcessChild;
#[cfg(test)]
use super::process_sandbox::TestOnlyProcessSandboxPort;
#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
use super::process_sandbox::UnavailableProcessSandboxPort;
use super::process_secret_store::PROCESS_SECRET_MAX_BYTES;
pub(super) use super::process_spawn_spec::MaterializedProcessEnvironment;
use super::process_spawn_spec::SandboxedProcessSpawnSpec;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const MAX_EXECUTION_HANDLES: usize = 128;
const MAX_INHERITED_ENVIRONMENT_BYTES: usize = 4 * 1024;
const INHERITED_ENVIRONMENT_KEYS: [&str; 8] = [
    "SystemDrive",
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
];

pub(super) struct NativeProcessExecutionSpec {
    pub capability_id: &'static str,
    pub operation_id: String,
    pub scope: CapabilityScope,
    pub executable_path: PathBuf,
    pub argv: Vec<String>,
    pub environment: Vec<MaterializedProcessEnvironment>,
    pub working_directory: Option<PathBuf>,
    pub timeout: Duration,
    pub output_limit_bytes: usize,
    pub side_effect: SideEffectClass,
    pub target: ProcessTarget,
    pub resource_policy: ProcessResourcePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NativeProcessExecutionSnapshot {
    pub execution_state: ProcessExecutionState,
    pub side_effect_state: ProcessExecutionSideEffectState,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub output_truncated: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProcessCancelOutcome {
    Requested,
    AlreadyTerminal,
    NotFound,
}

struct ProcessExecutionHandle {
    cancel: Sender<CancelReason>,
    snapshot: Arc<Mutex<NativeProcessExecutionSnapshot>>,
    monitor: Option<JoinHandle<()>>,
}

pub(super) struct NativeProcessExecutionEngine {
    handles: HashMap<String, ProcessExecutionHandle>,
    sandbox: Box<dyn ProcessSandboxPort>,
}

impl NativeProcessExecutionEngine {
    #[cfg(test)]
    pub fn new() -> Self {
        Self {
            handles: HashMap::new(),
            sandbox: Box::new(TestOnlyProcessSandboxPort),
        }
    }

    #[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
    pub(super) fn with_unavailable_sandbox() -> Self {
        Self {
            handles: HashMap::new(),
            sandbox: Box::new(UnavailableProcessSandboxPort),
        }
    }

    pub fn start(
        &mut self,
        spec: NativeProcessExecutionSpec,
    ) -> Result<NativeProcessExecutionSnapshot, LocalCapabilityError> {
        if self.handles.contains_key(&spec.operation_id) {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_OPERATION_REUSED",
            ));
        }
        if self.handles.len() >= MAX_EXECUTION_HANDLES {
            self.prune_finished();
        }
        if self.handles.len() >= MAX_EXECUTION_HANDLES {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_CAPACITY_REACHED",
            ));
        }
        validate_spec(&spec)?;
        let running = running_snapshot(spec.side_effect);
        let snapshot = Arc::new(Mutex::new(running.clone()));
        let (cancel, cancel_receiver) = mpsc::channel();
        let operation_id = spec.operation_id.clone();
        let monitor_snapshot = snapshot.clone();
        let monitor = spawn_monitored_process(
            self.sandbox.as_mut(),
            spec,
            cancel_receiver,
            monitor_snapshot,
        )?;
        self.handles.insert(
            operation_id,
            ProcessExecutionHandle {
                cancel,
                snapshot,
                monitor: Some(monitor),
            },
        );
        Ok(running)
    }

    pub fn cancel(&mut self, operation_id: &str, reason: CancelReason) -> ProcessCancelOutcome {
        let Some(handle) = self.handles.get_mut(operation_id) else {
            return ProcessCancelOutcome::NotFound;
        };
        if snapshot_is_terminal(&handle.snapshot) {
            join_monitor(handle);
            return ProcessCancelOutcome::AlreadyTerminal;
        }
        if handle.cancel.send(reason).is_err() {
            join_monitor(handle);
            return ProcessCancelOutcome::AlreadyTerminal;
        }
        ProcessCancelOutcome::Requested
    }

    pub fn snapshot(&mut self, operation_id: &str) -> Option<NativeProcessExecutionSnapshot> {
        let handle = self.handles.get_mut(operation_id)?;
        let snapshot = handle.snapshot.lock().ok()?.clone();
        if is_terminal(snapshot.execution_state) {
            join_monitor(handle);
        }
        Some(snapshot)
    }

    pub fn discard_terminal(&mut self, operation_id: &str) -> bool {
        let Some(handle) = self.handles.get_mut(operation_id) else {
            return true;
        };
        if !snapshot_is_terminal(&handle.snapshot) {
            return false;
        }
        join_monitor(handle);
        self.handles.remove(operation_id);
        true
    }

    fn prune_finished(&mut self) {
        self.handles.retain(|_, handle| {
            if snapshot_is_terminal(&handle.snapshot) {
                join_monitor(handle);
                false
            } else {
                true
            }
        });
    }
}

impl Drop for NativeProcessExecutionEngine {
    fn drop(&mut self) {
        for handle in self.handles.values_mut() {
            let _ = handle.cancel.send(CancelReason::Shutdown);
            join_monitor(handle);
        }
    }
}

fn spawn_monitored_process(
    sandbox: &mut dyn ProcessSandboxPort,
    spec: NativeProcessExecutionSpec,
    cancel_receiver: mpsc::Receiver<CancelReason>,
    snapshot: Arc<Mutex<NativeProcessExecutionSnapshot>>,
) -> Result<JoinHandle<()>, LocalCapabilityError> {
    let before = validate_launch_path(&spec.executable_path)?;
    let working_directory_before = spec
        .working_directory
        .as_deref()
        .map(validate_working_directory)
        .transpose()?;
    let spawn_spec = SandboxedProcessSpawnSpec {
        capability_id: spec.capability_id,
        operation_id: &spec.operation_id,
        scope: &spec.scope,
        executable_path: &spec.executable_path,
        argv: &spec.argv,
        inherited_environment: inherited_environment(std::env::vars()),
        environment: &spec.environment,
        working_directory: spec.working_directory.as_deref(),
        target: spec.target,
        resource_policy: &spec.resource_policy,
    };
    let mut child = sandbox.spawn(spawn_spec)?;
    revalidate_and_resume_child(child.as_mut(), &spec, &before, &working_directory_before)?;
    let Some(stdout) = child.take_stdout() else {
        terminate_failed_spawn(child.as_mut());
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_STDOUT_UNAVAILABLE",
        ));
    };
    let Some(stderr) = child.take_stderr() else {
        terminate_failed_spawn(child.as_mut());
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_STDERR_UNAVAILABLE",
        ));
    };
    let budget = Arc::new(OutputBudget::new(spec.output_limit_bytes));
    let stdout_budget = budget.clone();
    let stderr_budget = budget.clone();
    let stdout_reader = thread::spawn(move || read_bounded_output(stdout, stdout_budget));
    let stderr_reader = thread::spawn(move || read_bounded_output(stderr, stderr_budget));
    Ok(thread::spawn(move || {
        monitor_process(
            child.as_mut(),
            &spec,
            cancel_receiver,
            budget,
            stdout_reader,
            stderr_reader,
            snapshot,
        );
    }))
}

fn revalidate_and_resume_child(
    child: &mut dyn SandboxedProcessChild,
    spec: &NativeProcessExecutionSpec,
    executable_before: &FileSnapshot,
    working_directory_before: &Option<FileSnapshot>,
) -> Result<(), LocalCapabilityError> {
    let after = validate_launch_path(&spec.executable_path);
    let working_directory_after = spec
        .working_directory
        .as_deref()
        .map(validate_working_directory)
        .transpose();
    if !matches!(after, Ok(ref observed) if observed == executable_before) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_IDENTITY_CHANGED",
        ));
    }
    if !matches!(working_directory_after, Ok(ref observed) if observed == working_directory_before)
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_IDENTITY_CHANGED",
        ));
    }
    if child.resume().is_err() {
        terminate_failed_spawn(child);
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_SANDBOX_RESUME_FAILED",
        ));
    }
    Ok(())
}

fn validate_launch_path(path: &std::path::Path) -> Result<FileSnapshot, LocalCapabilityError> {
    reject_unsafe_absolute_components(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED"))?;
    let metadata = safe_metadata(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
    validate_executable_type(path, &metadata)?;
    let observed = snapshot(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
    if observed.kind != FileTargetKind::File {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_TYPE_REJECTED",
        ));
    }
    Ok(observed)
}

fn validate_working_directory(
    path: &std::path::Path,
) -> Result<FileSnapshot, LocalCapabilityError> {
    reject_unsafe_absolute_components(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_WORKING_DIRECTORY_REJECTED"))?;
    let canonical = path
        .canonicalize()
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_WORKING_DIRECTORY_UNAVAILABLE"))?;
    reject_unsafe_absolute_components(&canonical)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_WORKING_DIRECTORY_REJECTED"))?;
    let observed = snapshot(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_WORKING_DIRECTORY_UNAVAILABLE"))?;
    let canonical_observed = snapshot(&canonical)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_WORKING_DIRECTORY_UNAVAILABLE"))?;
    if observed != canonical_observed {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_IDENTITY_CHANGED",
        ));
    }
    if observed.kind != FileTargetKind::Directory {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_TYPE_REJECTED",
        ));
    }
    Ok(observed)
}

fn terminate_failed_spawn(child: &mut dyn SandboxedProcessChild) {
    let _ = child.kill();
    let _ = child.wait();
}

fn validate_spec(spec: &NativeProcessExecutionSpec) -> Result<(), LocalCapabilityError> {
    if spec.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
        || !spec.executable_path.is_absolute()
        || spec.timeout.is_zero()
        || spec.output_limit_bytes == 0
        || spec.environment.iter().any(|entry| {
            entry.name.is_empty()
                || entry.value.is_empty()
                || entry.value.len() > PROCESS_SECRET_MAX_BYTES
                || entry.value.contains('\0')
                || entry.value.chars().any(char::is_control)
        })
    {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_PROCESS_EXECUTION_SPEC",
        ));
    }
    spec.scope.validate()?;
    if current_process_target() != Some(spec.target) {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_SANDBOX_TARGET_MISMATCH",
        ));
    }
    spec.resource_policy.validate()?;
    Ok(())
}

pub(super) fn inherited_environment(
    source: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    let source = source.into_iter().collect::<Vec<_>>();
    INHERITED_ENVIRONMENT_KEYS
        .into_iter()
        .filter_map(|allowed| {
            let mut matches = source
                .iter()
                .filter(|(name, _)| name.eq_ignore_ascii_case(allowed));
            let (_, value) = matches.next()?;
            if matches.next().is_some()
                || value.len() > MAX_INHERITED_ENVIRONMENT_BYTES
                || value.contains('\0')
            {
                return None;
            }
            Some((allowed.to_owned(), value.clone()))
        })
        .collect()
}

fn snapshot_is_terminal(snapshot: &Arc<Mutex<NativeProcessExecutionSnapshot>>) -> bool {
    snapshot
        .lock()
        .is_ok_and(|current| is_terminal(current.execution_state))
}

fn is_terminal(state: ProcessExecutionState) -> bool {
    state != ProcessExecutionState::Running
}

fn join_monitor(handle: &mut ProcessExecutionHandle) {
    if let Some(monitor) = handle.monitor.take() {
        let _ = monitor.join();
    }
}
