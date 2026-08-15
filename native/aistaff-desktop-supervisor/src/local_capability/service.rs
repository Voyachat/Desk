use super::contracts::{
    AdapterAvailability, AdapterKind, AdapterStatus, AdmissionStatus, CapabilityBrokerCapabilities,
    CapabilityCancelInput, CapabilityCancelResult, CapabilityEvaluationResult, CapabilityEvidence,
    CapabilityReconcileInput, CapabilityReconcileResult, CapabilityRequest, ConfirmationState,
    DecisionOutcome, LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError,
    ObservedSideEffectState, PolicyDecision, ReconcileDecision, RiskLevel, SideEffectClass,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, to_value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fmt::Write;
use std::time::{SystemTime, UNIX_EPOCH};

const LEDGER_CAPACITY: usize = 128;
const ADAPTER_UNAVAILABLE_REASON: &str = "CAPABILITY_ADAPTER_UNAVAILABLE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AuthorizationEvaluation {
    Authorized,
    Rejected(PolicyDecision, &'static str),
}

#[derive(Debug, Clone)]
struct LedgerEntry {
    operation_id: String,
    request_hash: String,
    result: CapabilityEvaluationResult,
}

pub trait LocalCapabilityCommandHandler {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError>;
}

pub struct LocalCapabilityBrokerService {
    entries: HashMap<String, LedgerEntry>,
    insertion_order: VecDeque<String>,
    now_ms: fn() -> u64,
}

impl Default for LocalCapabilityBrokerService {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalCapabilityBrokerService {
    pub fn new() -> Self {
        Self::with_clock(system_time_ms)
    }

    pub(crate) fn with_clock(now_ms: fn() -> u64) -> Self {
        Self {
            entries: HashMap::new(),
            insertion_order: VecDeque::new(),
            now_ms,
        }
    }

    fn capabilities(&self) -> CapabilityBrokerCapabilities {
        CapabilityBrokerCapabilities {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            availability: "policy_only",
            execution_enabled: false,
            adapters: [
                AdapterKind::File,
                AdapterKind::Directory,
                AdapterKind::Browser,
                AdapterKind::Mcp,
                AdapterKind::Process,
            ]
            .into_iter()
            .map(|adapter_kind| AdapterStatus {
                adapter_kind,
                availability: match adapter_kind {
                    AdapterKind::File | AdapterKind::Directory => {
                        AdapterAvailability::PathAdmissionOnly
                    }
                    _ => AdapterAvailability::AdapterUnavailable,
                },
                reason_code: match adapter_kind {
                    AdapterKind::File | AdapterKind::Directory => "LOCAL_FILE_PATH_ADMISSION_ONLY",
                    _ => ADAPTER_UNAVAILABLE_REASON,
                },
            })
            .collect(),
            reason_code: "CAPABILITY_POLICY_ONLY",
        }
    }

    fn evaluate(
        &mut self,
        request: CapabilityRequest,
    ) -> Result<CapabilityEvaluationResult, LocalCapabilityError> {
        request.validate()?;
        let request_hash = hash_request(&request)?;
        let idempotency_key = request.operation.idempotency_key.clone();

        if let Some(entry) = self.entries.get(&idempotency_key) {
            if entry.request_hash == request_hash {
                let mut replay = entry.result.clone();
                replay.idempotency_replayed = true;
                return Ok(replay);
            }
            return Ok(evaluation_result(
                &request,
                request_hash,
                PolicyDecision::Deny,
                "CAPABILITY_IDEMPOTENCY_CONFLICT",
            ));
        }

        let (decision, reason_code) = evaluate_policy(&request, (self.now_ms)());
        let result = evaluation_result(&request, request_hash.clone(), decision, reason_code);
        self.insert_entry(
            idempotency_key,
            LedgerEntry {
                operation_id: request.operation.operation_id.clone(),
                request_hash,
                result: result.clone(),
            },
        );
        Ok(result)
    }

    fn cancel(&self, input: CapabilityCancelInput) -> CapabilityCancelResult {
        CapabilityCancelResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id,
            cancel_status: "not_running",
            execution_state: "not_executed",
            reason_code: "CAPABILITY_OPERATION_NOT_RUNNING",
        }
    }

    fn reconcile(&self, input: CapabilityReconcileInput) -> CapabilityReconcileResult {
        let matching_entry = self.entries.values().find(|entry| {
            entry.operation_id == input.operation_id && entry.request_hash == input.request_hash
        });
        let (decision, reason_code) =
            match (matching_entry.is_some(), input.observed_side_effect_state) {
                (true, ObservedSideEffectState::None) => {
                    (ReconcileDecision::Deny, "CAPABILITY_SIDE_EFFECT_NONE")
                }
                (true, ObservedSideEffectState::Confirmed) => (
                    ReconcileDecision::RequireHandoff,
                    "CAPABILITY_UNEXPECTED_SIDE_EFFECT",
                ),
                (true, ObservedSideEffectState::Unknown) => (
                    ReconcileDecision::RequireHandoff,
                    "CAPABILITY_SIDE_EFFECT_UNKNOWN",
                ),
                (false, _) => (
                    ReconcileDecision::RequireReconcile,
                    "CAPABILITY_RECONCILIATION_RECORD_NOT_FOUND",
                ),
            };
        CapabilityReconcileResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id,
            decision,
            execution_state: "not_executed",
            reason_code,
        }
    }

    fn insert_entry(&mut self, key: String, entry: LedgerEntry) {
        if self.entries.len() == LEDGER_CAPACITY
            && let Some(oldest) = self.insertion_order.pop_front()
        {
            self.entries.remove(&oldest);
        }
        self.insertion_order.push_back(key.clone());
        self.entries.insert(key, entry);
    }
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn parse_payload<T: DeserializeOwned>(payload: Option<Value>) -> Result<T, LocalCapabilityError> {
    serde_json::from_value(
        payload.ok_or_else(|| LocalCapabilityError::new("CAPABILITY_COMMAND_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| LocalCapabilityError::new("INVALID_LOCAL_CAPABILITY_COMMAND_PAYLOAD"))
}

fn serialize_result<T: serde::Serialize>(result: T) -> Result<Value, LocalCapabilityError> {
    to_value(result)
        .map_err(|_| LocalCapabilityError::new("LOCAL_CAPABILITY_RESPONSE_SERIALIZATION_FAILED"))
}

fn hash_request(request: &CapabilityRequest) -> Result<String, LocalCapabilityError> {
    let encoded = serde_json::to_vec(request)
        .map_err(|_| LocalCapabilityError::new("LOCAL_CAPABILITY_HASH_FAILED"))?;
    let digest = Sha256::digest(encoded);
    let mut output = String::with_capacity(64);
    for byte in digest {
        write!(&mut output, "{byte:02x}")
            .map_err(|_| LocalCapabilityError::new("LOCAL_CAPABILITY_HASH_FAILED"))?;
    }
    Ok(output)
}

pub(super) fn evaluate_authorization(
    request: &CapabilityRequest,
    now_ms: u64,
) -> AuthorizationEvaluation {
    if request.scope.tenant_id != request.authorization.tenant_id {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_TENANT_SCOPE_MISMATCH",
        );
    }
    if request.operation.action_id != request.authorization.action_id {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_ACTION_SCOPE_MISMATCH",
        );
    }
    if request.operation.capability_id != request.authorization.capability_id {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_ID_SCOPE_MISMATCH",
        );
    }
    if request.operation.expected_revision != request.authorization.resource_revision {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_REVISION_SCOPE_MISMATCH",
        );
    }
    if request.authorization.outcome != DecisionOutcome::Allow {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_DECISION_NOT_ALLOWED",
        );
    }
    if request.authorization.expires_at_ms <= now_ms {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_AUTHORIZATION_EXPIRED",
        );
    }
    if request.artifact.admission_status != AdmissionStatus::Verified {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::Deny,
            "CAPABILITY_ARTIFACT_NOT_VERIFIED",
        );
    }
    let confirmation_required = request.operation.side_effect == SideEffectClass::Mutation
        || matches!(
            request.operation.risk_level,
            RiskLevel::High | RiskLevel::Critical
        );
    if confirmation_required && request.operation.confirmation != ConfirmationState::Confirmed {
        return AuthorizationEvaluation::Rejected(
            PolicyDecision::RequireConfirmation,
            "CAPABILITY_CONFIRMATION_REQUIRED",
        );
    }
    AuthorizationEvaluation::Authorized
}

