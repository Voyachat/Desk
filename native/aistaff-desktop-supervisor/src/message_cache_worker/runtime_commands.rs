use super::contracts::{
    MessageCacheWorkerRequest, ProcessedWorkerRequest, WorkerScopeInput, error_response,
    success_response,
};
use super::key_provider::CacheKeyProviderPort;
use super::path::valid_scope_handle;
use super::recovery_contracts::{CacheRecoveryReason, RecoveryAdmission};
use super::request_hash::{
    purge_request_hash, put_local_history_request_hash, put_request_hash,
    release_local_history_request_hash,
};
use super::retention::CacheClockPort;
use super::runtime::{MessageCacheWorkerRuntime, parse_payload};
use super::scope_driver::{
    EncryptedScopeDriver, EncryptedScopeDriverError, EncryptedScopeOpenContext,
    EncryptedScopeOpenResult, WorkerAdapterAvailability,
};
use crate::message_cache::{
    LOCAL_HISTORY_PROTOCOL_VERSION, MESSAGE_CACHE_PROTOCOL_VERSION, PageInput, PurgeScopeInput,
    PutConfirmedInput, PutLocalHistoryInput, ReleaseLocalHistoryInput, SnapshotLocalHistoryInput,
};
use serde_json::json;

const UNKNOWN_MUTATION_CODE: &str = "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED";

