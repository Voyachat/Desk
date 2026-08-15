use super::contracts::{
    AdapterKind, CancelReason, CapabilityRequest, LocalCapabilityError, is_lower_sha256,
    is_lower_uuid, validate_protocol,
};
use super::process_contracts::ProcessDescriptorAdmitInput;
use serde::{Deserialize, Serialize};

pub const LOCAL_PROCESS_EXECUTION_COMMANDS: [&str; 3] = [
    "capability.process.execution.start",
    "capability.process.execution.cancel",
    "capability.process.execution.reconcile",
];
pub const LOCAL_PROCESS_EXECUTION_CAPABILITY_ID: &str = "local_process_execution.v1";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessExecutionStartInput {
    pub protocol_version: String,
    pub capability_request: CapabilityRequest,
    pub descriptor_request: ProcessDescriptorAdmitInput,
    pub expected_process_descriptor_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessExecutionCancelInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub request_hash: String,
    pub reason: CancelReason,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessObservedSideEffectState {
    None,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessExecutionReconcileInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub request_hash: String,
    pub observed_side_effect_state: ProcessObservedSideEffectState,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessExecutionState {
    Running,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessExecutionSideEffectState {
    None,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessExecutionEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub process_descriptor_hash: String,
    pub executable_fingerprint: String,
    pub stdout_sha256: Option<String>,
    pub stderr_sha256: Option<String>,
    pub cloud_audit_ref: String,
    pub side_effect_state: ProcessExecutionSideEffectState,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessExecutionStartResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub process_descriptor_hash: String,
    pub executable_fingerprint: String,
    pub execution_state: ProcessExecutionState,
    pub side_effect_state: ProcessExecutionSideEffectState,
    pub execution_mode: &'static str,
    pub production_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessExecutionCancelResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub cancel_status: &'static str,
    pub execution_state: ProcessExecutionState,
    pub side_effect_state: ProcessExecutionSideEffectState,
    pub production_enabled: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessExecutionReconcileResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub decision: &'static str,
    pub execution_state: ProcessExecutionState,
    pub side_effect_state: ProcessExecutionSideEffectState,
    pub exit_code: Option<i32>,
    pub stdout_encoding: Option<&'static str>,
    pub stdout_base64: Option<String>,
    pub stdout_bytes: u64,
    pub stdout_sha256: Option<String>,
    pub stderr_encoding: Option<&'static str>,
    pub stderr_base64: Option<String>,
    pub stderr_bytes: u64,
    pub stderr_sha256: Option<String>,
    pub output_truncated: bool,
    pub production_enabled: bool,
    pub reason_code: &'static str,
    pub evidence: Option<ProcessExecutionEvidence>,
}

pub fn is_local_process_execution_command(command: &str) -> bool {
    LOCAL_PROCESS_EXECUTION_COMMANDS.contains(&command)
}

impl ProcessExecutionStartInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.capability_request.validate()?;
        self.descriptor_request.validate()?;
        if !is_lower_sha256(&self.expected_process_descriptor_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_EXECUTION_DESCRIPTOR_HASH",
            ));
        }
        if self.capability_request.operation.adapter_kind != AdapterKind::Process
            || self.capability_request.operation.operation_id
                != self.descriptor_request.operation_id
            || self.capability_request.operation.descriptor_hash
                != self.expected_process_descriptor_hash
            || self.capability_request.scope != self.descriptor_request.scope
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_BINDING_MISMATCH",
            ));
        }
        Ok(())
    }
}

impl ProcessExecutionCancelInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        validate_operation_request_hash(&self.operation_id, &self.request_hash)
    }
}

impl ProcessExecutionReconcileInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        validate_operation_request_hash(&self.operation_id, &self.request_hash)
    }
}

fn validate_operation_request_hash(
    operation_id: &str,
    request_hash: &str,
) -> Result<(), LocalCapabilityError> {
    if !is_lower_uuid(operation_id) || !is_lower_sha256(request_hash) {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_PROCESS_EXECUTION_REFERENCE",
        ));
    }
    Ok(())
}
