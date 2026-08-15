use super::contracts::{
    INTEGRITY_HEALTHY, NativeCheckIntegrityRequestV1, NativeCloseScopeRequestV1,
    NativeIntegrityResultV1, NativeMutationResultV1, NativeOpenScopeRequestV1,
    NativeOpenScopeResultV1, NativePageRequestV1, NativePageResultV1, NativeProbeV1,
    NativeProjectionV1, NativePurgeScopeRequestV1, NativePutConfirmedRequestV1,
    NativeStatusResultV1, STATUS_OK,
};
use super::projection::encode_projection;
use super::*;
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, RedactionProfile,
};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

const VERSION: &[u8] = b"2.1.16";
const COMMIT: &[u8] = b"df808591b9f9a9ab42156006819c3550d5af13a3";
const OPERATION_ID: &str = "11111111-1111-4111-8111-111111111111";
static CLOSE_CALLS: AtomicUsize = AtomicUsize::new(0);
static NATIVE_TEST_LOCK: Mutex<()> = Mutex::new(());

unsafe extern "C" fn successful_open(
    input_size: u32,
    input: *const NativeOpenScopeRequestV1,
    output_size: u32,
    output: *mut NativeOpenScopeResultV1,
) -> u32 {
    assert_eq!(input_size, size_of::<NativeOpenScopeRequestV1>() as u32);
    assert_eq!(output_size, size_of::<NativeOpenScopeResultV1>() as u32);
    // SAFETY: The wrapper supplies aligned pointers to its live fixed-size values.
    let input = unsafe { &*input };
    // SAFETY: The wrapper supplies aligned pointers to its live fixed-size values.
    let output = unsafe { &mut *output };
    assert_eq!(
        input.cipher_key_length,
        MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES as u32
    );
    assert_eq!(input.now_epoch_s, 1_000);
    assert_eq!(input.retention_seconds, 100);
    assert_eq!(input.retention_sweep_limit, 20);
    output.struct_size = size_of::<NativeOpenScopeResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.reopened = 1;
    output.scope = std::ptr::dangling_mut::<c_void>();
    STATUS_OK
}

unsafe extern "C" fn successful_close(
    _input_size: u32,
    input: *const NativeCloseScopeRequestV1,
    _output_size: u32,
    output: *mut NativeStatusResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies aligned pointers to its live fixed-size values.
    assert_eq!(unsafe { &*input }.scope, std::ptr::dangling_mut::<c_void>());
    // SAFETY: The wrapper supplies aligned pointers to its live fixed-size values.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeStatusResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    CLOSE_CALLS.fetch_add(1, Ordering::SeqCst);
    STATUS_OK
}

unsafe extern "C" fn successful_integrity(
    _input_size: u32,
    input: *const NativeCheckIntegrityRequestV1,
    _output_size: u32,
    output: *mut NativeIntegrityResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies aligned pointers to its live fixed-size values.
    assert_eq!(unsafe { &*input }.scope, std::ptr::dangling_mut::<c_void>());
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeIntegrityResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.integrity_state = INTEGRITY_HEALTHY;
    STATUS_OK
}

unsafe extern "C" fn successful_put(
    _input_size: u32,
    input: *const NativePutConfirmedRequestV1,
    _output_size: u32,
    output: *mut NativeMutationResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies aligned pointers and live borrowed buffers.
    let input = unsafe { &*input };
    assert_eq!(input.operation_id_length, OPERATION_ID.len() as u32);
    assert_eq!(input.request_hash_length, 32);
    // SAFETY: The projection pointer targets a live fixed-size request value.
    assert_eq!(unsafe { &*input.projection }.sequence, 1);
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeMutationResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    STATUS_OK
}

unsafe extern "C" fn malformed_put(
    input_size: u32,
    input: *const NativePutConfirmedRequestV1,
    output_size: u32,
    output: *mut NativeMutationResultV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments preserves the successful mock preconditions.
    let status = unsafe { successful_put(input_size, input, output_size, output) };
    // SAFETY: The wrapper supplies a live fixed-size result value.
    unsafe { &mut *output }.idempotency_replayed = 2;
    status
}

