use super::browser_service::{LocalBrowserCapabilityCommandHandler, LocalBrowserCapabilityService};
use super::contracts::LOCAL_CAPABILITY_PROTOCOL_VERSION;
use serde_json::{Value, json};

const NOW_MS: u64 = 1_900_000_000_000;
const POLICY_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const POLICY_REVISION: &str = "22222222-2222-4222-8222-222222222222";
const EXPECTED_DESCRIPTOR_HASH: &str =
    "8a7299875a6d251100f783d824cf058ad9929273a077434e942cb5313804a349";

fn scope() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn download_policy() -> Value {
    json!({
        "schema_version": "aistaff.local-browser-download-policy.v1",
        "mode": "disabled",
        "max_bytes": null,
        "allowed_mime_types": []
    })
}

fn permission_policy() -> Value {
    json!({
        "schema_version": "aistaff.local-browser-permission-policy.v1",
        "default_mode": "deny",
        "overrides": [
            {
                "permission": "camera",
                "mode": "deny"
            },
            {
                "permission": "microphone",
                "mode": "deny"
            }
        ]
    })
}

fn evidence_policy() -> Value {
    json!({
        "schema_version": "aistaff.local-browser-evidence-policy.v1",
        "dom_capture": "disabled",
        "screenshot_capture": "disabled",
        "network_capture": "origin_only",
        "console_capture": "disabled"
    })
}

fn register_input() -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "33333333-3333-4333-8333-333333333333",
        "policy_handle": POLICY_HANDLE,
        "policy_revision": POLICY_REVISION,
        "scope": scope(),
        "policy_id": "browser.salesforce.read.v1",
        "action_id": "local.browser.open_salesforce",
        "capability_id": "browser.open",
        "allowed_origins": ["https://app.example.com"],
        "download_policy": download_policy(),
        "permission_policy": permission_policy(),
        "evidence_policy": evidence_policy(),
        "max_timeout_ms": 30_000,
        "source": "trusted_browser_policy_port",
        "expires_at_ms": NOW_MS + 60_000
    })
}

fn descriptor_input() -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "44444444-4444-4444-8444-444444444444",
        "policy_handle": POLICY_HANDLE,
        "expected_policy_revision": POLICY_REVISION,
        "scope": scope(),
        "start_url": "https://app.example.com/accounts?view=owned",
        "expected_origin": "https://app.example.com",
        "timeout_ms": 10_000,
        "download_policy": download_policy(),
        "permission_policy": permission_policy(),
        "evidence_policy": evidence_policy()
    })
}

fn capability_request() -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "scope": scope(),
        "authorization": {
            "tenant_id": "tenant-1",
            "source_decision_id": "decision-browser-1",
            "outcome": "allow",
            "action_id": "local.browser.open_salesforce",
            "capability_id": "browser.open",
            "resource_revision": "browser-resource-v1",
            "policy_revision": "browser-policy-v1",
            "audit_ref": "audit-browser-1",
            "expires_at_ms": NOW_MS + 60_000
        },
        "artifact": {
            "artifact_id": "artifact-browser-1",
            "artifact_version": "1.0.0",
            "artifact_sha256": "a".repeat(64),
            "admission_status": "verified"
        },
        "operation": {
            "operation_id": "44444444-4444-4444-8444-444444444444",
            "idempotency_key": "77777777-7777-4777-8777-777777777777",
            "action_id": "local.browser.open_salesforce",
            "capability_id": "browser.open",
            "expected_revision": "browser-resource-v1",
            "adapter_kind": "browser",
            "side_effect": "read_only",
            "risk_level": "low",
            "descriptor_hash": EXPECTED_DESCRIPTOR_HASH,
            "confirmation": "confirmed"
        }
    })
}

fn navigate_input() -> Value {
    navigate_input_for(descriptor_input(), EXPECTED_DESCRIPTOR_HASH)
}

