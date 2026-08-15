use super::capability_hash::hash_value;
use super::contracts::{AdmissionStatus, LOCAL_CAPABILITY_PROTOCOL_VERSION};
use super::process_execution_contracts::ProcessExecutionStartInput;
use super::process_execution_test_support::{OPERATION_ID, POLICY_HANDLE, POLICY_REVISION};
use serde_json::json;

#[test]
fn start_request_hash_matches_the_main_process_canonical_fixture() {
    let input: ProcessExecutionStartInput = serde_json::from_value(json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "capability_request": {
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
                "action_id": "local.process.generate_report",
                "capability_id": "process.generate_report",
                "resource_revision": "resource-v1",
                "policy_revision": "policy-v1",
                "audit_ref": "audit-1",
                "expires_at_ms": 1_900_000_060_000_u64
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
                "descriptor_hash": "d".repeat(64),
                "confirmation": "not_required"
            }
        },
        "descriptor_request": {
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": OPERATION_ID,
            "policy_handle": POLICY_HANDLE,
            "expected_policy_revision": POLICY_REVISION,
            "scope": {
                "tenant_id": "tenant-1",
                "session_id": "session-1",
                "run_id": "run-1"
            },
            "argv": ["--mode", "report"],
            "environment_refs": [],
            "working_directory": null,
            "timeout_ms": 30_000,
            "output_limit_bytes": 16_384,
            "resource_policy": {
                "schema_version": "aistaff.local-process-resource-policy.v1",
                "cpu_time_limit_ms": 1_000,
                "memory_limit_bytes": 67_108_864,
                "process_count_limit": 4,
                "network_access": "denied",
                "sandbox_profile": "aistaff.restricted-process.v1"
            }
        },
        "expected_process_descriptor_hash": "d".repeat(64)
    }))
    .expect("parse canonical fixture");
    assert_eq!(
        hash_value(&input).expect("hash fixture"),
        "16ccd70bd65ea390b56af4ad85d843e860aafe311cc2a68d2b4e6485743f8322"
    );
}
