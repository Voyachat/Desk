mod contracts;
mod key_provider;
mod native_package_admission;
mod native_package_contract;
mod packaged_scope_driver;
mod path;
mod process;
mod process_commands;
mod random;
mod recovery;
mod recovery_completed;
mod recovery_contracts;
mod recovery_journal;
mod recovery_state;
mod request_hash;
mod retention;
mod runtime;
mod runtime_commands;
mod runtime_recovery_commands;
mod scope_driver;

#[cfg(test)]
#[path = "tests/native_package.rs"]
mod native_package_tests;

#[cfg(test)]
#[path = "tests/native_recovery.rs"]
mod native_recovery_tests;

pub use contracts::{
    MAX_WORKER_REQUEST_FRAME_BYTES, MAX_WORKER_RESPONSE_FRAME_BYTES,
    MESSAGE_CACHE_WORKER_PROTOCOL_VERSION, MessageCacheWorkerError, MessageCacheWorkerResponse,
};
pub use key_provider::{
    CACHE_CIPHER_KEY_BYTES, CacheKeyProviderError, CacheKeyProviderPort, CacheScopeKey,
    OsVaultCacheKeyProvider, UnavailableCacheKeyProvider,
};
pub use process::{MessageCacheWorkerProcess, MessageCacheWorkerProcessError};
pub use process_commands::{
    MessageCacheWorkerIntegrityResult, MessageCacheWorkerIntegrityStatus,
    MessageCacheWorkerOpenScopeResult, MessageCacheWorkerPageResult, MessageCacheWorkerPurgeResult,
    MessageCacheWorkerPutLocalHistoryResult, MessageCacheWorkerPutResult,
    MessageCacheWorkerRebuildResult, MessageCacheWorkerRebuildStatus,
    MessageCacheWorkerReleaseLocalHistoryResult, MessageCacheWorkerSnapshotLocalHistoryResult,
};
pub use recovery_contracts::{
    CacheRecoveryReason, MessageCacheWorkerCompleteRebuildInput, MessageCacheWorkerRebuildInput,
};
pub use retention::{CacheClockError, CacheClockPort, CacheRetentionPolicy, SystemCacheClock};
pub use runtime::{MessageCacheWorkerRuntime, run_message_cache_worker_stdio};
pub use scope_driver::{
    EncryptedScopeDriver, EncryptedScopeDriverError, EncryptedScopeIntegrity,
    EncryptedScopeLocalHistoryRelease, EncryptedScopeLocalHistorySnapshot,
    EncryptedScopeMutationResult, EncryptedScopeOpenContext, EncryptedScopeOpenResult,
    EncryptedScopePage, NativeEncryptedScopeDriver, UnavailableEncryptedScopeDriver,
    WorkerAdapterAvailability,
};
