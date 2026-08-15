use super::contracts::{
    ACTOR_SERVICE, ACTOR_USER, CURSOR_CAPACITY, DELIVERY_CONFIRMED, EVENT_TYPE_CAPACITY,
    NativeProjectionV1, PAYLOAD_HASH_CAPACITY, REDACTION_SUMMARY_ONLY, RUN_ID_CAPACITY,
    SUMMARY_CAPACITY, THREAD_ID_CAPACITY, TIMESTAMP_CAPACITY,
};
use super::{MESSAGE_CACHE_NATIVE_ABI_VERSION, MessageCacheNativeAbiError};
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, RedactionProfile,
};
use std::mem::size_of;

pub(super) struct DecodedProjection {
    pub projection: ConfirmedTimelineProjection,
    pub confirmed_at_epoch_s: i64,
    pub expires_at_epoch_s: i64,
}

pub(super) fn encode_projection(
    projection: &ConfirmedTimelineProjection,
    confirmed_at_epoch_s: i64,
    expires_at_epoch_s: i64,
) -> Result<NativeProjectionV1, MessageCacheNativeAbiError> {
    projection
        .validate()
        .map_err(|_| MessageCacheNativeAbiError::RequestInvalid)?;
    if projection.sequence > i64::MAX as u64
        || confirmed_at_epoch_s <= 0
        || expires_at_epoch_s <= confirmed_at_epoch_s
    {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }

    let mut output = NativeProjectionV1 {
        struct_size: size_of::<NativeProjectionV1>() as u32,
        abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
        sequence: projection.sequence,
        confirmed_at_epoch_s,
        expires_at_epoch_s,
        actor_type: match projection.actor_type {
            ActorType::User => ACTOR_USER,
            ActorType::Service => ACTOR_SERVICE,
        },
        delivery_state: DELIVERY_CONFIRMED,
        redaction_profile: REDACTION_SUMMARY_ONLY,
        ..NativeProjectionV1::default()
    };
    output.thread_id_length = copy_text(&mut output.thread_id, &projection.thread_id)?;
    output.event_type_length = copy_text(&mut output.event_type, &projection.event_type)?;
    output.occurred_at_length = copy_text(&mut output.occurred_at, &projection.occurred_at)?;
    output.masked_summary_length =
        copy_text(&mut output.masked_summary, &projection.masked_summary)?;
    output.payload_hash_length = copy_text(&mut output.payload_hash, &projection.payload_hash)?;
    if let Some(run_id) = projection.run_id.as_deref() {
        output.run_id_length = copy_text(&mut output.run_id, run_id)?;
    }
    if let Some(cursor) = projection.server_cursor.as_deref() {
        output.server_cursor_length = copy_text(&mut output.server_cursor, cursor)?;
    }
    Ok(output)
}

pub(super) fn decode_projection(
    value: &NativeProjectionV1,
) -> Result<DecodedProjection, MessageCacheNativeAbiError> {
    if value.struct_size != size_of::<NativeProjectionV1>() as u32
        || value.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
        || value.sequence == 0
        || value.sequence > i64::MAX as u64
        || value.confirmed_at_epoch_s <= 0
        || value.expires_at_epoch_s <= value.confirmed_at_epoch_s
        || value.delivery_state != DELIVERY_CONFIRMED
        || value.redaction_profile != REDACTION_SUMMARY_ONLY
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    let actor_type = match value.actor_type {
        ACTOR_USER => ActorType::User,
        ACTOR_SERVICE => ActorType::Service,
        _ => return Err(MessageCacheNativeAbiError::ResponseInvalid),
    };
    let projection = ConfirmedTimelineProjection {
        thread_id: read_text(&value.thread_id, value.thread_id_length, false)?,
        sequence: value.sequence,
        event_type: read_text(&value.event_type, value.event_type_length, false)?,
        actor_type,
        occurred_at: read_text(&value.occurred_at, value.occurred_at_length, false)?,
        masked_summary: read_text(&value.masked_summary, value.masked_summary_length, true)?,
        payload_hash: read_text(&value.payload_hash, value.payload_hash_length, false)?,
        run_id: read_optional_text(&value.run_id, value.run_id_length)?,
        server_cursor: read_optional_text(&value.server_cursor, value.server_cursor_length)?,
        delivery_state: DeliveryState::Confirmed,
        redaction_profile: RedactionProfile::SummaryOnlyV1,
    };
    projection
        .validate()
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    Ok(DecodedProjection {
        projection,
        confirmed_at_epoch_s: value.confirmed_at_epoch_s,
        expires_at_epoch_s: value.expires_at_epoch_s,
    })
}

pub(super) fn valid_operation_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

pub(super) fn valid_thread_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= THREAD_ID_CAPACITY
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn copy_text<const CAPACITY: usize>(
    destination: &mut [u8; CAPACITY],
    value: &str,
) -> Result<u32, MessageCacheNativeAbiError> {
    if value.len() > CAPACITY || value.contains('\0') {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    destination[..value.len()].copy_from_slice(value.as_bytes());
    Ok(value.len() as u32)
}

fn read_optional_text<const CAPACITY: usize>(
    source: &[u8; CAPACITY],
    length: u32,
) -> Result<Option<String>, MessageCacheNativeAbiError> {
    if length == 0 {
        if source.iter().any(|byte| *byte != 0) {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        return Ok(None);
    }
    read_text(source, length, false).map(Some)
}

fn read_text<const CAPACITY: usize>(
    source: &[u8; CAPACITY],
    length: u32,
    allow_empty: bool,
) -> Result<String, MessageCacheNativeAbiError> {
    let length =
        usize::try_from(length).map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
    if length > CAPACITY
        || (!allow_empty && length == 0)
        || source[length..].iter().any(|byte| *byte != 0)
        || source[..length].contains(&0)
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    std::str::from_utf8(&source[..length])
        .map(str::to_owned)
        .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)
}

const _: () = {
    assert!(THREAD_ID_CAPACITY == 160);
    assert!(EVENT_TYPE_CAPACITY == 96);
    assert!(TIMESTAMP_CAPACITY == 64);
    assert!(SUMMARY_CAPACITY == 512);
    assert!(PAYLOAD_HASH_CAPACITY == 64);
    assert!(RUN_ID_CAPACITY == 160);
    assert!(CURSOR_CAPACITY == 256);
};
