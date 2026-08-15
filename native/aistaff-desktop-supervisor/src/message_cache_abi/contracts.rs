use std::ffi::c_void;

pub(super) const VERSION_CAPACITY: usize = 32;
pub(super) const COMMIT_CAPACITY: usize = 41;
pub(super) const THREAD_ID_CAPACITY: usize = 160;
pub(super) const EVENT_TYPE_CAPACITY: usize = 96;
pub(super) const TIMESTAMP_CAPACITY: usize = 64;
pub(super) const SUMMARY_CAPACITY: usize = 512;
pub(super) const PAYLOAD_HASH_CAPACITY: usize = 64;
pub(super) const RUN_ID_CAPACITY: usize = 160;
pub(super) const CURSOR_CAPACITY: usize = 256;
pub(super) const MAXIMUM_PAGE_SIZE: u32 = 50;
pub(super) const LOCAL_HISTORY_MAXIMUM_ITEMS: u32 = 8;
pub(super) const LOCAL_HISTORY_JSON_CAPACITY: usize = 8192;
pub(super) const LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY: usize = 64;
pub(super) const LOCAL_HISTORY_CONVERSATION_ID_CAPACITY: usize = 36;

pub(super) const STATUS_OK: u32 = 0;
pub(super) const STATUS_INVALID_KEY: u32 = 9;
pub(super) const STATUS_DATABASE_OPEN_FAILED: u32 = 10;
pub(super) const STATUS_SCOPE_HANDLE_INVALID: u32 = 11;
pub(super) const STATUS_NATIVE_FAILURE: u32 = 12;
pub(super) const STATUS_INVALID_ARGUMENT: u32 = 13;
pub(super) const STATUS_SCHEMA_MISMATCH: u32 = 14;
pub(super) const STATUS_OPERATION_REPLAY_MISMATCH: u32 = 15;
pub(super) const STATUS_SEQUENCE_REGRESSION: u32 = 16;
pub(super) const STATUS_DATABASE_BUSY: u32 = 17;
pub(super) const STATUS_DATABASE_CORRUPT: u32 = 18;
pub(super) const STATUS_DATABASE_FULL: u32 = 19;
pub(super) const STATUS_INTEGRITY_CHECK_FAILED: u32 = 20;

pub(super) const ACTOR_USER: u32 = 1;
pub(super) const ACTOR_SERVICE: u32 = 2;
pub(super) const DELIVERY_CONFIRMED: u32 = 1;
pub(super) const REDACTION_SUMMARY_ONLY: u32 = 1;
pub(super) const INTEGRITY_HEALTHY: u32 = 1;
pub(super) const INTEGRITY_CONFIRMED_CORRUPT: u32 = 2;
pub(super) const LOCAL_HISTORY_STATUS_PROCESSING: u32 = 1;
pub(super) const LOCAL_HISTORY_STATUS_INTERRUPTED: u32 = 2;
pub(super) const LOCAL_HISTORY_STATUS_OTHER: u32 = 3;

pub(super) type NativeOpenScopeFunction = unsafe extern "C" fn(
    u32,
    *const NativeOpenScopeRequestV1,
    u32,
    *mut NativeOpenScopeResultV1,
) -> u32;

pub(super) type NativeCloseScopeFunction = unsafe extern "C" fn(
    u32,
    *const NativeCloseScopeRequestV1,
    u32,
    *mut NativeStatusResultV1,
) -> u32;

pub(super) type NativeCheckIntegrityFunction = unsafe extern "C" fn(
    u32,
    *const NativeCheckIntegrityRequestV1,
    u32,
    *mut NativeIntegrityResultV1,
) -> u32;

pub(super) type NativePutConfirmedFunction = unsafe extern "C" fn(
    u32,
    *const NativePutConfirmedRequestV1,
    u32,
    *mut NativeMutationResultV1,
) -> u32;

pub(super) type NativePageFunction =
    unsafe extern "C" fn(u32, *const NativePageRequestV1, u32, *mut NativePageResultV1) -> u32;

pub(super) type NativePurgeScopeFunction = unsafe extern "C" fn(
    u32,
    *const NativePurgeScopeRequestV1,
    u32,
    *mut NativeMutationResultV1,
) -> u32;

pub(super) type NativePutLocalHistoryFunction = unsafe extern "C" fn(
    u32,
    *const NativePutLocalHistoryRequestV1,
    u32,
    *mut NativeMutationResultV1,
) -> u32;

pub(super) type NativeSnapshotLocalHistoryFunction = unsafe extern "C" fn(
    u32,
    *const NativeSnapshotLocalHistoryRequestV1,
    u32,
    *mut NativeSnapshotLocalHistoryResultV1,
) -> u32;