impl<K: CacheKeyProviderPort, D: EncryptedScopeDriver, C: CacheClockPort>
    MessageCacheWorkerRuntime<K, D, C>
{
    pub(super) fn open_scope(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        if self.recovery_admission.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RECOVERY_ADMISSION_PENDING",
                false,
            );
        }
        let input: WorkerScopeInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        let opened = match self.open_encrypted_scope(&input) {
            Ok(opened) => opened,
            Err((code, should_shutdown)) => {
                return error_response(request.request_id, request.sequence, code, should_shutdown);
            }
        };
        self.active_scope = Some(input.scope_handle);
        success_response(
            request.request_id,
            request.sequence,
            json!({
                "scope_status": "ready",
                "adapter_id": self.driver.adapter_id(),
                "persistent": true,
                "reopened": opened.reopened
            }),
            false,
        )
    }

    pub(super) fn put_confirmed(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: PutConfirmedInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        let (confirmed_at_epoch_s, expires_at_epoch_s) = match self.mutation_time() {
            Ok(value) => value,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        let request_hash = put_request_hash(&input);
        match self.driver.put_confirmed(
            &input,
            &request_hash,
            confirmed_at_epoch_s,
            expires_at_epoch_s,
        ) {
            Ok(result) => {
                if self.active_restore.is_some() && !result.idempotency_replayed {
                    let Some(next_count) = self
                        .active_restore
                        .as_ref()
                        .and_then(|restore| restore.restored_projection_count.checked_add(1))
                    else {
                        let _ = self.close_active_scope();
                        return error_response(
                            request.request_id,
                            request.sequence,
                            "CACHE_RESTORE_COUNT_UNKNOWN_RECONCILE_REQUIRED",
                            true,
                        );
                    };
                    if let Some(restore) = self.active_restore.as_mut() {
                        restore.restored_projection_count = next_count;
                    }
                }
                success_response(
                    request.request_id,
                    request.sequence,
                    json!({
                        "protocol_version": MESSAGE_CACHE_PROTOCOL_VERSION,
                        "projection": input.projection,
                        "idempotency_replayed": result.idempotency_replayed
                    }),
                    false,
                )
            }
            Err(error) => self.mutation_error(request.request_id, request.sequence, error),
        }
    }

    pub(super) fn page(&mut self, request: MessageCacheWorkerRequest) -> ProcessedWorkerRequest {
        let input: PageInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        if self.active_restore.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RESTORE_PAGE_FORBIDDEN",
                false,
            );
        }
        let now_epoch_s = match self.clock.now_epoch_seconds() {
            Ok(now) if now > 0 => now,
            Ok(_) | Err(_) => {
                return error_response(
                    request.request_id,
                    request.sequence,
                    "CACHE_CLOCK_UNAVAILABLE",
                    false,
                );
            }
        };
        match self.driver.page(&input, now_epoch_s) {
            Ok(result) => success_response(
                request.request_id,
                request.sequence,
                json!({
                    "protocol_version": MESSAGE_CACHE_PROTOCOL_VERSION,
                    "projections": result.projections,
                    "next_after_sequence": result.next_after_sequence,
                    "has_more": result.has_more
                }),
                false,
            ),
            Err(error) => error_response(request.request_id, request.sequence, error.code, false),
        }
    }

    pub(super) fn put_local_history(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: PutLocalHistoryInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => return error_response(request.request_id, request.sequence, code, false),
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        let request_hash = put_local_history_request_hash(&input);
        match self.driver.put_local_history(&input, &request_hash) {
            Ok(result) => success_response(
                request.request_id,
                request.sequence,
                json!({
                    "protocol_version": LOCAL_HISTORY_PROTOCOL_VERSION,
                    "projection": input.projection,
                    "idempotency_replayed": result.idempotency_replayed
                }),
                false,
            ),
            Err(error) => self.mutation_error(request.request_id, request.sequence, error),
        }
    }

    pub(super) fn snapshot_local_history(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: SnapshotLocalHistoryInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => return error_response(request.request_id, request.sequence, code, false),
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        match self.driver.snapshot_local_history(&input) {
            Ok(result) => success_response(
                request.request_id,
                request.sequence,
                json!({
                    "protocol_version": LOCAL_HISTORY_PROTOCOL_VERSION,
                    "projections": result.projections,
                    "interrupted_count": result.interrupted_count
                }),
                false,
            ),
            Err(error) => self.mutation_error(request.request_id, request.sequence, error),
        }
    }

    pub(super) fn release_local_history(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: ReleaseLocalHistoryInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => return error_response(request.request_id, request.sequence, code, false),
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        let committed_at_epoch_ms = match self
            .clock
            .now_epoch_seconds()
            .ok()
            .and_then(|seconds| u64::try_from(seconds).ok())
            .and_then(|seconds| seconds.checked_mul(1_000))
        {
            Some(value) if value > 0 => value,
            _ => {
                return error_response(
                    request.request_id,
                    request.sequence,
                    "CACHE_CLOCK_UNAVAILABLE",
                    false,
                );
            }
        };
        let request_hash = release_local_history_request_hash(&input);
        match self
            .driver
            .release_local_history(&input, &request_hash, committed_at_epoch_ms)
        {
            Ok(result) => success_response(
                request.request_id,
                request.sequence,
                json!({
                    "protocol_version": LOCAL_HISTORY_PROTOCOL_VERSION,
                    "conversation_id": input.conversation_id,
                    "released": result.released,
                    "idempotency_replayed": result.idempotency_replayed
                }),
                false,
            ),
            Err(error) => self.mutation_error(request.request_id, request.sequence, error),
        }
    }

    pub(super) fn purge_scope(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: PurgeScopeInput = match validated_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        if self.active_restore.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RESTORE_PURGE_FORBIDDEN",
                false,
            );
        }
        let (committed_at_epoch_s, expires_at_epoch_s) = match self.mutation_time() {
            Ok(value) => value,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        let request_hash = purge_request_hash(&input);
        let result = match self.driver.purge_scope(
            &input,
            &request_hash,
            committed_at_epoch_s,
            expires_at_epoch_s,
        ) {
            Ok(result) => result,
            Err(error) => {
                return self.mutation_error(request.request_id, request.sequence, error);
            }
        };
        if self.close_active_scope().is_err() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_PURGE_COMMITTED_RECONCILE_REQUIRED",
                true,
            );
        }
        if self
            .key_provider
            .delete_scope_key(&input.scope_handle)
            .is_err()
        {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_PURGE_KEY_DELETE_FAILED",
                true,
            );
        }
        success_response(
            request.request_id,
            request.sequence,
            json!({
                "protocol_version": MESSAGE_CACHE_PROTOCOL_VERSION,
                "purged": true,
                "idempotency_replayed": result.idempotency_replayed
            }),
            true,
        )
    }

    pub(super) fn close_scope(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: WorkerScopeInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if !self.scope_matches(&input.scope_handle) {
            return scope_mismatch(request.request_id, request.sequence);
        }
        if self.active_restore.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RESTORE_COMPLETION_REQUIRED",
                false,
            );
        }
        match self.close_active_scope() {
            Ok(()) => success_response(
                request.request_id,
                request.sequence,
                json!({ "scope_status": "closed" }),
                true,
            ),
            Err(code) => error_response(request.request_id, request.sequence, code, true),
        }
    }

    pub(super) fn shutdown(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        if request.payload.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "WORKER_INVALID_COMMAND_PAYLOAD",
                false,
            );
        }
        match self.close_active_scope() {
            Ok(()) => success_response(
                request.request_id,
                request.sequence,
                json!({ "status": "shutting_down" }),
                true,
            ),
            Err(code) => error_response(request.request_id, request.sequence, code, true),
        }
    }

    pub(super) fn close_active_scope(&mut self) -> Result<(), &'static str> {
        let Some(scope_handle) = self.active_scope.take() else {
            return Ok(());
        };
        let close_result = self.driver.close_scope();
        let revoke_result = self.key_provider.revoke_scope(&scope_handle);
        close_result
            .map_err(|error| error.code)
            .and_then(|()| revoke_result.map_err(|error| error.code))
    }

    fn open_encrypted_scope(
        &mut self,
        input: &WorkerScopeInput,
    ) -> Result<EncryptedScopeOpenResult, (&'static str, bool)> {
        if !valid_scope_handle(&input.scope_handle) {
            return Err(("INVALID_CACHE_SCOPE_HANDLE", false));
        }
        if self.active_scope.is_some() {
            return Err(("CACHE_SCOPE_ALREADY_OPEN", false));
        }
        if self.driver.availability() != WorkerAdapterAvailability::Available {
            return Err((
                self.driver
                    .unavailable_reason()
                    .unwrap_or("WCDB_ADAPTER_NOT_IMPLEMENTED"),
                false,
            ));
        }
        let cache_root = self
            .cache_root
            .as_ref()
            .ok_or(("WORKER_STATE_INVALID", true))?;
        let database_path = cache_root
            .scope_database_path(&input.scope_handle)
            .map_err(|error| (error.code, false))?;
        let now_epoch_s = self
            .clock
            .now_epoch_seconds()
            .ok()
            .filter(|now| self.retention.expires_at(*now).is_ok())
            .ok_or(("CACHE_CLOCK_UNAVAILABLE", false))?;
        let key = self
            .key_provider
            .load_scope_key(&input.scope_handle)
            .map_err(|error| (error.code, false))?;
        let result = self.driver.open_scope(
            &database_path,
            key.expose(),
            EncryptedScopeOpenContext {
                now_epoch_s,
                retention: self.retention,
            },
        );
        match result {
            Ok(opened) => Ok(opened),
            Err(error) => {
                let revoke_failed = self.key_provider.revoke_scope(&input.scope_handle).is_err();
                if revoke_failed {
                    return Err(("CACHE_SCOPE_KEY_REVOKE_FAILED", true));
                }
                if error.code == "WCDB_NATIVE_SCHEMA_MISMATCH" {
                    self.recovery_admission = Some(RecoveryAdmission {
                        scope_handle: input.scope_handle.clone(),
                        reason: CacheRecoveryReason::DecryptedSchemaMismatch,
                    });
                    Err(("CACHE_SCHEMA_MISMATCH_QUARANTINE_REQUIRED", false))
                } else {
                    Err((error.code, true))
                }
            }
        }
    }

    pub(super) fn scope_matches(&self, scope_handle: &str) -> bool {
        self.active_scope.as_deref() == Some(scope_handle)
    }

    fn mutation_time(&self) -> Result<(i64, i64), &'static str> {
        let now = self.clock.now_epoch_seconds().map_err(|error| error.code)?;
        let expires_at = self.retention.expires_at(now).map_err(|error| error.code)?;
        Ok((now, expires_at))
    }

    fn mutation_error(
        &mut self,
        request_id: String,
        sequence: u64,
        error: EncryptedScopeDriverError,
    ) -> ProcessedWorkerRequest {
        let should_shutdown = error.code == UNKNOWN_MUTATION_CODE;
        if should_shutdown {
            let _ = self.close_active_scope();
        }
        error_response(request_id, sequence, error.code, should_shutdown)
    }
}

fn validated_payload<T>(payload: Option<serde_json::Value>) -> Result<T, &'static str>
where
    T: serde::de::DeserializeOwned + ValidatedCacheInput,
{
    let input: T = parse_payload(payload)?;
    input.validate_code()?;
    Ok(input)
}

trait ValidatedCacheInput {
    fn validate_code(&self) -> Result<(), &'static str>;
}

impl ValidatedCacheInput for PutConfirmedInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

impl ValidatedCacheInput for PageInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

impl ValidatedCacheInput for PurgeScopeInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

impl ValidatedCacheInput for PutLocalHistoryInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

impl ValidatedCacheInput for SnapshotLocalHistoryInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

impl ValidatedCacheInput for ReleaseLocalHistoryInput {
    fn validate_code(&self) -> Result<(), &'static str> {
        self.validate().map_err(|error| error.code)
    }
}

fn scope_mismatch(request_id: String, sequence: u64) -> ProcessedWorkerRequest {
    error_response(request_id, sequence, "CACHE_SCOPE_MISMATCH", false)
}
