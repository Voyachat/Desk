use super::browser_contracts::{
    BrowserDescriptorAdmitInput, BrowserDescriptorAdmitResult, BrowserDescriptorEvidence,
    BrowserPolicyRegisterInput, BrowserPolicyRegisterResult, BrowserPolicyRevokeInput,
    BrowserPolicyRevokeResult, LOCAL_BROWSER_DESCRIPTOR_ADMISSION_CAPABILITY_ID, validate_expiry,
};
#[cfg(test)]
use super::browser_execution_adapter::TestOnlyBrowserAdapter;
use super::browser_execution_adapter::{
    BrowserAutomationAdapter, ProductionDisabledBrowserAdapter,
};
use super::browser_execution_contracts::BrowserExecutionNavigateInput;
use super::browser_policy::{
    RegisteredBrowserPolicy, browser_descriptor_hash, validate_descriptor_against_policy,
};
use super::capability_hash::hash_value;
use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::service::{AuthorizationEvaluation, evaluate_authorization};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, to_value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ACTIVE_POLICIES: usize = 32;
const MAX_USED_POLICY_HANDLES: usize = 128;
const REPLAY_LEDGER_CAPACITY: usize = 128;
const ADMITTED_DESCRIPTOR_CAPACITY: usize = 128;
const MAX_USED_EXECUTION_IDENTITIES: usize = 256;

#[derive(Debug, Clone)]
struct BrowserReplayEntry {
    operation_id: String,
    request_hash: String,
    response: Value,
}

pub trait LocalBrowserCapabilityCommandHandler {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError>;
}

pub struct LocalBrowserCapabilityService {
    policies: HashMap<String, RegisteredBrowserPolicy>,
    used_policy_handles: HashSet<String>,
    admitted_descriptors: HashMap<String, String>,
    admitted_descriptor_order: VecDeque<String>,
    replay_entries: HashMap<String, BrowserReplayEntry>,
    replay_order: VecDeque<String>,
    execution_entries: HashMap<String, BrowserReplayEntry>,
    execution_order: VecDeque<String>,
    used_execution_keys: HashSet<String>,
    used_execution_operations: HashSet<String>,
    browser_adapter: Box<dyn BrowserAutomationAdapter>,
    now_ms: Box<dyn Fn() -> u64 + Send + Sync>,
}

impl Default for LocalBrowserCapabilityService {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalBrowserCapabilityService {
    pub fn new() -> Self {
        Self::with_clock(system_time_ms)
    }

    pub(crate) fn with_clock<F>(now_ms: F) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        Self {
            policies: HashMap::new(),
            used_policy_handles: HashSet::new(),
            admitted_descriptors: HashMap::new(),
            admitted_descriptor_order: VecDeque::new(),
            replay_entries: HashMap::new(),
            replay_order: VecDeque::new(),
            execution_entries: HashMap::new(),
            execution_order: VecDeque::new(),
            used_execution_keys: HashSet::new(),
            used_execution_operations: HashSet::new(),
            browser_adapter: Box::new(ProductionDisabledBrowserAdapter),
            now_ms: Box::new(now_ms),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_execution<F>(now_ms: F) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        let mut service = Self::with_clock(now_ms);
        service.browser_adapter = Box::new(TestOnlyBrowserAdapter);
        service
    }

