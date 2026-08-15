use super::contracts::{CapabilityScope, LOCAL_CAPABILITY_PROTOCOL_VERSION};
use super::file_contracts::{
    FileCapabilityIntent, FilePathAdmitInput, LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
};
use super::file_path::AdmittedFileRoot;
use super::file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const NOW_MS: u64 = 1_900_000_000_000;
const OPERATION_ID: &str = "11111111-1111-4111-8111-111111111111";
const GRANT_HANDLE: &str = "22222222-2222-4222-8222-222222222222";
const GRANT_REVISION: &str = "33333333-3333-4333-8333-333333333333";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join("local-file-tests")
        .join(format!("{label}-{}-{sequence}", std::process::id()))
}

fn remove_test_root(root: &Path) {
    if root.exists() {
        std::fs::remove_dir_all(root).expect("remove exact test root");
    }
}

fn scope() -> Value {
    json!({
        "tenant_id": "tenant-1",
        "session_id": "session-1",
        "run_id": "run-1"
    })
}

fn register_input(root: &Path) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": OPERATION_ID,
        "grant_handle": GRANT_HANDLE,
        "grant_revision": GRANT_REVISION,
        "scope": scope(),
        "root_path": root.to_str().expect("utf-8 test root"),
        "access": "read_only",
        "allowed_intents": [
            "metadata_read",
            "read_file",
            "list_directory"
        ],
        "source": "system_directory_picker",
        "expires_at_ms": NOW_MS + 60_000
    })
}

fn path_input(intent: &str, segments: &[&str], maximum_bytes: Option<u64>) -> Value {
    json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "44444444-4444-4444-8444-444444444444",
        "grant_handle": GRANT_HANDLE,
        "expected_grant_revision": GRANT_REVISION,
        "scope": scope(),
        "intent": intent,
        "relative_segments": segments,
        "max_bytes": maximum_bytes
    })
}

fn service() -> LocalFileCapabilityService {
    LocalFileCapabilityService::with_clock(|| NOW_MS)
}

fn handle(service: &mut LocalFileCapabilityService, command: &str, payload: Value) -> Value {
    service
        .handle(command, Some(payload))
        .expect("command should succeed")
}

fn register(service: &mut LocalFileCapabilityService, root: &Path) -> Value {
    handle(
        service,
        "capability.file.grant.register",
        register_input(root),
    )
}

#[test]
fn register_returns_only_opaque_metadata_and_is_idempotent() {
    let root = test_root("register");
    std::fs::create_dir_all(&root).expect("root");
    let mut broker = service();

    let first = register(&mut broker, &root);
    let serialized = serde_json::to_string(&first).expect("result");
    assert_eq!(first["grant_status"], "registered");
    assert_eq!(first["execution_enabled"], false);
    assert_eq!(first["root_fingerprint"].as_str().map(str::len), Some(64));
    assert!(!serialized.contains(root.to_str().expect("root")));

    let replay = register(&mut broker, &root);
    assert_eq!(replay["root_fingerprint"], first["root_fingerprint"]);
    assert_eq!(replay["idempotency_replayed"], true);

    let mut conflict = register_input(&root);
    conflict["expires_at_ms"] = json!(NOW_MS + 90_000);
    assert_eq!(
        broker
            .handle("capability.file.grant.register", Some(conflict))
            .expect_err("operation reuse must fail")
            .code,
        "LOCAL_FILE_IDEMPOTENCY_CONFLICT"
    );
    drop(broker);
    remove_test_root(&root);
}

#[test]
fn admits_bounded_file_and_root_directory_without_exposing_path() {
    let root = test_root("admit");
    let reports = root.join("reports");
    std::fs::create_dir_all(&reports).expect("reports");
    std::fs::write(reports.join("summary.txt"), b"summary").expect("fixture");
    let mut broker = service();
    register(&mut broker, &root);

    let file = handle(
        &mut broker,
        "capability.file.path.admit",
        path_input("read_file", &["reports", "summary.txt"], Some(1024)),
    );
    assert_eq!(file["admission_status"], "validated_no_execution");
    assert_eq!(
        file["capability_id"],
        LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID
    );
    assert_eq!(file["target_kind"], "file");
    assert_eq!(file["size_bytes"], 7);
    assert_eq!(file["execution_enabled"], false);
    assert_eq!(file["evidence"]["side_effect_state"], "none");
    assert_eq!(
        file["evidence"]["capability_id"],
        LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID
    );
    let serialized = serde_json::to_string(&file).expect("result");
    assert!(!serialized.contains("summary.txt"));
    assert!(!serialized.contains(root.to_str().expect("root")));

    let directory = handle(
        &mut broker,
        "capability.file.path.admit",
        path_input("list_directory", &[], None),
    );
    assert_eq!(directory["target_kind"], "directory");
    assert_eq!(directory["size_bytes"], Value::Null);
    drop(broker);
    remove_test_root(&root);
}

