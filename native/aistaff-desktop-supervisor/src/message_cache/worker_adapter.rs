use super::contracts::{
    CacheAvailability, CacheCapabilitiesResult, CacheScopeStatus, LOCAL_HISTORY_PROTOCOL_VERSION,
    MESSAGE_CACHE_PROTOCOL_VERSION, MessageCacheError, OpenScopeInput, OpenScopeResult, PageInput,
    PageResult, PurgeScopeInput, PurgeScopeResult, PutConfirmedInput, PutConfirmedResult,
    PutLocalHistoryInput, PutLocalHistoryResult, ReconcileDecision, ReconcileInput,
    ReconcileResult, ReleaseLocalHistoryInput, ReleaseLocalHistoryResult, SideEffectState,
    SnapshotLocalHistoryInput, SnapshotLocalHistoryResult,
};
use super::service::MessageCacheAdapter;
use crate::message_cache_worker::{MessageCacheWorkerProcess, MessageCacheWorkerProcessError};
use std::path::PathBuf;
use std::time::Duration;

const WORKER_TIMEOUT: Duration = Duration::from_secs(5);
const ADAPTER_ID: &str = "wcdb.v2.1.16";
const MAXIMUM_RECONCILE_PAGES: usize = 128;

pub struct WorkerMessageCacheAdapter {
    binary_path: PathBuf,
    cache_root: PathBuf,
    worker: Option<MessageCacheWorkerProcess>,
    active_scope: Option<String>,
    unavailable_reason: Option<&'static str>,
}

impl WorkerMessageCacheAdapter {
    pub fn from_current_process() -> Self {
        let binary_path = std::env::current_exe();
        let cache_root = std::env::current_dir().map(|root| root.join("message-cache"));
        match (binary_path, cache_root) {
            (Ok(binary_path), Ok(cache_root)) => {
                match MessageCacheWorkerProcess::spawn(&binary_path, &cache_root, WORKER_TIMEOUT) {
                    Ok(worker) if worker.native_adapter() == "available" => Self {
                        binary_path,
                        cache_root,
                        worker: Some(worker),
                        active_scope: None,
                        unavailable_reason: None,
                    },
                    Ok(worker) => {
                        let reason = map_unavailable_reason(worker.native_adapter_reason());
                        let _ = worker.force_stop();
                        Self::unavailable(binary_path, cache_root, reason)
                    }
                    Err(error) => {
                        Self::unavailable(binary_path, cache_root, map_worker_start_error(&error))
                    }
                }
            }
            _ => Self::unavailable(
                PathBuf::new(),
                PathBuf::new(),
                "CACHE_RUNTIME_ROOT_UNAVAILABLE",
            ),
        }
    }

    fn unavailable(binary_path: PathBuf, cache_root: PathBuf, reason: &'static str) -> Self {
        Self {
            binary_path,
            cache_root,
            worker: None,
            active_scope: None,
            unavailable_reason: Some(reason),
        }
    }

