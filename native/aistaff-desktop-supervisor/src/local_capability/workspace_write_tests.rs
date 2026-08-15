use super::file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
use super::workspace_write_contracts::CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION;
use crate::{PROTOCOL_VERSION, SupervisorRuntime};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const NOW_MS: u64 = 1_900_000_000_000;
const BINDING_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
const BINDING_REVISION: &str = "22222222-2222-4222-8222-222222222222";
const REGISTER_OPERATION: &str = "33333333-3333-4333-8333-333333333333";
const APPLY_OPERATION: &str = "44444444-4444-4444-8444-444444444444";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestRoot(PathBuf);

impl TestRoot {
    fn new(label: &str) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join(format!(
                "workspace-write-{label}-{}-{sequence}",
                std::process::id()
            ));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("clean exact root");
        }
        std::fs::create_dir_all(root.join("src")).expect("create root");
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

fn handle(
    service: &mut LocalFileCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn register(service: &mut LocalFileCapabilityService, root: &Path) -> (String, String) {
    let response = handle(
        service,
        "capability.workspace.grant.register",
        json!({
            "schema_version": CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
            "action_id": "capability.workspace.grant.register",
            "operation_id": REGISTER_OPERATION,
            "binding_handle": BINDING_HANDLE,
            "binding_revision": BINDING_REVISION,
            "root_path": root.to_str().expect("utf8 root"),
            "access_mode": "read_write"
        }),
    )
    .expect("register write grant");
    let serialized = serde_json::to_string(&response).expect("serialize");
    assert!(!serialized.contains(root.to_str().expect("root")));
    assert_eq!(response["absolute_path_exposed"], false);
    assert_eq!(response["server_scope_consumed"], false);
    (
        response["grant_handle"]
            .as_str()
            .expect("grant handle")
            .to_owned(),
        response["grant_revision"]
            .as_str()
            .expect("grant revision")
            .to_owned(),
    )
}

fn apply_payload(grant_handle: &str, grant_revision: &str, changes: Value) -> Value {
    json!({
        "schema_version": CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
        "action_id": "capability.workspace.change.apply",
        "operation_id": APPLY_OPERATION,
        "binding_handle": BINDING_HANDLE,
        "binding_revision": BINDING_REVISION,
        "grant_handle": grant_handle,
        "grant_revision": grant_revision,
        "confirmed": true,
        "changes": changes
    })
}

fn sha256(content: &str) -> String {
    let mut output = String::with_capacity(64);
    for byte in Sha256::digest(content.as_bytes()) {
        write!(&mut output, "{byte:02x}").expect("hex");
    }
    output
}

#[test]
fn applies_create_modify_delete_and_replays_without_reexecution() {
    let root = TestRoot::new("lifecycle");
    std::fs::write(root.path().join("src/existing.txt"), "old").expect("existing");
    std::fs::write(root.path().join("delete.txt"), "remove").expect("delete");
    let mut service = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (grant_handle, grant_revision) = register(&mut service, root.path());
    let payload = apply_payload(
        &grant_handle,
        &grant_revision,
        json!([
            {
                "path": "created.txt", "operation": "create",
                "base_sha256": null, "content": "created"
            },
            {
                "path": "src/existing.txt", "operation": "modify",
                "base_sha256": sha256("old"), "content": "updated"
            },
            {
                "path": "delete.txt", "operation": "delete",
                "base_sha256": sha256("remove"), "content": null
            }
        ]),
    );
    let response = handle(
        &mut service,
        "capability.workspace.change.apply",
        payload.clone(),
    )
    .expect("apply");
    assert_eq!(response["execution_state"], "completed");
    assert_eq!(response["files"].as_array().expect("files").len(), 3);
    assert_eq!(
        std::fs::read_to_string(root.path().join("created.txt")).unwrap(),
        "created"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("src/existing.txt")).unwrap(),
        "updated"
    );
    assert!(!root.path().join("delete.txt").exists());
    let serialized = serde_json::to_string(&response).expect("response");
    assert!(!serialized.contains(root.path().to_str().expect("root")));
    assert!(!serialized.contains("created\"") && !serialized.contains("updated\""));
    assert_eq!(response["evidence"]["content_exposed"], false);
    assert_eq!(response["evidence"]["cleanup_state"], "completed");
    assert_eq!(
        response["evidence"]["idempotency_scope"],
        "supervisor_process_lifetime"
    );
    assert_eq!(
        response["evidence"]["restart_reconcile"],
        "unavailable_fail_closed"
    );
    assert_eq!(response["production_ready"], false);
    for directory in [root.path().to_path_buf(), root.path().join("src")] {
        let names = std::fs::read_dir(directory)
            .expect("directory")
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(!names.iter().any(|name| name.starts_with(".aistaff-")));
    }

    let replay =
        handle(&mut service, "capability.workspace.change.apply", payload).expect("replay");
    assert_eq!(replay["idempotency_replayed"], true);
    assert_eq!(replay["change_sha256"], response["change_sha256"]);
}

