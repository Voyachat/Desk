use super::contracts::{
    AdmissionStatus, CapabilityScope, LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError,
};
use super::file_grant_registry::SharedFileGrantRegistry;
use super::file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
use super::process_contracts::ProcessEnvironmentRef;
use super::process_execution_context::{
    FileGrantProcessExecutionContextProvider, ProcessSecretMaterializationPort,
};
use super::process_execution_test_support::{
    CONTEXT_FIXTURE, NOW_MS, OPERATION_ID, POLICY_HANDLE, POLICY_REVISION, TEST_SECRET, TestRoot,
    sha256, target_name, test_resource_policy, test_target,
};
use super::process_service::{LocalProcessCapabilityCommandHandler, LocalProcessCapabilityService};
use serde_json::{Value, json};
use zeroize::Zeroizing;

const GRANT_HANDLE: &str = "55555555-5555-4555-8555-555555555555";
const GRANT_REVISION: &str = "66666666-6666-4666-8666-666666666666";

struct IntegratedContextFixture {
    process_service: LocalProcessCapabilityService,
    file_service: LocalFileCapabilityService,
    process_descriptor_hash: String,
    cwd_descriptor_hash: String,
    _root: TestRoot,
}

struct TestProcessSecretStore;

impl ProcessSecretMaterializationPort for TestProcessSecretStore {
    fn materialize(
        &self,
        scope: &CapabilityScope,
        reference: &ProcessEnvironmentRef,
    ) -> Result<Zeroizing<String>, LocalCapabilityError> {
        if scope != &scope_value()
            || reference.name != "PROCESS_TEST_TOKEN"
            || reference.secret_ref != "vault.process_test_token"
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_TEST_SECRET_BINDING_MISMATCH",
            ));
        }
        Ok(Zeroizing::new(TEST_SECRET.to_owned()))
    }
}

fn scope_value() -> CapabilityScope {
    CapabilityScope {
        tenant_id: "tenant-1".to_owned(),
        session_id: "session-1".to_owned(),
        run_id: "run-1".to_owned(),
    }
}

fn scope_json() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn file_handle(
    service: &mut LocalFileCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn process_handle(
    service: &mut LocalProcessCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn descriptor_input(cwd_descriptor_hash: &str) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": OPERATION_ID,
        "policy_handle": POLICY_HANDLE,
        "expected_policy_revision": POLICY_REVISION,
        "scope": scope_json(),
        "argv": ["--ignored", "--exact", CONTEXT_FIXTURE, "--nocapture"],
        "environment_refs": [{
            "name": "PROCESS_TEST_TOKEN",
            "secret_ref": "vault.process_test_token"
        }],
        "working_directory": {
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION,
            "relative_segments": ["cwd"],
            "target_descriptor_hash": cwd_descriptor_hash
        },
        "timeout_ms": 2_000,
        "output_limit_bytes": 16_384,
        "resource_policy": test_resource_policy()
    })
}

fn start_input(process_descriptor_hash: &str, cwd_descriptor_hash: &str) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "capability_request": {
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "scope": scope_json(),
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
        "descriptor_request": descriptor_input(cwd_descriptor_hash),
        "expected_process_descriptor_hash": process_descriptor_hash
    })
}

fn register_shared_grant_and_admit_cwd(
    file_service: &mut LocalFileCapabilityService,
    root: &TestRoot,
) -> String {
    file_handle(
        file_service,
        "capability.file.grant.register",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "grant_handle": GRANT_HANDLE,
            "grant_revision": GRANT_REVISION,
            "scope": scope_json(),
            "root_path": root.root.to_str().expect("utf8 root"),
            "access": "read_only",
            "allowed_intents": ["metadata_read"],
            "source": "system_directory_picker",
            "expires_at_ms": NOW_MS + 60_000
        }),
    )
    .expect("register shared grant");
    let cwd_admission = file_handle(
        file_service,
        "capability.file.path.admit",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION,
            "scope": scope_json(),
            "intent": "metadata_read",
            "relative_segments": ["cwd"],
            "max_bytes": null
        }),
    )
    .expect("admit shared cwd");
    cwd_admission["target_descriptor_hash"]
        .as_str()
        .expect("cwd descriptor hash")
        .to_owned()
}

