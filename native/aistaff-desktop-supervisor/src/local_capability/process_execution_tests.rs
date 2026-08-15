use super::contracts::{AdmissionStatus, LOCAL_CAPABILITY_PROTOCOL_VERSION};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use super::process_execution_contracts::ProcessExecutionState;
use super::process_execution_test_support::*;
use super::process_service::LocalProcessCapabilityService;
use serde_json::{Value, json};

fn policy_input(root: &TestRoot) -> Value {
    let executable_bytes = std::fs::read(&root.executable).expect("read executable");
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "33333333-3333-4333-8333-333333333333",
        "policy_handle": POLICY_HANDLE,
        "policy_revision": POLICY_REVISION,
        "scope": scope(),
        "policy_id": "report.generator.v1",
        "action_id": "local.process.generate_report",
        "capability_id": "process.generate_report",
        "executable_path": root.executable.to_str().expect("utf8 path"),
        "expected_executable_sha256": sha256(&executable_bytes),
        "target": target_name(),
        "fixed_argv": ["--ignored", "--exact", CONTEXT_FIXTURE, "--nocapture"],
        "required_environment_refs": [{
            "name": "PROCESS_TEST_TOKEN", "secret_ref": "vault.process_test_token"
        }],
        "working_directory_mode": "required_scoped_directory",
        "side_effect": "read_only",
        "max_timeout_ms": 2_000,
        "max_output_bytes": 16_384,
        "resource_policy": test_resource_policy(),
        "source": "trusted_policy_port",
        "expires_at_ms": NOW_MS + 60_000
    })
}

fn scope() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn descriptor_input() -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": OPERATION_ID,
        "policy_handle": POLICY_HANDLE,
        "expected_policy_revision": POLICY_REVISION,
        "scope": scope(),
        "argv": ["--ignored", "--exact", CONTEXT_FIXTURE, "--nocapture"],
        "environment_refs": [{"name": "PROCESS_TEST_TOKEN", "secret_ref": "vault.process_test_token"}],
        "working_directory": {
            "grant_handle": "55555555-5555-4555-8555-555555555555",
            "expected_grant_revision": "66666666-6666-4666-8666-666666666666",
            "relative_segments": ["reports"],
            "target_descriptor_hash": CWD_DESCRIPTOR_HASH
        },
        "timeout_ms": 2_000,
        "output_limit_bytes": 16_384,
        "resource_policy": test_resource_policy()
    })
}

fn start_input(process_descriptor_hash: &str) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "capability_request": {
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "scope": scope(),
            "authorization": {
                "tenant_id": "tenant-1",
                "source_decision_id": "decision-1",
                "outcome": "allow",
                "action_id": "local.process.generate_report",
                "capability_id": "process.generate_report",
                "resource_revision": "resource-v1",
                "policy_revision": "policy-v1",
                "audit_ref": "audit-1",
                "expires_at_ms": NOW_MS + 60_000
            },
            "artifact": {
                "artifact_id": "artifact-1",
                "artifact_version": "1.0.0",
                "artifact_sha256": "a".repeat(64),
                "admission_status": AdmissionStatus::Verified
            },
            "operation": {
                "operation_id": OPERATION_ID,
                "idempotency_key": "77777777-7777-4777-8777-777777777777",
                "action_id": "local.process.generate_report",
                "capability_id": "process.generate_report",
                "expected_revision": "resource-v1",
                "adapter_kind": "process",
                "side_effect": "read_only",
                "risk_level": "low",
                "descriptor_hash": process_descriptor_hash,
                "confirmation": "not_required"
            }
        },
        "descriptor_request": descriptor_input(),
        "expected_process_descriptor_hash": process_descriptor_hash
    })
}

fn test_service(root: &TestRoot) -> LocalProcessCapabilityService {
    LocalProcessCapabilityService::with_test_execution(
        || NOW_MS,
        test_target(),
        std::env::current_exe().expect("test executable"),
        Box::new(TestContextProvider {
            working_directory: root
                .working_directory
                .canonicalize()
                .expect("canonical cwd"),
        }),
    )
}

