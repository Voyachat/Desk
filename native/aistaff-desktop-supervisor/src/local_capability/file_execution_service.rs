use super::capability_hash::{digest_hex, hash_value};
use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::file_contracts::FilePathAdmitInput;
use super::file_execution_contracts::{
    DirectoryListExecutionInput, DirectoryListExecutionResult, FileExecutionEvidence,
    FileExecutionReconcileInput, FileExecutionReconcileResult, FileReadExecutionInput,
    FileReadExecutionResult, LOCAL_DIRECTORY_LIST_CAPABILITY_ID, LOCAL_FILE_READ_CAPABILITY_ID,
};
use super::file_grant_registry::{RegisteredGrant, descriptor_hash};
use super::file_service::{ExecutionRecord, LocalFileCapabilityService};
use super::service::{AuthorizationEvaluation, evaluate_authorization};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest, Sha256};

const EXECUTION_LEDGER_CAPACITY: usize = 128;
const MAX_USED_EXECUTION_IDENTITIES: usize = 256;

impl LocalFileCapabilityService {
    pub(super) fn execute_file_read(
        &mut self,
        input: FileReadExecutionInput,
    ) -> Result<FileReadExecutionResult, LocalCapabilityError> {
        input.validate()?;
        self.ensure_execution_enabled()?;
        let now_ms = (self.now_ms)();
        ensure_authorized(&input.capability_request, now_ms)?;
        self.prune_expired(now_ms)?;
        let request_hash = hash_value(&input)?;
        let replay = self.prepare_execution(
            &input.capability_request.operation.idempotency_key,
            &input.capability_request.operation.operation_id,
            &request_hash,
        )?;
        let (descriptor, bytes) = {
            let grant = self.active_execution_grant(&input.path_request)?;
            let admission = grant.root.admit_path(&input.path_request)?;
            let descriptor = descriptor_hash(&grant, &input.path_request, &admission)?;
            if descriptor != input.expected_target_descriptor_hash {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_EXECUTION_DESCRIPTOR_CHANGED",
                ));
            }
            let output = grant.root.read_bounded(&input.path_request, &admission)?;
            (descriptor, output.bytes)
        };
        let output_sha256 = digest_hex(Sha256::digest(&bytes).as_slice())?;
        let idempotency_replayed = self.finish_execution(
            &input.capability_request.operation.idempotency_key,
            &input.capability_request.operation.operation_id,
            &request_hash,
            &output_sha256,
            replay,
        )?;
        let operation_id = input.capability_request.operation.operation_id.clone();
        let cloud_audit_ref = input.capability_request.authorization.audit_ref.clone();
        Ok(FileReadExecutionResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_FILE_READ_CAPABILITY_ID,
            operation_id: operation_id.clone(),
            execution_state: "completed",
            side_effect_state: "none",
            target_descriptor_hash: descriptor.clone(),
            request_hash: request_hash.clone(),
            content_encoding: "base64",
            content_base64: STANDARD.encode(&bytes),
            bytes_read: bytes.len() as u64,
            content_sha256: output_sha256.clone(),
            idempotency_replayed,
            reason_code: "LOCAL_FILE_READ_COMPLETED_SYNTHETIC_ONLY",
            evidence: FileExecutionEvidence {
                schema_version: "aistaff.local-file-execution-evidence.v1",
                capability_id: LOCAL_FILE_READ_CAPABILITY_ID,
                operation_id,
                request_hash,
                target_descriptor_hash: descriptor,
                output_sha256,
                cloud_audit_ref,
                side_effect_state: "none",
                redaction_profile: "bounded_file_content.v1",
            },
        })
    }

    pub(super) fn execute_directory_list(
        &mut self,
        input: DirectoryListExecutionInput,
    ) -> Result<DirectoryListExecutionResult, LocalCapabilityError> {
        input.validate()?;
        self.ensure_execution_enabled()?;
        let now_ms = (self.now_ms)();
        ensure_authorized(&input.capability_request, now_ms)?;
        self.prune_expired(now_ms)?;
        let request_hash = hash_value(&input)?;
        let replay = self.prepare_execution(
            &input.capability_request.operation.idempotency_key,
            &input.capability_request.operation.operation_id,
            &request_hash,
        )?;
        let (descriptor, output) = {
            let grant = self.active_execution_grant(&input.path_request)?;
            let admission = grant.root.admit_path(&input.path_request)?;
            let descriptor = descriptor_hash(&grant, &input.path_request, &admission)?;
            if descriptor != input.expected_target_descriptor_hash {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_EXECUTION_DESCRIPTOR_CHANGED",
                ));
            }
            let output = grant.root.list_bounded(
                &input.path_request,
                &admission,
                input.max_entries as usize,
            )?;
            (descriptor, output)
        };
        let output_sha256 = hash_value(&output)?;
        let idempotency_replayed = self.finish_execution(
            &input.capability_request.operation.idempotency_key,
            &input.capability_request.operation.operation_id,
            &request_hash,
            &output_sha256,
            replay,
        )?;
        let operation_id = input.capability_request.operation.operation_id.clone();
        let cloud_audit_ref = input.capability_request.authorization.audit_ref.clone();
        Ok(DirectoryListExecutionResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_DIRECTORY_LIST_CAPABILITY_ID,
            operation_id: operation_id.clone(),
            execution_state: "completed",
            side_effect_state: "none",
            target_descriptor_hash: descriptor.clone(),
            request_hash: request_hash.clone(),
            entries: output.entries,
            truncated: output.truncated,
            output_sha256: output_sha256.clone(),
            idempotency_replayed,
            reason_code: "LOCAL_DIRECTORY_LIST_COMPLETED_SYNTHETIC_ONLY",
            evidence: FileExecutionEvidence {
                schema_version: "aistaff.local-file-execution-evidence.v1",
                capability_id: LOCAL_DIRECTORY_LIST_CAPABILITY_ID,
                operation_id,
                request_hash,
                target_descriptor_hash: descriptor,
                output_sha256,
                cloud_audit_ref,
                side_effect_state: "none",
                redaction_profile: "bounded_directory_metadata.v1",
            },
        })
    }

    pub(super) fn reconcile_file_execution(
        &self,
        input: FileExecutionReconcileInput,
    ) -> Result<FileExecutionReconcileResult, LocalCapabilityError> {
        input.validate()?;
        let matching_operation = self
            .execution_records
            .values()
            .find(|entry| entry.operation_id == input.operation_id);
        let (decision, execution_state, output_sha256, side_effect_state, reason_code) =
            match matching_operation {
                Some(entry) if entry.request_hash == input.request_hash => (
                    "confirmed_evidence_only",
                    "completed",
                    Some(entry.output_sha256.clone()),
                    "none",
                    "LOCAL_FILE_EXECUTION_CONFIRMED_EVIDENCE_ONLY",
                ),
                Some(_) => (
                    "require_handoff",
                    "unknown",
                    None,
                    "unknown",
                    "LOCAL_FILE_EXECUTION_RECONCILE_HASH_MISMATCH",
                ),
                None => (
                    "require_handoff",
                    "unknown",
                    None,
                    match input.observed_execution_state {
                        super::file_execution_contracts::ObservedFileExecutionState::None => "none",
                        super::file_execution_contracts::ObservedFileExecutionState::Unknown => {
                            "unknown"
                        }
                    },
                    "LOCAL_FILE_EXECUTION_RECONCILE_RECORD_NOT_FOUND",
                ),
            };
        Ok(FileExecutionReconcileResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            operation_id: input.operation_id,
            decision,
            execution_state,
            request_hash: input.request_hash,
            output_sha256,
            side_effect_state,
            reason_code,
        })
    }

    fn ensure_execution_enabled(&self) -> Result<(), LocalCapabilityError> {
        if !self.execution_enabled {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED",
            ));
        }
        Ok(())
    }

    fn active_execution_grant(
        &self,
        input: &FilePathAdmitInput,
    ) -> Result<RegisteredGrant, LocalCapabilityError> {
        self.grant_registry.active_grant_for_path(input)
    }

    fn prepare_execution(
        &self,
        idempotency_key: &str,
        operation_id: &str,
        request_hash: &str,
    ) -> Result<Option<ExecutionRecord>, LocalCapabilityError> {
        if let Some(entry) = self.execution_records.get(idempotency_key) {
            if entry.request_hash != request_hash || entry.operation_id != operation_id {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_EXECUTION_IDEMPOTENCY_CONFLICT",
                ));
            }
            return Ok(Some(entry.clone()));
        }
        if self.used_execution_keys.contains(idempotency_key) {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_EXECUTION_REPLAY_EXPIRED",
            ));
        }
        if self.used_execution_operations.contains(operation_id) {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_EXECUTION_OPERATION_REUSED",
            ));
        }
        if self.used_execution_keys.len() >= MAX_USED_EXECUTION_IDENTITIES
            || self.used_execution_operations.len() >= MAX_USED_EXECUTION_IDENTITIES
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_EXECUTION_IDENTITY_CAPACITY_REACHED",
            ));
        }
        Ok(None)
    }

    fn finish_execution(
        &mut self,
        idempotency_key: &str,
        operation_id: &str,
        request_hash: &str,
        output_sha256: &str,
        replay: Option<ExecutionRecord>,
    ) -> Result<bool, LocalCapabilityError> {
        if let Some(entry) = replay {
            if entry.output_sha256 != output_sha256 {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_EXECUTION_REPLAY_OUTPUT_CHANGED",
                ));
            }
            return Ok(true);
        }
        if self.execution_records.len() == EXECUTION_LEDGER_CAPACITY
            && let Some(oldest) = self.execution_order.pop_front()
        {
            self.execution_records.remove(&oldest);
        }
        self.execution_order.push_back(idempotency_key.to_owned());
        self.execution_records.insert(
            idempotency_key.to_owned(),
            ExecutionRecord {
                operation_id: operation_id.to_owned(),
                request_hash: request_hash.to_owned(),
                output_sha256: output_sha256.to_owned(),
            },
        );
        self.used_execution_keys.insert(idempotency_key.to_owned());
        self.used_execution_operations
            .insert(operation_id.to_owned());
        Ok(false)
    }
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
