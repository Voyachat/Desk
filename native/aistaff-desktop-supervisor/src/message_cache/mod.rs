mod contracts;
#[cfg(test)]
mod memory_adapter;
#[cfg(test)]
mod runtime_tests;
mod service;
mod unavailable_adapter;
mod worker_adapter;

pub use contracts::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, LOCAL_HISTORY_PROTOCOL_VERSION,
    LocalHistoryMessage, LocalHistoryMessageRole, LocalHistoryMode, LocalHistoryResultProjection,
    LocalHistoryStatus, LocalHistoryTaskProjection, MESSAGE_CACHE_CAPABILITY,
    MESSAGE_CACHE_PROTOCOL_VERSION, PageInput, PageResult, PurgeScopeInput, PurgeScopeResult,
    PutConfirmedInput, PutConfirmedResult, PutLocalHistoryInput, PutLocalHistoryResult,
    RedactionProfile, ReleaseLocalHistoryInput, ReleaseLocalHistoryResult,
    SnapshotLocalHistoryInput, SnapshotLocalHistoryResult, is_message_cache_command,
};
#[cfg(test)]
pub use memory_adapter::MemoryMessageCacheAdapter;
pub use service::{MessageCacheCommandHandler, MessageCacheService};
pub use unavailable_adapter::UnavailableMessageCacheAdapter;
pub use worker_adapter::WorkerMessageCacheAdapter;