unsafe extern "C" fn successful_page(
    _input_size: u32,
    input: *const NativePageRequestV1,
    _output_size: u32,
    output: *mut NativePageResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies aligned pointers and a capacity-bounded output array.
    let input = unsafe { &*input };
    assert_eq!(input.limit, 2);
    for index in 0usize..2 {
        let value = encode_projection(
            &fixture_projection(index as u64 + 1),
            1_000 + index as i64,
            1_100 + index as i64,
        )
        .expect("projection");
        // SAFETY: The request declares projection_capacity=2 and the wrapper allocated two slots.
        unsafe { input.projections.add(index).write(value) };
    }
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativePageResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.projection_count = 2;
    output.next_after_sequence = 2;
    STATUS_OK
}

unsafe extern "C" fn successful_purge(
    _input_size: u32,
    input: *const NativePurgeScopeRequestV1,
    _output_size: u32,
    output: *mut NativeMutationResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies aligned pointers and live borrowed buffers.
    let input = unsafe { &*input };
    assert_eq!(input.operation_id_length, OPERATION_ID.len() as u32);
    assert_eq!(input.committed_at_epoch_s, 1_000);
    assert_eq!(input.expires_at_epoch_s, 1_100);
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeMutationResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.idempotency_replayed = 1;
    STATUS_OK
}

unsafe extern "C" fn successful_probe(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    assert_eq!(caller_version, MESSAGE_CACHE_NATIVE_ABI_VERSION);
    assert_eq!(output_size, size_of::<NativeProbeV1>() as u32);
    // SAFETY: The wrapper passes a live, aligned fixed-size output.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeProbeV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.wcdb_version_length = VERSION.len() as u32;
    output.wcdb_commit_length = COMMIT.len() as u32;
    output.wcdb_cpp_enabled = 1;
    output.open_scope = Some(successful_open);
    output.close_scope = Some(successful_close);
    output.check_integrity = Some(successful_integrity);
    output.put_confirmed = Some(successful_put);
    output.page = Some(successful_page);
    output.purge_scope = Some(successful_purge);
    output.put_local_history = Some(successful_put_local_history);
    output.snapshot_local_history = Some(successful_snapshot_local_history);
    output.release_local_history = Some(successful_release_local_history);
    output.wcdb_version[..VERSION.len()].copy_from_slice(VERSION);
    output.wcdb_commit[..COMMIT.len()].copy_from_slice(COMMIT);
    STATUS_OK
}

unsafe extern "C" fn successful_put_local_history(
    _input_size: u32,
    _input: *const super::contracts::NativePutLocalHistoryRequestV1,
    _output_size: u32,
    output: *mut NativeMutationResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeMutationResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    STATUS_OK
}

unsafe extern "C" fn successful_snapshot_local_history(
    _input_size: u32,
    _input: *const super::contracts::NativeSnapshotLocalHistoryRequestV1,
    _output_size: u32,
    output: *mut super::contracts::NativeSnapshotLocalHistoryResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<super::contracts::NativeSnapshotLocalHistoryResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    STATUS_OK
}

unsafe extern "C" fn successful_release_local_history(
    _input_size: u32,
    _input: *const super::contracts::NativeReleaseLocalHistoryRequestV1,
    _output_size: u32,
    output: *mut super::contracts::NativeReleaseLocalHistoryResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<super::contracts::NativeReleaseLocalHistoryResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    STATUS_OK
}

unsafe extern "C" fn malformed_mutation_probe(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments preserves successful mock preconditions.
    let status = unsafe { successful_probe(caller_version, output_size, output) };
    // SAFETY: The wrapper passes a live, aligned fixed-size output.
    unsafe { &mut *output }.put_confirmed = Some(malformed_put);
    status
}

unsafe extern "C" fn rejected_probe(
    _caller_version: u32,
    _output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: The wrapper passes a live, aligned fixed-size output.
    unsafe { &mut *output }.status = 3;
    3
}