    fn worker(
        &mut self,
        scope_handle: &str,
    ) -> Result<&mut MessageCacheWorkerProcess, MessageCacheError> {
        if self.unavailable_reason.is_some() || self.worker.is_none() {
            return Err(MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"));
        }
        if self.active_scope.as_deref() != Some(scope_handle) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_OPEN"));
        }
        self.worker
            .as_mut()
            .ok_or_else(|| MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"))
    }

    fn restart_worker(&mut self) -> Result<&mut MessageCacheWorkerProcess, MessageCacheError> {
        if let Some(worker) = self.worker.take() {
            let _ = worker.force_stop();
        }
        self.active_scope = None;
        let worker =
            MessageCacheWorkerProcess::spawn(&self.binary_path, &self.cache_root, WORKER_TIMEOUT)
                .map_err(map_worker_error)?;
        if worker.native_adapter() != "available" {
            let _ = worker.force_stop();
            return Err(MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"));
        }
        self.worker = Some(worker);
        self.worker
            .as_mut()
            .ok_or_else(|| MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"))
    }
}

impl Drop for WorkerMessageCacheAdapter {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.force_stop();
        }
    }
}

impl MessageCacheAdapter for WorkerMessageCacheAdapter {
    fn capabilities(&self) -> CacheCapabilitiesResult {
        match self.unavailable_reason {
            Some(reason_code) => CacheCapabilitiesResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                adapter_id: "unavailable",
                availability: CacheAvailability::AdapterUnavailable,
                persistent: false,
                reason_code: Some(reason_code),
            },
            None => CacheCapabilitiesResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                adapter_id: ADAPTER_ID,
                availability: CacheAvailability::Available,
                persistent: true,
                reason_code: None,
            },
        }
    }

    fn open_scope(&mut self, input: OpenScopeInput) -> Result<OpenScopeResult, MessageCacheError> {
        if self.unavailable_reason.is_some() {
            return Err(MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"));
        }
        if self.active_scope.as_deref() == Some(input.scope_handle.as_str()) {
            return Ok(OpenScopeResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                scope_status: CacheScopeStatus::Ready,
                adapter_id: ADAPTER_ID,
                persistent: true,
                reopened: true,
            });
        }
        let worker = if self.active_scope.is_some() {
            self.restart_worker()?
        } else {
            self.worker
                .as_mut()
                .ok_or_else(|| MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"))?
        };
        let opened = worker
            .open_scope(&input.scope_handle)
            .map_err(map_worker_error)?;
        if opened.adapter_id != ADAPTER_ID || !opened.persistent {
            return Err(MessageCacheError::new("CACHE_WORKER_RESPONSE_INVALID"));
        }
        self.active_scope = Some(input.scope_handle);
        Ok(OpenScopeResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            scope_status: CacheScopeStatus::Ready,
            adapter_id: ADAPTER_ID,
            persistent: true,
            reopened: opened.reopened,
        })
    }

    fn put_confirmed(
        &mut self,
        input: PutConfirmedInput,
    ) -> Result<PutConfirmedResult, MessageCacheError> {
        let result = self
            .worker(&input.scope_handle)?
            .put_confirmed(&input)
            .map_err(map_worker_error)?;
        Ok(PutConfirmedResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            projection: result.projection,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    fn page(&mut self, input: PageInput) -> Result<PageResult, MessageCacheError> {
        let result = self
            .worker(&input.scope_handle)?
            .page(&input)
            .map_err(map_worker_error)?;
        Ok(PageResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            projections: result.projections,
            next_after_sequence: result.next_after_sequence,
            has_more: result.has_more,
        })
    }

    fn purge_scope(
        &mut self,
        input: PurgeScopeInput,
    ) -> Result<PurgeScopeResult, MessageCacheError> {
        if self.active_scope.as_deref() != Some(input.scope_handle.as_str()) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_OPEN"));
        }
        let worker = self
            .worker
            .take()
            .ok_or_else(|| MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"))?;
        self.active_scope = None;
        let result = worker.purge_scope(&input).map_err(map_worker_error)?;
        self.restart_worker()?;
        Ok(PurgeScopeResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            purged: true,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    fn reconcile(&mut self, input: ReconcileInput) -> Result<ReconcileResult, MessageCacheError> {
        if input.side_effect_state == SideEffectState::Unknown {
            return Ok(ReconcileResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                decision: ReconcileDecision::ReconcileRequired,
                cache_last_sequence: None,
                reason_code: Some("UNKNOWN_SIDE_EFFECT"),
            });
        }
        let mut after_sequence = None;
        let mut latest = None;
        for _ in 0..MAXIMUM_RECONCILE_PAGES {
            let page = self.page(PageInput {
                scope_handle: input.scope_handle.clone(),
                thread_id: input.thread_id.clone(),
                after_sequence,
                limit: 50,
            })?;
            latest = page.projections.last().cloned().or(latest);
            if !page.has_more {
                let cache_last_sequence = latest.as_ref().map(|item| item.sequence);
                let cache_cursor = latest
                    .as_ref()
                    .and_then(|item| item.server_cursor.as_deref());
                let (decision, reason_code) = match cache_last_sequence {
                    None if input.server_last_sequence == 0 => (ReconcileDecision::UseCache, None),
                    None => (ReconcileDecision::RefreshRequired, Some("CACHE_EMPTY")),
                    Some(sequence) if sequence > input.server_last_sequence => (
                        ReconcileDecision::RebuildRequired,
                        Some("CACHE_AHEAD_OF_SERVER"),
                    ),
                    Some(sequence) if sequence < input.server_last_sequence => (
                        ReconcileDecision::RefreshRequired,
                        Some("CACHE_BEHIND_SERVER"),
                    ),
                    Some(_) if cache_cursor != input.server_cursor.as_deref() => (
                        ReconcileDecision::RebuildRequired,
                        Some("CACHE_CURSOR_MISMATCH"),
                    ),
                    Some(_) => (ReconcileDecision::UseCache, None),
                };
                return Ok(ReconcileResult {
                    protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                    decision,
                    cache_last_sequence,
                    reason_code,
                });
            }
            after_sequence = page.next_after_sequence;
        }
        Err(MessageCacheError::new("CACHE_RECONCILE_LIMIT_EXCEEDED"))
    }

    fn put_local_history(
        &mut self,
        input: PutLocalHistoryInput,
    ) -> Result<PutLocalHistoryResult, MessageCacheError> {
        let result = self
            .worker(&input.scope_handle)?
            .put_local_history(&input)
            .map_err(map_worker_error)?;
        Ok(PutLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            projection: result.projection,
            idempotency_replayed: result.idempotency_replayed,
        })
    }

    fn snapshot_local_history(
        &mut self,
        input: SnapshotLocalHistoryInput,
    ) -> Result<SnapshotLocalHistoryResult, MessageCacheError> {
        let result = self
            .worker(&input.scope_handle)?
            .snapshot_local_history(&input)
            .map_err(map_worker_error)?;
        Ok(SnapshotLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            projections: result.projections,
            interrupted_count: result.interrupted_count,
        })
    }

    fn release_local_history(
        &mut self,
        input: ReleaseLocalHistoryInput,
    ) -> Result<ReleaseLocalHistoryResult, MessageCacheError> {
        let result = self
            .worker(&input.scope_handle)?
            .release_local_history(&input)
            .map_err(map_worker_error)?;
        Ok(ReleaseLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            conversation_id: result.conversation_id,
            released: result.released,
            idempotency_replayed: result.idempotency_replayed,
        })
    }
}