    fn register_policy(
        &mut self,
        input: BrowserPolicyRegisterInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        validate_expiry(input.expires_at_ms, now_ms)?;
        self.prune_expired(now_ms);
        let request_hash = hash_value(&input)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            self.policies
                .get(&input.policy_handle)
                .filter(|policy| policy.revision == input.policy_revision)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_BROWSER_POLICY_REPLAY_EXPIRED"))?;
            return Ok(mark_replayed(replay));
        }
        self.validate_new_policy_handle(&input.policy_handle)?;
        let result = BrowserPolicyRegisterResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle.clone(),
            policy_revision: input.policy_revision.clone(),
            policy_id: input.policy_id.clone(),
            action_id: input.action_id.clone(),
            capability_id: input.capability_id.clone(),
            allowed_origins: input.allowed_origins.clone(),
            policy_status: "registered",
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_BROWSER_POLICY_ADMISSION_ONLY",
        };
        let response = serialize_result(result)?;
        self.policies.insert(
            input.policy_handle.clone(),
            RegisteredBrowserPolicy {
                revision: input.policy_revision,
                scope: input.scope,
                policy_id: input.policy_id,
                action_id: input.action_id,
                capability_id: input.capability_id,
                allowed_origins: input.allowed_origins,
                download_policy: input.download_policy,
                permission_policy: input.permission_policy,
                evidence_policy: input.evidence_policy,
                max_timeout_ms: input.max_timeout_ms,
                expires_at_ms: input.expires_at_ms,
            },
        );
        self.used_policy_handles.insert(input.policy_handle);
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn validate_new_policy_handle(&self, policy_handle: &str) -> Result<(), LocalCapabilityError> {
        if self.policies.len() >= MAX_ACTIVE_POLICIES {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_POLICY_CAPACITY_REACHED",
            ));
        }
        if self.used_policy_handles.len() >= MAX_USED_POLICY_HANDLES {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_POLICY_HANDLE_CAPACITY_REACHED",
            ));
        }
        if self.used_policy_handles.contains(policy_handle) {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_POLICY_HANDLE_REUSED",
            ));
        }
        Ok(())
    }

    fn revoke_policy(
        &mut self,
        input: BrowserPolicyRevokeInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let request_hash = hash_value(&input)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            return Ok(mark_replayed(replay));
        }
        let status = match self.policies.get(&input.policy_handle) {
            Some(policy) if policy.revision != input.expected_policy_revision => {
                return Err(LocalCapabilityError::new(
                    "LOCAL_BROWSER_POLICY_REVISION_MISMATCH",
                ));
            }
            Some(_) => {
                self.policies.remove(&input.policy_handle);
                "revoked"
            }
            None => "not_found",
        };
        let result = BrowserPolicyRevokeResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle,
            revoke_status: status,
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: if status == "revoked" {
                "LOCAL_BROWSER_POLICY_REVOKED"
            } else {
                "LOCAL_BROWSER_POLICY_NOT_FOUND"
            },
        };
        let response = serialize_result(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn admit_descriptor(
        &mut self,
        input: BrowserDescriptorAdmitInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms);
        let request_hash = hash_value(&input)?;
        let policy = self
            .policies
            .get(&input.policy_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_BROWSER_POLICY_NOT_ACTIVE"))?;
        validate_descriptor_against_policy(&input, policy)?;
        let descriptor_hash = browser_descriptor_hash(&input, policy)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            if replay["browser_descriptor_hash"] != descriptor_hash {
                return Err(LocalCapabilityError::new(
                    "LOCAL_BROWSER_DESCRIPTOR_REPLAY_DRIFT",
                ));
            }
            return Ok(mark_replayed(replay));
        }
        let result = BrowserDescriptorAdmitResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_BROWSER_DESCRIPTOR_ADMISSION_CAPABILITY_ID,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle.clone(),
            expected_origin: input.expected_origin.clone(),
            admission_status: "validated_no_execution",
            browser_descriptor_hash: descriptor_hash.clone(),
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_BROWSER_DESCRIPTOR_ADMISSION_ONLY",
            evidence: BrowserDescriptorEvidence {
                schema_version: "aistaff.local-browser-descriptor-evidence.v1",
                capability_id: LOCAL_BROWSER_DESCRIPTOR_ADMISSION_CAPABILITY_ID,
                operation_id: input.operation_id.clone(),
                policy_handle: input.policy_handle,
                expected_origin: input.expected_origin,
                browser_descriptor_hash: descriptor_hash.clone(),
                side_effect_state: "none",
                redaction_profile: "browser_descriptor_metadata_only.v1",
            },
        };
        self.record_admitted_descriptor(input.operation_id.clone(), descriptor_hash);
        let response = serialize_result(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn navigate(
        &mut self,
        input: BrowserExecutionNavigateInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms);
        ensure_authorized(&input.capability_request, now_ms)?;
        let request_hash = hash_value(&input)?;
        let idempotency_key = input.capability_request.operation.idempotency_key.clone();
        let operation_id = input.capability_request.operation.operation_id.clone();
        let policy = self
            .policies
            .get(&input.descriptor_request.policy_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_BROWSER_POLICY_NOT_ACTIVE"))?;
        validate_descriptor_against_policy(&input.descriptor_request, policy)?;
        if policy.action_id != input.capability_request.operation.action_id
            || policy.action_id != input.capability_request.authorization.action_id
            || policy.capability_id != input.capability_request.operation.capability_id
            || policy.capability_id != input.capability_request.authorization.capability_id
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_EXECUTION_POLICY_MISMATCH",
            ));
        }
        let descriptor_hash = browser_descriptor_hash(&input.descriptor_request, policy)?;
        if descriptor_hash != input.expected_browser_descriptor_hash {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_DESCRIPTOR_HASH_MISMATCH",
            ));
        }
        if self
            .admitted_descriptors
            .get(&input.descriptor_request.operation_id)
            != Some(&descriptor_hash)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_DESCRIPTOR_NOT_ADMITTED",
            ));
        }
        if let Some(replay) =
            self.prepare_execution(&idempotency_key, &operation_id, &request_hash)?
        {
            return Ok(mark_replayed(replay));
        }
        let result = self
            .browser_adapter
            .navigate(&input, &request_hash, &descriptor_hash)?;
        let response = serialize_result(result)?;
        self.record_execution_replay(
            idempotency_key,
            operation_id,
            request_hash,
            response.clone(),
        );
        Ok(response)
    }

    fn replay_entry(
        &self,
        operation_id: &str,
        request_hash: &str,
    ) -> Result<Option<Value>, LocalCapabilityError> {
        let Some(entry) = self.replay_entries.get(operation_id) else {
            return Ok(None);
        };
        if entry.request_hash != request_hash {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_IDEMPOTENCY_CONFLICT",
            ));
        }
        Ok(Some(entry.response.clone()))
    }

    fn prepare_execution(
        &self,
        idempotency_key: &str,
        operation_id: &str,
        request_hash: &str,
    ) -> Result<Option<Value>, LocalCapabilityError> {
        if let Some(entry) = self.execution_entries.get(idempotency_key) {
            if entry.request_hash != request_hash || entry.operation_id != operation_id {
                return Err(LocalCapabilityError::new(
                    "LOCAL_BROWSER_EXECUTION_IDEMPOTENCY_CONFLICT",
                ));
            }
            return Ok(Some(entry.response.clone()));
        }
        if self.used_execution_keys.contains(idempotency_key) {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_EXECUTION_REPLAY_EXPIRED",
            ));
        }
        if self.used_execution_operations.contains(operation_id) {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_EXECUTION_OPERATION_REUSED",
            ));
        }
        if self.used_execution_keys.len() >= MAX_USED_EXECUTION_IDENTITIES
            || self.used_execution_operations.len() >= MAX_USED_EXECUTION_IDENTITIES
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_EXECUTION_IDENTITY_CAPACITY_REACHED",
            ));
        }
        Ok(None)
    }

    fn record_replay(&mut self, operation_id: String, request_hash: String, response: Value) {
        if self.replay_entries.len() == REPLAY_LEDGER_CAPACITY
            && let Some(oldest) = self.replay_order.pop_front()
        {
            self.replay_entries.remove(&oldest);
        }
        self.replay_order.push_back(operation_id.clone());
        self.replay_entries.insert(
            operation_id.clone(),
            BrowserReplayEntry {
                operation_id,
                request_hash,
                response,
            },
        );
    }

    fn record_admitted_descriptor(&mut self, operation_id: String, descriptor_hash: String) {
        if !self.admitted_descriptors.contains_key(&operation_id) {
            if self.admitted_descriptors.len() == ADMITTED_DESCRIPTOR_CAPACITY
                && let Some(oldest) = self.admitted_descriptor_order.pop_front()
            {
                self.admitted_descriptors.remove(&oldest);
            }
            self.admitted_descriptor_order
                .push_back(operation_id.clone());
        }
        self.admitted_descriptors
            .insert(operation_id, descriptor_hash);
    }

    fn record_execution_replay(
        &mut self,
        idempotency_key: String,
        operation_id: String,
        request_hash: String,
        response: Value,
    ) {
        if self.execution_entries.len() == REPLAY_LEDGER_CAPACITY
            && let Some(oldest) = self.execution_order.pop_front()
        {
            self.execution_entries.remove(&oldest);
        }
        self.execution_order.push_back(idempotency_key.clone());
        self.execution_entries.insert(
            idempotency_key.clone(),
            BrowserReplayEntry {
                operation_id: operation_id.clone(),
                request_hash,
                response,
            },
        );
        self.used_execution_keys.insert(idempotency_key);
        self.used_execution_operations.insert(operation_id);
    }

    fn prune_expired(&mut self, now_ms: u64) {
        self.policies
            .retain(|_, policy| policy.expires_at_ms > now_ms);
    }
}