#[test]
fn rejects_scope_revision_intent_type_and_size_mismatch() {
    let root = test_root("policy");
    std::fs::create_dir_all(root.join("directory")).expect("root");
    std::fs::write(root.join("large.txt"), b"too large").expect("fixture");
    let mut broker = service();
    register(&mut broker, &root);

    let mut wrong_scope = path_input("read_file", &["large.txt"], Some(1024));
    wrong_scope["scope"]["tenant_id"] = json!("tenant-2");
    assert_eq!(
        broker
            .handle("capability.file.path.admit", Some(wrong_scope))
            .expect_err("scope")
            .code,
        "LOCAL_FILE_GRANT_SCOPE_MISMATCH"
    );

    let mut wrong_revision = path_input("read_file", &["large.txt"], Some(1024));
    wrong_revision["expected_grant_revision"] = json!("55555555-5555-4555-8555-555555555555");
    assert_eq!(
        broker
            .handle("capability.file.path.admit", Some(wrong_revision))
            .expect_err("revision")
            .code,
        "LOCAL_FILE_GRANT_REVISION_MISMATCH"
    );

    for (payload, expected) in [
        (
            path_input("read_file", &["directory"], Some(1024)),
            "LOCAL_FILE_TARGET_INTENT_MISMATCH",
        ),
        (
            path_input("list_directory", &["large.txt"], None),
            "LOCAL_FILE_TARGET_INTENT_MISMATCH",
        ),
        (
            path_input("read_file", &["large.txt"], Some(2)),
            "LOCAL_FILE_TARGET_TOO_LARGE",
        ),
    ] {
        assert_eq!(
            broker
                .handle("capability.file.path.admit", Some(payload))
                .expect_err("admission")
                .code,
            expected
        );
    }
    drop(broker);
    remove_test_root(&root);
}

#[test]
fn grant_expiry_revokes_admission_without_persisting_state() {
    let root = test_root("expiry");
    std::fs::create_dir_all(&root).expect("root");
    std::fs::write(root.join("file.txt"), b"fixture").expect("file");
    let clock = Arc::new(AtomicU64::new(NOW_MS));
    let clock_reader = Arc::clone(&clock);
    let mut broker =
        LocalFileCapabilityService::with_clock(move || clock_reader.load(Ordering::Relaxed));
    register(&mut broker, &root);

    clock.store(NOW_MS + 60_000, Ordering::Relaxed);
    assert_eq!(
        broker
            .handle(
                "capability.file.path.admit",
                Some(path_input("read_file", &["file.txt"], Some(1024)))
            )
            .expect_err("expired")
            .code,
        "LOCAL_FILE_GRANT_NOT_ACTIVE"
    );
    remove_test_root(&root);
}

#[test]
fn rejects_traversal_reserved_segments_and_absolute_payload_fields() {
    let root = test_root("segments");
    std::fs::create_dir_all(&root).expect("root");
    let mut broker = service();
    register(&mut broker, &root);

    for segment in [
        "..",
        "../outside",
        "nested/file",
        "nested\\file",
        "report:secret",
        "CON",
        "trailing.",
    ] {
        assert_eq!(
            broker
                .handle(
                    "capability.file.path.admit",
                    Some(path_input("read_file", &[segment], Some(1024)))
                )
                .expect_err("segment")
                .code,
            "INVALID_LOCAL_FILE_RELATIVE_SEGMENTS"
        );
    }
    let mut forged = path_input("read_file", &["safe.txt"], Some(1024));
    forged["absolute_path"] = json!("/forbidden");
    assert_eq!(
        broker
            .handle("capability.file.path.admit", Some(forged))
            .expect_err("unknown field")
            .code,
        "INVALID_LOCAL_FILE_CAPABILITY_PAYLOAD"
    );
    drop(broker);
    remove_test_root(&root);
}

