use super::contracts::{LOCAL_CAPABILITY_PROTOCOL_VERSION, PolicyDecision};
use super::service::{LocalCapabilityBrokerService, LocalCapabilityCommandHandler};
use serde_json::{Value, json};

const NOW_MS: u64 = 1_900_000_000_000;

fn fixed_now_ms() -> u64 {
    NOW_MS
}

fn request() -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "scope": {
            "tenant_id": "tenant-1",
            "session_id": "session-1",
            "run_id": "run-1"
        },
        "authorization": {
            "tenant_id": "tenant-1",
            "source_decision_id": "decision-1",
            "outcome": "allow",
            "action_id": "local.file.read",
            "capability_id": "file.read",
            "resource_revision": "revision-1",
            "policy_revision": "policy-1",
            "audit_ref": "audit-1",
            "expires_at_ms": 2_000_000_000_000_u64
        },
        "artifact": {
            "artifact_id": "artifact-1",
            "artifact_version": "1.0.0",
            "artifact_sha256":
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "admission_status": "verified"
        },
        "operation": {
            "operation_id": "11111111-1111-4111-8111-111111111111",
            "idempotency_key": "22222222-2222-4222-8222-222222222222",
            "action_id": "local.file.read",
            "capability_id": "file.read",
            "expected_revision": "revision-1",
            "adapter_kind": "file",
            "side_effect": "read_only",
            "risk_level": "low",
            "descriptor_hash":
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "confirmation": "not_required"
        }
    })
}

fn service() -> LocalCapabilityBrokerService {
    LocalCapabilityBrokerService::with_clock(fixed_now_ms)
}

fn handle(
    service: &mut LocalCapabilityBrokerService,
    command: &str,
    payload: Option<Value>,
) -> Value {
    service
        .handle(command, payload)
        .expect("command should succeed")
}

#[test]
fn advertises_policy_only_with_path_admission_but_no_execution() {
    let result = handle(&mut service(), "capability.capabilities", None);

    assert_eq!(result["availability"], "policy_only");
    assert_eq!(result["execution_enabled"], false);
    assert_eq!(result["adapters"].as_array().map(Vec::len), Some(5));
    for adapter in result["adapters"].as_array().expect("adapters") {
        let kind = adapter["adapter_kind"].as_str().expect("kind");
        if kind == "file" || kind == "directory" {
            assert_eq!(adapter["availability"], "path_admission_only");
            assert_eq!(adapter["reason_code"], "LOCAL_FILE_PATH_ADMISSION_ONLY");
        } else {
            assert_eq!(adapter["availability"], "adapter_unavailable");
            assert_eq!(adapter["reason_code"], "CAPABILITY_ADAPTER_UNAVAILABLE");
        }
    }
}

#[test]
fn valid_envelope_remains_denied_when_adapter_is_unavailable() {
    let result = handle(&mut service(), "capability.evaluate", Some(request()));

    assert_eq!(result["decision"], "deny");
    assert_eq!(result["reason_code"], "CAPABILITY_ADAPTER_UNAVAILABLE");
    assert_eq!(result["execution_state"], "not_executed");
    assert_eq!(result["evidence"]["side_effect_state"], "none");
    assert_eq!(result["evidence"]["redaction_profile"], "metadata_only.v1");
    assert_eq!(
        result["request_hash"],
        "8ac20de07676c9cb0a97bc290b1910f86d837f5c89cccb246021d600273725cc"
    );
}

#[test]
fn fail_closed_policy_rejects_forged_scope_and_authorization() {
    let cases = [
        (
            "/authorization/tenant_id",
            json!("tenant-2"),
            "CAPABILITY_TENANT_SCOPE_MISMATCH",
        ),
        (
            "/authorization/action_id",
            json!("local.file.write"),
            "CAPABILITY_ACTION_SCOPE_MISMATCH",
        ),
        (
            "/authorization/capability_id",
            json!("file.write"),
            "CAPABILITY_ID_SCOPE_MISMATCH",
        ),
        (
            "/authorization/resource_revision",
            json!("revision-2"),
            "CAPABILITY_REVISION_SCOPE_MISMATCH",
        ),
        (
            "/authorization/outcome",
            json!("require_approval"),
            "CAPABILITY_DECISION_NOT_ALLOWED",
        ),
        (
            "/artifact/admission_status",
            json!("unverified"),
            "CAPABILITY_ARTIFACT_NOT_VERIFIED",
        ),
    ];

    for (pointer, replacement, expected_reason) in cases {
        let mut payload = request();
        *payload
            .pointer_mut(pointer)
            .expect("fixture pointer must exist") = replacement;
        let result = handle(&mut service(), "capability.evaluate", Some(payload));
        assert_eq!(
            result["reason_code"], expected_reason,
            "failed case {pointer}"
        );
        assert_eq!(result["execution_state"], "not_executed");
    }

    let mut expired = request();
    expired["authorization"]["expires_at_ms"] = json!(NOW_MS);
    assert_eq!(
        handle(&mut service(), "capability.evaluate", Some(expired))["reason_code"],
        "CAPABILITY_AUTHORIZATION_EXPIRED"
    );
}