impl LocalBrowserCapabilityCommandHandler for LocalBrowserCapabilityService {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError> {
        match command {
            "capability.browser.policy.register" => {
                let input: BrowserPolicyRegisterInput = parse_payload(payload)?;
                self.register_policy(input)
            }
            "capability.browser.policy.revoke" => {
                let input: BrowserPolicyRevokeInput = parse_payload(payload)?;
                self.revoke_policy(input)
            }
            "capability.browser.descriptor.admit" => {
                let input: BrowserDescriptorAdmitInput = parse_payload(payload)?;
                self.admit_descriptor(input)
            }
            "capability.browser.execution.navigate" => {
                let input: BrowserExecutionNavigateInput = parse_payload(payload)?;
                self.navigate(input)
            }
            _ => Err(LocalCapabilityError::new(
                "UNKNOWN_LOCAL_BROWSER_CAPABILITY_COMMAND",
            )),
        }
    }
}

fn mark_replayed(mut response: Value) -> Value {
    if let Some(record) = response.as_object_mut() {
        record.insert("idempotency_replayed".to_owned(), Value::Bool(true));
    }
    response
}

fn ensure_authorized(
    request: &super::contracts::CapabilityRequest,
    now_ms: u64,
) -> Result<(), LocalCapabilityError> {
    if let AuthorizationEvaluation::Rejected(_, reason_code) =
        evaluate_authorization(request, now_ms)
    {
        return Err(LocalCapabilityError::new(reason_code));
    }
    Ok(())
}

fn parse_payload<T: DeserializeOwned>(payload: Option<Value>) -> Result<T, LocalCapabilityError> {
    serde_json::from_value(
        payload.ok_or_else(|| LocalCapabilityError::new("LOCAL_BROWSER_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| LocalCapabilityError::new("INVALID_LOCAL_BROWSER_PAYLOAD"))
}

fn serialize_result<T: Serialize>(result: T) -> Result<Value, LocalCapabilityError> {
    to_value(result)
        .map_err(|_| LocalCapabilityError::new("LOCAL_BROWSER_RESPONSE_SERIALIZATION_FAILED"))
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}