fn integrated_context_fixture() -> IntegratedContextFixture {
    let root = TestRoot::new();
    let grant_registry = SharedFileGrantRegistry::new();
    let mut file_service =
        LocalFileCapabilityService::with_clock_and_registry(|| NOW_MS, grant_registry.clone());
    let cwd_descriptor_hash = register_shared_grant_and_admit_cwd(&mut file_service, &root);
    let context_provider = FileGrantProcessExecutionContextProvider::new(
        grant_registry,
        Box::new(TestProcessSecretStore),
        || NOW_MS,
    );
    let mut process_service = LocalProcessCapabilityService::with_test_execution(
        || NOW_MS,
        test_target(),
        std::env::current_exe().expect("test executable"),
        Box::new(context_provider),
    );
    let executable_bytes = std::fs::read(&root.executable).expect("read executable");
    process_handle(
        &mut process_service,
        "capability.process.policy.register",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "policy_handle": POLICY_HANDLE,
            "policy_revision": POLICY_REVISION,
            "scope": scope_json(),
            "policy_id": "report.generator.v1",
            "action_id": "local.process.generate_report",
            "capability_id": "process.generate_report",
            "executable_path": root.executable.to_str().expect("utf8 executable"),
            "expected_executable_sha256": sha256(&executable_bytes),
            "target": target_name(),
            "fixed_argv": ["--ignored", "--exact", CONTEXT_FIXTURE, "--nocapture"],
            "required_environment_refs": [{
                "name": "PROCESS_TEST_TOKEN",
                "secret_ref": "vault.process_test_token"
            }],
            "working_directory_mode": "required_scoped_directory",
            "side_effect": "read_only",
            "max_timeout_ms": 2_000,
            "max_output_bytes": 16_384,
            "resource_policy": test_resource_policy(),
            "source": "trusted_policy_port",
            "expires_at_ms": NOW_MS + 60_000
        }),
    )
    .expect("register process policy");
    let process_admission = process_handle(
        &mut process_service,
        "capability.process.descriptor.admit",
        descriptor_input(&cwd_descriptor_hash),
    )
    .expect("admit process descriptor");
    IntegratedContextFixture {
        process_service,
        file_service,
        process_descriptor_hash: process_admission["process_descriptor_hash"]
            .as_str()
            .expect("process descriptor hash")
            .to_owned(),
        cwd_descriptor_hash,
        _root: root,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn reconcile_until_terminal(
    service: &mut LocalProcessCapabilityService,
    request_hash: &str,
) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let result = process_handle(
            service,
            "capability.process.execution.reconcile",
            json!({
                "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
                "operation_id": OPERATION_ID,
                "request_hash": request_hash,
                "observed_side_effect_state": "none"
            }),
        )
        .expect("reconcile shared context execution");
        if result["execution_state"] != "running" {
            return result;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "shared context process timed out"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn process_execution_uses_shared_grant_and_secret_ports_end_to_end() {
    let mut fixture = integrated_context_fixture();
    let started = process_handle(
        &mut fixture.process_service,
        "capability.process.execution.start",
        start_input(
            &fixture.process_descriptor_hash,
            &fixture.cwd_descriptor_hash,
        ),
    )
    .expect("start with shared context");
    let terminal = reconcile_until_terminal(
        &mut fixture.process_service,
        started["request_hash"].as_str().expect("request hash"),
    );
    assert_eq!(terminal["execution_state"], "completed");
    let stdout = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        terminal["stdout_base64"].as_str().expect("stdout base64"),
    )
    .expect("decode stdout");
    let stdout_text = String::from_utf8_lossy(&stdout);
    assert!(stdout_text.contains("cwd-marker=present"));
    assert!(!stdout_text.contains(TEST_SECRET));
    assert!(stdout_text.contains(&"*".repeat(TEST_SECRET.len())));
}

#[test]
fn grant_revoke_after_process_admission_blocks_spawn() {
    let mut fixture = integrated_context_fixture();
    file_handle(
        &mut fixture.file_service,
        "capability.file.grant.revoke",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION
        }),
    )
    .expect("revoke after process admission");
    assert_eq!(
        process_handle(
            &mut fixture.process_service,
            "capability.process.execution.start",
            start_input(
                &fixture.process_descriptor_hash,
                &fixture.cwd_descriptor_hash,
            )
        ),
        Err("LOCAL_FILE_GRANT_NOT_ACTIVE")
    );
    assert!(fixture.process_service.execution_records.is_empty());
}