fn registered_service(root: &TestRoot) -> (LocalProcessCapabilityService, String) {
    let mut service = test_service(root);
    handle(
        &mut service,
        "capability.process.policy.register",
        policy_input(root),
    )
    .expect("register policy");
    let admitted = handle(
        &mut service,
        "capability.process.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    (
        service,
        admitted["process_descriptor_hash"]
            .as_str()
            .expect("descriptor hash")
            .to_owned(),
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn reconcile_until_terminal(
    service: &mut LocalProcessCapabilityService,
    request_hash: &str,
) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let result = handle(
            service,
            "capability.process.execution.reconcile",
            json!({
                "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
                "operation_id": OPERATION_ID,
                "request_hash": request_hash,
                "observed_side_effect_state": "none"
            }),
        )
        .expect("reconcile");
        if result["execution_state"] != json!(ProcessExecutionState::Running) {
            return result;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "execution did not terminate"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn service_executes_test_only_with_cloud_policy_context_and_redacted_output() {
    let root = TestRoot::new();
    let (mut service, descriptor_hash) = registered_service(&root);
    let input = start_input(&descriptor_hash);
    let started = handle(
        &mut service,
        "capability.process.execution.start",
        input.clone(),
    )
    .expect("start execution");
    assert_eq!(started["execution_mode"], "test_only");
    assert_eq!(started["production_enabled"], false);
    let request_hash = started["request_hash"].as_str().expect("request hash");
    let terminal = reconcile_until_terminal(&mut service, request_hash);
    assert_eq!(terminal["execution_state"], "completed");
    assert_eq!(terminal["decision"], "confirmed_evidence_only");
    let stdout = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        terminal["stdout_base64"].as_str().expect("stdout base64"),
    )
    .expect("decode stdout");
    let stdout_text = String::from_utf8_lossy(&stdout);
    assert!(stdout_text.contains("cwd-marker=present"));
    assert!(!stdout_text.contains(TEST_SECRET));
    assert!(stdout_text.contains(&"*".repeat(TEST_SECRET.len())));
    assert_eq!(
        terminal["evidence"]["stdout_sha256"],
        terminal["stdout_sha256"]
    );
    let replay = handle(&mut service, "capability.process.execution.start", input)
        .expect("idempotent replay");
    assert_eq!(replay["idempotency_replayed"], true);
    assert_eq!(replay["execution_state"], "completed");
    let conservative = handle(
        &mut service,
        "capability.process.execution.reconcile",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": OPERATION_ID,
            "request_hash": request_hash,
            "observed_side_effect_state": "unknown"
        }),
    )
    .expect("conservative reconcile");
    assert_eq!(conservative["decision"], "require_handoff");
    assert_eq!(conservative["side_effect_state"], "unknown");
    assert_eq!(conservative["evidence"]["side_effect_state"], "unknown");
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn execution_identity_and_missing_engine_record_fail_closed() {
    let root = TestRoot::new();
    let (mut service, descriptor_hash) = registered_service(&root);
    let started = handle(
        &mut service,
        "capability.process.execution.start",
        start_input(&descriptor_hash),
    )
    .expect("start execution");
    let request_hash = started["request_hash"]
        .as_str()
        .expect("request hash")
        .to_owned();
    assert_eq!(
        reconcile_until_terminal(&mut service, &request_hash)["execution_state"],
        "completed"
    );
    let mut reused_operation = start_input(&descriptor_hash);
    reused_operation["capability_request"]["operation"]["idempotency_key"] =
        Value::String("99999999-9999-4999-8999-999999999999".to_owned());
    assert_eq!(
        handle(
            &mut service,
            "capability.process.execution.start",
            reused_operation
        ),
        Err("LOCAL_PROCESS_EXECUTION_OPERATION_REUSED")
    );
    assert!(
        service
            .execution_engine
            .as_mut()
            .expect("test engine")
            .discard_terminal(OPERATION_ID)
    );
    let lost = handle(
        &mut service,
        "capability.process.execution.reconcile",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": OPERATION_ID,
            "request_hash": &request_hash,
            "observed_side_effect_state": "none"
        }),
    )
    .expect("lost handle reconciliation");
    assert_eq!(lost["decision"], "require_handoff");
    assert_eq!(
        lost["execution_state"],
        json!(ProcessExecutionState::Unknown)
    );
    assert_eq!(
        lost["reason_code"],
        "LOCAL_PROCESS_EXECUTION_RECONCILE_RECORD_LOST"
    );

    service
        .execution_records
        .remove("77777777-7777-4777-8777-777777777777");
    service.execution_order.clear();
    assert_eq!(
        handle(
            &mut service,
            "capability.process.execution.start",
            start_input(&descriptor_hash)
        ),
        Err("LOCAL_PROCESS_EXECUTION_REPLAY_EXPIRED")
    );
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn authorization_expiry_is_rechecked_before_spawn_and_bounds_runtime() {
    let root = TestRoot::new();
    let clock_calls = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let launch_clock = std::sync::Arc::clone(&clock_calls);
    let mut expired_during_context = LocalProcessCapabilityService::with_test_execution(
        move || {
            if launch_clock.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= 3 {
                NOW_MS + 100
            } else {
                NOW_MS
            }
        },
        test_target(),
        std::env::current_exe().expect("test executable"),
        Box::new(TestContextProvider {
            working_directory: root
                .working_directory
                .canonicalize()
                .expect("canonical cwd"),
        }),
    );
    handle(
        &mut expired_during_context,
        "capability.process.policy.register",
        policy_input(&root),
    )
    .expect("register policy");
    let admitted = handle(
        &mut expired_during_context,
        "capability.process.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    let descriptor_hash = admitted["process_descriptor_hash"]
        .as_str()
        .expect("descriptor hash");
    let mut expiring_start = start_input(descriptor_hash);
    expiring_start["capability_request"]["authorization"]["expires_at_ms"] =
        Value::from(NOW_MS + 50);
    assert_eq!(
        handle(
            &mut expired_during_context,
            "capability.process.execution.start",
            expiring_start
        ),
        Err("CAPABILITY_AUTHORIZATION_EXPIRED")
    );
    assert!(expired_during_context.execution_records.is_empty());
    std::fs::write(root.working_directory.join("process-context-wait"), b"wait")
        .expect("write wait marker");
    let (mut bounded_runtime, descriptor_hash) = registered_service(&root);
    let mut bounded_start = start_input(&descriptor_hash);
    bounded_start["capability_request"]["authorization"]["expires_at_ms"] =
        Value::from(NOW_MS + 50);
    let started = handle(
        &mut bounded_runtime,
        "capability.process.execution.start",
        bounded_start,
    )
    .expect("start authorization-bounded process");
    let request_hash = started["request_hash"].as_str().expect("request hash");
    assert_eq!(
        reconcile_until_terminal(&mut bounded_runtime, request_hash)["execution_state"],
        json!(ProcessExecutionState::TimedOut)
    );
}

#[test]
fn production_and_cloud_policy_drift_fail_before_process_spawn() {
    let root = TestRoot::new();
    let (_, descriptor_hash) = registered_service(&root);
    let mut production =
        LocalProcessCapabilityService::with_clock_and_target(|| NOW_MS, test_target());
    assert_eq!(
        handle(
            &mut production,
            "capability.process.execution.start",
            start_input(&descriptor_hash)
        ),
        Err("LOCAL_PROCESS_PRODUCTION_EXECUTION_DISABLED")
    );

    let (mut service, descriptor_hash) = registered_service(&root);
    let mut forged = start_input(&descriptor_hash);
    forged["capability_request"]["operation"]["action_id"] =
        Value::String("local.process.forged".to_owned());
    forged["capability_request"]["authorization"]["action_id"] =
        Value::String("local.process.forged".to_owned());
    assert_eq!(
        handle(&mut service, "capability.process.execution.start", forged),
        Err("LOCAL_PROCESS_EXECUTION_CLOUD_POLICY_MISMATCH")
    );
    assert_eq!(
        handle(
            &mut service,
            "capability.process.execution.start",
            start_input(LEGACY_DESCRIPTOR_HASH)
        ),
        Err("LOCAL_PROCESS_EXECUTION_DESCRIPTOR_CHANGED")
    );
    let mut unknown = start_input(&descriptor_hash);
    unknown["command"] = Value::String("tool --mode report".to_owned());
    assert_eq!(
        handle(&mut service, "capability.process.execution.start", unknown),
        Err("INVALID_LOCAL_PROCESS_PAYLOAD")
    );

    let mut drifted_context = LocalProcessCapabilityService::with_test_execution(
        || NOW_MS,
        test_target(),
        std::env::current_exe().expect("test executable"),
        Box::new(DriftedContextProvider {
            working_directory: root
                .working_directory
                .canonicalize()
                .expect("canonical cwd"),
        }),
    );
    handle(
        &mut drifted_context,
        "capability.process.policy.register",
        policy_input(&root),
    )
    .expect("register drifted context policy");
    let admitted = handle(
        &mut drifted_context,
        "capability.process.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit drifted context descriptor");
    assert_eq!(
        handle(
            &mut drifted_context,
            "capability.process.execution.start",
            start_input(
                admitted["process_descriptor_hash"]
                    .as_str()
                    .expect("descriptor hash")
            )
        ),
        Err("LOCAL_PROCESS_EXECUTION_CONTEXT_BINDING_MISMATCH")
    );
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn cancel_and_policy_revoke_terminate_the_running_process_group() {
    let root = TestRoot::new();
    std::fs::write(root.working_directory.join("process-context-wait"), b"wait")
        .expect("write wait marker");
    let (mut service, descriptor_hash) = registered_service(&root);
    let started = handle(
        &mut service,
        "capability.process.execution.start",
        start_input(&descriptor_hash),
    )
    .expect("start execution");
    let request_hash = started["request_hash"]
        .as_str()
        .expect("request hash")
        .to_owned();
    let cancelled = handle(
        &mut service,
        "capability.process.execution.cancel",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": OPERATION_ID,
            "request_hash": request_hash,
            "reason": "user_requested"
        }),
    )
    .expect("cancel");
    assert_eq!(cancelled["cancel_status"], "cancel_requested");
    assert_eq!(
        reconcile_until_terminal(&mut service, &request_hash)["execution_state"],
        json!(ProcessExecutionState::Cancelled)
    );
    let (mut revoked_service, descriptor_hash) = registered_service(&root);
    let started = handle(
        &mut revoked_service,
        "capability.process.execution.start",
        start_input(&descriptor_hash),
    )
    .expect("start execution");
    let request_hash = started["request_hash"].as_str().expect("request hash");
    handle(
        &mut revoked_service,
        "capability.process.policy.revoke",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "88888888-8888-4888-8888-888888888888",
            "policy_handle": POLICY_HANDLE,
            "expected_policy_revision": POLICY_REVISION
        }),
    )
    .expect("revoke policy");
    assert_eq!(
        reconcile_until_terminal(&mut revoked_service, request_hash)["execution_state"],
        json!(ProcessExecutionState::Cancelled)
    );
}
