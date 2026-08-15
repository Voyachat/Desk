use super::contracts::{
    CacheAvailability, CacheCapabilitiesResult, CacheScopeStatus, ConfirmedTimelineProjection,
    LOCAL_HISTORY_PROTOCOL_VERSION, LocalHistoryStatus, MESSAGE_CACHE_PROTOCOL_VERSION,
    MessageCacheError, OpenScopeInput, OpenScopeResult, PageInput, PageResult, PurgeScopeInput,
    PurgeScopeResult, PutConfirmedInput, PutConfirmedResult, PutLocalHistoryInput,
    PutLocalHistoryResult, ReconcileDecision, ReconcileInput, ReconcileResult,
    ReleaseLocalHistoryInput, ReleaseLocalHistoryResult, SideEffectState,
    SnapshotLocalHistoryInput, SnapshotLocalHistoryResult,
};
use super::service::MessageCacheAdapter;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Default)]
struct MemoryScope {
    status: Option<CacheScopeStatus>,
    projections: BTreeMap<(String, u64), ConfirmedTimelineProjection>,
    put_operations: HashMap<String, PutConfirmedInput>,
    local_history: HashMap<String, super::contracts::LocalHistoryTaskProjection>,
    local_put_operations: HashMap<String, PutLocalHistoryInput>,
    local_release_operations: HashMap<String, (String, bool)>,
}

#[derive(Default)]
pub struct MemoryMessageCacheAdapter {
    scopes: HashMap<String, MemoryScope>,
    revoked_scopes: HashSet<String>,
    purge_operations: HashMap<String, String>,
}

impl MemoryMessageCacheAdapter {
    pub fn mark_corrupt(&mut self, scope_handle: &str) {
        if let Some(scope) = self.scopes.get_mut(scope_handle) {
            scope.status = Some(CacheScopeStatus::Corrupt);
        }
    }

    fn scope(&self, scope_handle: &str) -> Result<&MemoryScope, MessageCacheError> {
        if self.revoked_scopes.contains(scope_handle) {
            return Err(MessageCacheError::new("CACHE_SCOPE_REVOKED"));
        }
        self.scopes
            .get(scope_handle)
            .ok_or_else(|| MessageCacheError::new("CACHE_SCOPE_NOT_OPEN"))
    }

    fn scope_mut(&mut self, scope_handle: &str) -> Result<&mut MemoryScope, MessageCacheError> {
        if self.revoked_scopes.contains(scope_handle) {
            return Err(MessageCacheError::new("CACHE_SCOPE_REVOKED"));
        }
        self.scopes
            .get_mut(scope_handle)
            .ok_or_else(|| MessageCacheError::new("CACHE_SCOPE_NOT_OPEN"))
    }
}

