mod contracts;
mod local_history;
mod projection;
mod response;
mod scope;

use contracts::{
    COMMIT_CAPACITY, NativeCheckIntegrityFunction, NativeCloseScopeFunction,
    NativeOpenScopeFunction, NativePageFunction, NativeProbeV1, NativePurgeScopeFunction,
    NativePutConfirmedFunction, NativePutLocalHistoryFunction, NativeReleaseLocalHistoryFunction,
    NativeSnapshotLocalHistoryFunction, STATUS_DATABASE_BUSY, STATUS_DATABASE_CORRUPT,
    STATUS_DATABASE_FULL, STATUS_DATABASE_OPEN_FAILED, STATUS_INTEGRITY_CHECK_FAILED,
    STATUS_INVALID_ARGUMENT, STATUS_INVALID_KEY, STATUS_NATIVE_FAILURE, STATUS_OK,
    STATUS_OPERATION_REPLAY_MISMATCH, STATUS_SCHEMA_MISMATCH, STATUS_SCOPE_HANDLE_INVALID,
    STATUS_SEQUENCE_REGRESSION, VERSION_CAPACITY,
};
pub use contracts::{MessageCacheNativeProbeFunction, NativeProbeV1 as MessageCacheNativeProbeV1};

use crate::message_cache::{ConfirmedTimelineProjection, LocalHistoryTaskProjection};
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::NonNull;

pub const MESSAGE_CACHE_NATIVE_ABI_VERSION: u32 = 1;
pub const MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES: usize = 32;
const MAXIMUM_RETENTION_SECONDS: u64 = 10 * 366 * 24 * 60 * 60;
const MAXIMUM_SWEEP_LIMIT: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageCacheNativeRetentionPolicy {
    pub retention_seconds: u64,
    pub sweep_limit: u32,
}