fn map_worker_error(error: MessageCacheWorkerProcessError) -> MessageCacheError {
    let code = match error.code.as_str() {
        "CACHE_OPERATION_REPLAY_MISMATCH" => "CACHE_OPERATION_REPLAY_MISMATCH",
        "CACHE_SEQUENCE_REGRESSION" => "CACHE_SEQUENCE_REGRESSION",
        "CACHE_SCOPE_MISMATCH" => "CACHE_SCOPE_MISMATCH",
        "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED" => {
            "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
        }
        "CACHE_SCHEMA_MISMATCH_QUARANTINE_REQUIRED" => "CACHE_SCHEMA_MISMATCH_QUARANTINE_REQUIRED",
        "CACHE_KEY_ACCESS_DENIED" => "CACHE_KEY_ACCESS_DENIED",
        "CACHE_KEY_PROVIDER_UNAVAILABLE" => "CACHE_KEY_PROVIDER_UNAVAILABLE",
        "WCDB_NATIVE_DATABASE_BUSY" => "WCDB_NATIVE_DATABASE_BUSY",
        "WCDB_NATIVE_DATABASE_CORRUPT" => "WCDB_NATIVE_DATABASE_CORRUPT",
        "WCDB_NATIVE_DATABASE_FULL" => "WCDB_NATIVE_DATABASE_FULL",
        _ => "CACHE_WORKER_OPERATION_FAILED",
    };
    MessageCacheError::new(code)
}

fn map_worker_start_error(error: &MessageCacheWorkerProcessError) -> &'static str {
    match error.code.as_str() {
        "CACHE_ROOT_INVALID" | "CACHE_ROOT_UNAVAILABLE" | "CACHE_ROOT_UNSAFE" => {
            "CACHE_RUNTIME_ROOT_UNAVAILABLE"
        }
        _ => "CACHE_WORKER_UNAVAILABLE",
    }
}

