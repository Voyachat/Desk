use serde::{Deserialize, Serialize};

pub const LOCAL_CAPABILITY_PROTOCOL_VERSION: &str = "aistaff.local-capability.v1";
pub const LOCAL_CAPABILITY_SUPERVISOR_CAPABILITY: &str = "local_capability_broker.v1";
pub const LOCAL_CAPABILITY_COMMANDS: [&str; 4] = [
    "capability.capabilities",
    "capability.evaluate",
    "capability.cancel",
    "capability.reconcile",
];

const MAX_RESOURCE_ID_BYTES: usize = 180;
const MAX_REVISION_BYTES: usize = 180;
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    File,
    Directory,
    Browser,
    Mcp,
    Process,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterAvailability {
    AdapterUnavailable,
    PathAdmissionOnly,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionOutcome {
    Allow,
    Deny,
    RequireApproval,
    RequireTask,
    RequireHandoff,
    RequireMoreContext,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionStatus {
    Verified,
    Unverified,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectClass {
    ReadOnly,
    Mutation,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationState {
    NotRequired,
    Confirmed,
    Missing,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecision {
    Deny,
    RequireConfirmation,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CancelReason {
    UserRequested,
    PolicyRevoked,
    Shutdown,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObservedSideEffectState {
    None,
    Confirmed,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReconcileDecision {
    Deny,
    RequireHandoff,
    RequireReconcile,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AdapterStatus {
    pub adapter_kind: AdapterKind,
    pub availability: AdapterAvailability,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapabilityBrokerCapabilities {
    pub protocol_version: &'static str,
    pub availability: &'static str,
    pub execution_enabled: bool,
    pub adapters: Vec<AdapterStatus>,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityScope {
    pub tenant_id: String,
    pub session_id: String,
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityAuthorization {
    pub tenant_id: String,
    pub source_decision_id: String,
    pub outcome: DecisionOutcome,
    pub action_id: String,
    pub capability_id: String,
    pub resource_revision: String,
    pub policy_revision: String,
    pub audit_ref: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityArtifact {
    pub artifact_id: String,
    pub artifact_version: String,
    pub artifact_sha256: String,
    pub admission_status: AdmissionStatus,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityOperation {
    pub operation_id: String,
    pub idempotency_key: String,
    pub action_id: String,
    pub capability_id: String,
    pub expected_revision: String,
    pub adapter_kind: AdapterKind,
    pub side_effect: SideEffectClass,
    pub risk_level: RiskLevel,
    pub descriptor_hash: String,
    pub confirmation: ConfirmationState,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequest {
    pub protocol_version: String,
    pub scope: CapabilityScope,
    pub authorization: CapabilityAuthorization,
    pub artifact: CapabilityArtifact,
    pub operation: CapabilityOperation,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapabilityEvidence {
    pub schema_version: &'static str,
    pub request_hash: String,
    pub operation_id: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapabilityEvaluationResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub decision: PolicyDecision,
    pub execution_state: &'static str,
    pub reason_code: &'static str,
    pub request_hash: String,
    pub idempotency_replayed: bool,
    pub evidence: CapabilityEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityCancelInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub reason: CancelReason,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapabilityCancelResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub cancel_status: &'static str,
    pub execution_state: &'static str,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityReconcileInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub request_hash: String,
    pub observed_side_effect_state: ObservedSideEffectState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapabilityReconcileResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub decision: ReconcileDecision,
    pub execution_state: &'static str,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalCapabilityError {
    pub code: &'static str,
}

impl LocalCapabilityError {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub fn is_local_capability_command(command: &str) -> bool {
    LOCAL_CAPABILITY_COMMANDS.contains(&command)
}

pub(super) fn is_safe_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value.len() <= MAX_RESOURCE_ID_BYTES
        && bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn is_bounded_revision(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_REVISION_BYTES && !value.contains('\0')
}

pub(super) fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

pub(super) fn is_lower_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && value.bytes().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index) || byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
        })
}

pub(super) fn validate_protocol(protocol_version: &str) -> Result<(), LocalCapabilityError> {
    if protocol_version != LOCAL_CAPABILITY_PROTOCOL_VERSION {
        return Err(LocalCapabilityError::new(
            "LOCAL_CAPABILITY_PROTOCOL_MISMATCH",
        ));
    }
    Ok(())
}

impl CapabilityScope {
    pub(super) fn validate(&self) -> Result<(), LocalCapabilityError> {
        for identifier in [&self.tenant_id, &self.session_id, &self.run_id] {
            if !is_safe_identifier(identifier) {
                return Err(LocalCapabilityError::new(
                    "INVALID_LOCAL_CAPABILITY_IDENTIFIER",
                ));
            }
        }
        Ok(())
    }
}

impl CapabilityRequest {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        for identifier in [
            &self.authorization.tenant_id,
            &self.authorization.source_decision_id,
            &self.authorization.action_id,
            &self.authorization.capability_id,
            &self.authorization.audit_ref,
            &self.artifact.artifact_id,
            &self.operation.action_id,
            &self.operation.capability_id,
        ] {
            if !is_safe_identifier(identifier) {
                return Err(LocalCapabilityError::new(
                    "INVALID_LOCAL_CAPABILITY_IDENTIFIER",
                ));
            }
        }
        for revision in [
            &self.authorization.resource_revision,
            &self.authorization.policy_revision,
            &self.artifact.artifact_version,
            &self.operation.expected_revision,
        ] {
            if !is_bounded_revision(revision) {
                return Err(LocalCapabilityError::new(
                    "INVALID_LOCAL_CAPABILITY_REVISION",
                ));
            }
        }
        if self.authorization.expires_at_ms == 0
            || self.authorization.expires_at_ms > JAVASCRIPT_MAX_SAFE_INTEGER
        {
            return Err(LocalCapabilityError::new("INVALID_LOCAL_CAPABILITY_EXPIRY"));
        }
        if !is_lower_sha256(&self.artifact.artifact_sha256)
            || !is_lower_sha256(&self.operation.descriptor_hash)
        {
            return Err(LocalCapabilityError::new("INVALID_LOCAL_CAPABILITY_HASH"));
        }
        if !is_lower_uuid(&self.operation.operation_id)
            || !is_lower_uuid(&self.operation.idempotency_key)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_CAPABILITY_OPERATION_ID",
            ));
        }
        Ok(())
    }
}

impl CapabilityCancelInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_CAPABILITY_OPERATION_ID",
            ));
        }
        Ok(())
    }
}

impl CapabilityReconcileInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_CAPABILITY_OPERATION_ID",
            ));
        }
        if !is_lower_sha256(&self.request_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_CAPABILITY_REQUEST_HASH",
            ));
        }
        Ok(())
    }
}
