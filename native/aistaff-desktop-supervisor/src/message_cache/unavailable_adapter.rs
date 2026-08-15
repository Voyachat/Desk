use super::contracts::{
    CacheAvailability, CacheCapabilitiesResult, MESSAGE_CACHE_PROTOCOL_VERSION, MessageCacheError,
    OpenScopeInput, OpenScopeResult, PageInput, PageResult, PurgeScopeInput, PurgeScopeResult,
    PutConfirmedInput, PutConfirmedResult, PutLocalHistoryInput, PutLocalHistoryResult,
    ReconcileInput, ReconcileResult, ReleaseLocalHistoryInput, ReleaseLocalHistoryResult,
    SnapshotLocalHistoryInput, SnapshotLocalHistoryResult,
};
use super::service::MessageCacheAdapter;

pub struct UnavailableMessageCacheAdapter;

fn unavailable<T>() -> Result<T, MessageCacheError> {
    Err(MessageCacheError::new("CACHE_ADAPTER_UNAVAILABLE"))
}

impl MessageCacheAdapter for UnavailableMessageCacheAdapter {
    fn capabilities(&self) -> CacheCapabilitiesResult {
        CacheCapabilitiesResult {
            protocol_version: MESSAGE_CACHE_PROTOCOL_VERSION,
            adapter_id: "unavailable",
            availability: CacheAvailability::AdapterUnavailable,
            persistent: false,
            reason_code: Some("WCDB_ADAPTER_NOT_IMPLEMENTED"),
        }
    }

    fn open_scope(&mut self, _input: OpenScopeInput) -> Result<OpenScopeResult, MessageCacheError> {
        unavailable()
    }

    fn put_confirmed(
        &mut self,
        _input: PutConfirmedInput,
    ) -> Result<PutConfirmedResult, MessageCacheError> {
        unavailable()
    }

    fn page(&mut self, _input: PageInput) -> Result<PageResult, MessageCacheError> {
        unavailable()
    }

    fn purge_scope(
        &mut self,
        _input: PurgeScopeInput,
    ) -> Result<PurgeScopeResult, MessageCacheError> {
        unavailable()
    }

    fn reconcile(&mut self, _input: ReconcileInput) -> Result<ReconcileResult, MessageCacheError> {
        unavailable()
    }

    fn put_local_history(
        &mut self,
        _input: PutLocalHistoryInput,
    ) -> Result<PutLocalHistoryResult, MessageCacheError> {
        unavailable()
    }

    fn snapshot_local_history(
        &mut self,
        _input: SnapshotLocalHistoryInput,
    ) -> Result<SnapshotLocalHistoryResult, MessageCacheError> {
        unavailable()
    }

    fn release_local_history(
        &mut self,
        _input: ReleaseLocalHistoryInput,
    ) -> Result<ReleaseLocalHistoryResult, MessageCacheError> {
        unavailable()
    }
}
