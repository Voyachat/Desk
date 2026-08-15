use super::*;

#[test]
fn worker_random_values_are_fixed_lower_hex_and_not_reused() {
    let first = random_hex(32).expect("random");
    let second = random_hex(32).expect("random");
    assert_eq!(first.len(), 64);
    assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(first, first.to_ascii_lowercase());
    assert_ne!(first, second);
}

#[test]
fn worker_environment_excludes_parent_tokens_and_loader_injection() {
    let environment = worker_environment([
        ("SystemRoot".to_owned(), r"C:\Windows".to_owned()),
        ("TMPDIR".to_owned(), "/private/tmp".to_owned()),
        (
            "AISTAFF_SUPERVISOR_TOKEN".to_owned(),
            "must-not-cross".to_owned(),
        ),
        ("DYLD_INSERT_LIBRARIES".to_owned(), "/bad".to_owned()),
    ]);
    assert_eq!(
        environment,
        vec![
            ("SystemRoot".to_owned(), r"C:\Windows".to_owned()),
            ("TMPDIR".to_owned(), "/private/tmp".to_owned())
        ]
    );
}

#[test]
fn spawn_inputs_reject_relative_binary_and_unsafe_timeout() {
    assert_eq!(
        validate_spawn_inputs(
            Path::new("relative"),
            Path::new("/absolute"),
            Duration::from_secs(1)
        )
        .expect_err("relative")
        .code,
        "WORKER_SPAWN_INPUT_INVALID"
    );
    assert!(!valid_adapter_id(".hidden"));
    assert!(!valid_adapter_id("2wcdb"));
    assert!(valid_adapter_id("wcdb.v2.1.16"));
    assert!(valid_adapter_reason("available", None));
    assert!(!valid_adapter_reason(
        "available",
        Some("WCDB_NATIVE_LIBRARY_LOAD_FAILED")
    ));
    assert!(valid_adapter_reason(
        "adapter_unavailable",
        Some("WCDB_NATIVE_LIBRARY_LOAD_FAILED")
    ));
    assert!(!valid_adapter_reason("adapter_unavailable", None));
}

#[test]
fn worker_timeout_is_reconcile_required_and_never_a_retry_signal() {
    let (_sender, receiver) = mpsc::channel();
    assert_eq!(
        receive_response_line(&receiver, Duration::from_millis(1))
            .expect_err("timeout")
            .code,
        "WORKER_RESPONSE_TIMEOUT_RECONCILE_REQUIRED"
    );
}
