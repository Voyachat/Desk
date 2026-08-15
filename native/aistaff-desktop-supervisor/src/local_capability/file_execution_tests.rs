use super::capability_hash::hash_value;
use super::contracts::LOCAL_CAPABILITY_PROTOCOL_VERSION;
use super::file_execution_contracts::{FileReadExecutionInput, LOCAL_FILE_MAX_READ_OUTPUT_BYTES};
use super::file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const NOW_MS: u64 = 1_900_000_000_000;
const GRANT_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const GRANT_REVISION: &str = "22222222-2222-4222-8222-222222222222";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestRoot(PathBuf);

impl TestRoot {
    fn new(label: &str) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join(format!(
                "local-file-execution-{label}-{}-{sequence}",
                std::process::id()
            ));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("clean exact root");
        }
        std::fs::create_dir_all(&root).expect("create root");
        Self(root)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        if self.0.exists() {
            std::fs::remove_dir_all(&self.0).expect("remove exact root");
        }
    }
}

fn service(enabled: bool) -> LocalFileCapabilityService {
    if enabled {
        LocalFileCapabilityService::with_clock_and_synthetic_execution(|| NOW_MS)
    } else {
        LocalFileCapabilityService::with_clock(|| NOW_MS)
    }
}

fn handle(
    service: &mut LocalFileCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn register(service: &mut LocalFileCapabilityService, root: &Path) {
    handle(
        service,
        "capability.file.grant.register",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "33333333-3333-4333-8333-333333333333",
            "grant_handle": GRANT_HANDLE,
            "grant_revision": GRANT_REVISION,
            "scope": scope(),
            "root_path": root.to_str().expect("utf-8 root"),
            "access": "read_only",
            "allowed_intents": ["read_file", "list_directory"],
            "source": "system_directory_picker",
            "expires_at_ms": NOW_MS + 60_000
        }),
    )
    .expect("register");
}

fn scope() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn path_request(
    operation_id: &str,
    intent: &str,
    segments: &[&str],
    max_bytes: Option<u64>,
) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": operation_id,
        "grant_handle": GRANT_HANDLE,
        "expected_grant_revision": GRANT_REVISION,
        "scope": scope(),
        "intent": intent,
        "relative_segments": segments,
        "max_bytes": max_bytes
    })
}

fn descriptor(service: &mut LocalFileCapabilityService, path_request: &Value) -> String {
    handle(
        service,
        "capability.file.path.admit",
        path_request.clone(),
    )
    .expect("path admission")["target_descriptor_hash"]
        .as_str()
        .expect("descriptor")
        .to_owned()
}

fn capability_request(
    operation_id: &str,
    idempotency_key: &str,
    adapter: &str,
    descriptor: &str,
) -> Value {
    let (action_id, capability_id) = if adapter == "file" {
        ("local.file.read", "file.read")
    } else {
        ("local.directory.list", "directory.list")
    };
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "scope": scope(),
        "authorization": {
            "tenant_id": "tenant-1",
            "source_decision_id": "decision-1",
            "outcome": "allow",
            "action_id": action_id,
            "capability_id": capability_id,
            "resource_revision": "revision-1",
            "policy_revision": "policy-1",
            "audit_ref": "audit-1",
            "expires_at_ms": NOW_MS + 30_000
        },
        "artifact": {
            "artifact_id": "artifact-1",
            "artifact_version": "1.0.0",
            "artifact_sha256": "a".repeat(64),
            "admission_status": "verified"
        },
        "operation": {
            "operation_id": operation_id,
            "idempotency_key": idempotency_key,
            "action_id": action_id,
            "capability_id": capability_id,
            "expected_revision": "revision-1",
            "adapter_kind": adapter,
            "side_effect": "read_only",
            "risk_level": "low",
            "descriptor_hash": descriptor,
            "confirmation": "not_required"
        }
    })
}

fn read_input(
    operation_id: &str,
    idempotency_key: &str,
    path_request: Value,
    descriptor: &str,
) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "capability_request":
            capability_request(operation_id, idempotency_key, "file", descriptor),
        "path_request": path_request,
        "expected_target_descriptor_hash": descriptor
    })
}