fn navigate_input_for(descriptor_request: Value, descriptor_hash: &str) -> Value {
    let descriptor_operation_id = descriptor_request["operation_id"]
        .as_str()
        .expect("descriptor operation id")
        .to_owned();
    let mut bound_capability_request = capability_request();
    bound_capability_request["operation"]["operation_id"] = json!(descriptor_operation_id);
    bound_capability_request["operation"]["descriptor_hash"] = json!(descriptor_hash);
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "capability_request": bound_capability_request,
        "descriptor_request": descriptor_request,
        "expected_browser_descriptor_hash": descriptor_hash
    })
}

fn navigate_input_with_idempotency_key(
    descriptor_request: Value,
    descriptor_hash: &str,
    idempotency_key: &str,
) -> Value {
    let mut input = navigate_input_for(descriptor_request, descriptor_hash);
    input["capability_request"]["operation"]["idempotency_key"] = json!(idempotency_key);
    input
}

fn handle(
    service: &mut LocalBrowserCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn descriptor_with_operation_id(index: usize) -> Value {
    let operation_id = format!("55555555-5555-4555-8{index:03x}-555555555555");
    let mut descriptor = descriptor_input();
    descriptor["operation_id"] = json!(operation_id);
    descriptor
}

fn admit_descriptor(
    browser: &mut LocalBrowserCapabilityService,
    descriptor: Value,
) -> (Value, String) {
    let admitted = handle(
        browser,
        "capability.browser.descriptor.admit",
        descriptor.clone(),
    )
    .expect("admit descriptor");
    let descriptor_hash = admitted["browser_descriptor_hash"]
        .as_str()
        .expect("descriptor hash")
        .to_owned();
    (descriptor, descriptor_hash)
}

fn registered_service(test_only_execution: bool) -> LocalBrowserCapabilityService {
    let mut browser = if test_only_execution {
        LocalBrowserCapabilityService::with_test_execution(|| NOW_MS)
    } else {
        LocalBrowserCapabilityService::with_clock(|| NOW_MS)
    };
    handle(
        &mut browser,
        "capability.browser.policy.register",
        register_input(),
    )
    .expect("register policy");
    browser
}

#[test]
fn production_browser_execution_is_disabled_after_admission() {
    let mut browser = registered_service(false);
    handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            navigate_input(),
        )
        .expect_err("production disabled"),
        "LOCAL_BROWSER_PRODUCTION_EXECUTION_DISABLED"
    );
}

#[test]
fn test_only_browser_adapter_navigates_with_metadata_only_evidence() {
    let mut browser = registered_service(true);
    handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    let navigated = handle(
        &mut browser,
        "capability.browser.execution.navigate",
        navigate_input(),
    )
    .expect("test-only navigate");
    assert_eq!(navigated["execution_state"], "completed");
    assert_eq!(navigated["execution_mode"], "test_only");
    assert_eq!(navigated["production_enabled"], false);
    assert_eq!(
        navigated["browser_descriptor_hash"],
        EXPECTED_DESCRIPTOR_HASH
    );
    assert_eq!(navigated["evidence"]["cloud_audit_ref"], "audit-browser-1");
    assert_eq!(
        navigated["evidence"]["redaction_profile"],
        "browser_execution_metadata_only.v1"
    );
    let serialized = serde_json::to_string(&navigated).expect("response json");
    assert!(!serialized.contains("storage_state"));
    assert!(!serialized.contains("cookie"));
    assert!(!serialized.contains("screenshot"));
    assert!(!serialized.contains("browser_profile_path"));
    assert!(!serialized.contains("dom"));
    assert!(!serialized.contains("header"));

    let replay = handle(
        &mut browser,
        "capability.browser.execution.navigate",
        navigate_input(),
    )
    .expect("test-only navigate replay");
    assert_eq!(replay["idempotency_replayed"], true);
}

