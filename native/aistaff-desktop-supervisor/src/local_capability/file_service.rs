use super::capability_hash::hash_value;
use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::file_contracts::{
    FileGrantRegisterInput, FileGrantRegisterResult, FileGrantRevokeInput, FileGrantRevokeResult,
    FilePathAdmitInput, FilePathAdmitResult, FilePathEvidence,
    LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
};
use super::file_execution_contracts::{
    DirectoryListExecutionInput, FileExecutionReconcileInput, FileReadExecutionInput,
};
use super::file_grant_registry::{
    GrantRevokeOutcome, RegisteredGrant, RegisteredGrantScope, SharedFileGrantRegistry,
    descriptor_hash,
};
use super::file_path::AdmittedFileRoot;
use super::workspace_write_contracts::{
    WorkspaceChangeApplyInput, WorkspaceWriteGrantRegisterInput,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, to_value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

const REPLAY_LEDGER_CAPACITY: usize = 128;
const MAX_GRANT_LIFETIME_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone)]
struct ReplayEntry {
    request_hash: String,
    response: Value,
}

#[derive(Debug, Clone)]
pub(super) struct ExecutionRecord {
    pub(super) operation_id: String,
    pub(super) request_hash: String,
    pub(super) output_sha256: String,
}

pub trait LocalFileCapabilityCommandHandler {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError>;
}

pub struct LocalFileCapabilityService {
    pub(super) grant_registry: SharedFileGrantRegistry,
    replay_entries: HashMap<String, ReplayEntry>,
    replay_order: VecDeque<String>,
    pub(super) now_ms: Box<dyn Fn() -> u64 + Send + Sync>,
    pub(super) execution_enabled: bool,
    pub(super) execution_records: HashMap<String, ExecutionRecord>,
    pub(super) execution_order: VecDeque<String>,
    pub(super) used_execution_keys: HashSet<String>,
    pub(super) used_execution_operations: HashSet<String>,
}

impl Default for LocalFileCapabilityService {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalFileCapabilityService {
    pub fn new() -> Self {
        Self::with_clock(system_time_ms)
    }

    pub(crate) fn with_shared_grants(grant_registry: SharedFileGrantRegistry) -> Self {
        Self::with_clock_and_registry(system_time_ms, grant_registry)
    }

    pub(crate) fn with_clock<F>(now_ms: F) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        Self::with_clock_and_registry(now_ms, SharedFileGrantRegistry::new())
    }

    pub(crate) fn with_clock_and_registry<F>(
        now_ms: F,
        grant_registry: SharedFileGrantRegistry,
    ) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        Self {
            grant_registry,
            replay_entries: HashMap::new(),
            replay_order: VecDeque::new(),
            now_ms: Box::new(now_ms),
            execution_enabled: false,
            execution_records: HashMap::new(),
            execution_order: VecDeque::new(),
            used_execution_keys: HashSet::new(),
            used_execution_operations: HashSet::new(),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_clock_and_synthetic_execution<F>(now_ms: F) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        let mut service = Self::with_clock(now_ms);
        service.execution_enabled = true;
        service
    }

