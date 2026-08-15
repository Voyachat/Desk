use super::contracts::{
    CacheCapabilitiesResult, MessageCacheError, OpenScopeInput, OpenScopeResult, PageInput,
    PageResult, PurgeScopeInput, PurgeScopeResult, PutConfirmedInput, PutConfirmedResult,
    PutLocalHistoryInput, PutLocalHistoryResult, ReconcileInput, ReconcileResult,
    ReleaseLocalHistoryInput, ReleaseLocalHistoryResult, SnapshotLocalHistoryInput,
    SnapshotLocalHistoryResult,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, to_value};

pub trait MessageCacheAdapter {
    fn capabilities(&self) -> CacheCapabilitiesResult;
    fn open_scope(&mut self, input: OpenScopeInput) -> Result<OpenScopeResult, MessageCacheError>;
    fn put_confirmed(
        &mut self,
        input: PutConfirmedInput,
    ) -> Result<PutConfirmedResult, MessageCacheError>;
    fn page(&mut self, input: PageInput) -> Result<PageResult, MessageCacheError>;
    fn purge_scope(
        &mut self,
        input: PurgeScopeInput,
    ) -> Result<PurgeScopeResult, MessageCacheError>;
    fn reconcile(&mut self, input: ReconcileInput) -> Result<ReconcileResult, MessageCacheError>;
    fn put_local_history(
        &mut self,
        input: PutLocalHistoryInput,
    ) -> Result<PutLocalHistoryResult, MessageCacheError>;
    fn snapshot_local_history(
        &mut self,
        input: SnapshotLocalHistoryInput,
    ) -> Result<SnapshotLocalHistoryResult, MessageCacheError>;
    fn release_local_history(
        &mut self,
        input: ReleaseLocalHistoryInput,
    ) -> Result<ReleaseLocalHistoryResult, MessageCacheError>;
}

pub trait MessageCacheCommandHandler {
    fn handle(&mut self, command: &str, payload: Option<Value>)
    -> Result<Value, MessageCacheError>;
}

pub struct MessageCacheService<A: MessageCacheAdapter> {
    adapter: A,
}

impl<A: MessageCacheAdapter> MessageCacheService<A> {
    pub fn new(adapter: A) -> Self {
        Self { adapter }
    }
}

fn parse_payload<T: DeserializeOwned>(payload: Option<Value>) -> Result<T, MessageCacheError> {
    serde_json::from_value(
        payload.ok_or_else(|| MessageCacheError::new("CACHE_COMMAND_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| MessageCacheError::new("INVALID_CACHE_COMMAND_PAYLOAD"))
}

fn serialize_result<T: serde::Serialize>(result: T) -> Result<Value, MessageCacheError> {
    to_value(result).map_err(|_| MessageCacheError::new("CACHE_RESPONSE_SERIALIZATION_FAILED"))
}

impl<A: MessageCacheAdapter> MessageCacheCommandHandler for MessageCacheService<A> {
    fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, MessageCacheError> {
        match command {
            "cache.capabilities" => {
                if payload.is_some() {
                    return Err(MessageCacheError::new("INVALID_CACHE_COMMAND_PAYLOAD"));
                }
                serialize_result(self.adapter.capabilities())
            }
            "cache.open_scope" => {
                let input: OpenScopeInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.open_scope(input)?)
            }
            "cache.put_confirmed" => {
                let input: PutConfirmedInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.put_confirmed(input)?)
            }
            "cache.page" => {
                let input: PageInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.page(input)?)
            }
            "cache.purge_scope" => {
                let input: PurgeScopeInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.purge_scope(input)?)
            }
            "cache.reconcile" => {
                let input: ReconcileInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.reconcile(input)?)
            }
            "cache.local_history.put" => {
                let input: PutLocalHistoryInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.put_local_history(input)?)
            }
            "cache.local_history.snapshot" => {
                let input: SnapshotLocalHistoryInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.snapshot_local_history(input)?)
            }
            "cache.local_history.release" => {
                let input: ReleaseLocalHistoryInput = parse_payload(payload)?;
                input.validate()?;
                serialize_result(self.adapter.release_local_history(input)?)
            }
            _ => Err(MessageCacheError::new("UNKNOWN_CACHE_COMMAND")),
        }
    }
}
