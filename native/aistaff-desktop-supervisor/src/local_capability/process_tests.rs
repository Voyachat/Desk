use super::contracts::LOCAL_CAPABILITY_PROTOCOL_VERSION;
use super::process_contracts::{ProcessTarget, current_process_target};
use super::process_service::{LocalProcessCapabilityCommandHandler, LocalProcessCapabilityService};
use crate::{PROTOCOL_VERSION, SupervisorRuntime};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const NOW_MS: u64 = 1_900_000_000_000;
const POLICY_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const POLICY_REVISION: &str = "22222222-2222-4222-8222-222222222222";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn resource_policy() -> Value {
    json!({
        "schema_version": "aistaff.local-process-resource-policy.v1",
        "cpu_time_limit_ms": 1_000,
        "memory_limit_bytes": 64 * 1024 * 1024,
        "process_count_limit": 4,
        "network_access": "denied",
        "sandbox_profile": "aistaff.restricted-process.v1"
    })
}

struct TestExecutable {
    root: PathBuf,
    path: PathBuf,
}

impl TestExecutable {
    fn new(label: &str, content: &[u8]) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join(format!(
                "local-process-{label}-{}-{sequence}",
                std::process::id()
            ));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("clean exact root");
        }
        std::fs::create_dir_all(&root).expect("create root");
        let file_name = if cfg!(windows) { "tool.exe" } else { "tool" };
        let path = root.join(file_name);
        std::fs::write(&path, content).expect("write fixture");
        make_executable(&path);
        Self { root, path }
    }
}

impl Drop for TestExecutable {
    fn drop(&mut self) {
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root).expect("remove exact root");
        }
    }
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(path, permissions).expect("permissions");
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn target_name() -> &'static str {
    match test_target() {
        super::process_contracts::ProcessTarget::MacosX64 => "macos_x64",
        super::process_contracts::ProcessTarget::MacosArm64 => "macos_arm64",
        super::process_contracts::ProcessTarget::WindowsX64 => "windows_x64",
    }
}

fn test_target() -> ProcessTarget {
    current_process_target().unwrap_or(ProcessTarget::MacosX64)
}

fn native_executable_content() -> Vec<u8> {
    match test_target() {
        ProcessTarget::MacosX64 | ProcessTarget::MacosArm64 => {
            let mut bytes = vec![0_u8; 64];
            bytes[0..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
            let cpu = match test_target() {
                ProcessTarget::MacosX64 => 0x0100_0007_u32,
                ProcessTarget::MacosArm64 => 0x0100_000c_u32,
                ProcessTarget::WindowsX64 => unreachable!(),
            };
            bytes[4..8].copy_from_slice(&cpu.to_le_bytes());
            bytes
        }
        ProcessTarget::WindowsX64 => {
            let mut bytes = vec![0_u8; 128];
            bytes[0..2].copy_from_slice(b"MZ");
            bytes[0x3c..0x40].copy_from_slice(&64_u32.to_le_bytes());
            bytes[64..68].copy_from_slice(b"PE\0\0");
            bytes[68..70].copy_from_slice(&0x8664_u16.to_le_bytes());
            bytes
        }
    }
}

fn scope() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn register_input(path: &Path, executable_sha256: &str) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "33333333-3333-4333-8333-333333333333",
        "policy_handle": POLICY_HANDLE,
        "policy_revision": POLICY_REVISION,
        "scope": scope(),
        "policy_id": "report.generator.v1",
        "action_id": "local.process.generate_report",
        "capability_id": "process.generate_report",
        "executable_path": path.to_str().expect("utf-8 fixture"),
        "expected_executable_sha256": executable_sha256,
        "target": target_name(),
        "fixed_argv": ["--mode", "report"],
        "required_environment_refs": [{
            "name": "REPORT_API_TOKEN",
            "secret_ref": "vault.report_api_token"
        }],
        "working_directory_mode": "required_scoped_directory",
        "side_effect": "mutation",
        "max_timeout_ms": 60_000,
        "max_output_bytes": 32_768,
        "resource_policy": resource_policy(),
        "source": "trusted_policy_port",
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
        "argv": ["--mode", "report"],
        "environment_refs": [{
            "name": "REPORT_API_TOKEN",
            "secret_ref": "vault.report_api_token"
        }],
        "working_directory": {
            "grant_handle": "55555555-5555-4555-8555-555555555555",
            "expected_grant_revision": "66666666-6666-4666-8666-666666666666",
            "relative_segments": ["reports"],
            "target_descriptor_hash": "a".repeat(64)
        },
        "timeout_ms": 30_000,
        "output_limit_bytes": 16_384,
        "resource_policy": resource_policy()
    })
}