#[test]
fn completes_all_preflight_before_mutating_any_target() {
    let root = TestRoot::new("preflight");
    std::fs::write(root.path().join("first.txt"), "first").expect("first");
    std::fs::write(root.path().join("second.txt"), "second").expect("second");
    let mut service = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (grant_handle, grant_revision) = register(&mut service, root.path());
    let result = handle(
        &mut service,
        "capability.workspace.change.apply",
        apply_payload(
            &grant_handle,
            &grant_revision,
            json!([
                {
                    "path": "first.txt", "operation": "modify",
                    "base_sha256": sha256("first"), "content": "changed"
                },
                {
                    "path": "second.txt", "operation": "delete",
                    "base_sha256": sha256("wrong"), "content": null
                }
            ]),
        ),
    );
    assert_eq!(
        result,
        Err("LOCAL_WORKSPACE_CHANGE_STATE_DIVERGED_RECONCILE_REQUIRED")
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("first.txt")).unwrap(),
        "first"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("second.txt")).unwrap(),
        "second"
    );
    let names = std::fs::read_dir(root.path())
        .expect("entries")
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(!names.iter().any(|name| name.starts_with(".aistaff-")));
}

#[test]
fn rejects_binding_revision_confirmation_unsafe_paths_and_special_targets() {
    let root = TestRoot::new("security");
    std::fs::create_dir(root.path().join("directory-target")).expect("directory");
    let mut service = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (grant_handle, grant_revision) = register(&mut service, root.path());
    let base = apply_payload(
        &grant_handle,
        &grant_revision,
        json!([{
            "path": "directory-target", "operation": "delete",
            "base_sha256": sha256("ignored"), "content": null
        }]),
    );
    assert_eq!(
        handle(
            &mut service,
            "capability.workspace.change.apply",
            base.clone()
        ),
        Err("LOCAL_WORKSPACE_SYMLINK_OR_SPECIAL_REJECTED")
    );
    let mut binding_mismatch = base.clone();
    binding_mismatch["binding_revision"] = json!("66666666-6666-4666-8666-666666666666");
    assert_eq!(
        handle(
            &mut service,
            "capability.workspace.change.apply",
            binding_mismatch,
        ),
        Err("LOCAL_WORKSPACE_BINDING_REVISION_MISMATCH")
    );
    let mut unconfirmed = base.clone();
    unconfirmed["confirmed"] = json!(false);
    assert_eq!(
        handle(
            &mut service,
            "capability.workspace.change.apply",
            unconfirmed,
        ),
        Err("INVALID_CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY")
    );
    let mut traversal = base;
    traversal["changes"] = json!([{
        "path": "../escape", "operation": "create",
        "base_sha256": null, "content": "forbidden"
    }]);
    assert_eq!(
        handle(&mut service, "capability.workspace.change.apply", traversal,),
        Err("INVALID_CLIENT_LOCAL_WORKSPACE_CHANGE_PATH")
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlink_targets_and_symlink_parent_components() {
    use std::os::unix::fs::symlink;

    let root = TestRoot::new("symlink");
    let outside = TestRoot::new("outside");
    std::fs::write(outside.path().join("outside.txt"), "outside").expect("outside file");
    symlink(
        outside.path().join("outside.txt"),
        root.path().join("linked.txt"),
    )
    .expect("file symlink");
    symlink(outside.path(), root.path().join("linked-dir")).expect("dir symlink");
    let mut service = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (grant_handle, grant_revision) = register(&mut service, root.path());
    for change in [
        json!({
            "path": "linked.txt", "operation": "modify",
            "base_sha256": sha256("outside"), "content": "changed"
        }),
        json!({
            "path": "linked-dir/new.txt", "operation": "create",
            "base_sha256": null, "content": "changed"
        }),
    ] {
        assert!(
            handle(
                &mut service,
                "capability.workspace.change.apply",
                apply_payload(&grant_handle, &grant_revision, json!([change])),
            )
            .is_err()
        );
    }
    assert_eq!(
        std::fs::read_to_string(outside.path().join("outside.txt")).unwrap(),
        "outside"
    );
    assert!(!outside.path().join("new.txt").exists());
}

#[cfg(unix)]
#[test]
fn accepts_a_picker_root_below_a_canonicalizable_ancestor_alias_but_not_a_symlink_root() {
    use std::os::unix::fs::symlink;

    let real_parent = TestRoot::new("alias-real");
    std::fs::create_dir(real_parent.path().join("selected")).expect("selected root");
    let alias_parent = TestRoot::new("alias-parent");
    let alias = alias_parent.path().join("alias");
    symlink(real_parent.path(), &alias).expect("ancestor alias");

    let mut service = LocalFileCapabilityService::with_clock(|| NOW_MS);
    register(&mut service, &alias.join("selected"));

    let mut rejected = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let selected_symlink = alias_parent.path().join("selected-symlink");
    symlink(real_parent.path().join("selected"), &selected_symlink).expect("selected symlink");
    assert_eq!(
        handle(
            &mut rejected,
            "capability.workspace.grant.register",
            json!({
                "schema_version": CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
                "action_id": "capability.workspace.grant.register",
                "operation_id": REGISTER_OPERATION,
                "binding_handle": BINDING_HANDLE,
                "binding_revision": BINDING_REVISION,
                "root_path": selected_symlink.to_str().expect("utf8 root"),
                "access_mode": "read_write"
            }),
        ),
        Err("LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED")
    );
}

#[test]
fn rejects_operation_reuse_with_different_request_and_expired_grant() {
    let root = TestRoot::new("idempotency");
    let clock = std::sync::Arc::new(AtomicU64::new(NOW_MS));
    let service_clock = clock.clone();
    let mut service =
        LocalFileCapabilityService::with_clock(move || service_clock.load(Ordering::Relaxed));
    let (grant_handle, grant_revision) = register(&mut service, root.path());
    let first = apply_payload(
        &grant_handle,
        &grant_revision,
        json!([{
            "path": "first.txt", "operation": "create",
            "base_sha256": null, "content": "first"
        }]),
    );
    handle(&mut service, "capability.workspace.change.apply", first).expect("first");
    let conflict = apply_payload(
        &grant_handle,
        &grant_revision,
        json!([{
            "path": "second.txt", "operation": "create",
            "base_sha256": null, "content": "second"
        }]),
    );
    assert_eq!(
        handle(&mut service, "capability.workspace.change.apply", conflict),
        Err("LOCAL_FILE_IDEMPOTENCY_CONFLICT")
    );

    clock.store(NOW_MS + 10 * 60 * 1_000 + 1, Ordering::Relaxed);
    let expired = json!({
        "schema_version": CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
        "action_id": "capability.workspace.change.apply",
        "operation_id": "77777777-7777-4777-8777-777777777777",
        "binding_handle": BINDING_HANDLE,
        "binding_revision": BINDING_REVISION,
        "grant_handle": grant_handle,
        "grant_revision": grant_revision,
        "confirmed": true,
        "changes": [{
            "path": "third.txt", "operation": "create",
            "base_sha256": null, "content": "third"
        }]
    });
    assert_eq!(
        handle(&mut service, "capability.workspace.change.apply", expired),
        Err("LOCAL_FILE_GRANT_NOT_ACTIVE")
    );
}

#[test]
fn restart_loses_ledger_and_fails_closed_when_completed_state_diverges_from_base() {
    let root = TestRoot::new("restart-unknown");
    std::fs::write(root.path().join("state.txt"), "before").expect("state");
    let changes = json!([{
        "path": "state.txt", "operation": "modify",
        "base_sha256": sha256("before"), "content": "after"
    }]);

    let mut first_process = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (first_handle, first_revision) = register(&mut first_process, root.path());
    handle(
        &mut first_process,
        "capability.workspace.change.apply",
        apply_payload(&first_handle, &first_revision, changes.clone()),
    )
    .expect("first process applies");
    drop(first_process);

    let mut restarted_process = LocalFileCapabilityService::with_clock(|| NOW_MS);
    let (new_handle, new_revision) = register(&mut restarted_process, root.path());
    assert_eq!(
        handle(
            &mut restarted_process,
            "capability.workspace.change.apply",
            apply_payload(&new_handle, &new_revision, changes),
        ),
        Err("LOCAL_WORKSPACE_CHANGE_STATE_DIVERGED_RECONCILE_REQUIRED")
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("state.txt")).unwrap(),
        "after"
    );
}

#[test]
fn authenticated_supervisor_router_accepts_workspace_grant_without_echoing_root() {
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
    let root = TestRoot::new("router");
    let request = json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "workspace-write-router",
        "auth_token": TOKEN,
        "command": "capability.workspace.grant.register",
        "payload": {
            "schema_version": CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
            "action_id": "capability.workspace.grant.register",
            "operation_id": REGISTER_OPERATION,
            "binding_handle": BINDING_HANDLE,
            "binding_revision": BINDING_REVISION,
            "root_path": root.path().to_str().expect("utf8 root"),
            "access_mode": "read_write"
        }
    });
    let mut runtime = SupervisorRuntime::new();
    let processed =
        runtime.process_request_line(&serde_json::to_vec(&request).expect("request"), TOKEN);
    assert!(processed.response.ok);
    let serialized = serde_json::to_string(&processed.response).expect("response");
    assert!(!serialized.contains(root.path().to_str().expect("root")));
    assert_eq!(
        processed.response.result.expect("result")["grant_status"],
        "registered"
    );
}
