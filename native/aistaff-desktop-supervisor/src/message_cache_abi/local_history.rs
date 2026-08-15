use super::contracts::{
    LOCAL_HISTORY_CONVERSATION_ID_CAPACITY, LOCAL_HISTORY_JSON_CAPACITY,
    LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY, LOCAL_HISTORY_STATUS_INTERRUPTED,
    LOCAL_HISTORY_STATUS_OTHER, LOCAL_HISTORY_STATUS_PROCESSING, NativeLocalHistoryProjectionV1,
};
use super::{MESSAGE_CACHE_NATIVE_ABI_VERSION, MessageCacheNativeAbiError};
use crate::message_cache::{LocalHistoryStatus, LocalHistoryTaskProjection};
use std::mem::size_of;

pub(super) fn encode_local_history(
    projection: &LocalHistoryTaskProjection,
) -> Result<NativeLocalHistoryProjectionV1, MessageCacheNativeAbiError> {
    projection
        .validate()
        .map_err(|_| MessageCacheNativeAbiError::RequestInvalid)?;
    if projection.updated_at_epoch_ms > i64::MAX as u64 {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    let json =
        serde_json::to_vec(projection).map_err(|_| MessageCacheNativeAbiError::RequestInvalid)?;
    if json.is_empty() || json.len() > LOCAL_HISTORY_JSON_CAPACITY || json.contains(&0) {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    let mut output = NativeLocalHistoryProjectionV1 {
        struct_size: size_of::<NativeLocalHistoryProjectionV1>() as u32,
        abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
        updated_at_epoch_ms: projection.updated_at_epoch_ms,
        status: native_status(projection.status),
        ..NativeLocalHistoryProjectionV1::default()
    };
    output.conversation_id_length = copy(
        &mut output.conversation_id,
        projection.conversation_id.as_bytes(),
    )?;
    output.provider_identity_digest_length = copy(
        &mut output.provider_identity_digest,
        projection.provider_identity_digest.as_bytes(),
    )?;
    output.projection_json_length = copy(&mut output.projection_json, &json)?;
    Ok(output)
}

pub(super) fn decode_local_history(
    value: &NativeLocalHistoryProjectionV1,
) -> Result<LocalHistoryTaskProjection, MessageCacheNativeAbiError> {
    if value.struct_size != size_of::<NativeLocalHistoryProjectionV1>() as u32
        || value.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
        || value.updated_at_epoch_ms == 0
        || value.updated_at_epoch_ms > i64::MAX as u64
        || !matches!(
            value.status,
            LOCAL_HISTORY_STATUS_PROCESSING
                | LOCAL_HISTORY_STATUS_INTERRUPTED
                | LOCAL_HISTORY_STATUS_OTHER
        )
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    let conversation_id = read(
        &value.conversation_id,
        value.conversation_id_length,
        LOCAL_HISTORY_CONVERSATION_ID_CAPACITY,
    )?;
    let provider_identity_digest = read(
        &value.provider_identity_digest,
        value.provider_identity_digest_length,
        LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY,
    )?;
    let json = read(
        &value.projection_json,
        value.projection_json_length,
        LOCAL_HISTORY_JSON_CAPACITY,
    )?;
    let mut projection: LocalHistoryTaskProjection =
        serde_json::from_str(&json).map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    if projection.conversation_id != conversation_id
        || projection.provider_identity_digest != provider_identity_digest
        || projection.updated_at_epoch_ms != value.updated_at_epoch_ms
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    match value.status {
        LOCAL_HISTORY_STATUS_PROCESSING if projection.status != LocalHistoryStatus::Processing => {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        LOCAL_HISTORY_STATUS_INTERRUPTED => {
            projection.status = LocalHistoryStatus::Interrupted;
            projection.reason_code = Some("CLIENT_RESTART_INTERRUPTED".to_owned());
            projection.result = None;
        }
        LOCAL_HISTORY_STATUS_OTHER
            if matches!(
                projection.status,
                LocalHistoryStatus::Processing | LocalHistoryStatus::Interrupted
            ) =>
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        _ => {}
    }
    projection
        .validate()
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    Ok(projection)
}

fn native_status(status: LocalHistoryStatus) -> u32 {
    match status {
        LocalHistoryStatus::Processing => LOCAL_HISTORY_STATUS_PROCESSING,
        LocalHistoryStatus::Interrupted => LOCAL_HISTORY_STATUS_INTERRUPTED,
        _ => LOCAL_HISTORY_STATUS_OTHER,
    }
}

fn copy<const CAPACITY: usize>(
    destination: &mut [u8; CAPACITY],
    value: &[u8],
) -> Result<u32, MessageCacheNativeAbiError> {
    if value.is_empty() || value.len() > CAPACITY || value.contains(&0) {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    destination[..value.len()].copy_from_slice(value);
    Ok(value.len() as u32)
}

fn read<const CAPACITY: usize>(
    source: &[u8; CAPACITY],
    length: u32,
    expected_capacity: usize,
) -> Result<String, MessageCacheNativeAbiError> {
    if CAPACITY != expected_capacity {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    let length =
        usize::try_from(length).map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    if length == 0
        || length > CAPACITY
        || source[..length].contains(&0)
        || source[length..].iter().any(|byte| *byte != 0)
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    std::str::from_utf8(&source[..length])
        .map(str::to_owned)
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)
}

const _: () = {
    assert!(LOCAL_HISTORY_CONVERSATION_ID_CAPACITY == 36);
    assert!(LOCAL_HISTORY_PROVIDER_DIGEST_CAPACITY == 64);
    assert!(LOCAL_HISTORY_JSON_CAPACITY == 8192);
};
