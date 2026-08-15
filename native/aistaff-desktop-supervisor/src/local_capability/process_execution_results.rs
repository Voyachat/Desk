use super::capability_hash::digest_hex;
use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::process_execution::{NativeProcessExecutionSnapshot, ProcessCancelOutcome};
use super::process_execution_contracts::{
    LOCAL_PROCESS_EXECUTION_CAPABILITY_ID, ProcessExecutionCancelInput,
    ProcessExecutionCancelResult, ProcessExecutionEvidence, ProcessExecutionReconcileInput,
    ProcessExecutionReconcileResult, ProcessExecutionSideEffectState, ProcessExecutionStartInput,
    ProcessExecutionStartResult, ProcessExecutionState, ProcessObservedSideEffectState,
};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub(super) struct ProcessExecutionRecord {
    pub operation_id: String,
    pub request_hash: String,
    pub policy_handle: String,
    pub process_descriptor_hash: String,
    pub executable_fingerprint: String,
    pub cloud_audit_ref: String,
}

pub(super) fn start_result(
    input: &ProcessExecutionStartInput,
    request_hash: String,
    process_descriptor_hash: String,
    executable_fingerprint: String,
    snapshot: NativeProcessExecutionSnapshot,
    replayed: bool,
) -> ProcessExecutionStartResult {
    ProcessExecutionStartResult {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id: input.capability_request.operation.operation_id.clone(),
        request_hash,
        process_descriptor_hash,
        executable_fingerprint,
        execution_state: snapshot.execution_state,
        side_effect_state: snapshot.side_effect_state,
        execution_mode: "test_only",
        production_enabled: false,
        idempotency_replayed: replayed,
        reason_code: "LOCAL_PROCESS_EXECUTION_STARTED_TEST_ONLY",
    }
}

pub(super) fn cancel_result(
    input: ProcessExecutionCancelInput,
    outcome: ProcessCancelOutcome,
    snapshot: NativeProcessExecutionSnapshot,
) -> ProcessExecutionCancelResult {
    let (cancel_status, reason_code) = match outcome {
        ProcessCancelOutcome::Requested => ("cancel_requested", "LOCAL_PROCESS_CANCEL_REQUESTED"),
        ProcessCancelOutcome::AlreadyTerminal => {
            ("already_terminal", "LOCAL_PROCESS_ALREADY_TERMINAL")
        }
        ProcessCancelOutcome::NotFound => ("not_found", "LOCAL_PROCESS_EXECUTION_NOT_FOUND"),
    };
    ProcessExecutionCancelResult {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
        operation_id: input.operation_id,
        request_hash: input.request_hash,
        cancel_status,
        execution_state: snapshot.execution_state,
        side_effect_state: snapshot.side_effect_state,
        production_enabled: false,
        reason_code,
    }
}

pub(super) fn reconcile_result(
    input: ProcessExecutionReconcileInput,
    record: ProcessExecutionRecord,
    snapshot: NativeProcessExecutionSnapshot,
) -> Result<ProcessExecutionReconcileResult, LocalCapabilityError> {
    let side_effect_state = conservative_side_effect_state(
        input.observed_side_effect_state,
        snapshot.side_effect_state,
    );
    if snapshot.execution_state == ProcessExecutionState::Running {
        return Ok(in_progress_reconcile(input, side_effect_state));
    }
    let stdout_sha256 = digest_hex(Sha256::digest(&snapshot.stdout).as_slice())?;
    let stderr_sha256 = digest_hex(Sha256::digest(&snapshot.stderr).as_slice())?;
    let requires_handoff = side_effect_state == ProcessExecutionSideEffectState::Unknown
        || snapshot.execution_state == ProcessExecutionState::Unknown
        || snapshot.output_truncated;
    let evidence = ProcessExecutionEvidence {
        schema_version: "aistaff.local-process-execution-evidence.v1",
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id: input.operation_id.clone(),
        request_hash: input.request_hash.clone(),
        process_descriptor_hash: record.process_descriptor_hash,
        executable_fingerprint: record.executable_fingerprint,
        stdout_sha256: Some(stdout_sha256.clone()),
        stderr_sha256: Some(stderr_sha256.clone()),
        cloud_audit_ref: record.cloud_audit_ref,
        side_effect_state,
        redaction_profile: "bounded_process_output.v1",
    };
    Ok(ProcessExecutionReconcileResult {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id: input.operation_id,
        request_hash: input.request_hash,
        decision: if requires_handoff {
            "require_handoff"
        } else {
            "confirmed_evidence_only"
        },
        execution_state: snapshot.execution_state,
        side_effect_state,
        exit_code: snapshot.exit_code,
        stdout_encoding: Some("base64"),
        stdout_base64: Some(STANDARD.encode(&snapshot.stdout)),
        stdout_bytes: snapshot.stdout.len() as u64,
        stdout_sha256: Some(stdout_sha256),
        stderr_encoding: Some("base64"),
        stderr_base64: Some(STANDARD.encode(&snapshot.stderr)),
        stderr_bytes: snapshot.stderr.len() as u64,
        stderr_sha256: Some(stderr_sha256),
        output_truncated: snapshot.output_truncated,
        production_enabled: false,
        reason_code: snapshot.reason_code,
        evidence: Some(evidence),
    })
}

pub(super) fn unknown_reconcile(
    input: ProcessExecutionReconcileInput,
    reason_code: &'static str,
) -> ProcessExecutionReconcileResult {
    let mut result = in_progress_reconcile(input, ProcessExecutionSideEffectState::Unknown);
    result.decision = "require_handoff";
    result.execution_state = ProcessExecutionState::Unknown;
    result.reason_code = reason_code;
    result
}

pub(super) fn unknown_snapshot(reason_code: &'static str) -> NativeProcessExecutionSnapshot {
    NativeProcessExecutionSnapshot {
        execution_state: ProcessExecutionState::Unknown,
        side_effect_state: ProcessExecutionSideEffectState::Unknown,
        exit_code: None,
        stdout: Vec::new(),
        stderr: Vec::new(),
        output_truncated: false,
        reason_code,
    }
}

fn conservative_side_effect_state(
    observed: ProcessObservedSideEffectState,
    local: ProcessExecutionSideEffectState,
) -> ProcessExecutionSideEffectState {
    if observed == ProcessObservedSideEffectState::Unknown
        || local == ProcessExecutionSideEffectState::Unknown
    {
        ProcessExecutionSideEffectState::Unknown
    } else {
        ProcessExecutionSideEffectState::None
    }
}

fn in_progress_reconcile(
    input: ProcessExecutionReconcileInput,
    side_effect_state: ProcessExecutionSideEffectState,
) -> ProcessExecutionReconcileResult {
    ProcessExecutionReconcileResult {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id: input.operation_id,
        request_hash: input.request_hash,
        decision: "in_progress",
        execution_state: ProcessExecutionState::Running,
        side_effect_state,
        exit_code: None,
        stdout_encoding: None,
        stdout_base64: None,
        stdout_bytes: 0,
        stdout_sha256: None,
        stderr_encoding: None,
        stderr_base64: None,
        stderr_bytes: 0,
        stderr_sha256: None,
        output_truncated: false,
        production_enabled: false,
        reason_code: "LOCAL_PROCESS_EXECUTION_RUNNING",
        evidence: None,
    }
}
