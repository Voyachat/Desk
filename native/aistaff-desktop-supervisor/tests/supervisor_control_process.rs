#![cfg(feature = "supervisor-control-test-support")]

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_BYTES: [u8; 32] = [0x5a; 32];
const WRONG_KEY_BYTES: [u8; 32] = [0xa5; 32];
const FUTURE: &str = "2099-01-01T00:00:00.000Z";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestRoot {
    path: PathBuf,
}

impl TestRoot {
    fn new(label: &str) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join("supervisor-control-process-tests")
            .join(format!("{label}-{}-{sequence}", std::process::id()));
        if path.exists() {
            fs::remove_dir_all(&path).expect("remove exact stale test root");
        }
        fs::create_dir_all(&path).expect("create test root");
        Self { path }
    }

    fn key_path(&self) -> PathBuf {
        let path = self.path.join("test-data-key.bin");
        write_private_file(&path, &KEY_BYTES);
        path
    }

    fn state_directory(&self) -> PathBuf {
        self.path.join("state")
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        if self.path.exists() {
            fs::remove_dir_all(&self.path).expect("remove exact test root");
        }
    }
}

struct RunningSupervisor {
    child: Child,
    input: ChildStdin,
    output: BufReader<std::process::ChildStdout>,
    next_request: u64,
    forbidden_path: String,
}