unsafe extern "C" fn malformed_probe(
    _caller_version: u32,
    _output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: The wrapper passes a live, aligned fixed-size output.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeProbeV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.wcdb_version_length = 200;
    output.wcdb_commit_length = COMMIT.len() as u32;
    output.wcdb_cpp_enabled = 1;
    output.open_scope = Some(successful_open);
    output.close_scope = Some(successful_close);
    output.put_confirmed = Some(successful_put);
    output.page = Some(successful_page);
    output.purge_scope = Some(successful_purge);
    output.wcdb_commit[..COMMIT.len()].copy_from_slice(COMMIT);
    STATUS_OK
}

fn fixture_projection(sequence: u64) -> ConfirmedTimelineProjection {
    ConfirmedTimelineProjection {
        thread_id: "thread:fixture".to_owned(),
        sequence,
        event_type: "message.confirmed".to_owned(),
        actor_type: ActorType::User,
        occurred_at: "2026-07-29T00:00:00Z".to_owned(),
        masked_summary: "summary".to_owned(),
        payload_hash: "a".repeat(64),
        run_id: Some("run:fixture".to_owned()),
        server_cursor: Some("cursor:fixture".to_owned()),
        delivery_state: DeliveryState::Confirmed,
        redaction_profile: RedactionProfile::SummaryOnlyV1,
    }
}

fn open_scope(api: &MessageCacheNativeApi) -> MessageCacheNativeScope {
    api.open_encrypted_scope(
        Path::new(if cfg!(windows) {
            r"C:\aistaff\cache.db"
        } else {
            "/tmp/aistaff/cache.db"
        }),
        &[7; MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES],
        1_000,
        MessageCacheNativeRetentionPolicy {
            retention_seconds: 100,
            sweep_limit: 20,
        },
    )
    .expect("scope")
}

#[test]
fn native_structs_match_the_owned_c_layout() {
    assert_eq!(size_of::<NativeProbeV1>(), 184);
    assert_eq!(std::mem::offset_of!(NativeProbeV1, put_confirmed), 48);
    assert_eq!(std::mem::offset_of!(NativeProbeV1, wcdb_version), 72);
    assert_eq!(std::mem::offset_of!(NativeProbeV1, check_integrity), 152);
    assert_eq!(std::mem::offset_of!(NativeProbeV1, put_local_history), 160);
    assert_eq!(size_of::<NativeOpenScopeRequestV1>(), 64);
    assert_eq!(size_of::<NativeOpenScopeResultV1>(), 32);
    assert_eq!(size_of::<NativeCloseScopeRequestV1>(), 24);
    assert_eq!(size_of::<NativeStatusResultV1>(), 16);
    assert_eq!(size_of::<NativeCheckIntegrityRequestV1>(), 24);
    assert_eq!(size_of::<NativeIntegrityResultV1>(), 24);
    assert_eq!(size_of::<NativeProjectionV1>(), 1_384);
    assert_eq!(size_of::<NativePutConfirmedRequestV1>(), 56);
    assert_eq!(size_of::<NativeMutationResultV1>(), 24);
    assert_eq!(size_of::<NativePageRequestV1>(), 72);
    assert_eq!(size_of::<NativePageResultV1>(), 32);
    assert_eq!(size_of::<NativePurgeScopeRequestV1>(), 64);
}

#[test]
fn native_function_table_round_trips_crud_and_closes_once() {
    let _guard = NATIVE_TEST_LOCK.lock().expect("native test lock");
    CLOSE_CALLS.store(0, Ordering::SeqCst);
    let api = MessageCacheNativeAbi::new(successful_probe)
        .probe()
        .expect("valid probe");
    assert_eq!(api.metadata().wcdb_version, "2.1.16");
    let mut scope = open_scope(&api);
    assert!(scope.reopened());
    assert_eq!(
        scope.check_integrity().expect("integrity"),
        MessageCacheNativeIntegrity::Healthy
    );
    let mutation = scope
        .put_confirmed(OPERATION_ID, &[3; 32], &fixture_projection(1), 1_000, 1_100)
        .expect("put");
    assert!(!mutation.idempotency_replayed);
    let page = scope.page("thread:fixture", None, 1_000, 2).expect("page");
    assert_eq!(page.projections.len(), 2);
    assert_eq!(page.next_after_sequence, Some(2));
    assert!(!page.has_more);
    let purge = scope
        .purge_scope(OPERATION_ID, &[4; 32], 1_000, 1_100)
        .expect("purge");
    assert!(purge.idempotency_replayed);
    scope.close().expect("close");
    assert_eq!(CLOSE_CALLS.load(Ordering::SeqCst), 1);
}