impl MessageCacheAdapter for MemoryMessageCacheAdapter {
    fn capabilities(&self) -> CacheCapabilitiesResult {
        CacheCapabilitiesResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            adapter_id: "memory_fixture",
            availability: CacheAvailability::Available,
            persistent: false,
            reason_code: Some("TEST_FIXTURE_ONLY"),
        }
    }

    fn open_scope(&mut self, input: OpenScopeInput) -> Result<OpenScopeResult, MessageCacheError> {
        if self.revoked_scopes.contains(&input.scope_handle) {
            return Err(MessageCacheError::new("CACHE_SCOPE_REVOKED"));
        }
        let reopened = self.scopes.contains_key(&input.scope_handle);
        let scope = self.scopes.entry(input.scope_handle).or_default();
        let scope_status = scope.status.unwrap_or(CacheScopeStatus::Ready);
        scope.status = Some(scope_status);
        Ok(OpenScopeResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            scope_status,
            adapter_id: "memory_fixture",
            persistent: false,
            reopened,
        })
    }

    fn put_confirmed(
        &mut self,
        input: PutConfirmedInput,
    ) -> Result<PutConfirmedResult, MessageCacheError> {
        let scope = self.scope_mut(&input.scope_handle)?;
        if scope.status != Some(CacheScopeStatus::Ready) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_READY"));
        }

        if let Some(previous) = scope.put_operations.get(&input.operation_id) {
            if previous != &input {
                return Err(MessageCacheError::new("CACHE_OPERATION_REPLAY_MISMATCH"));
            }
            return Ok(PutConfirmedResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                projection: input.projection,
                idempotency_replayed: true,
            });
        }

        let latest_sequence = scope
            .projections
            .keys()
            .filter(|(thread_id, _)| thread_id == &input.projection.thread_id)
            .map(|(_, sequence)| *sequence)
            .max();
        if latest_sequence.is_some_and(|sequence| input.projection.sequence <= sequence) {
            return Err(MessageCacheError::new("CACHE_SEQUENCE_REGRESSION"));
        }

        let key = (
            input.projection.thread_id.clone(),
            input.projection.sequence,
        );
        scope.projections.insert(key, input.projection.clone());
        scope
            .put_operations
            .insert(input.operation_id.clone(), input.clone());
        Ok(PutConfirmedResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            projection: input.projection,
            idempotency_replayed: false,
        })
    }

    fn page(&mut self, input: PageInput) -> Result<PageResult, MessageCacheError> {
        let scope = self.scope(&input.scope_handle)?;
        if scope.status != Some(CacheScopeStatus::Ready) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_READY"));
        }
        let after_sequence = input.after_sequence.unwrap_or(0);
        let mut projections = scope
            .projections
            .iter()
            .filter(|((thread_id, sequence), _)| {
                thread_id == &input.thread_id && *sequence > after_sequence
            })
            .map(|(_, projection)| projection.clone())
            .take(usize::from(input.limit) + 1)
            .collect::<Vec<_>>();
        let has_more = projections.len() > usize::from(input.limit);
        if has_more {
            projections.pop();
        }
        let next_after_sequence = projections.last().map(|projection| projection.sequence);
        Ok(PageResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            projections,
            next_after_sequence,
            has_more,
        })
    }

    fn purge_scope(
        &mut self,
        input: PurgeScopeInput,
    ) -> Result<PurgeScopeResult, MessageCacheError> {
        if let Some(previous_scope) = self.purge_operations.get(&input.operation_id) {
            if previous_scope != &input.scope_handle {
                return Err(MessageCacheError::new("CACHE_OPERATION_REPLAY_MISMATCH"));
            }
            return Ok(PurgeScopeResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                purged: true,
                idempotency_replayed: true,
            });
        }
        if self.revoked_scopes.contains(&input.scope_handle) {
            return Err(MessageCacheError::new("CACHE_SCOPE_REVOKED"));
        }
        if self.scopes.remove(&input.scope_handle).is_none() {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_OPEN"));
        }
        self.revoked_scopes.insert(input.scope_handle.clone());
        self.purge_operations
            .insert(input.operation_id, input.scope_handle);
        Ok(PurgeScopeResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            purged: true,
            idempotency_replayed: false,
        })
    }

    fn reconcile(&mut self, input: ReconcileInput) -> Result<ReconcileResult, MessageCacheError> {
        let scope = self.scope(&input.scope_handle)?;
        if input.side_effect_state == SideEffectState::Unknown {
            return Ok(ReconcileResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                decision: ReconcileDecision::ReconcileRequired,
                cache_last_sequence: None,
                reason_code: Some("UNKNOWN_SIDE_EFFECT"),
            });
        }
        if scope.status == Some(CacheScopeStatus::Corrupt) {
            return Ok(ReconcileResult {
                protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
                decision: ReconcileDecision::RebuildRequired,
                cache_last_sequence: None,
                reason_code: Some("CACHE_CORRUPT"),
            });
        }

        let latest = scope
            .projections
            .values()
            .filter(|projection| projection.thread_id == input.thread_id)
            .max_by_key(|projection| projection.sequence);
        let cache_last_sequence = latest.map(|projection| projection.sequence);
        let cache_cursor = latest.and_then(|projection| projection.server_cursor.as_deref());

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
        Ok(ReconcileResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            decision,
            cache_last_sequence,
            reason_code,
        })
    }

    fn put_local_history(
        &mut self,
        input: PutLocalHistoryInput,
    ) -> Result<PutLocalHistoryResult, MessageCacheError> {
        let scope = self.scope_mut(&input.scope_handle)?;
        if scope.status != Some(CacheScopeStatus::Ready) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_READY"));
        }
        if let Some(previous) = scope.local_put_operations.get(&input.operation_id) {
            if previous != &input {
                return Err(MessageCacheError::new("CACHE_OPERATION_REPLAY_MISMATCH"));
            }
            return Ok(PutLocalHistoryResult {
                protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
                projection: input.projection,
                idempotency_replayed: true,
            });
        }
        if !scope
            .local_history
            .contains_key(&input.projection.conversation_id)
            && scope.local_history.len() >= 8
            && let Some(oldest) = scope
                .local_history
                .values()
                .min_by_key(|projection| projection.updated_at_epoch_ms)
                .map(|projection| projection.conversation_id.clone())
        {
            scope.local_history.remove(&oldest);
            scope
                .local_put_operations
                .retain(|_, previous| previous.projection.conversation_id != oldest);
        }
        scope.local_history.insert(
            input.projection.conversation_id.clone(),
            input.projection.clone(),
        );
        scope
            .local_put_operations
            .insert(input.operation_id.clone(), input.clone());
        Ok(PutLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            projection: input.projection,
            idempotency_replayed: false,
        })
    }

    fn snapshot_local_history(
        &mut self,
        input: SnapshotLocalHistoryInput,
    ) -> Result<SnapshotLocalHistoryResult, MessageCacheError> {
        let scope = self.scope_mut(&input.scope_handle)?;
        if scope.status != Some(CacheScopeStatus::Ready) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_READY"));
        }
        scope.local_history.retain(|_, projection| {
            projection.provider_identity_digest == input.provider_identity_digest
        });
        scope.local_put_operations.retain(|_, previous| {
            scope
                .local_history
                .contains_key(&previous.projection.conversation_id)
        });
        let mut interrupted_count = 0;
        for projection in scope.local_history.values_mut() {
            if projection.status == LocalHistoryStatus::Processing {
                projection.status = LocalHistoryStatus::Interrupted;
                projection.reason_code = Some("CLIENT_RESTART_INTERRUPTED".to_owned());
                projection.result = None;
                interrupted_count += 1;
            }
        }
        let mut projections = scope.local_history.values().cloned().collect::<Vec<_>>();
        projections.sort_by_key(|projection| std::cmp::Reverse(projection.updated_at_epoch_ms));
        projections.truncate(usize::from(input.limit));
        Ok(SnapshotLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            projections,
            interrupted_count,
        })
    }

    fn release_local_history(
        &mut self,
        input: ReleaseLocalHistoryInput,
    ) -> Result<ReleaseLocalHistoryResult, MessageCacheError> {
        let scope = self.scope_mut(&input.scope_handle)?;
        if scope.status != Some(CacheScopeStatus::Ready) {
            return Err(MessageCacheError::new("CACHE_SCOPE_NOT_READY"));
        }
        if let Some((previous, released)) = scope.local_release_operations.get(&input.operation_id)
        {
            if previous != &input.conversation_id {
                return Err(MessageCacheError::new("CACHE_OPERATION_REPLAY_MISMATCH"));
            }
            return Ok(ReleaseLocalHistoryResult {
                protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
                conversation_id: input.conversation_id,
                released: *released,
                idempotency_replayed: true,
            });
        }
        let released = scope.local_history.remove(&input.conversation_id).is_some();
        scope
            .local_put_operations
            .retain(|_, previous| previous.projection.conversation_id != input.conversation_id);
        scope.local_release_operations.insert(
            input.operation_id,
            (input.conversation_id.clone(), released),
        );
        Ok(ReleaseLocalHistoryResult {
            protocol_version: LOCAL_HISTORY_PROTOCOL_VERSION,
            conversation_id: input.conversation_id,
            released,
            idempotency_replayed: false,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message_cache::contracts::{ReconcileDecision, SideEffectState};

    const SCOPE: &str = "33333333-3333-4333-8333-333333333333";

    #[test]
    fn corruption_requires_rebuild_without_reading_projection() {
        let mut adapter = MemoryMessageCacheAdapter::default();
        adapter
            .open_scope(OpenScopeInput {
                scope_handle: SCOPE.to_owned(),
            })
            .expect("open");
        adapter.mark_corrupt(SCOPE);
        let reopened = adapter
            .open_scope(OpenScopeInput {
                scope_handle: SCOPE.to_owned(),
            })
            .expect("reopen");
        assert_eq!(reopened.scope_status, CacheScopeStatus::Corrupt);

        let result = adapter
            .reconcile(ReconcileInput {
                scope_handle: SCOPE.to_owned(),
                thread_id: "session-1".to_owned(),
                server_last_sequence: 0,
                server_cursor: None,
                side_effect_state: SideEffectState::Known,
            })
            .expect("reconcile");

        assert_eq!(result.decision, ReconcileDecision::RebuildRequired);
        assert_eq!(result.reason_code, Some("CACHE_CORRUPT"));
        assert_eq!(result.cache_last_sequence, None);
    }
}
