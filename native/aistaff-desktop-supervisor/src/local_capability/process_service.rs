use super::capability_hash::hash_value;
use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::file_grant_registry::SharedFileGrantRegistry;
use super::process_contracts::{
    LOCAL_PROCESS_DESCRIPTOR_ADMISSION_CAPABILITY_ID, ProcessDescriptorAdmitInput,
    ProcessDescriptorAdmitResult, ProcessDescriptorEvidence, ProcessPolicyRegisterInput,
    ProcessPolicyRegisterResult, ProcessPolicyRevokeInput, ProcessPolicyRevokeResult,
    ProcessTarget, current_process_target,
};
use super::process_executable::AdmittedExecutable;
use super::process_execution::NativeProcessExecutionEngine;
use super::process_execution_context::{
    FileGrantProcessExecutionContextProvider, ProcessExecutionContextProvider,
    UnavailableProcessExecutionContextProvider,
};
use super::process_execution_contracts::{
    ProcessExecutionCancelInput, ProcessExecutionReconcileInput, ProcessExecutionStartInput,
};
use super::process_execution_results::ProcessExecutionRecord;
use super::process_native_sandbox::NativeProcessSandboxAdmission;
use super::process_policy::{
    RegisteredProcessPolicy, process_descriptor_hash, validate_descriptor_against_policy,
};
use super::process_secret_store::production_process_secret_store;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, to_value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ACTIVE_POLICIES: usize = 32;
const MAX_USED_POLICY_HANDLES: usize = 128;
const REPLAY_LEDGER_CAPACITY: usize = 128;
pub(super) const EXECUTION_IDENTITY_CAPACITY: usize = 256;
const MAX_POLICY_LIFETIME_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone)]
struct ProcessReplayEntry {
    request_hash: String,
    response: Value,
}

pub trait LocalProcessCapabilityCommandHandler {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError>;
}

pub struct LocalProcessCapabilityService {
    pub(super) policies: HashMap<String, RegisteredProcessPolicy>,
    used_policy_handles: HashSet<String>,
    replay_entries: HashMap<String, ProcessReplayEntry>,
    replay_order: VecDeque<String>,
    current_target: Option<ProcessTarget>,
    pub(super) native_sandbox_admission: NativeProcessSandboxAdmission,
    pub(super) now_ms: Box<dyn Fn() -> u64 + Send + Sync>,
    pub(super) execution_engine: Option<NativeProcessExecutionEngine>,
    pub(super) execution_context_provider: Box<dyn ProcessExecutionContextProvider>,
    pub(super) execution_records: HashMap<String, ProcessExecutionRecord>,
    pub(super) execution_order: VecDeque<String>,
    pub(super) used_execution_keys: HashSet<String>,
    pub(super) used_execution_operations: HashSet<String>,
    #[cfg(test)]
    test_execution_path: Option<std::path::PathBuf>,
}

impl Default for LocalProcessCapabilityService {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalProcessCapabilityService {
    pub fn new() -> Self {
        Self::with_runtime(system_time_ms, current_process_target())
    }

    pub(crate) fn with_shared_file_grants(grant_registry: SharedFileGrantRegistry) -> Self {
        let mut service = Self::with_runtime(system_time_ms, current_process_target());
        service.execution_context_provider =
            Box::new(FileGrantProcessExecutionContextProvider::new(
                grant_registry,
                production_process_secret_store(),
                system_time_ms,
            ));
        service
    }

    #[cfg(test)]
    pub(crate) fn with_clock_and_target<F>(now_ms: F, target: ProcessTarget) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        Self::with_runtime(now_ms, Some(target))
    }

