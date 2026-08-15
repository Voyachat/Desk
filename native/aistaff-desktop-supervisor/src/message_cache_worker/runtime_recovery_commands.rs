use super::contracts::{
    MessageCacheWorkerRequest, ProcessedWorkerRequest, WorkerScopeInput, error_response,
    success_response,
};
use super::key_provider::CacheKeyProviderPort;
use super::recovery::{RecoveryCoordinator, RecoveryOpenPlan, RecoveryStart};
use super::recovery_contracts::{
    ActiveRestore, CacheRecoveryReason, MessageCacheWorkerCompleteRebuildInput,
    MessageCacheWorkerRebuildInput, RecoveryAdmission,
};
use super::retention::CacheClockPort;
use super::runtime::{MessageCacheWorkerRuntime, parse_payload};
use super::scope_driver::{
    EncryptedScopeDriver, EncryptedScopeIntegrity, EncryptedScopeOpenContext,
};
use serde_json::json;

impl<K: CacheKeyProviderPort, D: EncryptedScopeDriver, C: CacheClockPort>
    MessageCacheWorkerRuntime<K, D, C>
{
    pub(super) fn check_integrity(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: WorkerScopeInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if self.active_restore.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RESTORE_IN_PROGRESS",
                false,
            );
        }
        if !self.scope_matches(&input.scope_handle) {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_SCOPE_MISMATCH",
                false,
            );
        }
        match self.driver.check_integrity() {
            Ok(EncryptedScopeIntegrity::Healthy) => success_response(
                request.request_id,
                request.sequence,
                json!({
                    "integrity_status": "healthy",
                    "scope_status": "ready"
                }),
                false,
            ),
            Ok(EncryptedScopeIntegrity::ConfirmedCorrupt) => {
                if self.close_active_scope().is_err() {
                    return error_response(
                        request.request_id,
                        request.sequence,
                        "CACHE_INTEGRITY_CLOSE_UNKNOWN_RECONCILE_REQUIRED",
                        true,
                    );
                }
                self.recovery_admission = Some(RecoveryAdmission {
                    scope_handle: input.scope_handle,
                    reason: CacheRecoveryReason::IntegrityConfirmedCorrupt,
                });
                success_response(
                    request.request_id,
                    request.sequence,
                    json!({
                        "integrity_status": "confirmed_corrupt",
                        "scope_status": "quarantine_required",
                        "reason": "integrity_confirmed_corrupt"
                    }),
                    false,
                )
            }
            Err(error) => {
                let close_failed = self.close_active_scope().is_err();
                self.recovery_admission = None;
                let code = if !close_failed && error.code == "WCDB_NATIVE_INTEGRITY_CHECK_FAILED" {
                    "CACHE_INTEGRITY_CHECK_FAILED_RECONCILE_REQUIRED"
                } else {
                    "CACHE_INTEGRITY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
                };
                error_response(request.request_id, request.sequence, code, true)
            }
        }
    }

    pub(super) fn rebuild_scope(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: MessageCacheWorkerRebuildInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if let Err(code) = input.validate() {
            return error_response(request.request_id, request.sequence, code, false);
        }
        if self.active_scope.is_some() || self.active_restore.is_some() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_SCOPE_ALREADY_OPEN",
                false,
            );
        }
        let now_epoch_s = match self.recovery_now() {
            Ok(now) => now,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        let plan = match self.start_recovery(&input, now_epoch_s) {
            Ok(RecoveryStart::Completed(evidence)) => {
                self.recovery_admission = None;
                return success_response(
                    request.request_id,
                    request.sequence,
                    json!({
                        "scope_status": "restore_completed",
                        "incident_id": evidence.incident_id,
                        "evidence_hash": evidence.evidence_hash,
                        "restored_projection_count": evidence.restored_projection_count,
                        "idempotency_replayed": true
                    }),
                    true,
                );
            }
            Ok(RecoveryStart::Open(plan)) => plan,
            Err(code) => {
                self.recovery_admission = None;
                return error_response(request.request_id, request.sequence, code, true);
            }
        };
        let restore = match self.open_restore_plan(&input, plan, now_epoch_s) {
            Ok(restore) => restore,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, true);
            }
        };
        self.recovery_admission = None;
        self.active_restore = Some(restore.clone());
        success_response(
            request.request_id,
            request.sequence,
            json!({
                "scope_status": "restoring_from_server",
                "adapter_id": self.driver.adapter_id(),
                "incident_id": restore.incident_id,
                "evidence_hash": restore.evidence_hash,
                "restored_projection_count": 0
            }),
            false,
        )
    }

    pub(super) fn complete_rebuild(
        &mut self,
        request: MessageCacheWorkerRequest,
    ) -> ProcessedWorkerRequest {
        let input: MessageCacheWorkerCompleteRebuildInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if let Err(code) = input.validate() {
            return error_response(request.request_id, request.sequence, code, false);
        }
        let restore = match self.validated_completion_restore(&input) {
            Ok(restore) => restore,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        let now_epoch_s = match self.recovery_now() {
            Ok(now) => now,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, false);
            }
        };
        if self.close_active_scope().is_err() {
            return error_response(
                request.request_id,
                request.sequence,
                "CACHE_RESTORE_CLOSE_UNKNOWN_RECONCILE_REQUIRED",
                true,
            );
        }
        let completed = {
            let Some(root) = self.cache_root.as_ref() else {
                return error_response(
                    request.request_id,
                    request.sequence,
                    "WORKER_STATE_INVALID",
                    true,
                );
            };
            RecoveryCoordinator::new(root).complete(&restore, now_epoch_s)
        };
        match completed {
            Ok(evidence) => {
                self.active_restore = None;
                success_response(
                    request.request_id,
                    request.sequence,
                    json!({
                        "scope_status": "restore_completed",
                        "incident_id": evidence.incident_id,
                        "evidence_hash": evidence.evidence_hash,
                        "restored_projection_count": evidence.restored_projection_count,
                        "idempotency_replayed": false
                    }),
                    true,
                )
            }
            Err(error) => error_response(request.request_id, request.sequence, error.code, true),
        }
    }

    fn recovery_now(&self) -> Result<i64, &'static str> {
        self.clock
            .now_epoch_seconds()
            .ok()
            .filter(|now| *now > 0)
            .ok_or("CACHE_CLOCK_UNAVAILABLE")
    }

    fn start_recovery(
        &self,
        input: &MessageCacheWorkerRebuildInput,
        now_epoch_s: i64,
    ) -> Result<RecoveryStart, &'static str> {
        let root = self.cache_root.as_ref().ok_or("WORKER_STATE_INVALID")?;
        RecoveryCoordinator::new(root)
            .start(input, self.recovery_admission.as_ref(), now_epoch_s)
            .map_err(|error| error.code)
    }

    fn open_restore_plan(
        &mut self,
        input: &MessageCacheWorkerRebuildInput,
        plan: RecoveryOpenPlan,
        now_epoch_s: i64,
    ) -> Result<ActiveRestore, &'static str> {
        let key = self
            .key_provider
            .load_scope_key(&input.scope_handle)
            .map_err(|error| error.code)?;
        let opened = self.driver.open_scope(
            &plan.database_path,
            key.expose(),
            EncryptedScopeOpenContext {
                now_epoch_s,
                retention: self.retention,
            },
        );
        match opened {
            Ok(opened) if !opened.reopened => {}
            Ok(_) => return Err(self.reject_reopened_restore(&input.scope_handle)),
            Err(_) => {
                return Err(self.reject_failed_restore_open(&input.scope_handle));
            }
        }
        self.active_scope = Some(input.scope_handle.clone());
        let mut restore = plan.restore;
        let marked = self
            .cache_root
            .as_ref()
            .ok_or("WORKER_STATE_INVALID")
            .and_then(|root| {
                RecoveryCoordinator::new(root)
                    .mark_restoring(&mut restore, now_epoch_s)
                    .map_err(|error| error.code)
            });
        if let Err(code) = marked {
            let _ = self.close_active_scope();
            return Err(code);
        }
        Ok(restore)
    }

    fn reject_reopened_restore(&mut self, scope_handle: &str) -> &'static str {
        let close_failed = self.driver.close_scope().is_err();
        let revoke_failed = self.key_provider.revoke_scope(scope_handle).is_err();
        if close_failed || revoke_failed {
            "CACHE_RESTORE_OPEN_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
        } else {
            "CACHE_RESTORE_OPEN_FAILED_RECONCILE_REQUIRED"
        }
    }

    fn reject_failed_restore_open(&mut self, scope_handle: &str) -> &'static str {
        if self.key_provider.revoke_scope(scope_handle).is_err() {
            "CACHE_RESTORE_OPEN_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
        } else {
            "CACHE_RESTORE_OPEN_FAILED_RECONCILE_REQUIRED"
        }
    }

    fn validated_completion_restore(
        &self,
        input: &MessageCacheWorkerCompleteRebuildInput,
    ) -> Result<ActiveRestore, &'static str> {
        let restore = self
            .active_restore
            .clone()
            .ok_or("CACHE_RESTORE_NOT_ACTIVE")?;
        if self.active_scope.as_deref() != Some(input.scope_handle.as_str())
            || restore.scope_handle != input.scope_handle
            || restore.operation_id != input.operation_id
            || restore.server_snapshot_hash != input.server_snapshot_hash
            || restore.restored_projection_count != input.restored_projection_count
        {
            return Err("CACHE_RESTORE_COMPLETION_MISMATCH");
        }
        Ok(restore)
    }
}
