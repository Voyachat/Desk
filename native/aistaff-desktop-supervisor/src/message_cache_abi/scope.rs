use super::contracts::{
    INTEGRITY_CONFIRMED_CORRUPT, INTEGRITY_HEALTHY, LOCAL_HISTORY_MAXIMUM_ITEMS, MAXIMUM_PAGE_SIZE,
    NativeCheckIntegrityRequestV1, NativeCloseScopeRequestV1, NativeIntegrityResultV1,
    NativeLocalHistoryProjectionV1, NativeMutationResultV1, NativeOpenScopeRequestV1,
    NativeOpenScopeResultV1, NativePageRequestV1, NativePageResultV1, NativeProjectionV1,
    NativePurgeScopeRequestV1, NativePutConfirmedRequestV1, NativePutLocalHistoryRequestV1,
    NativeReleaseLocalHistoryRequestV1, NativeReleaseLocalHistoryResultV1,
    NativeSnapshotLocalHistoryRequestV1, NativeSnapshotLocalHistoryResultV1, NativeStatusResultV1,
    STATUS_OK,
};
use super::local_history::{decode_local_history, encode_local_history};
use super::projection::{encode_projection, valid_operation_id, valid_thread_id};
use super::response::{parse_mutation_result, parse_page_result, valid_open_response};
use super::{
    MESSAGE_CACHE_NATIVE_ABI_VERSION, MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES,
    MessageCacheNativeAbiError, MessageCacheNativeApi, MessageCacheNativeIntegrity,
    MessageCacheNativeLocalHistoryRelease, MessageCacheNativeLocalHistorySnapshot,
    MessageCacheNativeMutationResult, MessageCacheNativePage, MessageCacheNativeRetentionPolicy,
    MessageCacheNativeScope,
};
use crate::message_cache::{ConfirmedTimelineProjection, LocalHistoryTaskProjection};
use std::ffi::c_void;
use std::mem::size_of;
use std::path::Path;
use std::ptr::NonNull;

const MAXIMUM_PATH_BYTES: usize = 4096;