    fn register_grant(
        &mut self,
        input: FileGrantRegisterInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        if input.expires_at_ms <= now_ms
            || input.expires_at_ms
                > now_ms
                    .checked_add(MAX_GRANT_LIFETIME_MS)
                    .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_EXPIRY_INVALID"))?
        {
            return Err(LocalCapabilityError::new("LOCAL_FILE_GRANT_EXPIRY_INVALID"));
        }
        self.prune_expired(now_ms)?;
        let request_hash = hash_value(&input)?;
        if let Some(response) = self.replay(
            &input.operation_id,
            &request_hash,
            Some((&input.grant_handle, &input.grant_revision)),
        )? {
            return Ok(response);
        }
        self.grant_registry
            .ensure_registration_available(&input.grant_handle)?;
        let root = AdmittedFileRoot::admit(&input.root_path)?;
        let result = FileGrantRegisterResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            grant_handle: input.grant_handle.clone(),
            grant_revision: input.grant_revision.clone(),
            grant_status: "registered",
            access: input.access,
            allowed_intents: input.allowed_intents.clone(),
            expires_at_ms: input.expires_at_ms,
            root_fingerprint: root.fingerprint().to_owned(),
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_FILE_GRANT_ADMISSION_ONLY",
        };
        let response = serialize_result(result)?;
        self.grant_registry.register(
            input.grant_handle.clone(),
            RegisteredGrant {
                revision: input.grant_revision,
                scope: RegisteredGrantScope::Server(input.scope),
                access: input.access,
                allowed_intents: input.allowed_intents,
                expires_at_ms: input.expires_at_ms,
                root,
            },
        )?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn revoke_grant(&mut self, input: FileGrantRevokeInput) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let request_hash = hash_value(&input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash, None)? {
            return Ok(response);
        }
        let (revoke_status, reason_code) = match self
            .grant_registry
            .revoke(&input.grant_handle, &input.expected_grant_revision)?
        {
            GrantRevokeOutcome::Revoked => ("revoked", "LOCAL_FILE_GRANT_REVOKED"),
            GrantRevokeOutcome::NotFound => ("not_found", "LOCAL_FILE_GRANT_NOT_FOUND"),
        };
        let result = FileGrantRevokeResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id.clone(),
            grant_handle: input.grant_handle,
            revoke_status,
            execution_enabled: false,
            idempotency_replayed: false,
            reason_code,
        };
        let response = serialize_result(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    fn admit_path(
        &mut self,
        input: FilePathAdmitInput,
    ) -> Result<FilePathAdmitResult, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms)?;
        let grant = self.grant_registry.active_grant_for_path(&input)?;
        let admission = grant.root.admit_path(&input)?;
        let descriptor_hash = descriptor_hash(&grant, &input, &admission)?;
        self.grant_registry.record_path_admission(
            &input,
            &descriptor_hash,
            admission.target_kind,
        )?;
        Ok(FilePathAdmitResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
            operation_id: input.operation_id.clone(),
            grant_handle: input.grant_handle.clone(),
            admission_status: "validated_no_execution",
            intent: input.intent,
            target_kind: admission.target_kind,
            size_bytes: admission.size_bytes,
            root_fingerprint: grant.root.fingerprint().to_owned(),
            target_descriptor_hash: descriptor_hash.clone(),
            execution_enabled: false,
            reason_code: "LOCAL_FILE_PATH_VALIDATED_NO_EXECUTION",
            evidence: FilePathEvidence {
                schema_version: "aistaff.local-file-path-evidence.v1",
                capability_id: LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
                operation_id: input.operation_id,
                grant_handle: input.grant_handle,
                target_descriptor_hash: descriptor_hash,
                side_effect_state: "none",
                redaction_profile: "path_metadata_only.v1",
            },
        })
    }

    pub(super) fn replay(
        &self,
        operation_id: &str,
        request_hash: &str,
        active_grant: Option<(&str, &str)>,
    ) -> Result<Option<Value>, LocalCapabilityError> {
        let Some(entry) = self.replay_entries.get(operation_id) else {
            return Ok(None);
        };
        if entry.request_hash != request_hash {
            return Err(LocalCapabilityError::new("LOCAL_FILE_IDEMPOTENCY_CONFLICT"));
        }
        if let Some((handle, revision)) = active_grant {
            let grant = self
                .grant_registry
                .active_grant(handle)?
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_NOT_ACTIVE"))?;
            if grant.revision != revision {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_GRANT_REVISION_MISMATCH",
                ));
            }
            grant.root.validate()?;
        }
        let mut response = entry.response.clone();
        response["idempotency_replayed"] = Value::Bool(true);
        Ok(Some(response))
    }

    pub(super) fn record_replay(
        &mut self,
        operation_id: String,
        request_hash: String,
        response: Value,
    ) {
        if self.replay_entries.len() == REPLAY_LEDGER_CAPACITY
            && let Some(oldest) = self.replay_order.pop_front()
        {
            self.replay_entries.remove(&oldest);
        }
        self.replay_order.push_back(operation_id.clone());
        self.replay_entries.insert(
            operation_id,
            ReplayEntry {
                request_hash,
                response,
            },
        );
    }

    pub(super) fn prune_expired(&self, now_ms: u64) -> Result<(), LocalCapabilityError> {
        self.grant_registry.prune_expired(now_ms)
    }
}

impl LocalFileCapabilityCommandHandler for LocalFileCapabilityService {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, LocalCapabilityError> {
        match command {
            "capability.file.grant.register" => {
                let input: FileGrantRegisterInput = parse_payload(payload)?;
                self.register_grant(input)
            }
            "capability.file.grant.revoke" => {
                let input: FileGrantRevokeInput = parse_payload(payload)?;
                self.revoke_grant(input)
            }
            "capability.file.path.admit" => {
                let input: FilePathAdmitInput = parse_payload(payload)?;
                serialize_result(self.admit_path(input)?)
            }
            "capability.file.read" => {
                let input: FileReadExecutionInput = parse_payload(payload)?;
                serialize_result(self.execute_file_read(input)?)
            }
            "capability.directory.list" => {
                let input: DirectoryListExecutionInput = parse_payload(payload)?;
                serialize_result(self.execute_directory_list(input)?)
            }
            "capability.file.execution.reconcile" => {
                let input: FileExecutionReconcileInput = parse_payload(payload)?;
                serialize_result(self.reconcile_file_execution(input)?)
            }
            "capability.workspace.grant.register" => {
                let input: WorkspaceWriteGrantRegisterInput = parse_payload(payload)?;
                self.register_workspace_write_grant(input)
            }
            "capability.workspace.change.apply" => {
                let input: WorkspaceChangeApplyInput = parse_payload(payload)?;
                self.apply_workspace_changes(input)
            }
            _ => Err(LocalCapabilityError::new(
                "UNKNOWN_LOCAL_FILE_CAPABILITY_COMMAND",
            )),
        }
    }
}

fn parse_payload<T: DeserializeOwned>(payload: Option<Value>) -> Result<T, LocalCapabilityError> {
    serde_json::from_value(
        payload
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_CAPABILITY_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| LocalCapabilityError::new("INVALID_LOCAL_FILE_CAPABILITY_PAYLOAD"))
}

fn serialize_result<T: Serialize>(result: T) -> Result<Value, LocalCapabilityError> {
    to_value(result)
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_RESPONSE_SERIALIZATION_FAILED"))
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}