#[test]
fn contract_request_hash_matches_typescript_canonical_fixture() {
    let input: FileReadExecutionInput = serde_json::from_value(json!({
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
                "artifact_sha256": "b".repeat(64),
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
                "descriptor_hash": "a".repeat(64),
                "confirmation": "not_required"
            }
        },
        "path_request": {
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "11111111-1111-4111-8111-111111111111",
            "grant_handle": "33333333-3333-4333-8333-333333333333",
            "expected_grant_revision": "44444444-4444-4444-8444-444444444444",
            "scope": {
                "tenant_id": "tenant-1",
                "session_id": "session-1",
                "run_id": "run-1"
            },
            "intent": "read_file",
            "relative_segments": ["reports", "summary.bin"],
            "max_bytes": LOCAL_FILE_MAX_READ_OUTPUT_BYTES
        },
        "expected_target_descriptor_hash": "a".repeat(64)
    }))
    .expect("canonical fixture");

    assert_eq!(
        hash_value(&input).expect("request hash"),
        "5ecbb623cd2528cf667214248c49f364d39bb9f9f81173e3d8d40afe48a9d0d4"
    );
}

#[test]
fn production_constructor_rejects_content_execution() {
    let root = TestRoot::new("disabled");
    std::fs::write(root.path().join("read.txt"), b"private").expect("fixture");
    let operation_id = "44444444-4444-4444-8444-444444444444";
    let idempotency_key = "55555555-5555-4555-8555-555555555555";
    let mut broker = service(false);
    register(&mut broker, root.path());
    let path = path_request(operation_id, "read_file", &["read.txt"], Some(128));
    let descriptor = descriptor(&mut broker, &path);

    assert_eq!(
        handle(
            &mut broker,
            "capability.file.read",
            read_input(operation_id, idempotency_key, path, &descriptor),
        ),
        Err("LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED")
    );
}

#[test]
fn synthetic_read_is_bounded_descriptor_bound_and_path_private() {
    let root = TestRoot::new("read");
    let content = vec![0xa5; LOCAL_FILE_MAX_READ_OUTPUT_BYTES as usize];
    std::fs::write(root.path().join("read.bin"), &content).expect("fixture");
    let operation_id = "44444444-4444-4444-8444-444444444444";
    let idempotency_key = "55555555-5555-4555-8555-555555555555";
    let mut broker = service(true);
    register(&mut broker, root.path());
    let path = path_request(
        operation_id,
        "read_file",
        &["read.bin"],
        Some(LOCAL_FILE_MAX_READ_OUTPUT_BYTES),
    );
    let target_descriptor = descriptor(&mut broker, &path);
    let result = handle(
        &mut broker,
        "capability.file.read",
        read_input(operation_id, idempotency_key, path, &target_descriptor),
    )
    .expect("read");

    assert_eq!(result["execution_state"], "completed");
    assert_eq!(result["side_effect_state"], "none");
    assert_eq!(result["content_encoding"], "base64");
    assert_eq!(
        STANDARD
            .decode(result["content_base64"].as_str().expect("base64"))
            .expect("decode"),
        content
    );
    assert_eq!(result["bytes_read"], content.len() as u64);
    assert_eq!(result["evidence"]["cloud_audit_ref"], "audit-1");
    assert!(result["evidence"].get("content_base64").is_none());
    let serialized = serde_json::to_string(&result).expect("result");
    assert!(serialized.len() < 64 * 1024);
    assert!(!serialized.contains(root.path().to_str().expect("root")));
    assert!(!serialized.contains("read.bin"));
}

#[test]
fn idempotent_read_replays_only_unchanged_output_and_reconcile_is_hash_only() {
    let root = TestRoot::new("replay");
    let file = root.path().join("read.bin");
    std::fs::write(&file, b"first").expect("fixture");
    let operation_id = "44444444-4444-4444-8444-444444444444";
    let idempotency_key = "55555555-5555-4555-8555-555555555555";
    let mut broker = service(true);
    register(&mut broker, root.path());
    let path = path_request(operation_id, "read_file", &["read.bin"], Some(64));
    let target_descriptor = descriptor(&mut broker, &path);
    let input = read_input(
        operation_id,
        idempotency_key,
        path.clone(),
        &target_descriptor,
    );
    let first = handle(&mut broker, "capability.file.read", input.clone()).expect("first");
    let replay = handle(&mut broker, "capability.file.read", input.clone()).expect("replay");
    assert_eq!(replay["idempotency_replayed"], true);

    let reconciliation = handle(
        &mut broker,
        "capability.file.execution.reconcile",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": operation_id,
            "request_hash": first["request_hash"],
            "observed_execution_state": "unknown"
        }),
    )
    .expect("reconcile");
    assert_eq!(reconciliation["decision"], "confirmed_evidence_only");
    assert_eq!(reconciliation["output_sha256"], first["content_sha256"]);
    assert!(reconciliation.get("content_base64").is_none());

    std::fs::write(&file, b"other").expect("same-size mutation");
    assert_eq!(
        handle(&mut broker, "capability.file.read", input),
        Err("LOCAL_FILE_EXECUTION_REPLAY_OUTPUT_CHANGED")
    );
}

