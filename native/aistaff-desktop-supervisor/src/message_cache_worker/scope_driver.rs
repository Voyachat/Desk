use super::retention::CacheRetentionPolicy;
use crate::message_cache::{
    ConfirmedTimelineProjection, LocalHistoryTaskProjection, PageInput, PurgeScopeInput,
    PutConfirmedInput, PutLocalHistoryInput, ReleaseLocalHistoryInput, SnapshotLocalHistoryInput,
};
use crate::message_cache_abi::{
    MessageCacheNativeApi, MessageCacheNativeIntegrity, MessageCacheNativeLocalHistorySnapshot,
    MessageCacheNativePage, MessageCacheNativeScope,
};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerAdapterAvailability {
    Available,
    AdapterUnavailable,
}

impl WorkerAdapterAvailability {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::AdapterUnavailable => "adapter_unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptedScopeOpenContext {
    pub now_epoch_s: i64,
    pub retention: CacheRetentionPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptedScopeOpenResult {
    pub reopened: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptedScopeMutationResult {
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncryptedScopeIntegrity {
    Healthy,
    ConfirmedCorrupt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedScopePage {
    pub projections: Vec<ConfirmedTimelineProjection>,
    pub next_after_sequence: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedScopeLocalHistorySnapshot {
    pub projections: Vec<LocalHistoryTaskProjection>,
    pub interrupted_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptedScopeLocalHistoryRelease {
    pub idempotency_replayed: bool,
    pub released: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncryptedScopeDriverError {
    pub code: &'static str,
}

impl EncryptedScopeDriverError {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub trait EncryptedScopeDriver {
    fn availability(&self) -> WorkerAdapterAvailability;
    fn adapter_id(&self) -> &'static str;
    fn unavailable_reason(&self) -> Option<&'static str> {
        None
    }

    fn open_scope(
        &mut self,
        database_path: &Path,
        cipher_key: &[u8],
        context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError>;

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError>;

    fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
        request_hash: &[u8; 32],
        confirmed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError>;

    fn page(
        &mut self,
        input: &PageInput,
        now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError>;

    fn purge_scope(
        &mut self,
        input: &PurgeScopeInput,
        request_hash: &[u8; 32],
        committed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError>;

    fn put_local_history(
        &mut self,
        _input: &PutLocalHistoryInput,
        _request_hash: &[u8; 32],
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn snapshot_local_history(
        &mut self,
        _input: &SnapshotLocalHistoryInput,
    ) -> Result<EncryptedScopeLocalHistorySnapshot, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn release_local_history(
        &mut self,
        _input: &ReleaseLocalHistoryInput,
        _request_hash: &[u8; 32],
        _committed_at_epoch_ms: u64,
    ) -> Result<EncryptedScopeLocalHistoryRelease, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError>;
}

pub struct UnavailableEncryptedScopeDriver;

impl EncryptedScopeDriver for UnavailableEncryptedScopeDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        WorkerAdapterAvailability::AdapterUnavailable
    }

    fn adapter_id(&self) -> &'static str {
        "unavailable"
    }

    fn unavailable_reason(&self) -> Option<&'static str> {
        Some("WCDB_ADAPTER_NOT_IMPLEMENTED")
    }

    fn open_scope(
        &mut self,
        _database_path: &Path,
        _cipher_key: &[u8],
        _context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn put_confirmed(
        &mut self,
        _input: &PutConfirmedInput,
        _request_hash: &[u8; 32],
        _confirmed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn page(
        &mut self,
        _input: &PageInput,
        _now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn purge_scope(
        &mut self,
        _input: &PurgeScopeInput,
        _request_hash: &[u8; 32],
        _committed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Err(adapter_unavailable())
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        Ok(())
    }
}

pub struct NativeEncryptedScopeDriver {
    api: MessageCacheNativeApi,
    active_scope: Option<MessageCacheNativeScope>,
}

impl NativeEncryptedScopeDriver {
    pub const fn new(api: MessageCacheNativeApi) -> Self {
        Self {
            api,
            active_scope: None,
        }
    }

    fn active_scope(&mut self) -> Result<&mut MessageCacheNativeScope, EncryptedScopeDriverError> {
        self.active_scope
            .as_mut()
            .ok_or_else(|| EncryptedScopeDriverError::new("CACHE_SCOPE_NOT_OPEN"))
    }
}

impl EncryptedScopeDriver for NativeEncryptedScopeDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        WorkerAdapterAvailability::Available
    }

    fn adapter_id(&self) -> &'static str {
        "wcdb.v2.1.16"
    }

    fn open_scope(
        &mut self,
        database_path: &Path,
        cipher_key: &[u8],
        context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        if self.active_scope.is_some() {
            return Err(EncryptedScopeDriverError::new("CACHE_SCOPE_ALREADY_OPEN"));
        }
        let scope = self
            .api
            .open_encrypted_scope(
                database_path,
                cipher_key,
                context.now_epoch_s,
                context.retention.native(),
            )
            .map_err(|error| EncryptedScopeDriverError::new(error.reason_code()))?;
        let reopened = scope.reopened();
        self.active_scope = Some(scope);
        Ok(EncryptedScopeOpenResult { reopened })
    }

    fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
        request_hash: &[u8; 32],
        confirmed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.active_scope()?
            .put_confirmed(
                &input.operation_id,
                request_hash,
                &input.projection,
                confirmed_at_epoch_s,
                expires_at_epoch_s,
            )
            .map(|result| EncryptedScopeMutationResult {
                idempotency_replayed: result.idempotency_replayed,
            })
            .map_err(|error| EncryptedScopeDriverError::new(error.mutation_reason_code()))
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        self.active_scope()?
            .check_integrity()
            .map(|integrity| match integrity {
                MessageCacheNativeIntegrity::Healthy => EncryptedScopeIntegrity::Healthy,
                MessageCacheNativeIntegrity::ConfirmedCorrupt => {
                    EncryptedScopeIntegrity::ConfirmedCorrupt
                }
            })
            .map_err(|error| EncryptedScopeDriverError::new(error.reason_code()))
    }

    fn page(
        &mut self,
        input: &PageInput,
        now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        self.active_scope()?
            .page(
                &input.thread_id,
                input.after_sequence,
                now_epoch_s,
                input.limit,
            )
            .map(native_page)
            .map_err(|error| EncryptedScopeDriverError::new(error.reason_code()))
    }

    fn purge_scope(
        &mut self,
        input: &PurgeScopeInput,
        request_hash: &[u8; 32],
        committed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.active_scope()?
            .purge_scope(
                &input.operation_id,
                request_hash,
                committed_at_epoch_s,
                expires_at_epoch_s,
            )
            .map(|result| EncryptedScopeMutationResult {
                idempotency_replayed: result.idempotency_replayed,
            })
            .map_err(|error| EncryptedScopeDriverError::new(error.mutation_reason_code()))
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        let scope = self
            .active_scope
            .take()
            .ok_or_else(|| EncryptedScopeDriverError::new("CACHE_SCOPE_NOT_OPEN"))?;
        scope
            .close()
            .map_err(|error| EncryptedScopeDriverError::new(error.reason_code()))
    }

    fn put_local_history(
        &mut self,
        input: &PutLocalHistoryInput,
        request_hash: &[u8; 32],
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.active_scope()?
            .put_local_history(&input.operation_id, request_hash, &input.projection)
            .map(|result| EncryptedScopeMutationResult {
                idempotency_replayed: result.idempotency_replayed,
            })
            .map_err(|error| EncryptedScopeDriverError::new(error.mutation_reason_code()))
    }

    fn snapshot_local_history(
        &mut self,
        input: &SnapshotLocalHistoryInput,
    ) -> Result<EncryptedScopeLocalHistorySnapshot, EncryptedScopeDriverError> {
        self.active_scope()?
            .snapshot_local_history(&input.provider_identity_digest, input.limit)
            .map(native_local_history_snapshot)
            .map_err(|error| EncryptedScopeDriverError::new(error.mutation_reason_code()))
    }

    fn release_local_history(
        &mut self,
        input: &ReleaseLocalHistoryInput,
        request_hash: &[u8; 32],
        committed_at_epoch_ms: u64,
    ) -> Result<EncryptedScopeLocalHistoryRelease, EncryptedScopeDriverError> {
        self.active_scope()?
            .release_local_history(
                &input.operation_id,
                request_hash,
                &input.conversation_id,
                committed_at_epoch_ms,
            )
            .map(|result| EncryptedScopeLocalHistoryRelease {
                idempotency_replayed: result.idempotency_replayed,
                released: result.released,
            })
            .map_err(|error| EncryptedScopeDriverError::new(error.mutation_reason_code()))
    }
}

fn adapter_unavailable() -> EncryptedScopeDriverError {
    EncryptedScopeDriverError::new("WCDB_ADAPTER_NOT_IMPLEMENTED")
}

fn native_page(page: MessageCacheNativePage) -> EncryptedScopePage {
    EncryptedScopePage {
        projections: page.projections,
        next_after_sequence: page.next_after_sequence,
        has_more: page.has_more,
    }
}

fn native_local_history_snapshot(
    snapshot: MessageCacheNativeLocalHistorySnapshot,
) -> EncryptedScopeLocalHistorySnapshot {
    EncryptedScopeLocalHistorySnapshot {
        projections: snapshot.projections,
        interrupted_count: snapshot.interrupted_count,
    }
}