fn service() -> LocalProcessCapabilityService {
    LocalProcessCapabilityService::with_clock_and_target(|| NOW_MS, test_target())
}

fn handle(
    service: &mut LocalProcessCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn register(
    service: &mut LocalProcessCapabilityService,
    executable: &TestExecutable,
    content: &[u8],
) -> Value {
    handle(
        service,
        "capability.process.policy.register",
        register_input(&executable.path, &sha256(content)),
    )
    .expect("register policy")
}

#[test]
fn descriptor_admission_binds_policy_without_exposing_sensitive_inputs() {
    let content = native_executable_content();
    let executable = TestExecutable::new("admit", &content);
    let mut broker = service();
    let registered = register(&mut broker, &executable, &content);
    assert_eq!(registered["execution_enabled"], false);
    assert_eq!(registered["policy_status"], "registered");

    let admitted = handle(
        &mut broker,
        "capability.process.descriptor.admit",
        descriptor_input(),
    )
    .expect("descriptor");
    assert_eq!(admitted["admission_status"], "validated_no_execution");
    assert_eq!(admitted["execution_enabled"], false);
    assert_eq!(
        admitted["evidence"]["process_descriptor_hash"],
        admitted["process_descriptor_hash"]
    );
    let serialized = serde_json::to_string(&admitted).expect("serialize");
    for forbidden in [
        executable.path.to_str().expect("path"),
        "--mode",
        "REPORT_API_TOKEN",
        "vault.report_api_token",
        "reports",
    ] {
        assert!(!serialized.contains(forbidden));
    }

    let replay = handle(
        &mut broker,
        "capability.process.descriptor.admit",
        descriptor_input(),
    )
    .expect("replay");
    assert_eq!(replay["idempotency_replayed"], true);
    assert_eq!(
        replay["process_descriptor_hash"],
        admitted["process_descriptor_hash"]
    );
}

#[test]
fn policy_rejects_relative_path_hash_target_and_non_executable_drift() {
    let content = native_executable_content();
    let executable = TestExecutable::new("policy-negatives", &content);
    for (label, input) in [
        (
            "relative",
            register_input(Path::new("relative-tool"), &sha256(&content)),
        ),
        ("hash", register_input(&executable.path, &"f".repeat(64))),
        ("target", {
            let mut input = register_input(&executable.path, &sha256(&content));
            input["target"] = Value::String(
                match target_name() {
                    "windows_x64" => "macos_x64",
                    _ => "windows_x64",
                }
                .to_owned(),
            );
            input
        }),
    ] {
        let mut broker = service();
        assert!(
            handle(&mut broker, "capability.process.policy.register", input).is_err(),
            "{label}"
        );
    }

    let invalid_binary = TestExecutable::new("invalid-binary", b"not a native binary");
    let mut invalid_broker = service();
    assert_eq!(
        handle(
            &mut invalid_broker,
            "capability.process.policy.register",
            register_input(&invalid_binary.path, &sha256(b"not a native binary"))
        ),
        Err("LOCAL_PROCESS_EXECUTABLE_BINARY_TARGET_MISMATCH")
    );

    let mut broker = service();
    register(&mut broker, &executable, &content);
    let mut mutated = content.clone();
    *mutated.last_mut().expect("fixture byte") ^= 1;
    std::fs::write(&executable.path, mutated).expect("mutate");
    make_executable(&executable.path);
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.descriptor.admit",
            descriptor_input()
        ),
        Err("LOCAL_PROCESS_EXECUTABLE_HASH_CHANGED")
    );
}

