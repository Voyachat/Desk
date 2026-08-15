use super::browser_contracts::BrowserDescriptorAdmitInput;
use super::contracts::{
    AdapterKind, AdmissionStatus, CapabilityRequest, ConfirmationState, DecisionOutcome,
    LocalCapabilityError, SideEffectClass, is_lower_sha256, validate_protocol,
};
use serde::{Deserialize, Serialize};

pub const LOCAL_BROWSER_EXECUTION_COMMANDS: [&str; 1] = ["capability.browser.execution.navigate"];
pub const LOCAL_BROWSER_EXECUTION_CAPABILITY_ID: &str = "local_browser_execution.v1";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserExecutionNavigateInput {
    pub protocol_version: String,
    pub capability_request: CapabilityRequest,
    pub descriptor_request: BrowserDescriptorAdmitInput,
    pub expected_browser_descriptor_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserExecutionEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub browser_descriptor_hash: String,
    pub expected_origin: String,
    pub cloud_audit_ref: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserExecutionNavigateResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub browser_descriptor_hash: String,
    pub expected_origin: String,
    pub execution_state: &'static str,
    pub execution_mode: &'static str,
    pub production_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: BrowserExecutionEvidence,
}

pub fn is_local_browser_execution_command(command: &str) -> bool {
    LOCAL_BROWSER_EXECUTION_COMMANDS.contains(&command)
}

impl BrowserExecutionNavigateInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.capability_request.validate()?;
        self.descriptor_request.validate()?;
        if !is_lower_sha256(&self.expected_browser_descriptor_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_EXECUTION_DESCRIPTOR_HASH",
            ));
        }
        if self.capability_request.operation.adapter_kind != AdapterKind::Browser
            || self.capability_request.operation.side_effect != SideEffectClass::ReadOnly
            || self.capability_request.operation.operation_id
                != self.descriptor_request.operation_id
            || self.capability_request.operation.action_id
                != self.capability_request.authorization.action_id
            || self.capability_request.operation.capability_id
                != self.capability_request.authorization.capability_id
            || self.capability_request.operation.expected_revision
                != self.capability_request.authorization.resource_revision
            || self.capability_request.operation.descriptor_hash
                != self.expected_browser_descriptor_hash
            || self.capability_request.scope != self.descriptor_request.scope
            || self.capability_request.authorization.tenant_id
                != self.capability_request.scope.tenant_id
            || self.capability_request.authorization.outcome != DecisionOutcome::Allow
            || self.capability_request.artifact.admission_status != AdmissionStatus::Verified
            || self.capability_request.operation.confirmation != ConfirmationState::Confirmed
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_EXECUTION_BINDING_MISMATCH",
            ));
        }
        Ok(())
    }
}