#[test]
fn mutation_and_high_risk_require_explicit_confirmation() {
    for (pointer, value) in [
        ("/operation/side_effect", json!("mutation")),
        ("/operation/risk_level", json!("high")),
        ("/operation/risk_level", json!("critical")),
    ] {
        let mut payload = request();
        *payload
            .pointer_mut(pointer)
            .expect("fixture pointer must exist") = value;
        payload["operation"]["confirmation"] = json!("missing");
        let result = handle(&mut service(), "capability.evaluate", Some(payload));
        assert_eq!(
            result["decision"],
            serde_json::to_value(PolicyDecision::RequireConfirmation).expect("decision")
        );
        assert_eq!(result["reason_code"], "CAPABILITY_CONFIRMATION_REQUIRED");
        assert_eq!(result["execution_state"], "not_executed");
    }
}

#[test]
fn idempotency_replays_same_hash_and_denies_key_reuse() {
    let mut broker = service();
    let first = handle(&mut broker, "capability.evaluate", Some(request()));
    let replay = handle(&mut broker, "capability.evaluate", Some(request()));
    assert_eq!(replay["request_hash"], first["request_hash"]);
    assert_eq!(replay["reason_code"], first["reason_code"]);
    assert_eq!(replay["idempotency_replayed"], true);

    let mut conflict = request();
    conflict["operation"]["descriptor_hash"] =
        json!("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    let denied = handle(&mut broker, "capability.evaluate", Some(conflict));
    assert_eq!(denied["decision"], "deny");
    assert_eq!(denied["reason_code"], "CAPABILITY_IDEMPOTENCY_CONFLICT");
    assert_eq!(denied["execution_state"], "not_executed");
}

#[test]
fn idempotency_ledger_is_bounded_and_evicted_entries_are_not_claimed_as_replays() {
    let mut broker = service();
    for index in 0_u64..=128 {
        let mut payload = request();
        payload["operation"]["operation_id"] =
            json!(format!("00000000-0000-4000-8000-{index:012x}"));
        payload["operation"]["idempotency_key"] =
            json!(format!("10000000-0000-4000-8000-{index:012x}"));
        assert_eq!(
            handle(&mut broker, "capability.evaluate", Some(payload))["idempotency_replayed"],
            false
        );
    }

    let mut evicted = request();
    evicted["operation"]["operation_id"] = json!("00000000-0000-4000-8000-000000000000");
    evicted["operation"]["idempotency_key"] = json!("10000000-0000-4000-8000-000000000000");
    assert_eq!(
        handle(&mut broker, "capability.evaluate", Some(evicted))["idempotency_replayed"],
        false
    );
}

#[test]
fn rejects_sensitive_payload_unknown_fields_and_missing_audit_reference() {
    for field in ["path", "argv", "url", "mcp_payload", "secret", "token"] {
        let mut payload = request();
        payload["operation"][field] = json!("forbidden");
        let error = service()
            .handle("capability.evaluate", Some(payload))
            .expect_err("unknown field must fail closed");
        assert_eq!(error.code, "INVALID_LOCAL_CAPABILITY_COMMAND_PAYLOAD");
    }

    let mut missing_audit = request();
    missing_audit["authorization"]
        .as_object_mut()
        .expect("authorization")
        .remove("audit_ref");
    assert_eq!(
        service()
            .handle("capability.evaluate", Some(missing_audit))
            .expect_err("missing audit must fail closed")
            .code,
        "INVALID_LOCAL_CAPABILITY_COMMAND_PAYLOAD"
    );
}

#[test]
fn cancel_and_reconcile_never_claim_execution_or_retry() {
    let mut broker = service();
    let evaluated = handle(&mut broker, "capability.evaluate", Some(request()));
    let request_hash = evaluated["request_hash"].as_str().expect("request hash");

    let cancel = handle(
        &mut broker,
        "capability.cancel",
        Some(json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "11111111-1111-4111-8111-111111111111",
            "reason": "user_requested"
        })),
    );
    assert_eq!(cancel["cancel_status"], "not_running");
    assert_eq!(cancel["execution_state"], "not_executed");

    let unknown = handle(
        &mut broker,
        "capability.reconcile",
        Some(json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "11111111-1111-4111-8111-111111111111",
            "request_hash": request_hash,
            "observed_side_effect_state": "unknown"
        })),
    );
    assert_eq!(unknown["decision"], "require_handoff");
    assert_eq!(unknown["reason_code"], "CAPABILITY_SIDE_EFFECT_UNKNOWN");

    let missing = handle(
        &mut broker,
        "capability.reconcile",
        Some(json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "33333333-3333-4333-8333-333333333333",
            "request_hash":
                "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "observed_side_effect_state": "none"
        })),
    );
    assert_eq!(missing["decision"], "require_reconcile");
}