#[test]
fn descriptor_rejects_scope_revision_argv_environment_cwd_and_budget_drift() {
    let content = native_executable_content();
    let executable = TestExecutable::new("descriptor-negatives", &content);
    let candidates = [
        {
            let mut value = descriptor_input();
            value["scope"]["tenant_id"] = Value::String("tenant-2".to_owned());
            value
        },
        {
            let mut value = descriptor_input();
            value["expected_policy_revision"] =
                Value::String("77777777-7777-4777-8777-777777777777".to_owned());
            value
        },
        {
            let mut value = descriptor_input();
            value["argv"] = json!(["--mode", "shell"]);
            value
        },
        {
            let mut value = descriptor_input();
            value["environment_refs"][0]["name"] = Value::String("OTHER_TOKEN".to_owned());
            value
        },
        {
            let mut value = descriptor_input();
            value["environment_refs"][0]["secret_ref"] =
                Value::String("vault.other_token".to_owned());
            value
        },
        {
            let mut value = descriptor_input();
            value["working_directory"] = Value::Null;
            value
        },
        {
            let mut value = descriptor_input();
            value["resource_policy"]["memory_limit_bytes"] = json!(128 * 1024 * 1024);
            value
        },
        {
            let mut value = descriptor_input();
            value["timeout_ms"] = json!(60_001);
            value
        },
    ];
    for candidate in candidates {
        let mut broker = service();
        register(&mut broker, &executable, &content);
        assert!(
            handle(
                &mut broker,
                "capability.process.descriptor.admit",
                candidate
            )
            .is_err()
        );
    }
}

#[test]
fn revoke_is_revision_bound_idempotent_and_prevents_descriptor_reuse() {
    let content = native_executable_content();
    let executable = TestExecutable::new("revoke", &content);
    let mut broker = service();
    register(&mut broker, &executable, &content);
    let revoke = json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "77777777-7777-4777-8777-777777777777",
        "policy_handle": POLICY_HANDLE,
        "expected_policy_revision": POLICY_REVISION
    });
    let first = handle(
        &mut broker,
        "capability.process.policy.revoke",
        revoke.clone(),
    )
    .expect("revoke");
    assert_eq!(first["revoke_status"], "revoked");
    let replay = handle(&mut broker, "capability.process.policy.revoke", revoke).expect("replay");
    assert_eq!(replay["idempotency_replayed"], true);
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.descriptor.admit",
            descriptor_input()
        ),
        Err("LOCAL_PROCESS_POLICY_NOT_ACTIVE")
    );
}

#[cfg(unix)]
#[test]
fn symlinked_executable_and_missing_execute_bit_fail_closed() {
    use std::os::unix::fs::{PermissionsExt, symlink};

    let content = native_executable_content();
    let executable = TestExecutable::new("symlink", &content);
    let link = executable.root.join("linked-tool");
    symlink(&executable.path, &link).expect("symlink");
    let mut broker = service();
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.policy.register",
            register_input(&link, &sha256(&content))
        ),
        Err("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED")
    );

    let mut permissions = std::fs::metadata(&executable.path)
        .expect("metadata")
        .permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(&executable.path, permissions).expect("permissions");
    let mut broker = service();
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.policy.register",
            register_input(&executable.path, &sha256(&content))
        ),
        Err("LOCAL_PROCESS_EXECUTABLE_TYPE_REJECTED")
    );
}

#[test]
fn unknown_fields_and_secret_values_are_rejected_before_admission() {
    let content = native_executable_content();
    let executable = TestExecutable::new("strict", &content);
    let mut broker = service();
    let mut registration = register_input(&executable.path, &sha256(&content));
    registration["shell"] = Value::String("/bin/sh".to_owned());
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.policy.register",
            registration
        ),
        Err("INVALID_LOCAL_PROCESS_PAYLOAD")
    );

    register(&mut broker, &executable, &content);
    let mut descriptor = descriptor_input();
    descriptor["environment_refs"][0]["value"] = Value::String("forbidden-secret".to_owned());
    assert_eq!(
        handle(
            &mut broker,
            "capability.process.descriptor.admit",
            descriptor
        ),
        Err("INVALID_LOCAL_PROCESS_PAYLOAD")
    );
}

#[test]
fn authenticated_supervisor_router_keeps_executable_path_private() {
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
    let content = native_executable_content();
    let executable = TestExecutable::new("router", &content);
    let mut payload = register_input(&executable.path, &sha256(&content));
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_millis() as u64;
    payload["expires_at_ms"] = json!(now_ms + 60_000);
    let request = serde_json::to_vec(&json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "process-request-1",
        "auth_token": TOKEN,
        "command": "capability.process.policy.register",
        "payload": payload
    }))
    .expect("request");
    let mut runtime = SupervisorRuntime::new();
    runtime.local_process_capability = Box::new(
        LocalProcessCapabilityService::with_clock_and_target(move || now_ms, test_target()),
    );
    let processed = runtime.process_request_line(&request, TOKEN);

    assert!(processed.response.ok);
    let serialized = serde_json::to_string(&processed.response).expect("response");
    assert!(!serialized.contains(executable.path.to_str().expect("path")));
    assert_eq!(
        processed.response.result.expect("result")["execution_enabled"],
        false
    );
}