    fn with_runtime<F>(now_ms: F, current_target: Option<ProcessTarget>) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        let native_sandbox_admission = NativeProcessSandboxAdmission::candidate(current_target);
        Self {
            policies: HashMap::new(),
            used_policy_handles: HashSet::new(),
            replay_entries: HashMap::new(),
            replay_order: VecDeque::new(),
            current_target,
            native_sandbox_admission,
            now_ms: Box::new(now_ms),
            execution_engine: None,
            execution_context_provider: Box::new(UnavailableProcessExecutionContextProvider),
            execution_records: HashMap::new(),
            execution_order: VecDeque::new(),
            used_execution_keys: HashSet::new(),
            used_execution_operations: HashSet::new(),
            #[cfg(test)]
            test_execution_path: None,
        }
    }

    #[cfg(test)]
    pub(super) fn with_test_execution<F>(
        now_ms: F,
        target: ProcessTarget,
        execution_path: std::path::PathBuf,
        context_provider: Box<dyn ProcessExecutionContextProvider>,
    ) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        let mut service = Self::with_runtime(now_ms, Some(target));
        service.execution_engine = Some(NativeProcessExecutionEngine::new());
        service.native_sandbox_admission = NativeProcessSandboxAdmission::test_only(target);
        service.execution_context_provider = context_provider;
        service.test_execution_path = Some(execution_path);
        service
    }

    fn register_policy(
        &mut self,
        input: ProcessPolicyRegisterInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        validate_expiry(input.expires_at_ms, now_ms)?;
        self.prune_expired(now_ms);
        if self.current_target != Some(input.target) {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_POLICY_TARGET_MISMATCH",
            ));
        }
        let request_hash = hash_value(&input)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            let policy = self
                .policies
                .get(&input.policy_handle)
                .filter(|policy| policy.revision == input.policy_revision)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_POLICY_REPLAY_EXPIRED"))?;
            policy.executable.validate()?;
            return Ok(mark_replayed(replay));
        }
        self.validate_new_policy_handle(&input.policy_handle)?;
        let executable = AdmittedExecutable::admit(
            &input.executable_path,
            &input.expected_executable_sha256,
            input.target,
        )?;
        #[cfg(test)]
        let executable = {
            let mut executable = executable;
            if let Some(path) = &self.test_execution_path {
                executable.set_test_execution_path(path.clone());
            }
            executable
        };
        let result = ProcessPolicyRegisterResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle.clone(),
            policy_revision: input.policy_revision.clone(),
            policy_id: input.policy_id.clone(),
            action_id: input.action_id.clone(),
            capability_id: input.capability_id.clone(),
            target: input.target,
            executable_sha256: executable.sha256().to_owned(),
            executable_fingerprint: executable.fingerprint().to_owned(),
            policy_status: "registered",
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_PROCESS_POLICY_ADMISSION_ONLY",
        };
        let response = serialize_result(result)?;
        self.policies.insert(
            input.policy_handle.clone(),
            RegisteredProcessPolicy {
                revision: input.policy_revision,
                scope: input.scope,
                policy_id: input.policy_id,
                action_id: input.action_id,
                capability_id: input.capability_id,
                target: input.target,
                fixed_argv: input.fixed_argv,
                required_environment_refs: input.required_environment_refs,
                working_directory_mode: input.working_directory_mode,
                side_effect: input.side_effect,
                max_timeout_ms: input.max_timeout_ms,
                max_output_bytes: input.max_output_bytes,
                resource_policy: input.resource_policy,
                expires_at_ms: input.expires_at_ms,
                executable,
            },
        );
        self.used_policy_handles.insert(input.policy_handle);
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn validate_new_policy_handle(&self, policy_handle: &str) -> Result<(), LocalCapabilityError> {
        if self.policies.len() >= MAX_ACTIVE_POLICIES {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_POLICY_CAPACITY_REACHED",
            ));
        }
        if self.used_policy_handles.len() >= MAX_USED_POLICY_HANDLES {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_POLICY_HANDLE_CAPACITY_REACHED",
            ));
        }
        if self.used_policy_handles.contains(policy_handle) {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_POLICY_HANDLE_REUSED",
            ));
        }
        Ok(())
    }

    fn revoke_policy(
        &mut self,
        input: ProcessPolicyRevokeInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let request_hash = hash_value(&input)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            return Ok(mark_replayed(replay));
        }
        let status = match self.policies.get(&input.policy_handle) {
            Some(policy) if policy.revision != input.expected_policy_revision => {
                return Err(LocalCapabilityError::new(
                    "LOCAL_PROCESS_POLICY_REVISION_MISMATCH",
                ));
            }
            Some(_) => {
                self.cancel_policy_executions(&input.policy_handle);
                self.policies.remove(&input.policy_handle);
                "revoked"
            }
            None => "not_found",
        };
        let result = ProcessPolicyRevokeResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle,
            revoke_status: status,
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: if status == "revoked" {
                "LOCAL_PROCESS_POLICY_REVOKED"
            } else {
                "LOCAL_PROCESS_POLICY_NOT_FOUND"
            },
        };
        let response = serialize_result(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn admit_descriptor(
        &mut self,
        input: ProcessDescriptorAdmitInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms);
        let request_hash = hash_value(&input)?;
        let policy = self
            .policies
            .get(&input.policy_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_POLICY_NOT_ACTIVE"))?;
        validate_descriptor_against_policy(&input, policy)?;
        policy.executable.validate()?;
        let descriptor_hash = process_descriptor_hash(&input, policy)?;
        if let Some(replay) = self.replay_entry(&input.operation_id, &request_hash)? {
            if replay["process_descriptor_hash"] != descriptor_hash {
                return Err(LocalCapabilityError::new(
                    "LOCAL_PROCESS_DESCRIPTOR_REPLAY_DRIFT",
                ));
            }
            return Ok(mark_replayed(replay));
        }
        let result = ProcessDescriptorAdmitResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_PROCESS_DESCRIPTOR_ADMISSION_CAPABILITY_ID,
            operation_id: input.operation_id.clone(),
            policy_handle: input.policy_handle.clone(),
            policy_id: policy.policy_id.clone(),
            action_id: policy.action_id.clone(),
            process_capability_id: policy.capability_id.clone(),
            target: policy.target,
            side_effect: policy.side_effect,
            admission_status: "validated_no_execution",
            executable_fingerprint: policy.executable.fingerprint().to_owned(),
            process_descriptor_hash: descriptor_hash.clone(),
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_PROCESS_DESCRIPTOR_ADMISSION_ONLY",
            evidence: ProcessDescriptorEvidence {
                schema_version: "aistaff.local-process-descriptor-evidence.v2",
                capability_id: LOCAL_PROCESS_DESCRIPTOR_ADMISSION_CAPABILITY_ID,
                operation_id: input.operation_id.clone(),
                policy_handle: input.policy_handle,
                executable_fingerprint: policy.executable.fingerprint().to_owned(),
                process_descriptor_hash: descriptor_hash,
                side_effect_state: "none",
                redaction_profile: "process_descriptor_metadata_only.v1",
            },
        };
        let response = serialize_result(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
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
                "LOCAL_PROCESS_IDEMPOTENCY_CONFLICT",
            ));
        }
        Ok(Some(entry.response.clone()))
    }

    fn record_replay(&mut self, operation_id: String, request_hash: String, response: Value) {
        if self.replay_entries.len() == REPLAY_LEDGER_CAPACITY
            && let Some(oldest) = self.replay_order.pop_front()
        {
            self.replay_entries.remove(&oldest);
        }
        self.replay_order.push_back(operation_id.clone());
        self.replay_entries.insert(
            operation_id,
            ProcessReplayEntry {
                request_hash,
                response,
            },
        );
    }

    pub(super) fn prune_expired(&mut self, now_ms: u64) {
        let expired_handles = self
            .policies
            .iter()
            .filter(|(_, policy)| policy.expires_at_ms <= now_ms)
            .map(|(handle, _)| handle.clone())
            .collect::<Vec<_>>();
        for handle in &expired_handles {
            self.cancel_policy_executions(handle);
        }
        self.policies
            .retain(|_, policy| policy.expires_at_ms > now_ms);
    }
}