impl MessageCacheNativeApi {
    pub fn open_encrypted_scope(
        &self,
        database_path: &Path,
        cipher_key: &[u8],
        now_epoch_s: i64,
        retention: MessageCacheNativeRetentionPolicy,
    ) -> Result<MessageCacheNativeScope, MessageCacheNativeAbiError> {
        let path = bounded_database_path(database_path)?;
        if cipher_key.len() != MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES
            || now_epoch_s <= 0
            || !retention.is_valid()
        {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let input = NativeOpenScopeRequestV1 {
            struct_size: size_of::<NativeOpenScopeRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            database_path: path.as_ptr(),
            cipher_key: cipher_key.as_ptr(),
            now_epoch_s,
            retention_seconds: retention.retention_seconds,
            database_path_length: path.len() as u32,
            cipher_key_length: cipher_key.len() as u32,
            retention_sweep_limit: retention.sweep_limit,
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeOpenScopeResultV1::default();
        // SAFETY: Both borrowed buffers remain alive for the call; native returns only its handle.
        let status = unsafe {
            (self.open_scope)(
                size_of::<NativeOpenScopeRequestV1>() as u32,
                &input,
                size_of::<NativeOpenScopeResultV1>() as u32,
                &mut output,
            )
        };
        if !valid_open_response(&output) || output.status != status {
            self.close_malformed_handle(output.scope);
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        if status != STATUS_OK {
            if !output.scope.is_null() || output.reopened != 0 {
                self.close_malformed_handle(output.scope);
                return Err(MessageCacheNativeAbiError::ResponseInvalid);
            }
            return Err(MessageCacheNativeAbiError::NativeStatus(status));
        }
        if !matches!(output.reopened, 0 | 1) {
            self.close_malformed_handle(output.scope);
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        let handle =
            NonNull::new(output.scope).ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        Ok(MessageCacheNativeScope {
            api: self.clone(),
            handle: Some(handle),
            reopened: output.reopened == 1,
        })
    }

    fn close_malformed_handle(&self, handle: *mut c_void) {
        if let Some(handle) = NonNull::new(handle) {
            let _ = self.close_handle_once(handle);
        }
    }

    fn close_handle_once(&self, handle: NonNull<c_void>) -> Result<(), MessageCacheNativeAbiError> {
        let input = NativeCloseScopeRequestV1 {
            struct_size: size_of::<NativeCloseScopeRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: handle.as_ptr(),
            reserved: 0,
        };
        let mut output = NativeStatusResultV1::default();
        // SAFETY: The opaque handle came from this exact admitted native function table.
        let status = unsafe {
            (self.close_scope)(
                size_of::<NativeCloseScopeRequestV1>() as u32,
                &input,
                size_of::<NativeStatusResultV1>() as u32,
                &mut output,
            )
        };
        if output.struct_size != size_of::<NativeStatusResultV1>() as u32
            || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
            || output.reserved != 0
            || output.status != status
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        match status {
            STATUS_OK => Ok(()),
            _ => Err(MessageCacheNativeAbiError::NativeStatus(status)),
        }
    }
}

impl MessageCacheNativeScope {
    pub fn check_integrity(
        &mut self,
    ) -> Result<MessageCacheNativeIntegrity, MessageCacheNativeAbiError> {
        let input = NativeCheckIntegrityRequestV1 {
            struct_size: size_of::<NativeCheckIntegrityRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            reserved: 0,
        };
        let mut output = NativeIntegrityResultV1::default();
        // SAFETY: The fixed request and output live through the synchronous owned ABI call.
        let status = unsafe {
            (self.api.check_integrity)(
                size_of::<NativeCheckIntegrityRequestV1>() as u32,
                &input,
                size_of::<NativeIntegrityResultV1>() as u32,
                &mut output,
            )
        };
        if output.struct_size != size_of::<NativeIntegrityResultV1>() as u32
            || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
            || output.status != status
            || output.reserved != 0
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        if status != STATUS_OK {
            return Err(MessageCacheNativeAbiError::NativeStatus(status));
        }
        match output.integrity_state {
            INTEGRITY_HEALTHY => Ok(MessageCacheNativeIntegrity::Healthy),
            INTEGRITY_CONFIRMED_CORRUPT => Ok(MessageCacheNativeIntegrity::ConfirmedCorrupt),
            _ => Err(MessageCacheNativeAbiError::ResponseInvalid),
        }
    }

    pub const fn reopened(&self) -> bool {
        self.reopened
    }

    pub fn put_confirmed(
        &mut self,
        operation_id: &str,
        request_hash: &[u8; 32],
        projection: &ConfirmedTimelineProjection,
        confirmed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<MessageCacheNativeMutationResult, MessageCacheNativeAbiError> {
        if !valid_operation_id(operation_id) {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let projection = encode_projection(projection, confirmed_at_epoch_s, expires_at_epoch_s)?;
        let input = NativePutConfirmedRequestV1 {
            struct_size: size_of::<NativePutConfirmedRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            operation_id: operation_id.as_ptr(),
            request_hash: request_hash.as_ptr(),
            projection: &projection,
            operation_id_length: operation_id.len() as u32,
            request_hash_length: request_hash.len() as u32,
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeMutationResultV1::default();
        // SAFETY: The fixed request and all borrowed buffers live through the synchronous call.
        let status = unsafe {
            (self.api.put_confirmed)(
                size_of::<NativePutConfirmedRequestV1>() as u32,
                &input,
                size_of::<NativeMutationResultV1>() as u32,
                &mut output,
            )
        };
        parse_mutation_result(status, output)
    }

    pub fn page(
        &mut self,
        thread_id: &str,
        after_sequence: Option<u64>,
        now_epoch_s: i64,
        limit: u16,
    ) -> Result<MessageCacheNativePage, MessageCacheNativeAbiError> {
        let after_sequence = after_sequence.unwrap_or(0);
        if !valid_thread_id(thread_id)
            || after_sequence > i64::MAX as u64
            || now_epoch_s <= 0
            || limit == 0
            || u32::from(limit) > MAXIMUM_PAGE_SIZE
        {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let mut raw = vec![NativeProjectionV1::default(); usize::from(limit)];
        let input = NativePageRequestV1 {
            struct_size: size_of::<NativePageRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            thread_id: thread_id.as_ptr(),
            projections: raw.as_mut_ptr(),
            after_sequence,
            now_epoch_s,
            thread_id_length: thread_id.len() as u32,
            limit: u32::from(limit),
            projection_capacity: u32::from(limit),
            flags: 0,
            reserved: 0,
        };
        let mut output = NativePageResultV1::default();
        // SAFETY: Native may initialize at most projection_capacity caller-owned elements.
        let status = unsafe {
            (self.api.page)(
                size_of::<NativePageRequestV1>() as u32,
                &input,
                size_of::<NativePageResultV1>() as u32,
                &mut output,
            )
        };
        parse_page_result(
            status,
            output,
            &raw,
            thread_id,
            after_sequence,
            now_epoch_s,
            u32::from(limit),
        )
    }

    pub fn purge_scope(
        &mut self,
        operation_id: &str,
        request_hash: &[u8; 32],
        committed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<MessageCacheNativeMutationResult, MessageCacheNativeAbiError> {
        if !valid_operation_id(operation_id)
            || committed_at_epoch_s <= 0
            || expires_at_epoch_s <= committed_at_epoch_s
        {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let input = NativePurgeScopeRequestV1 {
            struct_size: size_of::<NativePurgeScopeRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            operation_id: operation_id.as_ptr(),
            request_hash: request_hash.as_ptr(),
            committed_at_epoch_s,
            expires_at_epoch_s,
            operation_id_length: operation_id.len() as u32,
            request_hash_length: request_hash.len() as u32,
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeMutationResultV1::default();
        // SAFETY: The fixed request and borrowed buffers live through the synchronous call.
        let status = unsafe {
            (self.api.purge_scope)(
                size_of::<NativePurgeScopeRequestV1>() as u32,
                &input,
                size_of::<NativeMutationResultV1>() as u32,
                &mut output,
            )
        };
        parse_mutation_result(status, output)
    }

    pub fn put_local_history(
        &mut self,
        operation_id: &str,
        request_hash: &[u8; 32],
        projection: &LocalHistoryTaskProjection,
    ) -> Result<MessageCacheNativeMutationResult, MessageCacheNativeAbiError> {
        if !valid_operation_id(operation_id) {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let projection = encode_local_history(projection)?;
        let input = NativePutLocalHistoryRequestV1 {
            struct_size: size_of::<NativePutLocalHistoryRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            operation_id: operation_id.as_ptr(),
            request_hash: request_hash.as_ptr(),
            projection: &projection,
            operation_id_length: operation_id.len() as u32,
            request_hash_length: request_hash.len() as u32,
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeMutationResultV1::default();
        // SAFETY: The fixed request and borrowed projection live through the synchronous call.
        let status = unsafe {
            (self.api.put_local_history)(
                size_of::<NativePutLocalHistoryRequestV1>() as u32,
                &input,
                size_of::<NativeMutationResultV1>() as u32,
                &mut output,
            )
        };
        parse_mutation_result(status, output)
    }

    pub fn snapshot_local_history(
        &mut self,
        provider_identity_digest: &str,
        limit: u8,
    ) -> Result<MessageCacheNativeLocalHistorySnapshot, MessageCacheNativeAbiError> {
        if provider_identity_digest.len() != 64
            || !provider_identity_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || u32::from(limit) != LOCAL_HISTORY_MAXIMUM_ITEMS
        {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let mut raw = (0..usize::from(limit))
            .map(|_| NativeLocalHistoryProjectionV1::default())
            .collect::<Vec<_>>();
        let input = NativeSnapshotLocalHistoryRequestV1 {
            struct_size: size_of::<NativeSnapshotLocalHistoryRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            provider_identity_digest: provider_identity_digest.as_ptr(),
            projections: raw.as_mut_ptr(),
            provider_identity_digest_length: provider_identity_digest.len() as u32,
            limit: u32::from(limit),
            projection_capacity: u32::from(limit),
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeSnapshotLocalHistoryResultV1::default();
        // SAFETY: Native may initialize at most projection_capacity caller-owned elements.
        let status = unsafe {
            (self.api.snapshot_local_history)(
                size_of::<NativeSnapshotLocalHistoryRequestV1>() as u32,
                &input,
                size_of::<NativeSnapshotLocalHistoryResultV1>() as u32,
                &mut output,
            )
        };
        if status != STATUS_OK {
            return Err(MessageCacheNativeAbiError::NativeStatus(status));
        }
        if output.struct_size != size_of::<NativeSnapshotLocalHistoryResultV1>() as u32
            || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
            || output.status != status
            || output.reserved != 0
            || output.projection_count > u32::from(limit)
            || output.interrupted_count > output.projection_count
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        let count = usize::try_from(output.projection_count)
            .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?;
        let mut projections = Vec::with_capacity(count);
        for value in &raw[..count] {
            let projection = decode_local_history(value)?;
            if projection.provider_identity_digest != provider_identity_digest {
                return Err(MessageCacheNativeAbiError::ResponseInvalid);
            }
            projections.push(projection);
        }
        if projections
            .windows(2)
            .any(|pair| pair[0].updated_at_epoch_ms < pair[1].updated_at_epoch_ms)
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        Ok(MessageCacheNativeLocalHistorySnapshot {
            projections,
            interrupted_count: usize::try_from(output.interrupted_count)
                .map_err(|_| MessageCacheNativeAbiError::ResponseInvalid)?,
        })
    }

    pub fn release_local_history(
        &mut self,
        operation_id: &str,
        request_hash: &[u8; 32],
        conversation_id: &str,
        committed_at_epoch_ms: u64,
    ) -> Result<MessageCacheNativeLocalHistoryRelease, MessageCacheNativeAbiError> {
        if !valid_operation_id(operation_id)
            || !valid_operation_id(conversation_id)
            || committed_at_epoch_ms == 0
            || committed_at_epoch_ms > i64::MAX as u64
        {
            return Err(MessageCacheNativeAbiError::RequestInvalid);
        }
        let input = NativeReleaseLocalHistoryRequestV1 {
            struct_size: size_of::<NativeReleaseLocalHistoryRequestV1>() as u32,
            abi_version: MESSAGE_CACHE_NATIVE_ABI_VERSION,
            scope: self.handle()?.as_ptr(),
            operation_id: operation_id.as_ptr(),
            request_hash: request_hash.as_ptr(),
            conversation_id: conversation_id.as_ptr(),
            committed_at_epoch_ms,
            operation_id_length: operation_id.len() as u32,
            request_hash_length: request_hash.len() as u32,
            conversation_id_length: conversation_id.len() as u32,
            flags: 0,
            reserved: 0,
        };
        let mut output = NativeReleaseLocalHistoryResultV1::default();
        // SAFETY: The fixed request and borrowed identifiers live through the synchronous call.
        let status = unsafe {
            (self.api.release_local_history)(
                size_of::<NativeReleaseLocalHistoryRequestV1>() as u32,
                &input,
                size_of::<NativeReleaseLocalHistoryResultV1>() as u32,
                &mut output,
            )
        };
        if status != STATUS_OK {
            return Err(MessageCacheNativeAbiError::NativeStatus(status));
        }
        if output.struct_size != size_of::<NativeReleaseLocalHistoryResultV1>() as u32
            || output.abi_version != MESSAGE_CACHE_NATIVE_ABI_VERSION
            || output.status != status
            || !matches!(output.idempotency_replayed, 0 | 1)
            || !matches!(output.released, 0 | 1)
            || output.reserved != 0
        {
            return Err(MessageCacheNativeAbiError::ResponseInvalid);
        }
        Ok(MessageCacheNativeLocalHistoryRelease {
            idempotency_replayed: output.idempotency_replayed == 1,
            released: output.released == 1,
        })
    }

    pub fn close(mut self) -> Result<(), MessageCacheNativeAbiError> {
        let handle = self
            .handle
            .take()
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)?;
        self.api.close_handle_once(handle)
    }

    fn handle(&self) -> Result<NonNull<c_void>, MessageCacheNativeAbiError> {
        self.handle
            .ok_or(MessageCacheNativeAbiError::ResponseInvalid)
    }
}

impl Drop for MessageCacheNativeScope {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = self.api.close_handle_once(handle);
        }
    }
}

fn bounded_database_path(path: &Path) -> Result<&[u8], MessageCacheNativeAbiError> {
    if !path.is_absolute() {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    let value = path
        .to_str()
        .ok_or(MessageCacheNativeAbiError::RequestInvalid)?
        .as_bytes();
    if value.is_empty() || value.len() > MAXIMUM_PATH_BYTES || value.contains(&0) {
        return Err(MessageCacheNativeAbiError::RequestInvalid);
    }
    Ok(value)
}
