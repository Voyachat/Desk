use super::super::contracts::{
    INTEGRITY_CONFIRMED_CORRUPT, NativeCheckIntegrityRequestV1, NativeIntegrityResultV1,
    NativeProbeV1, STATUS_INTEGRITY_CHECK_FAILED,
};
use super::*;

unsafe extern "C" fn confirmed_corrupt_integrity(
    input_size: u32,
    input: *const NativeCheckIntegrityRequestV1,
    output_size: u32,
    output: *mut NativeIntegrityResultV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments preserves the successful mock preconditions.
    let status = unsafe { successful_integrity(input_size, input, output_size, output) };
    // SAFETY: The wrapper supplies a live fixed-size result value.
    unsafe { &mut *output }.integrity_state = INTEGRITY_CONFIRMED_CORRUPT;
    status
}

unsafe extern "C" fn failed_integrity(
    _input_size: u32,
    _input: *const NativeCheckIntegrityRequestV1,
    _output_size: u32,
    output: *mut NativeIntegrityResultV1,
) -> u32 {
    // SAFETY: The wrapper supplies a live fixed-size result value.
    let output = unsafe { &mut *output };
    output.struct_size = size_of::<NativeIntegrityResultV1>() as u32;
    output.abi_version = MESSAGE_CACHE_NATIVE_ABI_VERSION;
    output.status = STATUS_INTEGRITY_CHECK_FAILED;
    STATUS_INTEGRITY_CHECK_FAILED
}

unsafe extern "C" fn malformed_integrity(
    input_size: u32,
    input: *const NativeCheckIntegrityRequestV1,
    output_size: u32,
    output: *mut NativeIntegrityResultV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments preserves the successful mock preconditions.
    let status = unsafe { successful_integrity(input_size, input, output_size, output) };
    // SAFETY: The wrapper supplies a live fixed-size result value.
    unsafe { &mut *output }.integrity_state = 99;
    status
}

unsafe extern "C" fn probe_with_integrity(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
    integrity: super::super::contracts::NativeCheckIntegrityFunction,
) -> u32 {
    // SAFETY: Forwarding the exact arguments preserves successful mock preconditions.
    let status = unsafe { successful_probe(caller_version, output_size, output) };
    // SAFETY: The wrapper passes a live, aligned fixed-size output.
    unsafe { &mut *output }.check_integrity = Some(integrity);
    status
}

unsafe extern "C" fn confirmed_corrupt_probe(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments and owned function pointer is valid.
    unsafe {
        probe_with_integrity(
            caller_version,
            output_size,
            output,
            confirmed_corrupt_integrity,
        )
    }
}

unsafe extern "C" fn failed_integrity_probe(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments and owned function pointer is valid.
    unsafe { probe_with_integrity(caller_version, output_size, output, failed_integrity) }
}

unsafe extern "C" fn malformed_integrity_probe(
    caller_version: u32,
    output_size: u32,
    output: *mut NativeProbeV1,
) -> u32 {
    // SAFETY: Forwarding the exact arguments and owned function pointer is valid.
    unsafe { probe_with_integrity(caller_version, output_size, output, malformed_integrity) }
}

#[test]
fn native_integrity_states_keep_corruption_failure_and_unknown_distinct() {
    let _guard = NATIVE_TEST_LOCK.lock().expect("native test lock");
    let corrupt_api = MessageCacheNativeAbi::new(confirmed_corrupt_probe)
        .probe()
        .expect("corrupt api");
    let mut corrupt_scope = open_scope(&corrupt_api);
    assert_eq!(
        corrupt_scope.check_integrity().expect("confirmed corrupt"),
        MessageCacheNativeIntegrity::ConfirmedCorrupt
    );
    corrupt_scope.close().expect("close corrupt scope");

    let failed_api = MessageCacheNativeAbi::new(failed_integrity_probe)
        .probe()
        .expect("failed api");
    let mut failed_scope = open_scope(&failed_api);
    let failed = failed_scope
        .check_integrity()
        .expect_err("integrity check failure");
    assert_eq!(failed.reason_code(), "WCDB_NATIVE_INTEGRITY_CHECK_FAILED");
    failed_scope.close().expect("close failed scope");

    let malformed_api = MessageCacheNativeAbi::new(malformed_integrity_probe)
        .probe()
        .expect("malformed api");
    let mut malformed_scope = open_scope(&malformed_api);
    assert_eq!(
        malformed_scope
            .check_integrity()
            .expect_err("unknown integrity result"),
        MessageCacheNativeAbiError::ResponseInvalid
    );
    malformed_scope.close().expect("close malformed scope");
}
