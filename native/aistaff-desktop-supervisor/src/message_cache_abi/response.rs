use super::contracts::{
    NativeMutationResultV1, NativeOpenScopeResultV1, NativePageResultV1, NativeProjectionV1,
    STATUS_OK,
};
use super::projection::decode_projection;
use super::{
    MESSAGE_CACHE_NATIVE_ABI_VERSION, MessageCacheNativeAbiError, MessageCacheNativeMutationResult,
    MessageCacheNativePage,
};
use std::mem::size_of;

pub(super) fn parse_mutation_result(
    status: u32,
    output: NativeMutationResultV1,
) -> Result<MessageCacheNativeMutationResult, MessageCacheNativeAbiError> {
    if output.struct_size != size_of::<NativeMutationResultV1>() as u32
        || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
        || output.status != status
        || output.reserved != 0
        || !matches!(output.idempotency_replayed, 0 | 1)
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    if status != STATUS_OK {
        return Err(MessageCacheNativeAbiError::NativeStatus(status));
    }
    Ok(MessageCacheNativeMutationResult {
        idempotency_replayed: output.idempotency_replayed == 1,
    })
}

pub(super) fn parse_page_result(
    status: u32,
    output: NativePageResultV1,
    raw: &[NativeProjectionV1],
    thread_id: &str,
    after_sequence: u64,
    now_epoch_s: i64,
    limit: u32,
) -> Result<MessageCacheNativePage, MessageCacheNativeAbiError> {
    if output.struct_size != size_of::<NativePageResultV1>() as u32
        || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
        || output.status != status
        || output.reserved != 0
        || output.projection_count > limit
        || !matches!(output.has_more, 0 | 1)
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    if status != STATUS_OK {
        return Err(MessageCacheNativeAbiError::NativeStatus(status));
    }
    let mut projections = Vec::with_capacity(output.projection_count as usize);
    let mut previous_sequence = after_sequence;
    for value in raw.iter().take(output.projection_count as usize) {
        let decoded = decode_projection(value)?;
        if decoded.projection.thread_id != thread_id
            || decoded.projection.sequence <= previous_sequence
            || decoded.expires_at_epoch_s <= now_epoch_s
            || decoded.confirmed_at_epoch_s > decoded.expires_at_epoch_s
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        previous_sequence = decoded.projection.sequence;
        projections.push(decoded.projection);
    }
    if projections.is_empty() {
        if output.next_after_sequence != 0 || output.has_more != 0 {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
    } else if output.next_after_sequence != previous_sequence
        || (output.has_more == 1 && output.projection_count != limit)
    {
        return Err(MessageCacheNativeAbiError::ResponseInvalid);
    }
    Ok(MessageCacheNativePage {
        next_after_sequence: projections.last().map(|item| item.sequence),
        projections,
        has_more: output.has_more == 1,
    })
}

pub(super) fn valid_open_response(output: &NativeOpenScopeResultV1) -> bool {
    output.struct_size == size_of::<NativeOpenScopeResultV1>() as u32
        && output.abi_version == MESSAGE_CACHE_NATIVE_ABI_VERSION
        && output.reserved == 0
}