pub(super) type NativeReleaseLocalHistoryFunction = unsafe extern "C" fn(
    u32,
    *const NativeReleaseLocalHistoryRequestV1,
    u32,
    *mut NativeReleaseLocalHistoryResultV1,
) -> u32;

pub type MessageCacheNativeProbeFunction =
    unsafe extern "C" fn(u32, u32, *mut NativeProbeV1) -> u32;

#[repr(C)]
#[derive(Clone)]
pub struct NativeProbeV1 {
    pub(super) struct_size: u32,
    pub(super) abi_version: u32,
    pub(super) status: u32,
    pub(super) wcdb_version_length: u32,
    pub(super) wcdb_commit_length: u32,
    pub(super) wcdb_cpp_enabled: u32,
    pub(super) wcdb_zstd_enabled: u32,
    pub(super) upstream_bridge_enabled: u32,
    pub(super) open_scope: Option<NativeOpenScopeFunction>,
    pub(super) close_scope: Option<NativeCloseScopeFunction>,
    pub(super) put_confirmed: Option<NativePutConfirmedFunction>,
    pub(super) page: Option<NativePageFunction>,
    pub(super) purge_scope: Option<NativePurgeScopeFunction>,
    pub(super) wcdb_version: [u8; VERSION_CAPACITY],
    pub(super) wcdb_commit: [u8; COMMIT_CAPACITY],
    pub(super) reserved: [u8; 7],
    pub(super) check_integrity: Option<NativeCheckIntegrityFunction>,
    pub(super) put_local_history: Option<NativePutLocalHistoryFunction>,
    pub(super) snapshot_local_history: Option<NativeSnapshotLocalHistoryFunction>,
    pub(super) release_local_history: Option<NativeReleaseLocalHistoryFunction>,
}

impl Default for NativeProbeV1 {
    fn default() -> Self {
        Self {
            struct_size: 0,
            abi_version: 0,
            status: 0,
            wcdb_version_length: 0,
            wcdb_commit_length: 0,
            wcdb_cpp_enabled: 0,
            wcdb_zstd_enabled: 0,
            upstream_bridge_enabled: 0,
            open_scope: None,
            close_scope: None,
            put_confirmed: None,
            page: None,
            purge_scope: None,
            wcdb_version: [0; VERSION_CAPACITY],
            wcdb_commit: [0; COMMIT_CAPACITY],
            reserved: [0; 7],
            check_integrity: None,
            put_local_history: None,
            snapshot_local_history: None,
            release_local_history: None,
        }
    }
}

#[repr(C)]
pub(super) struct NativeOpenScopeRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub database_path: *const u8,
    pub cipher_key: *const u8,
    pub now_epoch_s: i64,
    pub retention_seconds: u64,
    pub database_path_length: u32,
    pub cipher_key_length: u32,
    pub retention_sweep_limit: u32,
    pub flags: u32,
    pub reserved: u64,
}

#[derive(Default)]
#[repr(C)]
pub(super) struct NativeOpenScopeResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub reopened: u32,
    pub scope: *mut c_void,
    pub reserved: u64,
}

#[repr(C)]
pub(super) struct NativeCloseScopeRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub reserved: u64,
}

#[repr(C)]
pub(super) struct NativeCheckIntegrityRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub reserved: u64,
}

#[repr(C)]
#[derive(Default)]
pub(super) struct NativeIntegrityResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub integrity_state: u32,
    pub reserved: u64,
}

#[repr(C)]
#[derive(Default)]
pub(super) struct NativeStatusResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Clone)]
pub(super) struct NativeProjectionV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub sequence: u64,
    pub confirmed_at_epoch_s: i64,
    pub expires_at_epoch_s: i64,
    pub actor_type: u32,
    pub delivery_state: u32,
    pub redaction_profile: u32,
    pub thread_id_length: u32,
    pub event_type_length: u32,
    pub occurred_at_length: u32,
    pub masked_summary_length: u32,
    pub payload_hash_length: u32,
    pub run_id_length: u32,
    pub server_cursor_length: u32,
    pub thread_id: [u8; THREAD_ID_CAPACITY],
    pub event_type: [u8; EVENT_TYPE_CAPACITY],
    pub occurred_at: [u8; TIMESTAMP_CAPACITY],
    pub masked_summary: [u8; SUMMARY_CAPACITY],
    pub payload_hash: [u8; PAYLOAD_HASH_CAPACITY],
    pub run_id: [u8; RUN_ID_CAPACITY],
    pub server_cursor: [u8; CURSOR_CAPACITY],
}