impl RunningSupervisor {
    fn start(root: &TestRoot) -> Self {
        let key_path = root.key_path();
        let mut child = command(root, &key_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn supervisor");
        let mut input = child.stdin.take().expect("supervisor stdin");
        input
            .write_all(TOKEN.as_bytes())
            .and_then(|()| input.write_all(b"\n"))
            .and_then(|()| input.flush())
            .expect("write bootstrap token");
        let output = BufReader::new(child.stdout.take().expect("supervisor stdout"));
        Self {
            child,
            input,
            output,
            next_request: 0,
            forbidden_path: root.path.to_string_lossy().into_owned(),
        }
    }

    fn invoke(&mut self, command: &str, payload: Option<Value>) -> Value {
        self.next_request += 1;
        let request_id = format!("request-{}", self.next_request);
        let mut request = json!({
            "protocol_version": "aistaff.desktop-supervisor.v1",
            "request_id": request_id,
            "auth_token": TOKEN,
            "command": command,
        });
        if let Some(payload) = payload {
            request["payload"] = payload;
        }
        serde_json::to_writer(&mut self.input, &request).expect("serialize request");
        self.input.write_all(b"\n").expect("write newline");
        self.input.flush().expect("flush request");
        let mut line = String::new();
        self.output
            .read_line(&mut line)
            .expect("read supervisor response");
        assert!(!line.is_empty(), "supervisor exited before responding");
        assert!(!line.contains(TOKEN), "response leaked auth token");
        assert!(
            !line.contains(&self.forbidden_path),
            "response leaked selected or state path"
        );
        let response: Value = serde_json::from_str(&line).expect("parse response");
        assert_eq!(response["request_id"], request_id);
        response
    }

    fn success(&mut self, command: &str, payload: Option<Value>) -> Value {
        let response = self.invoke(command, payload);
        assert_eq!(response["ok"], true, "unexpected response: {response}");
        response["result"].clone()
    }

    fn failure(&mut self, command: &str, payload: Option<Value>, code: &str) {
        let response = self.invoke(command, payload);
        assert_eq!(response["ok"], false, "unexpected response: {response}");
        assert_eq!(response["error"], json!({ "code": code }));
        assert!(response.get("result").is_none());
    }

    fn kill(mut self) {
        self.child.kill().expect("kill supervisor");
        self.child.wait().expect("wait for killed supervisor");
    }
}

impl Drop for RunningSupervisor {
    fn drop(&mut self) {
        if self.child.try_wait().expect("poll supervisor").is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn command(root: &TestRoot, key_path: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_aistaff-desktop-supervisor"));
    command
        .arg("--supervisor-control-test")
        .current_dir(&root.path)
        .env("AISTAFF_SUPERVISOR_STATE_DIR", root.state_directory())
        .env("AISTAFF_SUPERVISOR_TEST_DATA_KEY_FILE", key_path);
    command
}

fn local_subject() -> Value {
    json!({
        "kind": "local",
        "activity_ref": "activity-local-1",
        "dsh_session_id": "dsh-session-local-1",
    })
}

fn register_payload(operation_id: &str, selected_root: &Path) -> Value {
    json!({
        "operation_id": operation_id,
        "subject": local_subject(),
        "root_path": selected_root.to_str().expect("utf-8 selected root"),
        "display_name": "workspace",
        "access": "read_only",
        "allowed_intents": ["file/read_text", "directory/list"],
        "expires_at": FUTURE,
    })
}

fn read_payload(
    operation_id: &str,
    context: &str,
    grant: &Value,
    intent: &str,
    segments: &[&str],
) -> Value {
    json!({
        "operation_id": operation_id,
        "execution_context": {
            "kind": "capability_only",
            "capability_context_handle": context,
        },
        "subject": local_subject(),
        "grant_handle": grant["grant_handle"],
        "expected_grant_revision": grant["grant_revision"],
        "intent": intent,
        "relative_segments": segments,
        "max_bytes": 8192,
        "deadline_at": FUTURE,
    })
}

#[test]
fn release_process_commits_real_reads_and_replays_them_after_kill_restart() {
    let root = TestRoot::new("restart");
    let selected_root = root.path.join("selected");
    fs::create_dir(&selected_root).expect("selected root");
    fs::write(selected_root.join("note.txt"), b"durable restart content").expect("file fixture");
    fs::create_dir(selected_root.join("nested")).expect("directory fixture");

    let mut first = RunningSupervisor::start(&root);
    let hello = first.success("control.hello", None);
    assert_eq!(hello["control_version"], "aidesktop.supervisor-control.v1");
    assert_eq!(
        hello["capabilities"],
        json!(["file/read_text", "directory/list"])
    );
    assert_eq!(hello["max_request_bytes"], 65_536);
    assert_eq!(hello["max_result_bytes"], 24_576);
    let first_context = hello["capability_context_handle"]
        .as_str()
        .expect("context")
        .to_owned();
    let registered = first.success(
        "control.grant.register",
        Some(register_payload("operation-register", &selected_root)),
    );
    assert_eq!(registered["receipt"]["status"], "succeeded");
    assert!(registered["receipt"].get("reason_code").is_none());
    let grant = registered["grant"].clone();

    let file_request = read_payload(
        "operation-read-file",
        &first_context,
        &grant,
        "file/read_text",
        &["note.txt"],
    );
    let file_result = first.success("control.capability.read", Some(file_request.clone()));
    assert_eq!(file_result["payload"]["kind"], "file");
    assert_eq!(
        STANDARD
            .decode(
                file_result["payload"]["bytes_base64"]
                    .as_str()
                    .expect("base64")
            )
            .expect("decode"),
        b"durable restart content"
    );
    assert_eq!(
        file_result["payload"]["media_type"],
        "text/plain; charset=utf-8"
    );
    assert!(file_result["receipt"].get("reason_code").is_none());
    let file_receipt_ref = file_result["receipt"]["receipt_ref"]
        .as_str()
        .expect("receipt ref")
        .to_owned();

    let directory_request = read_payload(
        "operation-list-directory",
        &first_context,
        &grant,
        "directory/list",
        &[],
    );
    let directory_result =
        first.success("control.capability.read", Some(directory_request.clone()));
    assert_eq!(directory_result["payload"]["kind"], "directory");
    assert_eq!(
        directory_result["payload"]["entries"],
        json!([
            { "name": "nested", "kind": "directory" },
            { "name": "note.txt", "kind": "file", "size_bytes": 23 }
        ])
    );
    first.kill();

    assert_encrypted_state(&root, &selected_root, b"durable restart content");

    let mut second = RunningSupervisor::start(&root);
    let restarted_hello = second.success("control.hello", None);
    let second_context = restarted_hello["capability_context_handle"]
        .as_str()
        .expect("restarted context");
    assert_ne!(second_context, first_context);
    let operation = second.success(
        "control.operation.read",
        Some(json!({ "operation_id": "operation-read-file" })),
    );
    assert_eq!(operation["state"], "succeeded");
    assert_eq!(operation["receipt_ref"], file_receipt_ref);
    let receipt = second.success(
        "control.receipt.get",
        Some(json!({ "receipt_ref": file_receipt_ref })),
    );
    assert_eq!(receipt, file_result["receipt"]);

    let replay = second.success("control.capability.read", Some(file_request.clone()));
    assert_eq!(replay, file_result);
    let directory_replay =
        second.success("control.capability.read", Some(directory_request.clone()));
    assert_eq!(directory_replay, directory_result);

    let mut conflict = file_request.clone();
    conflict["relative_segments"] = json!(["other.txt"]);
    second.failure(
        "control.capability.read",
        Some(conflict),
        "OPERATION_CONFLICT",
    );
    let stale_context = read_payload(
        "operation-stale-context",
        &first_context,
        &grant,
        "file/read_text",
        &["note.txt"],
    );
    second.failure(
        "control.capability.read",
        Some(stale_context),
        "CAPABILITY_DENIED",
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let outside = root.path.join("outside.txt");
        fs::write(&outside, b"outside secret").expect("outside fixture");
        symlink(&outside, selected_root.join("linked.txt")).expect("symlink fixture");
        let linked = read_payload(
            "operation-symlink",
            second_context,
            &grant,
            "file/read_text",
            &["linked.txt"],
        );
        second.failure(
            "control.capability.read",
            Some(linked),
            "TARGET_IDENTITY_CHANGED",
        );
    }

    let revoked = second.success(
        "control.grant.revoke",
        Some(json!({
            "operation_id": "operation-revoke",
            "grant_handle": grant["grant_handle"],
            "expected_grant_revision": grant["grant_revision"],
        })),
    );
    assert_eq!(revoked["status"], "succeeded");
    assert_eq!(revoked["effect_state"], "not_applied");
    assert!(revoked.get("reason_code").is_none());
    let after_revoke = read_payload(
        "operation-after-revoke",
        second_context,
        &grant,
        "file/read_text",
        &["note.txt"],
    );
    second.failure(
        "control.capability.read",
        Some(after_revoke),
        "GRANT_NOT_ACTIVE",
    );
}

#[cfg(unix)]
#[test]
fn durable_grant_uses_canonical_root_after_picker_ancestor_alias_is_removed() {
    use std::os::unix::fs::symlink;

    let root = TestRoot::new("canonical-root");
    let actual_parent = root.path.join("actual-parent");
    let selected_root = actual_parent.join("selected");
    fs::create_dir_all(&selected_root).expect("selected root");
    fs::write(selected_root.join("note.txt"), b"canonical durable content").expect("file fixture");
    let alias_parent = root.path.join("picker-alias");
    symlink(&actual_parent, &alias_parent).expect("picker ancestor alias");
    let selected_alias = alias_parent.join("selected");

    let mut first = RunningSupervisor::start(&root);
    let hello = first.success("control.hello", None);
    let context = hello["capability_context_handle"]
        .as_str()
        .expect("context");
    let registered = first.success(
        "control.grant.register",
        Some(register_payload(
            "operation-canonical-register",
            &selected_alias,
        )),
    );
    let grant = registered["grant"].clone();
    fs::remove_file(&alias_parent).expect("remove picker ancestor alias");
    let result = first.success(
        "control.capability.read",
        Some(read_payload(
            "operation-canonical-read-before-restart",
            context,
            &grant,
            "file/read_text",
            &["note.txt"],
        )),
    );
    assert_eq!(
        STANDARD
            .decode(result["payload"]["bytes_base64"].as_str().expect("base64"))
            .expect("decode"),
        b"canonical durable content"
    );
    first.kill();
    assert_encrypted_state(&root, &selected_root, b"canonical durable content");
    assert_encrypted_state(&root, &selected_alias, b"canonical durable content");

    let mut second = RunningSupervisor::start(&root);
    let hello = second.success("control.hello", None);
    let context = hello["capability_context_handle"]
        .as_str()
        .expect("restarted context");
    let result = second.success(
        "control.capability.read",
        Some(read_payload(
            "operation-canonical-read-after-restart",
            context,
            &grant,
            "file/read_text",
            &["note.txt"],
        )),
    );
    assert_eq!(result["payload"]["kind"], "file");
}

#[test]
fn tampered_ciphertext_or_wrong_key_fails_closed_without_leaking_paths() {
    let root = TestRoot::new("tampered-ciphertext");
    let selected_root = root.path.join("selected");
    fs::create_dir(&selected_root).expect("selected root");
    let mut process = RunningSupervisor::start(&root);
    process.success("control.hello", None);
    process.success(
        "control.grant.register",
        Some(register_payload(
            "operation-corrupt-register",
            &selected_root,
        )),
    );
    process.kill();

    let database = root.state_directory().join("supervisor-control.sqlite3");
    let connection = rusqlite::Connection::open(&database).expect("open operation journal");
    assert_eq!(
        connection
            .execute(
                "UPDATE operation_journal SET result_ciphertext = ?1 WHERE operation_id = ?2",
                rusqlite::params![vec![1_u8; 29], "operation-corrupt-register"],
            )
            .expect("tamper operation ciphertext"),
        1
    );
    drop(connection);
    let key_path = root.key_path();
    assert_startup_rejected(&root, &key_path);

    let wrong_key_root = TestRoot::new("wrong-key");
    create_valid_state(&wrong_key_root, "operation-wrong-key-register");
    let wrong_key_path = wrong_key_root.path.join("wrong-data-key.bin");
    write_private_file(&wrong_key_path, &WRONG_KEY_BYTES);
    assert_startup_rejected(&wrong_key_root, &wrong_key_path);
}

#[test]
fn foreign_unversioned_and_newer_databases_are_rejected() {
    for (label, application_id, user_version) in [
        ("unversioned", 0, 0),
        ("foreign", 0x0102_0304, 1),
        ("newer", 0x4144_5343, 2),
    ] {
        let root = TestRoot::new(label);
        write_nonempty_database(&root, application_id, user_version);
        let key_path = root.key_path();
        assert_startup_rejected(&root, &key_path);
    }
}

#[test]
fn missing_or_invalid_bootstrap_token_is_rejected_before_state_open() {
    let root = TestRoot::new("bootstrap-token");
    let key_path = root.key_path();
    for bootstrap in [
        b"".as_slice(),
        b"too-short\n".as_slice(),
        b"0123456789abcdef0123456789abcdef=\n".as_slice(),
    ] {
        let output = run_to_exit(&root, &key_path, bootstrap);
        assert_eq!(output.status.code(), Some(78));
        let stderr = String::from_utf8(output.stderr).expect("utf-8 stderr");
        assert!(!stderr.contains(root.path.to_str().expect("utf-8 root")));
        assert!(!stderr.contains(TOKEN));
        assert!(!contains_bytes(stderr.as_bytes(), bootstrap));
        assert!(!root.state_directory().exists());
    }
}

#[cfg(unix)]
#[test]
fn symlinked_state_directory_fails_closed_without_leaking_paths() {
    use std::os::unix::fs::symlink;

    let root = TestRoot::new("state-symlink");
    let destination = root.path.join("destination");
    fs::create_dir(&destination).expect("symlink destination");
    symlink(&destination, root.state_directory()).expect("state symlink");
    let key_path = root.key_path();
    assert_startup_rejected(&root, &key_path);

    let database_root = TestRoot::new("database-symlink");
    let state_directory = database_root.state_directory();
    fs::create_dir(&state_directory).expect("state directory");
    let destination = database_root.path.join("database-destination");
    write_private_file(&destination, b"not a sqlite database");
    symlink(
        &destination,
        state_directory.join("supervisor-control.sqlite3"),
    )
    .expect("database symlink");
    let key_path = database_root.key_path();
    assert_startup_rejected(&database_root, &key_path);
}

fn create_valid_state(root: &TestRoot, operation_id: &str) {
    let selected_root = root.path.join("selected");
    fs::create_dir(&selected_root).expect("selected root");
    let mut process = RunningSupervisor::start(root);
    process.success("control.hello", None);
    process.success(
        "control.grant.register",
        Some(register_payload(operation_id, &selected_root)),
    );
    process.kill();
}

fn write_nonempty_database(root: &TestRoot, application_id: i64, user_version: i64) {
    let state_directory = root.state_directory();
    fs::create_dir(&state_directory).expect("state directory");
    let database = state_directory.join("supervisor-control.sqlite3");
    let connection = rusqlite::Connection::open(&database).expect("create probe database");
    connection
        .execute("CREATE TABLE probe (value INTEGER NOT NULL)", [])
        .expect("create probe table");
    connection
        .pragma_update(None, "application_id", application_id)
        .expect("set application id");
    connection
        .pragma_update(None, "user_version", user_version)
        .expect("set user version");
    drop(connection);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(&database, fs::Permissions::from_mode(0o600)).expect("database mode");
    }
}

fn assert_startup_rejected(root: &TestRoot, key_path: &Path) {
    let mut bootstrap = TOKEN.as_bytes().to_vec();
    bootstrap.push(b'\n');
    let output = run_to_exit(root, key_path, &bootstrap);
    assert_eq!(output.status.code(), Some(78));
    let stderr = String::from_utf8(output.stderr).expect("utf-8 stderr");
    assert!(!stderr.contains(root.path.to_str().expect("utf-8 root")));
    assert!(!stderr.contains(TOKEN));
}

fn run_to_exit(root: &TestRoot, key_path: &Path, bootstrap: &[u8]) -> std::process::Output {
    let mut child = command(root, key_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped())
        .spawn()
        .expect("run supervisor to exit");
    let mut input = child.stdin.take().expect("supervisor stdin");
    input.write_all(bootstrap).expect("write bootstrap bytes");
    input.flush().expect("flush bootstrap bytes");
    drop(input);
    child.wait_with_output().expect("wait for supervisor exit")
}

fn assert_encrypted_state(root: &TestRoot, selected_root: &Path, content: &[u8]) {
    let state_directory = root.state_directory();
    let database = state_directory.join("supervisor-control.sqlite3");
    let mut inspected = 0;
    for path in [
        database.clone(),
        PathBuf::from(format!("{}-wal", database.to_string_lossy())),
        PathBuf::from(format!("{}-shm", database.to_string_lossy())),
    ] {
        if !path.exists() {
            continue;
        }
        inspected += 1;
        let bytes = fs::read(&path).expect("read sqlite file family");
        assert!(!contains_bytes(
            &bytes,
            selected_root.to_string_lossy().as_bytes()
        ));
        assert!(!contains_bytes(&bytes, content));
        assert!(!contains_bytes(&bytes, TOKEN.as_bytes()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::symlink_metadata(&path)
                .expect("sqlite file metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
    }
    assert!(inspected >= 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::symlink_metadata(&state_directory)
            .expect("state directory metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }

    let connection =
        rusqlite::Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open state database read-only");
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .expect("application id");
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("user version");
    assert_eq!(application_id, 0x4144_5343);
    assert_eq!(user_version, 1);
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

fn write_private_file(path: &Path, bytes: &[u8]) {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file: File = options.open(path).expect("open private file");
    file.write_all(bytes).expect("write private file");
    file.sync_all().expect("sync private file");
}