#[test]
fn target_identity_change_during_admission_fails_closed() {
    let root = test_root("race");
    std::fs::create_dir_all(&root).expect("root");
    let target = root.join("race.txt");
    let moved = root.join("race.old");
    std::fs::write(&target, b"first").expect("fixture");
    let admitted =
        AdmittedFileRoot::admit(root.to_str().expect("utf-8 root")).expect("admitted root");
    let input = FilePathAdmitInput {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION.to_owned(),
        operation_id: "44444444-4444-4444-8444-444444444444".to_owned(),
        grant_handle: GRANT_HANDLE.to_owned(),
        expected_grant_revision: GRANT_REVISION.to_owned(),
        scope: CapabilityScope {
            tenant_id: "tenant-1".to_owned(),
            session_id: "session-1".to_owned(),
            run_id: "run-1".to_owned(),
        },
        intent: FileCapabilityIntent::ReadFile,
        relative_segments: vec!["race.txt".to_owned()],
        max_bytes: Some(1024),
    };

    assert_eq!(
        admitted
            .admit_path_with_hook(&input, || {
                std::fs::rename(&target, &moved).expect("move old");
                std::fs::write(&target, b"other").expect("replace target");
            })
            .expect_err("identity race")
            .code,
        "LOCAL_FILE_TARGET_IDENTITY_CHANGED"
    );
    drop(admitted);
    remove_test_root(&root);
}

#[cfg(unix)]
#[test]
fn symlink_target_and_post_grant_root_swap_fail_closed() {
    use std::os::unix::fs::symlink;

    let root = test_root("symlink-root");
    let moved = test_root("symlink-moved");
    let outside = test_root("symlink-outside");
    std::fs::create_dir_all(&root).expect("root");
    std::fs::create_dir_all(&outside).expect("outside");
    std::fs::write(outside.join("outside.txt"), b"outside").expect("outside file");
    symlink(outside.join("outside.txt"), root.join("linked.txt")).expect("file symlink");
    let mut broker = service();
    register(&mut broker, &root);
    assert_eq!(
        broker
            .handle(
                "capability.file.path.admit",
                Some(path_input("read_file", &["linked.txt"], Some(1024)))
            )
            .expect_err("symlink")
            .code,
        "LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED"
    );

    std::fs::remove_file(root.join("linked.txt")).expect("remove link");
    std::fs::rename(&root, &moved).expect("move root");
    symlink(&outside, &root).expect("replace root");
    assert_eq!(
        broker
            .handle(
                "capability.file.path.admit",
                Some(path_input("read_file", &["outside.txt"], Some(1024)))
            )
            .expect_err("root swap")
            .code,
        "LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED"
    );

    std::fs::remove_file(&root).expect("remove root link");
    remove_test_root(&moved);
    remove_test_root(&outside);
}

#[test]
fn revoke_checks_revision_and_replays_without_reusing_handle() {
    let root = test_root("revoke");
    std::fs::create_dir_all(&root).expect("root");
    let mut broker = service();
    register(&mut broker, &root);
    let revoke = json!({
        "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
        "operation_id": "55555555-5555-4555-8555-555555555555",
        "grant_handle": GRANT_HANDLE,
        "expected_grant_revision": GRANT_REVISION
    });
    let first = handle(&mut broker, "capability.file.grant.revoke", revoke.clone());
    assert_eq!(first["revoke_status"], "revoked");
    assert_eq!(first["execution_enabled"], false);
    assert_eq!(
        handle(&mut broker, "capability.file.grant.revoke", revoke)["idempotency_replayed"],
        true
    );
    let mut reused_handle = register_input(&root);
    reused_handle["operation_id"] = json!("66666666-6666-4666-8666-666666666666");
    assert_eq!(
        broker
            .handle("capability.file.grant.register", Some(reused_handle))
            .expect_err("handle reuse")
            .code,
        "LOCAL_FILE_GRANT_HANDLE_REUSED"
    );
    remove_test_root(&root);
}