impl LocalProcessCapabilityCommandHandler for LocalProcessCapabilityService {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError> {
        match command {
            "capability.process.policy.register" => {
                let input: ProcessPolicyRegisterInput = parse_payload(payload)?;
                self.register_policy(input)
            }
            "capability.process.policy.revoke" => {
                let input: ProcessPolicyRevokeInput = parse_payload(payload)?;
                self.revoke_policy(input)
            }
            "capability.process.descriptor.admit" => {
                let input: ProcessDescriptorAdmitInput = parse_payload(payload)?;
                self.admit_descriptor(input)
            }
            "capability.process.execution.start" => {
                let input: ProcessExecutionStartInput = parse_payload(payload)?;
                serialize_result(self.start_process_execution(input)?)
            }
            "capability.process.execution.cancel" => {
                let input: ProcessExecutionCancelInput = parse_payload(payload)?;
                serialize_result(self.cancel_process_execution(input)?)
            }
            "capability.process.execution.reconcile" => {
                let input: ProcessExecutionReconcileInput = parse_payload(payload)?;
                serialize_result(self.reconcile_process_execution(input)?)
            }
            _ => Err(LocalCapabilityError::new(
                "UNKNOWN_LOCAL_PROCESS_CAPABILITY_COMMAND",
            )),
        }
    }
}

fn validate_expiry(expires_at_ms: u64, now_ms: u64) -> Result<(), LocalCapabilityError> {
    if expires_at_ms <= now_ms
        || expires_at_ms
            > now_ms
                .checked_add(MAX_POLICY_LIFETIME_MS)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_POLICY_EXPIRY_INVALID"))?
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_POLICY_EXPIRY_INVALID",
        ));
    }
    Ok(())
}

fn mark_replayed(mut response: Value) -> Value {
    if let Some(record) = response.as_object_mut() {
        record.insert("idempotency_replayed".to_owned(), Value::Bool(true));
    }
    response
}

fn parse_payload<T: DeserializeOwned>(payload: Option<Value>) -> Result<T, LocalCapabilityError> {
    serde_json::from_value(
        payload.ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| LocalCapabilityError::new("INVALID_LOCAL_PROCESS_PAYLOAD"))
}

fn serialize_result<T: Serialize>(result: T) -> Result<Value, LocalCapabilityError> {
    to_value(result)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_RESPONSE_SERIALIZATION_FAILED"))
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}