#[test]
fn malformed_mutation_is_an_unknown_outcome_without_retry_permission() {
    let _guard = NATIVE_TEST_LOCK.lock().expect("native test lock");
    let api = MessageCacheNativeAbi::new(malformed_mutation_probe)
        .probe()
        .expect("api");
    let mut scope = open_scope(&api);
    let error = scope
        .put_confirmed(OPERATION_ID, &[3; 32], &fixture_projection(1), 1_000, 1_100)
        .expect_err("malformed response");
    assert_eq!(error, MessageCacheNativeAbiError::ResponseInvalid);
    assert_eq!(
        error.mutation_reason_code(),
        "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
    );
    assert_eq!(
        MessageCacheNativeAbiError::NativeStatus(12).mutation_reason_code(),
        "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
    );
    assert_eq!(
        MessageCacheNativeAbiError::NativeStatus(250).mutation_reason_code(),
        "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
    );
    assert_eq!(
        MessageCacheNativeAbiError::NativeStatus(13).mutation_reason_code(),
        "WCDB_NATIVE_ARGUMENT_REJECTED"
    );
}

#[test]
fn native_scope_drop_closes_at_most_once() {
    let _guard = NATIVE_TEST_LOCK.lock().expect("native test lock");
    CLOSE_CALLS.store(0, Ordering::SeqCst);
    let api = MessageCacheNativeAbi::new(successful_probe)
        .probe()
        .expect("api");
    {
        let _scope = open_scope(&api);
    }
    assert_eq!(CLOSE_CALLS.load(Ordering::SeqCst), 1);
}

#[test]
fn native_scope_owns_its_function_table_after_the_probe_api_is_dropped() {
    let _guard = NATIVE_TEST_LOCK.lock().expect("native test lock");
    CLOSE_CALLS.store(0, Ordering::SeqCst);
    let mut scope = {
        let api = MessageCacheNativeAbi::new(successful_probe)
            .probe()
            .expect("api");
        open_scope(&api)
    };
    assert_eq!(
        scope.check_integrity().expect("owned function table"),
        MessageCacheNativeIntegrity::Healthy
    );
    scope.close().expect("close");
    assert_eq!(CLOSE_CALLS.load(Ordering::SeqCst), 1);
}

#[path = "tests/integrity.rs"]
mod integrity;

#[test]
fn native_probe_rejects_status_and_malformed_lengths() {
    let error = MessageCacheNativeAbi::new(rejected_probe)
        .probe()
        .err()
        .expect("rejected");
    assert_eq!(error, MessageCacheNativeAbiError::NativeStatus(3));
    assert_eq!(error.reason_code(), "WCDB_NATIVE_OPERATION_REJECTED");
    assert_eq!(
        MessageCacheNativeAbi::new(malformed_probe).probe().err(),
        Some(MessageCacheNativeAbiError::ResponseInvalid)
    );
}

#[test]
fn native_scope_rejects_unbounded_inputs_before_ffi() {
    let api = MessageCacheNativeAbi::new(successful_probe)
        .probe()
        .expect("api");
    let retention = MessageCacheNativeRetentionPolicy {
        retention_seconds: 100,
        sweep_limit: 20,
    };
    assert_eq!(
        api.open_encrypted_scope(
            Path::new("relative.db"),
            &[1; MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES],
            1_000,
            retention,
        )
        .err(),
        Some(MessageCacheNativeAbiError::RequestInvalid)
    );
    assert_eq!(
        api.open_encrypted_scope(
            Path::new(if cfg!(windows) {
                r"C:\aistaff\cache.db"
            } else {
                "/tmp/aistaff/cache.db"
            }),
            &[1; MESSAGE_CACHE_NATIVE_CIPHER_KEY_BYTES - 1],
            1_000,
            retention,
        )
        .err(),
        Some(MessageCacheNativeAbiError::RequestInvalid)
    );
}
