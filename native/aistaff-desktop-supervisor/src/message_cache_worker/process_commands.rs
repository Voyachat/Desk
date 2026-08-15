use super::process::{MessageCacheWorkerProcess, MessageCacheWorkerProcessError, valid_adapter_id};
use super::recovery_contracts::{
    MessageCacheWorkerCompleteRebuildInput, MessageCacheWorkerRebuildInput, valid_sha256,
};
use crate::message_cache::{
    ConfirmedTimelineProjection, LOCAL_HISTORY_PROTOCOL_VERSION, LocalHistoryTaskProjection,
    MESSAGE_CACHE_PROTOCOL_VERSION, PageInput, PurgeScopeInput, PutConfirmedInput,
    PutLocalHistoryInput, ReleaseLocalHistoryInput, SnapshotLocalHistoryInput,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerOpenScopeResult {
    pub adapter_id: String,
    pub persistent: bool,
    pub reopened: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerPutResult {
    pub projection: ConfirmedTimelineProjection,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerPageResult {
    pub projections: Vec<ConfirmedTimelineProjection>,
    pub next_after_sequence: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageCacheWorkerPurgeResult {
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerPutLocalHistoryResult {
    pub projection: LocalHistoryTaskProjection,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerSnapshotLocalHistoryResult {
    pub projections: Vec<LocalHistoryTaskProjection>,
    pub interrupted_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerReleaseLocalHistoryResult {
    pub conversation_id: String,
    pub released: bool,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageCacheWorkerIntegrityStatus {
    Healthy,
    ConfirmedCorrupt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerIntegrityResult {
    pub status: MessageCacheWorkerIntegrityStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageCacheWorkerRebuildStatus {
    RestoringFromServer,
    RestoreCompleted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerRebuildResult {
    pub status: MessageCacheWorkerRebuildStatus,
    pub incident_id: String,
    pub evidence_hash: String,
    pub restored_projection_count: u64,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerOpenScopeResult {
    scope_status: String,
    adapter_id: String,
    persistent: bool,
    reopened: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerPutResult {
    protocol_version: String,
    projection: ConfirmedTimelineProjection,
    idempotency_replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerPageResult {
    protocol_version: String,
    projections: Vec<ConfirmedTimelineProjection>,
    next_after_sequence: Option<u64>,
    has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerPurgeResult {
    protocol_version: String,
    purged: bool,
    idempotency_replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerPutLocalHistoryResult {
    protocol_version: String,
    projection: LocalHistoryTaskProjection,
    idempotency_replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerSnapshotLocalHistoryResult {
    protocol_version: String,
    projections: Vec<LocalHistoryTaskProjection>,
    interrupted_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerReleaseLocalHistoryResult {
    protocol_version: String,
    conversation_id: String,
    released: bool,
    idempotency_replayed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerClosedResult {
    scope_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerShutdownResult {
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerIntegrityResult {
    integrity_status: String,
    scope_status: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerRebuildResult {
    scope_status: String,
    #[serde(default)]
    adapter_id: Option<String>,
    incident_id: String,
    evidence_hash: String,
    restored_projection_count: u64,
    #[serde(default)]
    idempotency_replayed: Option<bool>,
}

impl MessageCacheWorkerProcess {
    pub fn open_scope(
        &mut self,
        scope_handle: &str,
    ) -> Result<MessageCacheWorkerOpenScopeResult, MessageCacheWorkerProcessError> {
        let result: WorkerOpenScopeResult =
            self.request("scope.open", Some(json!({ "scope_handle": scope_handle })))?;
        if result.scope_status != "ready"
            || !result.persistent
            || !valid_adapter_id(&result.adapter_id)
        {
            return self.invalid_response("WORKER_OPEN_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerOpenScopeResult {
            adapter_id: result.adapter_id,
            persistent: result.persistent,
            reopened: result.reopened,
        })
    }

    pub fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
    ) -> Result<MessageCacheWorkerPutResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerPutResult = self.request("scope.put_confirmed", Some(payload(input)?))?;
        if result.protocol_version != MESSAGE_CACHE_PROTOCOL_VERSION
            || result.projection != input.projection
            || result.projection.validate().is_err()
        {
            return self.invalid_response("WORKER_PUT_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerPutResult {
            projection: result.projection,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    pub fn check_integrity(
        &mut self,
        scope_handle: &str,
    ) -> Result<MessageCacheWorkerIntegrityResult, MessageCacheWorkerProcessError> {
        let result: WorkerIntegrityResult = self.request(
            "scope.check_integrity",
            Some(json!({ "scope_handle": scope_handle })),
        )?;
        let status = match (
            result.integrity_status.as_str(),
            result.scope_status.as_str(),
            result.reason.as_deref(),
        ) {
            ("healthy", "ready", None) => MessageCacheWorkerIntegrityStatus::Healthy,
            ("confirmed_corrupt", "quarantine_required", Some("integrity_confirmed_corrupt")) => {
                MessageCacheWorkerIntegrityStatus::ConfirmedCorrupt
            }
            _ => return self.invalid_response("WORKER_INTEGRITY_RESPONSE_INVALID"),
        };
        Ok(MessageCacheWorkerIntegrityResult { status })
    }

    pub fn put_local_history(
        &mut self,
        input: &PutLocalHistoryInput,
    ) -> Result<MessageCacheWorkerPutLocalHistoryResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerPutLocalHistoryResult =
            self.request("scope.local_history.put", Some(payload(input)?))?;
        if result.protocol_version != LOCAL_HISTORY_PROTOCOL_VERSION
            || result.projection != input.projection
            || result.projection.validate().is_err()
        {
            return self.invalid_response("WORKER_LOCAL_HISTORY_PUT_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerPutLocalHistoryResult {
            projection: result.projection,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    pub fn snapshot_local_history(
        &mut self,
        input: &SnapshotLocalHistoryInput,
    ) -> Result<MessageCacheWorkerSnapshotLocalHistoryResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerSnapshotLocalHistoryResult =
            self.request("scope.local_history.snapshot", Some(payload(input)?))?;
        if result.protocol_version != LOCAL_HISTORY_PROTOCOL_VERSION
            || result.projections.len() > usize::from(input.limit)
            || result.interrupted_count > result.projections.len()
            || result.projections.iter().any(|projection| {
                projection.validate().is_err()
                    || projection.provider_identity_digest != input.provider_identity_digest
            })
            || result
                .projections
                .windows(2)
                .any(|pair| pair[0].updated_at_epoch_ms < pair[1].updated_at_epoch_ms)
        {
            return self.invalid_response("WORKER_LOCAL_HISTORY_SNAPSHOT_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerSnapshotLocalHistoryResult {
            projections: result.projections,
            interrupted_count: result.interrupted_count,
        })
    }

    pub fn release_local_history(
        &mut self,
        input: &ReleaseLocalHistoryInput,
    ) -> Result<MessageCacheWorkerReleaseLocalHistoryResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerReleaseLocalHistoryResult =
            self.request("scope.local_history.release", Some(payload(input)?))?;
        if result.protocol_version != LOCAL_HISTORY_PROTOCOL_VERSION
            || result.conversation_id != input.conversation_id
        {
            return self.invalid_response("WORKER_LOCAL_HISTORY_RELEASE_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerReleaseLocalHistoryResult {
            conversation_id: result.conversation_id,
            released: result.released,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    pub fn rebuild_scope(
        &mut self,
        input: &MessageCacheWorkerRebuildInput,
    ) -> Result<MessageCacheWorkerRebuildResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(MessageCacheWorkerProcessError::new)?;
        let result: WorkerRebuildResult = self.request("scope.rebuild", Some(payload(input)?))?;
        let output = validate_rebuild_result(self, result)?;
        if output.status == MessageCacheWorkerRebuildStatus::RestoreCompleted {
            self.wait_for_exit()?;
        }
        Ok(output)
    }

    pub fn complete_rebuild(
        &mut self,
        input: &MessageCacheWorkerCompleteRebuildInput,
    ) -> Result<MessageCacheWorkerRebuildResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(MessageCacheWorkerProcessError::new)?;
        let result: WorkerRebuildResult =
            self.request("scope.complete_rebuild", Some(payload(input)?))?;
        let output = validate_rebuild_result(self, result)?;
        if output.status != MessageCacheWorkerRebuildStatus::RestoreCompleted
            || output.idempotency_replayed
        {
            return self.invalid_response("WORKER_REBUILD_RESPONSE_INVALID");
        }
        self.wait_for_exit()?;
        Ok(output)
    }

    pub fn page(
        &mut self,
        input: &PageInput,
    ) -> Result<MessageCacheWorkerPageResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerPageResult = self.request("scope.page", Some(payload(input)?))?;
        if result.protocol_version != MESSAGE_CACHE_PROTOCOL_VERSION
            || !valid_page_result(input, &result)
        {
            return self.invalid_response("WORKER_PAGE_RESPONSE_INVALID");
        }
        Ok(MessageCacheWorkerPageResult {
            projections: result.projections,
            next_after_sequence: result.next_after_sequence,
            has_more: result.has_more,
        })
    }

    pub fn purge_scope(
        mut self,
        input: &PurgeScopeInput,
    ) -> Result<MessageCacheWorkerPurgeResult, MessageCacheWorkerProcessError> {
        input
            .validate()
            .map_err(|error| MessageCacheWorkerProcessError::new(error.code))?;
        let result: WorkerPurgeResult = self.request("scope.purge", Some(payload(input)?))?;
        if result.protocol_version != MESSAGE_CACHE_PROTOCOL_VERSION || !result.purged {
            return self.invalid_response("WORKER_PURGE_RESPONSE_INVALID");
        }
        let output = MessageCacheWorkerPurgeResult {
            idempotency_replayed: result.idempotency_replayed,
        };
        self.wait_for_exit()?;
        Ok(output)
    }

    pub fn close_scope(mut self, scope_handle: &str) -> Result<(), MessageCacheWorkerProcessError> {
        let result: WorkerClosedResult =
            self.request("scope.close", Some(json!({ "scope_handle": scope_handle })))?;
        if result.scope_status != "closed" {
            return self.invalid_response("WORKER_CLOSE_RESPONSE_INVALID");
        }
        self.wait_for_exit()
    }

    pub fn shutdown(mut self) -> Result<(), MessageCacheWorkerProcessError> {
        let result: WorkerShutdownResult = self.request("worker.shutdown", None)?;
        if result.status != "shutting_down" {
            return self.invalid_response("WORKER_SHUTDOWN_RESPONSE_INVALID");
        }
        self.wait_for_exit()
    }

    fn invalid_response<T>(
        &mut self,
        code: &'static str,
    ) -> Result<T, MessageCacheWorkerProcessError> {
        self.terminate();
        Err(MessageCacheWorkerProcessError::new(code))
    }
}

fn validate_rebuild_result(
    process: &mut MessageCacheWorkerProcess,
    result: WorkerRebuildResult,
) -> Result<MessageCacheWorkerRebuildResult, MessageCacheWorkerProcessError> {
    if result.incident_id.len() != 32
        || !result
            .incident_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || !valid_sha256(&result.evidence_hash)
    {
        return process.invalid_response("WORKER_REBUILD_RESPONSE_INVALID");
    }
    let (status, idempotency_replayed) = match result.scope_status.as_str() {
        "restoring_from_server"
            if result.adapter_id.as_deref().is_some_and(valid_adapter_id)
                && result.restored_projection_count == 0
                && result.idempotency_replayed.is_none() =>
        {
            (MessageCacheWorkerRebuildStatus::RestoringFromServer, false)
        }
        "restore_completed"
            if result.adapter_id.is_none() && result.idempotency_replayed.is_some() =>
        {
            (
                MessageCacheWorkerRebuildStatus::RestoreCompleted,
                result.idempotency_replayed.unwrap_or(false),
            )
        }
        _ => return process.invalid_response("WORKER_REBUILD_RESPONSE_INVALID"),
    };
    Ok(MessageCacheWorkerRebuildResult {
        status,
        incident_id: result.incident_id,
        evidence_hash: result.evidence_hash,
        restored_projection_count: result.restored_projection_count,
        idempotency_replayed,
    })
}

fn payload(input: &impl serde::Serialize) -> Result<Value, MessageCacheWorkerProcessError> {
    serde_json::to_value(input)
        .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_REQUEST_INVALID"))
}

fn valid_page_result(input: &PageInput, result: &WorkerPageResult) -> bool {
    if result.projections.len() > usize::from(input.limit)
        || (result.has_more && result.projections.len() != usize::from(input.limit))
        || result.projections.iter().any(|projection| {
            projection.validate().is_err() || projection.thread_id != input.thread_id
        })
    {
        return false;
    }
    let mut previous = input.after_sequence.unwrap_or(0);
    for projection in &result.projections {
        if projection.sequence <= previous {
            return false;
        }
        previous = projection.sequence;
    }
    match result.projections.last() {
        Some(last) => result.next_after_sequence == Some(last.sequence),
        None => result.next_after_sequence.is_none() && !result.has_more,
    }
}
