use super::contracts::{CapabilityScope, SideEffectClass};
use super::process_contracts::{ProcessEnvironmentRef, ProcessTarget, ProcessWorkingDirectoryRef};
use super::process_execution_test_support::test_resource_policy;
use super::process_resource_policy::ProcessResourcePolicy;
use serde::Serialize;
use sha2::{Digest, Sha256};

const POLICY_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const POLICY_REVISION: &str = "22222222-2222-4222-8222-222222222222";

#[derive(Serialize)]
struct ProcessDescriptorHashFixture {
    schema_version: &'static str,
    policy_handle: &'static str,
    policy_revision: &'static str,
    scope: CapabilityScope,
    policy_id: &'static str,
    action_id: &'static str,
    capability_id: &'static str,
    target: ProcessTarget,
    side_effect: SideEffectClass,
    executable_sha256: String,
    executable_fingerprint: String,
    argv: Vec<String>,
    environment_refs: Vec<ProcessEnvironmentRef>,
    working_directory: ProcessWorkingDirectoryRef,
    timeout_ms: u64,
    output_limit_bytes: u64,
    resource_policy: ProcessResourcePolicy,
}

#[test]
fn descriptor_hash_serialization_matches_main_fixture() {
    let fixture = ProcessDescriptorHashFixture {
        schema_version: "aistaff.local-process-descriptor.v2",
        policy_handle: POLICY_HANDLE,
        policy_revision: POLICY_REVISION,
        scope: CapabilityScope {
            tenant_id: "tenant-1".to_owned(),
            session_id: "session-1".to_owned(),
            run_id: "run-1".to_owned(),
        },
        policy_id: "report.generator.v1",
        action_id: "local.process.generate_report",
        capability_id: "process.generate_report",
        target: ProcessTarget::MacosX64,
        side_effect: SideEffectClass::Mutation,
        executable_sha256: "a".repeat(64),
        executable_fingerprint: "b".repeat(64),
        argv: vec!["--mode".to_owned(), "report".to_owned()],
        environment_refs: vec![ProcessEnvironmentRef {
            name: "REPORT_API_TOKEN".to_owned(),
            secret_ref: "vault.report_api_token".to_owned(),
        }],
        working_directory: ProcessWorkingDirectoryRef {
            grant_handle: "55555555-5555-4555-8555-555555555555".to_owned(),
            expected_grant_revision: "66666666-6666-4666-8666-666666666666".to_owned(),
            relative_segments: vec!["reports".to_owned()],
            target_descriptor_hash: "c".repeat(64),
        },
        timeout_ms: 30_000,
        output_limit_bytes: 16_384,
        resource_policy: test_resource_policy(),
    };
    let encoded = serde_json::to_vec(&fixture).expect("fixture");
    let digest = Sha256::digest(encoded);
    let digest_hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(
        digest_hex,
        "33b0b03c192c764c8404dcec0890ed9a47159ff0545a9f2a079180e55773d625"
    );
}