fn evaluate_policy(request: &CapabilityRequest, now_ms: u64) -> (PolicyDecision, &'static str) {
    match evaluate_authorization(request, now_ms) {
        AuthorizationEvaluation::Authorized => (PolicyDecision::Deny, ADAPTER_UNAVAILABLE_REASON),
        AuthorizationEvaluation::Rejected(decision, reason_code) => (decision, reason_code),
    }
}

fn evaluation_result(
    request: &CapabilityRequest,
    request_hash: String,
    decision: PolicyDecision,
    reason_code: &'static str,
) -> CapabilityEvaluationResult {
    CapabilityEvaluationResult {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
        operation_id: request.operation.operation_id.clone(),
        decision,
        execution_state: "not_executed",
        reason_code,
        request_hash: request_hash.clone(),
        idempotency_replayed: false,
        evidence: CapabilityEvidence {
            schema_version: "aistaff.local-capability-evidence.v1",
            request_hash,
            operation_id: request.operation.operation_id.clone(),
            side_effect_state: "none",
            redaction_profile: "metadata_only.v1",
        },
    }
}

impl LocalCapabilityCommandHandler for LocalCapabilityBrokerService {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError> {
        match command {
            "capability.capabilities" => {
                if payload.is_some() {
                    return Err(LocalCapabilityError::new(
                        "INVALID_LOCAL_CAPABILITY_COMMAND_PAYLOAD",
                    ));
                }
                serialize_result(self.capabilities())
            }
            "capability.evaluate" => {
                let request: CapabilityRequest = parse_payload(payload)?;
                serialize_result(self.evaluate(request)?)
            }
            "capability.cancel" => {
                let input: CapabilityCancelInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.cancel(input))
            }
            "capability.reconcile" => {
                let input: CapabilityReconcileInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.reconcile(input))
            }
            _ => Err(LocalCapabilityError::new(
                "UNKNOWN_LOCAL_CAPABILITY_COMMAND",
            )),
        }
    }
}