#[test]
fn directory_list_is_sorted_bounded_and_does_not_follow_symlinks() {
    let root = TestRoot::new("list");
    let reports = root.path().join("reports");
    std::fs::create_dir_all(reports.join("nested")).expect("nested");
    std::fs::write(reports.join("b.txt"), b"bb").expect("b");
    std::fs::write(reports.join("a.txt"), b"a").expect("a");
    #[cfg(unix)]
    std::os::unix::fs::symlink("/etc/passwd", reports.join("outside-link"))
        .expect("symlink fixture");
    let operation_id = "66666666-6666-4666-8666-666666666666";
    let idempotency_key = "77777777-7777-4777-8777-777777777777";
    let mut broker = service(true);
    register(&mut broker, root.path());
    let path = path_request(operation_id, "list_directory", &["reports"], None);
    let target_descriptor = descriptor(&mut broker, &path);
    let result = handle(
        &mut broker,
        "capability.directory.list",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "capability_request":
                capability_request(operation_id, idempotency_key, "directory", &target_descriptor),
            "path_request": path,
            "expected_target_descriptor_hash": target_descriptor,
            "max_entries": 2
        }),
    )
    .expect("list");

    assert_eq!(result["execution_state"], "completed");
    assert_eq!(result["truncated"], true);
    assert_eq!(result["entries"][0]["name"], "a.txt");
    assert_eq!(result["entries"][1]["name"], "b.txt");
    let serialized = serde_json::to_string(&result).expect("result");
    assert!(!serialized.contains(root.path().to_str().expect("root")));
    assert!(!serialized.contains("/etc/passwd"));
}

#[test]
fn authorization_descriptor_and_unknown_reconciliation_fail_closed() {
    let root = TestRoot::new("denials");
    std::fs::write(root.path().join("read.bin"), b"private").expect("fixture");
    let operation_id = "44444444-4444-4444-8444-444444444444";
    let idempotency_key = "55555555-5555-4555-8555-555555555555";
    let mut broker = service(true);
    register(&mut broker, root.path());
    let path = path_request(operation_id, "read_file", &["read.bin"], Some(64));
    let target_descriptor = descriptor(&mut broker, &path);
    let mut denied = read_input(
        operation_id,
        idempotency_key,
        path.clone(),
        &target_descriptor,
    );
    denied["capability_request"]["authorization"]["outcome"] = json!("deny");
    assert_eq!(
        handle(&mut broker, "capability.file.read", denied),
        Err("CAPABILITY_DECISION_NOT_ALLOWED")
    );

    let mut drifted = read_input(operation_id, idempotency_key, path, &target_descriptor);
    drifted["expected_target_descriptor_hash"] = json!("c".repeat(64));
    drifted["capability_request"]["operation"]["descriptor_hash"] = json!("c".repeat(64));
    assert_eq!(
        handle(&mut broker, "capability.file.read", drifted),
        Err("LOCAL_FILE_EXECUTION_DESCRIPTOR_CHANGED")
    );

    let reconciliation = handle(
        &mut broker,
        "capability.file.execution.reconcile",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "88888888-8888-4888-8888-888888888888",
            "request_hash": "d".repeat(64),
            "observed_execution_state": "unknown"
        }),
    )
    .expect("unknown reconcile");
    assert_eq!(reconciliation["decision"], "require_handoff");
    assert_eq!(reconciliation["execution_state"], "unknown");
    assert_eq!(reconciliation["output_sha256"], Value::Null);
}

#[test]
fn execution_ledger_is_bounded_and_evicted_identity_cannot_execute_again() {
    let root = TestRoot::new("ledger");
    std::fs::write(root.path().join("read.bin"), b"x").expect("fixture");
    let mut broker = service(true);
    register(&mut broker, root.path());
    let mut first_input = None;

    for index in 0..129 {
        let operation_id = format!("99999999-9999-4999-8999-{index:012}");
        let idempotency_key = format!("aaaaaaaa-aaaa-4aaa-8aaa-{index:012}");
        let path = path_request(&operation_id, "read_file", &["read.bin"], Some(64));
        let target_descriptor = descriptor(&mut broker, &path);
        let input = read_input(&operation_id, &idempotency_key, path, &target_descriptor);
        handle(&mut broker, "capability.file.read", input.clone()).expect("read");
        if index == 0 {
            first_input = Some(input);
        }
    }

    assert_eq!(
        handle(
            &mut broker,
            "capability.file.read",
            first_input.expect("first input"),
        ),
        Err("LOCAL_FILE_EXECUTION_REPLAY_EXPIRED")
    );
}