impl Default for NativeProjectionV1 {
    fn default() -> Self {
        Self {
            struct_size: 0,
            abi_version: 0,
            sequence: 0,
            confirmed_at_epoch_s: 0,
            expires_at_epoch_s: 0,
            actor_type: 0,
            delivery_state: 0,
            redaction_profile: 0,
            thread_id_length: 0,
            event_type_length: 0,
            occurred_at_length: 0,
            masked_summary_length: 0,
            payload_hash_length: 0,
            run_id_length: 0,
            server_cursor_length: 0,
            thread_id: [0; THREAD_ID_CAPACITY],
            event_type: [0; EVENT_TYPE_CAPACITY],
            occurred_at: [0; TIMESTAMP_CAPACITY],
            masked_summary: [0; SUMMARY_CAPACITY],
            payload_hash: [0; PAYLOAD_HASH_CAPACITY],
            run_id: [0; RUN_ID_CAPACITY],
            server_cursor: [0; CURSOR_CAPACITY],
        }
    }
}

#[repr(C)]
pub(super) struct NativePutConfirmedRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub operation_id: *const u8,
    pub request_hash: *const u8,
    pub projection: *const NativeProjectionV1,
    pub operation_id_length: u32,
    pub request_hash_length: u32,
    pub flags: u32,
    pub reserved: u32,
}

#[repr(C)]
#[derive(Default)]
pub(super) struct NativeMutationResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub idempotency_replayed: u32,
    pub reserved: u64,
}

#[repr(C)]
pub(super) struct NativePageRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub thread_id: *const u8,
    pub projections: *mut NativeProjectionV1,
    pub after_sequence: u64,
    pub now_epoch_s: i64,
    pub thread_id_length: u32,
    pub limit: u32,
    pub projection_capacity: u32,
    pub flags: u32,
    pub reserved: u64,
}

#[repr(C)]
#[derive(Default)]
pub(super) struct NativePageResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub projection_count: u32,
    pub next_after_sequence: u64,
    pub has_more: u32,
    pub reserved: u32,
}

#[repr(C)]
pub(super) struct NativePurgeScopeRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub operation_id: *const u8,
    pub request_hash: *const u8,
    pub committed_at_epoch_s: i64,
    pub expires_at_epoch_s: i64,
    pub operation_id_length: u32,
    pub request_hash_length: u32,
    pub flags: u32,
    pub reserved: u32,
}

#[repr(C)]
pub(super) struct NativeLocalHistoryProjectionV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub updated_at_epoch_ms: u64,
    pub status: u32,
    pub conversation_id_length: u32,
    pub provider_identity_digest_length: u32,
    pub projection_json_length: u32,
    pub conversation_id: [u8; LOCAL_HISTORY_CONVERSATION_ID_CAPACITY],
    pub provider_identity_digest: [u8; LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY],
    pub projection_json: [u8; LOCAL_HISTORY_JSON_CAPACITY],
}

impl Default for NativeLocalHistoryProjectionV1 {
    fn default() -> Self {
        Self {
            struct_size: 0,
            abi_version: 0,
            updated_at_epoch_ms: 0,
            status: 0,
            conversation_id_length: 0,
            provider_identity_digest_length: 0,
            projection_json_length: 0,
            conversation_id: [0; LOCAL_HISTORY_CONVERSATION_ID_CAPACITY],
            provider_identity_digest: [0; LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY],
            projection_json: [0; LOCAL_HISTORY_JSON_CAPACITY],
        }
    }
}

#[repr(C)]
pub(super) struct NativePutLocalHistoryRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub operation_id: *const u8,
    pub request_hash: *const u8,
    pub projection: *const NativeLocalHistoryProjectionV1,
    pub operation_id_length: u32,
    pub request_hash_length: u32,
    pub flags: u32,
    pub reserved: u32,
}

#[repr(C)]
pub(super) struct NativeSnapshotLocalHistoryRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub provider_identity_digest: *const u8,
    pub projections: *mut NativeLocalHistoryProjectionV1,
    pub provider_identity_digest_length: u32,
    pub limit: u32,
    pub projection_capacity: u32,
    pub flags: u32,
    pub reserved: u64,
}

#[derive(Default)]
#[repr(C)]
pub(super) struct NativeSnapshotLocalHistoryResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub projection_count: u32,
    pub interrupted_count: u32,
    pub reserved: u32,
}

#[repr(C)]
pub(super) struct NativeReleaseLocalHistoryRequestV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub scope: *mut c_void,
    pub operation_id: *const u8,
    pub request_hash: *const u8,
    pub conversation_id: *const u8,
    pub committed_at_epoch_ms: u64,
    pub operation_id_length: u32,
    pub request_hash_length: u32,
    pub conversation_id_length: u32,
    pub flags: u32,
    pub reserved: u64,
}

#[derive(Default)]
#[repr(C)]
pub(super) struct NativeReleaseLocalHistoryResultV1 {
    pub struct_size: u32,
    pub abi_version: u32,
    pub status: u32,
    pub idempotency_replayed: u32,
    pub released: u32,
    pub reserved: u32,
}