fn map_unavailable_reason(reason: Option<&str>) -> &'static str {
    match reason {
        Some("WCDB_NATIVE_PACKAGE_MISSING") => "WCDB_NATIVE_PACKAGE_MISSING",
        Some("WCDB_NATIVE_PACKAGE_NOT_ADMITTED") => "WCDB_NATIVE_PACKAGE_NOT_ADMITTED",
        Some("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID") => "WCDB_NATIVE_PACKAGE_LAYOUT_INVALID",
        Some("WCDB_NATIVE_PLATFORM_UNSUPPORTED") => "WCDB_NATIVE_PLATFORM_UNSUPPORTED",
        Some("WCDB_NATIVE_PACKAGE_MANIFEST_INVALID") => "WCDB_NATIVE_PACKAGE_MANIFEST_INVALID",
        Some("WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH") => "WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH",
        Some("WCDB_NATIVE_RELEASE_MANIFEST_INVALID") => "WCDB_NATIVE_RELEASE_MANIFEST_INVALID",
        Some("WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH") => "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH",
        Some("WCDB_NATIVE_PACKAGE_BINDING_MISMATCH") => "WCDB_NATIVE_PACKAGE_BINDING_MISMATCH",
        Some("WCDB_NATIVE_PACKAGE_HASH_MISMATCH") => "WCDB_NATIVE_PACKAGE_HASH_MISMATCH",
        Some("WCDB_NATIVE_PACKAGE_IDENTITY_CHANGED") => "WCDB_NATIVE_PACKAGE_IDENTITY_CHANGED",
        Some("WCDB_NATIVE_PACKAGE_SYMLINK_REJECTED") => "WCDB_NATIVE_PACKAGE_SYMLINK_REJECTED",
        Some("WCDB_NATIVE_PACKAGE_FILE_INVALID") => "WCDB_NATIVE_PACKAGE_FILE_INVALID",
        Some("WCDB_NATIVE_BINARY_TARGET_MISMATCH") => "WCDB_NATIVE_BINARY_TARGET_MISMATCH",
        Some("WCDB_NATIVE_LIBRARY_LOAD_FAILED") => "WCDB_NATIVE_LIBRARY_LOAD_FAILED",
        Some("WCDB_NATIVE_ABI_REJECTED") => "WCDB_NATIVE_ABI_REJECTED",
        Some("WCDB_NATIVE_PROBE_MISMATCH") => "WCDB_NATIVE_PROBE_MISMATCH",
        Some("WCDB_NATIVE_PROBE_SYMBOL_MISSING") => "WCDB_NATIVE_PROBE_SYMBOL_MISSING",
        _ => "WCDB_ADAPTER_NOT_IMPLEMENTED",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter_unavailable() -> WorkerMessageCacheAdapter {
        WorkerMessageCacheAdapter::unavailable(
            PathBuf::from("/unavailable/bin/aistaff-desktop-supervisor"),
            PathBuf::from("/unavailable/runtime"),
            "WCDB_NATIVE_PACKAGE_MISSING",
        )
    }

    #[test]
    fn unavailable_worker_reports_stable_capability_and_never_opens_scope() {
        let mut adapter = adapter_unavailable();
        let capabilities = adapter.capabilities();
        assert_eq!(
            capabilities.availability,
            CacheAvailability::AdapterUnavailable
        );
        assert_eq!(
            capabilities.reason_code,
            Some("WCDB_NATIVE_PACKAGE_MISSING")
        );
        assert_eq!(
            adapter
                .open_scope(OpenScopeInput {
                    scope_handle: "11111111-1111-4111-8111-111111111111".to_owned(),
                })
                .expect_err("unavailable"),
            MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE")
        );
    }

    #[test]
    fn package_admission_failure_remains_a_stable_capability_reason() {
        assert_eq!(
            map_unavailable_reason(Some("WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH")),
            "WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH"
        );
        assert_eq!(
            map_unavailable_reason(Some("unexpected raw failure")),
            "WCDB_ADAPTER_NOT_IMPLEMENTED"
        );
    }

    #[test]
    fn worker_error_mapping_never_forwards_unknown_process_detail() {
        assert_eq!(
            map_worker_error(MessageCacheWorkerProcessError {
                code: "CACHE_OPERATION_REPLAY_MISMATCH".to_owned(),
            }),
            MessageCacheError::new("CACHE_OPERATION_REPLAY_MISMATCH")
        );
        assert_eq!(
            map_worker_error(MessageCacheWorkerProcessError {
                code: "WORKER_PRIVATE_DIAGNOSTIC".to_owned(),
            }),
            MessageCacheError::new("CACHE_WORKER_OPERATION_FAILED")
        );
    }
}
