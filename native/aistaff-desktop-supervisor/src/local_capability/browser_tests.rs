use super::browser_service::{LocalBrowserCapabilityCommandHandler, LocalBrowserCapabilityService};
use super::contracts::LOCAL_CAPABILITY_PROTOCOL_VERSION;
use crate::{PROTOCOL_VERSION, SupervisorRuntime};
use serde_json::{Value, json};

const NOW_MS: u64 = 1_900_000_000_000;
const POLICY_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const POLICY_REVISION: &str = "22222222-2222-4222-8222-222222222222";
const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
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

fn register_input(expires_at_ms: u64) -> Value {
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
        "expires_at_ms": expires_at_ms
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

fn service() -> LocalBrowserCapabilityService {
    LocalBrowserCapabilityService::with_clock(|| NOW_MS)
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

fn request(command: &str, payload: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "request-browser-1",
        "auth_token": TOKEN,
        "command": command,
        "payload": payload
    }))
    .expect("request fixture")
}

#[test]
fn descriptor_admission_binds_policy_without_browser_execution() {
    let mut browser = service();
    let registered = handle(
        &mut browser,
        "capability.browser.policy.register",
        register_input(NOW_MS + 60_000),
    )
    .expect("register policy");
    assert_eq!(registered["policy_status"], "registered");
    assert_eq!(registered["execution_enabled"], false);

    let admitted = handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("admit descriptor");
    assert_eq!(admitted["admission_status"], "validated_no_execution");
    assert_eq!(admitted["execution_enabled"], false);
    assert_eq!(
        admitted["browser_descriptor_hash"],
        EXPECTED_DESCRIPTOR_HASH
    );
    assert_eq!(
        admitted["evidence"]["redaction_profile"],
        "browser_descriptor_metadata_only.v1"
    );
    assert_eq!(admitted["evidence"]["side_effect_state"], "none");

    let serialized = serde_json::to_string(&admitted).expect("response json");
    assert!(!serialized.contains("storage_state"));
    assert!(!serialized.contains("cookie"));
    assert!(!serialized.contains("screenshot"));
    assert!(!serialized.contains("browser_profile_path"));
    assert!(!serialized.contains("profile_path"));
}

#[test]
fn register_rejects_localhost_private_hosts_and_relaxed_evidence() {
    let mut browser = service();
    for origin in [
        "https://localhost",
        "https://127.0.0.1",
        "https://100.64.0.1",
        "https://[::1]",
        "https://[::ffff:127.0.0.1]",
    ] {
        let mut local_origin = register_input(NOW_MS + 60_000);
        local_origin["allowed_origins"] = json!([origin]);
        assert_eq!(
            handle(
                &mut browser,
                "capability.browser.policy.register",
                local_origin,
            )
            .expect_err("private origin denied"),
            "LOCAL_BROWSER_PRIVATE_ORIGIN_DENIED"
        );
    }

    let mut default_port = register_input(NOW_MS + 60_000);
    default_port["allowed_origins"] = json!(["https://app.example.com:443"]);
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.policy.register",
            default_port,
        )
        .expect_err("default port denied"),
        "INVALID_LOCAL_BROWSER_ORIGIN"
    );

    for start_url in [
        "https://exa mple.com/accounts",
        "https://%20example.com/accounts",
        "https://example.com\\accounts",
        "https://2130706433/accounts",
        "https://0177.0.0.1/accounts",
        "https://0x7f.0.0.1/accounts",
        "https://127.1/accounts",
    ] {
        let mut invalid_host = descriptor_input();
        invalid_host["operation_id"] = json!("99999999-9999-4999-8999-999999999999");
        invalid_host["start_url"] = json!(start_url);
        assert_eq!(
            handle(
                &mut browser,
                "capability.browser.descriptor.admit",
                invalid_host,
            )
            .expect_err("invalid host denied"),
            "INVALID_LOCAL_BROWSER_START_URL"
        );
    }

    let mut relaxed_evidence = register_input(NOW_MS + 60_000);
    relaxed_evidence["evidence_policy"]["screenshot_capture"] = json!("metadata");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.policy.register",
            relaxed_evidence,
        )
        .expect_err("relaxed evidence denied"),
        "INVALID_LOCAL_BROWSER_EVIDENCE_POLICY"
    );
}

#[test]
fn descriptor_rejects_policy_drift_replay_conflict_and_revoked_policy() {
    let mut browser = service();
    handle(
        &mut browser,
        "capability.browser.policy.register",
        register_input(NOW_MS + 60_000),
    )
    .expect("register policy");

    let first = handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("first admit");
    let replayed = handle(
        &mut browser,
        "capability.browser.descriptor.admit",
        descriptor_input(),
    )
    .expect("replay admit");
    assert_eq!(first["browser_descriptor_hash"], EXPECTED_DESCRIPTOR_HASH);
    assert_eq!(replayed["idempotency_replayed"], true);

    let mut drifted = descriptor_input();
    drifted["expected_origin"] = json!("https://reports.example.com");
    drifted["start_url"] = json!("https://reports.example.com/");
    assert_eq!(
        handle(&mut browser, "capability.browser.descriptor.admit", drifted,)
            .expect_err("origin denied"),
        "LOCAL_BROWSER_ORIGIN_POLICY_MISMATCH"
    );

    let mut conflict = descriptor_input();
    conflict["timeout_ms"] = json!(20_000);
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.descriptor.admit",
            conflict,
        )
        .expect_err("idempotency conflict"),
        "LOCAL_BROWSER_IDEMPOTENCY_CONFLICT"
    );

    let mut default_port = descriptor_input();
    default_port["operation_id"] = json!("66666666-6666-4666-8666-666666666666");
    default_port["start_url"] = json!("https://app.example.com:443/accounts");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.descriptor.admit",
            default_port,
        )
        .expect_err("default port denied"),
        "INVALID_LOCAL_BROWSER_START_URL"
    );

    handle(
        &mut browser,
        "capability.browser.policy.revoke",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "55555555-5555-4555-8555-555555555555",
            "policy_handle": POLICY_HANDLE,
            "expected_policy_revision": POLICY_REVISION
        }),
    )
    .expect("revoke policy");
    assert_eq!(
        handle(
            &mut browser,
            "capability.browser.descriptor.admit",
            descriptor_input(),
        )
        .expect_err("revoked policy denied"),
        "LOCAL_BROWSER_POLICY_NOT_ACTIVE"
    );
}

#[test]
fn supervisor_routes_authenticated_browser_commands_without_sensitive_fields() {
    let expires_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_millis() as u64
        + 60_000;
    let mut runtime = SupervisorRuntime::new();
    let registered = runtime.process_request_line(
        &request(
            "capability.browser.policy.register",
            register_input(expires_at_ms),
        ),
        TOKEN,
    );
    assert!(registered.response.ok);
    assert_eq!(
        registered.response.result.expect("result")["execution_enabled"],
        false
    );

    let admitted = runtime.process_request_line(
        &request("capability.browser.descriptor.admit", descriptor_input()),
        TOKEN,
    );
    assert!(admitted.response.ok);
    let result = admitted.response.result.expect("result");
    assert_eq!(result["admission_status"], "validated_no_execution");
    assert_eq!(result["browser_descriptor_hash"], EXPECTED_DESCRIPTOR_HASH);
    let serialized = serde_json::to_string(&result).expect("response json");
    assert!(!serialized.contains("storage_state"));
    assert!(!serialized.contains("cookie"));
    assert!(!serialized.contains("download"));
    assert!(!serialized.contains("screenshot"));
}