#[test]
fn browser_execution_requires_prior_admission_artifact_and_authorization() {
    let mut browser = registered_service(true);
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            navigate_input(),
        )
        .expect_err("descriptor admission required"),
        "LOCAL_BROWSER_DESCRIPTOR_NOT_ADMITTED"
    );

    handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    let mut unverified_artifact = navigate_input();
    unverified_artifact["capability_request"]["artifact"]["admission_status"] = json!("unverified");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            unverified_artifact,
        )
        .expect_err("artifact must be verified"),
        "LOCAL_BROWSER_EXECUTION_BINDING_MISMATCH"
    );

    let mut stale_authorization = navigate_input();
    stale_authorization["capability_request"]["authorization"]["expires_at_ms"] = json!(NOW_MS);
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            stale_authorization,
        )
        .expect_err("authorization must be active"),
        "CAPABILITY_AUTHORIZATION_EXPIRED"
    );
}

#[test]
fn browser_execution_rejects_confirmation_and_action_drift() {
    let mut browser = registered_service(true);
    handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    let mut missing_confirmation = navigate_input();
    missing_confirmation["capability_request"]["operation"]["confirmation"] = json!("not_required");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            missing_confirmation,
        )
        .expect_err("browser execution requires explicit confirmation"),
        "LOCAL_BROWSER_EXECUTION_BINDING_MISMATCH"
    );

    let mut action_drift = navigate_input();
    action_drift["capability_request"]["operation"]["action_id"] = json!("local.browser.other");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            action_drift,
        )
        .expect_err("operation and authorization action must match"),
        "LOCAL_BROWSER_EXECUTION_BINDING_MISMATCH"
    );

    let mut policy_action_drift = navigate_input();
    policy_action_drift["capability_request"]["operation"]["action_id"] =
        json!("local.browser.other");
    policy_action_drift["capability_request"]["authorization"]["action_id"] =
        json!("local.browser.other");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            policy_action_drift,
        )
        .expect_err("policy action binding required"),
        "LOCAL_BROWSER_EXECUTION_POLICY_MISMATCH"
    );
}

#[test]
fn browser_execution_idempotency_key_and_operation_reuse_fail_closed() {
    let mut browser = registered_service(true);
    handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit baseline descriptor");
    handle(
        &mut browser,
        "capability.browser.execution.navigate",
        navigate_input(),
    )
    .expect("baseline navigate");

    let (second_descriptor, second_hash) =
        admit_descriptor(&mut browser, descriptor_with_operation_id(1));
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            navigate_input_for(second_descriptor, &second_hash),
        )
        .expect_err("same idempotency key cannot target a different descriptor"),
        "LOCAL_BROWSER_EXECUTION_IDEMPOTENCY_CONFLICT"
    );

    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            navigate_input_with_idempotency_key(
                descriptor_input(),
                EXPECTED_DESCRIPTOR_HASH,
                "88888888-8888-4888-8888-888888888888",
            ),
        )
        .expect_err("operation id cannot be reused with a different idempotency key"),
        "LOCAL_BROWSER_EXECUTION_OPERATION_REUSED"
    );
}

#[test]
fn browser_execution_descriptor_admission_cache_is_bounded_fail_closed() {
    let mut browser = registered_service(true);
    let mut first_descriptor: Option<Value> = None;
    let mut first_hash: Option<String> = None;
    let mut last_descriptor: Option<Value> = None;
    let mut last_hash: Option<String> = None;

    for index in 0..129 {
        let (descriptor, descriptor_hash) =
            admit_descriptor(&mut browser, descriptor_with_operation_id(index));
        if index == 0 {
            first_descriptor = Some(descriptor.clone());
            first_hash = Some(descriptor_hash.clone());
        }
        last_descriptor = Some(descriptor);
        last_hash = Some(descriptor_hash);
    }

    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.execution.navigate",
            navigate_input_for(
                first_descriptor.expect("first descriptor"),
                &first_hash.expect("first hash"),
            ),
        )
        .expect_err("oldest descriptor admission evicted"),
        "LOCAL_BROWSER_DESCRIPTOR_NOT_ADMITTED"
    );
    let navigated = handle(
        &mut browser,
        "capability.browser.execution.navigate",
        navigate_input_for(
            last_descriptor.expect("last descriptor"),
            &last_hash.expect("last hash"),
        ),
    )
    .expect("newest descriptor remains admitted");
    assert_eq!(navigated["execution_state"], "completed");
}