impl MessageCacheNativeRetentionPolicy {
    fn is_valid(self) -> bool {
        self.retention_seconds > 0
            && self.retention_seconds <= MAXIMUM_RETENTION_SECONDS
            && self.sweep_limit > 0
            && self.sweep_limit <= MAXIMUM_SWEEP_LIMIT
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheNativeProbe {
    pub wcdb_version: String,
    pub wcdb_commit: String,
    pub wcdb_cpp_enabled: bool,
    pub wcdb_zstd_enabled: bool,
    pub upstream_bridge_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageCacheNativeMutationResult {
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheNativePage {
    pub projections: Vec<ConfirmedTimelineProjection>,
    pub next_after_sequence: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheNativeLocalHistorySnapshot {
    pub projections: Vec<LocalHistoryTaskProjection>,
    pub interrupted_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageCacheNativeLocalHistoryRelease {
    pub idempotency_replayed: bool,
    pub released: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageCacheNativeIntegrity {
    Healthy,
    ConfirmedCorrupt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageCacheNativeAbiError {
    NativeStatus(u32),
    RequestInvalid,
    ResponseInvalid,
}

impl MessageCacheNativeAbiError {
    pub const fn reason_code(self) -> &'static str {
        match self {
            Self::NativeStatus(STATUS_INVALID_KEY) => "WCDB_NATIVE_SCOPE_KEY_REJECTED",
            Self::NativeStatus(STATUS_DATABASE_OPEN_FAILED) => "WCDB_NATIVE_SCOPE_OPEN_REJECTED",
            Self::NativeStatus(STATUS_SCOPE_HANDLE_INVALID) => "WCDB_NATIVE_SCOPE_HANDLE_REJECTED",
            Self::NativeStatus(STATUS_INVALID_ARGUMENT) => "WCDB_NATIVE_ARGUMENT_REJECTED",
            Self::NativeStatus(STATUS_SCHEMA_MISMATCH) => "WCDB_NATIVE_SCHEMA_MISMATCH",
            Self::NativeStatus(STATUS_OPERATION_REPLAY_MISMATCH) => {
                "CACHE_OPERATION_REPLAY_MISMATCH"
            }
            Self::NativeStatus(STATUS_SEQUENCE_REGRESSION) => "CACHE_SEQUENCE_REGRESSION",
            Self::NativeStatus(STATUS_DATABASE_BUSY) => "WCDB_NATIVE_DATABASE_BUSY",
            Self::NativeStatus(STATUS_DATABASE_CORRUPT) => "WCDB_NATIVE_DATABASE_CORRUPT",
            Self::NativeStatus(STATUS_DATABASE_FULL) => "WCDB_NATIVE_DATABASE_FULL",
            Self::NativeStatus(STATUS_INTEGRITY_CHECK_FAILED) => {
                "WCDB_NATIVE_INTEGRITY_CHECK_FAILED"
            }
            Self::NativeStatus(STATUS_NATIVE_FAILURE) => "WCDB_NATIVE_FAILURE",
            Self::NativeStatus(_) => "WCDB_NATIVE_OPERATION_REJECTED",
            Self::RequestInvalid => "WCDB_NATIVE_REQUEST_INVALID",
            Self::ResponseInvalid => "WCDB_NATIVE_RESPONSE_INVALID",
        }
    }

    pub const fn mutation_reason_code(self) -> &'static str {
        match self {
            Self::RequestInvalid
            | Self::NativeStatus(STATUS_SCOPE_HANDLE_INVALID)
            | Self::NativeStatus(STATUS_INVALID_ARGUMENT)
            | Self::NativeStatus(STATUS_SCHEMA_MISMATCH)
            | Self::NativeStatus(STATUS_OPERATION_REPLAY_MISMATCH)
            | Self::NativeStatus(STATUS_SEQUENCE_REGRESSION)
            | Self::NativeStatus(STATUS_DATABASE_BUSY)
            | Self::NativeStatus(STATUS_DATABASE_CORRUPT)
            | Self::NativeStatus(STATUS_DATABASE_FULL) => self.reason_code(),
            Self::ResponseInvalid | Self::NativeStatus(_) => {
                "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
            }
        }
    }
}

pub struct MessageCacheNativeAbi {
    probe: MessageCacheNativeProbeFunction,
}

#[derive(Clone)]
pub struct MessageCacheNativeApi {
    metadata: MessageCacheNativeProbe,
    open_scope: NativeOpenScopeFunction,
    close_scope: NativeCloseScopeFunction,
    check_integrity: NativeCheckIntegrityFunction,
    put_confirmed: NativePutConfirmedFunction,
    page: NativePageFunction,
    purge_scope: NativePurgeScopeFunction,
    put_local_history: NativePutLocalHistoryFunction,
    snapshot_local_history: NativeSnapshotLocalHistoryFunction,
    release_local_history: NativeReleaseLocalHistoryFunction,
}

pub struct MessageCacheNativeScope {
    api: MessageCacheNativeApi,
    handle: Option<NonNull<c_void>>,
    reopened: bool,
}

impl MessageCacheNativeAbi {
    pub const fn new(probe: MessageCacheNativeProbeFunction) -> Self {
        Self { probe }
    }

    pub fn probe(&self) -> Result<MessageCacheNativeApi, MessageCacheNativeAbiError> {
        let mut output = NativeProbeV1::default();
        // SAFETY: Probe receives one initialized, fixed-size caller-owned output value.
        let status = unsafe {
            (self.probe)(
                MESSAGE_CACHE_NATIVE_ABI_VERSION,
                size_of::<NativeProbeV1>() as u32,
                &mut output,
            )
        };
        if status != STATUS_OK {
            if output.status != status {
                return Err(MessageCacheNativeAbiError::ResponseInvalid);
            }
            return Err(MessageCacheNativeAbiError::NativeStatus(status));
        }
        let open_scope = output
            .open_scope
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let close_scope = output
            .close_scope
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let check_integrity = output
            .check_integrity
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let put_confirmed = output
            .put_confirmed
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let page = output
            .page
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let purge_scope = output
            .purge_scope
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let put_local_history = output
            .put_local_history
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let snapshot_local_history = output
            .snapshot_local_history
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        let release_local_history = output
            .release_local_history
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        if output.status != STATUS_OK
            || output.struct_size != size_of::<NativeProbeV1>() as u32
            || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
            || output.reserved != [0; 7]
            || !matches!(output.wcdb_cpp_enabled, 0 | 1)
            || !matches!(output.wcdb_zstd_enabled, 0 | 1)
            || !matches!(output.upstream_bridge_enabled, 0 | 1)
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        let wcdb_version = parse_bounded_ascii(
            &output.wcdb_version,
            output.wcdb_version_length,
            valid_version,
        )?;
        let wcdb_commit =
            parse_bounded_ascii(&output.wcdb_commit, output.wcdb_commit_length, |value| {
                value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
            })?;
        Ok(MessageCacheNativeApi {
            metadata: MessageCacheNativeProbe {
                wcdb_version,
                wcdb_commit,
                wcdb_cpp_enabled: output.wcdb_cpp_enabled == 1,
                wcdb_zstd_enabled: output.wcdb_zstd_enabled == 1,
                upstream_bridge_enabled: output.upstream_bridge_enabled == 1,
            },
            open_scope,
            close_scope,
            check_integrity,
            put_confirmed,
            page,
            purge_scope,
            put_local_history,
            snapshot_local_history,
            release_local_history,
        })
    }
}

impl MessageCacheNativeApi {
    pub const fn metadata(&self) -> &MessageCacheNativeProbe {
        &self.metadata
    }
}

fn valid_version(value: &str) -> bool {
    let mut segments = value.split('.');
    (0..3).all(|_| {
        segments.next().is_some_and(|segment| {
            !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit())
        })
    }) && segments.next().is_none()
}

fn parse_bounded_ascii(
    buffer: &[u8],
    declared_length: u32,
    validate: impl FnOnce(&str) -> bool,
) -> Result<String, MessageCacheNativeAbiError> {
    let length = usize::try_from(declared_length)
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    if length == 0 || length >= buffer.len() || buffer[length..].iter().any(|byte| *byte != 0) {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    let value = std::str::from_utf8(&buffer[..length])
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    if !value.is_ascii() || !validate(value) {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    Ok(value.to_owned())
}

const _: () = {
    assert!(VERSION_CAPACITY == 32);
    assert!(COMMIT_CAPACITY == 41);
};

#[cfg(test)]
mod tests;
