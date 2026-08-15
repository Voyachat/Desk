use super::contracts::{CancelReason, SideEffectClass};
use super::process_execution::{NativeProcessExecutionSnapshot, NativeProcessExecutionSpec};
use super::process_execution_contracts::{ProcessExecutionSideEffectState, ProcessExecutionState};
use super::process_output::{OutputBudget, redact_output};
use super::process_sandbox::SandboxedProcessChild;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MONITOR_INTERVAL: Duration = Duration::from_millis(5);

pub(super) fn monitor_process(
    child: &mut dyn SandboxedProcessChild,
    spec: &NativeProcessExecutionSpec,
    cancel_receiver: mpsc::Receiver<CancelReason>,
    budget: Arc<OutputBudget>,
    stdout_reader: JoinHandle<Vec<u8>>,
    stderr_reader: JoinHandle<Vec<u8>>,
    snapshot: Arc<Mutex<NativeProcessExecutionSnapshot>>,
) {
    let terminal = wait_for_process(child, spec, cancel_receiver, &budget);
    let terminal = finalize_process_output(spec, &budget, stdout_reader, stderr_reader, terminal);
    if let Ok(mut current) = snapshot.lock() {
        *current = terminal;
    }
}

pub(super) fn running_snapshot(side_effect: SideEffectClass) -> NativeProcessExecutionSnapshot {
    terminal_snapshot(
        side_effect,
        ProcessExecutionState::Running,
        None,
        "LOCAL_PROCESS_EXECUTION_RUNNING",
    )
}

fn wait_for_process(
    child: &mut dyn SandboxedProcessChild,
    spec: &NativeProcessExecutionSpec,
    cancel_receiver: mpsc::Receiver<CancelReason>,
    budget: &OutputBudget,
) -> NativeProcessExecutionSnapshot {
    let deadline = Instant::now() + spec.timeout;
    loop {
        if cancel_receiver.try_recv().is_ok() {
            return terminate_process(
                child,
                spec.side_effect,
                ProcessExecutionState::Cancelled,
                "LOCAL_PROCESS_EXECUTION_CANCELLED",
            );
        }
        if budget.truncated() {
            return terminate_process(
                child,
                spec.side_effect,
                ProcessExecutionState::Failed,
                "LOCAL_PROCESS_OUTPUT_LIMIT_EXCEEDED",
            );
        }
        if Instant::now() >= deadline {
            return terminate_process(
                child,
                spec.side_effect,
                ProcessExecutionState::TimedOut,
                "LOCAL_PROCESS_EXECUTION_TIMEOUT",
            );
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                return terminal_snapshot(
                    spec.side_effect,
                    ProcessExecutionState::Completed,
                    status.code(),
                    "LOCAL_PROCESS_EXECUTION_COMPLETED",
                );
            }
            Ok(Some(status)) => {
                return terminal_snapshot(
                    spec.side_effect,
                    ProcessExecutionState::Failed,
                    status.code(),
                    "LOCAL_PROCESS_EXECUTION_FAILED",
                );
            }
            Ok(None) => thread::sleep(MONITOR_INTERVAL),
            Err(_) => {
                return terminate_process(
                    child,
                    spec.side_effect,
                    ProcessExecutionState::Unknown,
                    "LOCAL_PROCESS_WAIT_UNKNOWN",
                );
            }
        }
    }
}

fn finalize_process_output(
    spec: &NativeProcessExecutionSpec,
    budget: &OutputBudget,
    stdout_reader: JoinHandle<Vec<u8>>,
    stderr_reader: JoinHandle<Vec<u8>>,
    mut terminal: NativeProcessExecutionSnapshot,
) -> NativeProcessExecutionSnapshot {
    let stdout_capture = stdout_reader.join();
    let stderr_capture = stderr_reader.join();
    if stdout_capture.is_err() || stderr_capture.is_err() || budget.read_failed() {
        terminal = terminal_snapshot(
            spec.side_effect,
            ProcessExecutionState::Unknown,
            None,
            "LOCAL_PROCESS_OUTPUT_CAPTURE_UNKNOWN",
        );
    } else if budget.truncated()
        && !matches!(
            terminal.execution_state,
            ProcessExecutionState::Cancelled
                | ProcessExecutionState::TimedOut
                | ProcessExecutionState::Unknown
        )
    {
        terminal = terminal_snapshot(
            spec.side_effect,
            ProcessExecutionState::Failed,
            None,
            "LOCAL_PROCESS_OUTPUT_LIMIT_EXCEEDED",
        );
    }
    let stdout = redact_output(
        stdout_capture.unwrap_or_default(),
        spec.environment.iter().map(|entry| entry.value.as_str()),
    );
    let stderr = redact_output(
        stderr_capture.unwrap_or_default(),
        spec.environment.iter().map(|entry| entry.value.as_str()),
    );
    NativeProcessExecutionSnapshot {
        stdout,
        stderr,
        output_truncated: budget.truncated(),
        ..terminal
    }
}

fn terminate_process(
    child: &mut dyn SandboxedProcessChild,
    side_effect: SideEffectClass,
    intended_state: ProcessExecutionState,
    reason_code: &'static str,
) -> NativeProcessExecutionSnapshot {
    let kill_result = child.kill();
    let wait_result = child.wait();
    if kill_result.is_ok() && wait_result.is_ok() {
        terminal_snapshot(side_effect, intended_state, None, reason_code)
    } else {
        terminal_snapshot(
            side_effect,
            ProcessExecutionState::Unknown,
            None,
            "LOCAL_PROCESS_TERMINATION_UNKNOWN",
        )
    }
}

fn terminal_snapshot(
    side_effect: SideEffectClass,
    execution_state: ProcessExecutionState,
    exit_code: Option<i32>,
    reason_code: &'static str,
) -> NativeProcessExecutionSnapshot {
    NativeProcessExecutionSnapshot {
        execution_state,
        side_effect_state: match side_effect {
            SideEffectClass::ReadOnly => ProcessExecutionSideEffectState::None,
            SideEffectClass::Mutation => ProcessExecutionSideEffectState::Unknown,
        },
        exit_code,
        stdout: Vec::new(),
        stderr: Vec::new(),
        output_truncated: false,
        reason_code,
    }
}
