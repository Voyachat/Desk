use super::*;
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, PageInput, PurgeScopeInput,
    PutConfirmedInput, RedactionProfile,
};
use crate::message_cache_worker::{
    CACHE_CIPHER_KEY_BYTES, CacheClockError, CacheClockPort, CacheKeyProviderError,
    CacheKeyProviderPort, CacheRecoveryReason, CacheRetentionPolicy, CacheScopeKey,
    EncryptedScopeDriver, EncryptedScopeDriverError, EncryptedScopeIntegrity,
    EncryptedScopeMutationResult, EncryptedScopeOpenContext, EncryptedScopeOpenResult,
    EncryptedScopePage, MessageCacheWorkerCompleteRebuildInput, MessageCacheWorkerRebuildInput,
    WorkerAdapterAvailability,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SCOPE: &str = "11111111-1111-4111-8111-111111111111";
const REBUILD_OPERATION: &str = "44444444-4444-4444-8444-444444444444";
const PUT_OPERATION: &str = "55555555-5555-4555-8555-555555555555";
const SNAPSHOT_HASH: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
enum IntegrityBehavior {
    Healthy,
    ConfirmedCorrupt,
    CheckFailed,
    Unknown,
}

#[derive(Default)]
struct DriverState {
    open_calls: usize,
    close_calls: usize,
    put_operations: HashSet<String>,
}

struct RecoveryDriver {
    state: Rc<RefCell<DriverState>>,
    integrity: IntegrityBehavior,
    first_open_error: Option<&'static str>,
}

impl EncryptedScopeDriver for RecoveryDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        WorkerAdapterAvailability::Available
    }

    fn adapter_id(&self) -> &'static str {
        "test.wcdb.recovery"
    }

    fn open_scope(
        &mut self,
        database_path: &Path,
        cipher_key: &[u8],
        _context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        assert_eq!(cipher_key, &[0x42; CACHE_CIPHER_KEY_BYTES]);
        let mut state = self.state.borrow_mut();
        state.open_calls += 1;
        if state.open_calls == 1
            && let Some(code) = self.first_open_error
        {
            return Err(EncryptedScopeDriverError::new(code));
        }
        std::fs::write(database_path, b"fake-encrypted-cache").expect("fake database");
        Ok(EncryptedScopeOpenResult { reopened: false })
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        match self.integrity {
            IntegrityBehavior::Healthy => Ok(EncryptedScopeIntegrity::Healthy),
            IntegrityBehavior::ConfirmedCorrupt => Ok(EncryptedScopeIntegrity::ConfirmedCorrupt),
            IntegrityBehavior::CheckFailed => Err(EncryptedScopeDriverError::new(
                "WCDB_NATIVE_INTEGRITY_CHECK_FAILED",
            )),
            IntegrityBehavior::Unknown => Err(EncryptedScopeDriverError::new(
                "WCDB_NATIVE_RESPONSE_INVALID",
            )),
        }
    }

    fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
        _request_hash: &[u8; 32],
        _confirmed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        let replayed = !self
            .state
            .borrow_mut()
            .put_operations
            .insert(input.operation_id.clone());
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: replayed,
        })
    }

    fn page(
        &mut self,
        _input: &PageInput,
        _now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        Ok(EncryptedScopePage {
            projections: Vec::new(),
            next_after_sequence: None,
            has_more: false,
        })
    }

    fn purge_scope(
        &mut self,
        _input: &PurgeScopeInput,
        _request_hash: &[u8; 32],
        _committed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: false,
        })
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        self.state.borrow_mut().close_calls += 1;
        Ok(())
    }
}

struct TestKeyProvider {
    revoke_calls: Rc<Cell<usize>>,
}

impl CacheKeyProviderPort for TestKeyProvider {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        CacheScopeKey::new(vec![0x42; CACHE_CIPHER_KEY_BYTES])
    }

    fn revoke_scope(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        self.revoke_calls.set(self.revoke_calls.get() + 1);
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct FixedClock;

impl CacheClockPort for FixedClock {
    fn now_epoch_seconds(&self) -> Result<i64, CacheClockError> {
        Ok(2_000)
    }
}

type RecoveryRuntime = MessageCacheWorkerRuntime<TestKeyProvider, RecoveryDriver, FixedClock>;

fn recovery_runtime(
    integrity: IntegrityBehavior,
    first_open_error: Option<&'static str>,
) -> (RecoveryRuntime, Rc<RefCell<DriverState>>, Rc<Cell<usize>>) {
    let state = Rc::new(RefCell::new(DriverState::default()));
    let revoke_calls = Rc::new(Cell::new(0));
    (
        MessageCacheWorkerRuntime::with_clock(
            TestKeyProvider {
                revoke_calls: Rc::clone(&revoke_calls),
            },
            RecoveryDriver {
                state: Rc::clone(&state),
                integrity,
                first_open_error,
            },
            FixedClock,
            CacheRetentionPolicy::default(),
        ),
        state,
        revoke_calls,
    )
}

fn recovery_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join("worker-recovery-tests")
        .join(format!("{label}-{}-{sequence}", std::process::id()))
}

fn remove_root(root: &Path) {
    if root.exists() {
        std::fs::remove_dir_all(root).expect("remove exact recovery test root");
    }
}

fn frame(sequence: u64, command: &str, payload: Option<Value>) -> Vec<u8> {
    let mut request = json!({
        "protocol_version": MESSAGE_CACHE_WORKER_PROTOCOL_VERSION,
        "request_id": format!("recovery-{sequence}"),
        "sequence": sequence,
        "auth_token": TOKEN,
        "command": command
    });
    if let Some(payload) = payload {
        request["payload"] = payload;
    }
    serde_json::to_vec(&request).expect("request")
}

fn send(
    runtime: &mut RecoveryRuntime,
    sequence: u64,
    command: &str,
    payload: Option<Value>,
) -> ProcessedWorkerRequest {
    runtime.process_request_line(&frame(sequence, command, payload))
}

fn bootstrap(runtime: &mut RecoveryRuntime, root: &Path) {
    assert!(
        send(
            runtime,
            0,
            "worker.hello",
            Some(json!({ "cache_root": root }))
        )
        .response
        .ok
    );
}

fn open(runtime: &mut RecoveryRuntime, sequence: u64) -> ProcessedWorkerRequest {
    send(
        runtime,
        sequence,
        "scope.open",
        Some(json!({ "scope_handle": SCOPE })),
    )
}

fn check(runtime: &mut RecoveryRuntime, sequence: u64) -> ProcessedWorkerRequest {
    send(
        runtime,
        sequence,
        "scope.check_integrity",
        Some(json!({ "scope_handle": SCOPE })),
    )
}

fn rebuild_input(snapshot_hash: &str) -> MessageCacheWorkerRebuildInput {
    MessageCacheWorkerRebuildInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: REBUILD_OPERATION.to_owned(),
        expected_reason: CacheRecoveryReason::IntegrityConfirmedCorrupt,
        server_snapshot_hash: snapshot_hash.to_owned(),
        confirmed: true,
    }
}

fn rebuild(
    runtime: &mut RecoveryRuntime,
    sequence: u64,
    input: &MessageCacheWorkerRebuildInput,
) -> ProcessedWorkerRequest {
    send(
        runtime,
        sequence,
        "scope.rebuild",
        Some(serde_json::to_value(input).expect("rebuild payload")),
    )
}

fn projection() -> ConfirmedTimelineProjection {
    ConfirmedTimelineProjection {
        thread_id: "thread:recovery".to_owned(),
        sequence: 1,
        event_type: "message.confirmed".to_owned(),
        actor_type: ActorType::Service,
        occurred_at: "2026-07-29T00:00:00Z".to_owned(),
        masked_summary: "masked".to_owned(),
        payload_hash: "a".repeat(64),
        run_id: None,
        server_cursor: Some("cursor:recovery".to_owned()),
        delivery_state: DeliveryState::Confirmed,
        redaction_profile: RedactionProfile::SummaryOnlyV1,
    }
}

fn put(runtime: &mut RecoveryRuntime, sequence: u64) -> ProcessedWorkerRequest {
    send(
        runtime,
        sequence,
        "scope.put_confirmed",
        Some(json!({
            "scope_handle": SCOPE,
            "operation_id": PUT_OPERATION,
            "projection": projection()
        })),
    )
}

fn complete(runtime: &mut RecoveryRuntime, sequence: u64, count: u64) -> ProcessedWorkerRequest {
    let input = MessageCacheWorkerCompleteRebuildInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: REBUILD_OPERATION.to_owned(),
        server_snapshot_hash: SNAPSHOT_HASH.to_owned(),
        restored_projection_count: count,
        confirmed: true,
    };
    send(
        runtime,
        sequence,
        "scope.complete_rebuild",
        Some(serde_json::to_value(input).expect("complete payload")),
    )
}

fn digest() -> String {
    let digest: [u8; 32] = Sha256::digest(SCOPE.as_bytes()).into();
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn count_directories(path: &Path) -> usize {
    std::fs::read_dir(path)
        .expect("directory")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .count()
}

fn recovery_json_text(root: &Path) -> String {
    fn visit(path: &Path, output: &mut String) {
        for entry in std::fs::read_dir(path).expect("recovery evidence directory") {
            let entry = entry.expect("recovery evidence entry");
            let kind = entry.file_type().expect("recovery evidence type");
            if kind.is_dir() {
                visit(&entry.path(), output);
            } else if kind.is_file()
                && entry.path().extension().and_then(|value| value.to_str()) == Some("json")
            {
                output.push_str(
                    &String::from_utf8(std::fs::read(entry.path()).expect("recovery evidence"))
                        .expect("utf8 recovery evidence"),
                );
            }
        }
    }

    let mut output = String::new();
    visit(root, &mut output);
    output
}

fn assert_completed_replay_contract(root: &Path, input: &MessageCacheWorkerRebuildInput) {
    let (mut mismatch_runtime, mismatch_state, _) =
        recovery_runtime(IntegrityBehavior::Healthy, None);
    bootstrap(&mut mismatch_runtime, root);
    let mismatched = rebuild(&mut mismatch_runtime, 1, &rebuild_input(&"c".repeat(64)));
    assert!(!mismatched.response.ok);
    assert!(mismatched.should_shutdown);
    assert_eq!(
        mismatched.response.error.expect("replay mismatch").code,
        "CACHE_RECOVERY_OPERATION_REPLAY_MISMATCH"
    );
    assert_eq!(mismatch_state.borrow().open_calls, 0);
    mismatch_runtime.shutdown_on_eof();

    let (mut replay_runtime, replay_state, _) = recovery_runtime(IntegrityBehavior::Healthy, None);
    bootstrap(&mut replay_runtime, root);
    let replayed = rebuild(&mut replay_runtime, 1, input);
    assert!(replayed.response.ok);
    assert!(replayed.should_shutdown);
    assert_eq!(
        replayed.response.result.expect("replayed")["idempotency_replayed"],
        true
    );
    assert_eq!(replay_state.borrow().open_calls, 0);
    replay_runtime.shutdown_on_eof();
}

#[test]
fn integrity_results_are_distinct_and_failures_never_admit_quarantine() {
    for (label, behavior, expected_ok, expected_code) in [
        ("healthy", IntegrityBehavior::Healthy, true, None),
        (
            "check-failed",
            IntegrityBehavior::CheckFailed,
            false,
            Some("CACHE_INTEGRITY_CHECK_FAILED_RECONCILE_REQUIRED"),
        ),
        (
            "unknown",
            IntegrityBehavior::Unknown,
            false,
            Some("CACHE_INTEGRITY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"),
        ),
    ] {
        let root = recovery_root(label);
        let (mut runtime, _, _) = recovery_runtime(behavior, None);
        bootstrap(&mut runtime, &root);
        assert!(open(&mut runtime, 1).response.ok);
        let checked = check(&mut runtime, 2);
        assert_eq!(checked.response.ok, expected_ok);
        if expected_ok {
            assert_eq!(
                checked.response.result.expect("healthy")["integrity_status"],
                "healthy"
            );
        } else {
            assert!(checked.should_shutdown);
            assert_eq!(
                checked.response.error.expect("error").code,
                expected_code.expect("expected code")
            );
            assert_eq!(count_directories(&root.join("quarantine")), 0);
            assert_eq!(count_directories(&root.join("recovery").join("active")), 0);
        }
        runtime.shutdown_on_eof();
        remove_root(&root);
    }
}

#[test]
fn rebuild_requires_explicit_confirmation_before_filesystem_mutation() {
    let root = recovery_root("confirmation");
    let (mut runtime, _, _) = recovery_runtime(IntegrityBehavior::ConfirmedCorrupt, None);
    bootstrap(&mut runtime, &root);
    assert!(open(&mut runtime, 1).response.ok);
    assert!(check(&mut runtime, 2).response.ok);
    let mut input = rebuild_input(SNAPSHOT_HASH);
    input.confirmed = false;
    let rejected = rebuild(&mut runtime, 3, &input);
    assert!(!rejected.response.ok);
    assert!(!rejected.should_shutdown);
    assert_eq!(
        rejected.response.error.expect("confirmation").code,
        "CACHE_RECOVERY_CONFIRMATION_REQUIRED"
    );
    assert_eq!(count_directories(&root.join("quarantine")), 0);
    assert_eq!(count_directories(&root.join("recovery").join("active")), 0);
    runtime.shutdown_on_eof();
    remove_root(&root);
}

#[test]
fn confirmed_corruption_rebuilds_from_server_and_completion_replays() {
    let root = recovery_root("complete");
    let (mut runtime, state, revoke_calls) =
        recovery_runtime(IntegrityBehavior::ConfirmedCorrupt, None);
    bootstrap(&mut runtime, &root);
    assert!(open(&mut runtime, 1).response.ok);
    let checked = check(&mut runtime, 2);
    assert!(checked.response.ok);
    assert_eq!(
        checked.response.result.expect("corrupt")["scope_status"],
        "quarantine_required"
    );
    let input = rebuild_input(SNAPSHOT_HASH);
    let rebuilding = rebuild(&mut runtime, 3, &input);
    assert!(rebuilding.response.ok);
    assert_eq!(
        rebuilding.response.result.as_ref().expect("rebuild")["scope_status"],
        "restoring_from_server"
    );
    let forbidden_page = send(
        &mut runtime,
        4,
        "scope.page",
        Some(json!({
            "scope_handle": SCOPE,
            "thread_id": "thread:recovery",
            "after_sequence": null,
            "limit": 10
        })),
    );
    assert_eq!(
        forbidden_page.response.error.expect("page error").code,
        "CACHE_RESTORE_PAGE_FORBIDDEN"
    );
    assert!(put(&mut runtime, 5).response.ok);
    let mismatch = complete(&mut runtime, 6, 2);
    assert!(!mismatch.response.ok);
    assert!(!mismatch.should_shutdown);
    assert_eq!(
        mismatch.response.error.expect("mismatch").code,
        "CACHE_RESTORE_COMPLETION_MISMATCH"
    );
    let completed = complete(&mut runtime, 7, 1);
    assert!(completed.response.ok);
    assert!(completed.should_shutdown);
    let completed_result = completed.response.result.expect("completed");
    assert_eq!(completed_result["scope_status"], "restore_completed");
    assert_eq!(completed_result["restored_projection_count"], 1);
    runtime.shutdown_on_eof();
    assert_eq!(state.borrow().open_calls, 2);
    assert_eq!(state.borrow().close_calls, 2);
    assert_eq!(revoke_calls.get(), 2);
    assert_eq!(count_directories(&root.join("quarantine")), 1);
    assert_eq!(count_directories(&root.join("recovery").join("active")), 0);
    assert_eq!(
        count_directories(&root.join("recovery").join("completed")),
        1
    );
    let evidence_text = recovery_json_text(&root);
    assert!(!evidence_text.contains(SCOPE));
    assert!(!evidence_text.contains(&root.to_string_lossy().to_string()));
    assert!(!evidence_text.contains("masked"));

    assert_completed_replay_contract(&root, &input);
    remove_root(&root);
}

#[test]
fn interrupted_restore_is_quarantined_before_replay_from_empty() {
    let root = recovery_root("restart");
    let input = rebuild_input(SNAPSHOT_HASH);
    let (mut first, _, _) = recovery_runtime(IntegrityBehavior::ConfirmedCorrupt, None);
    bootstrap(&mut first, &root);
    assert!(open(&mut first, 1).response.ok);
    assert!(check(&mut first, 2).response.ok);
    assert!(rebuild(&mut first, 3, &input).response.ok);
    assert!(put(&mut first, 4).response.ok);
    first.shutdown_on_eof();

    let (mut resumed, state, _) = recovery_runtime(IntegrityBehavior::Healthy, None);
    bootstrap(&mut resumed, &root);
    let restarted = rebuild(&mut resumed, 1, &input);
    assert!(restarted.response.ok);
    assert_eq!(
        restarted.response.result.expect("restarted")["restored_projection_count"],
        0
    );
    assert_eq!(count_directories(&root.join("quarantine")), 2);
    let completed = complete(&mut resumed, 2, 0);
    assert!(completed.response.ok);
    assert!(completed.should_shutdown);
    assert_eq!(state.borrow().open_calls, 1);
    resumed.shutdown_on_eof();
    remove_root(&root);
}

#[test]
fn schema_mismatch_is_admitted_but_generic_open_failure_is_not() {
    let schema_root = recovery_root("schema");
    let (mut schema_runtime, _, _) = recovery_runtime(
        IntegrityBehavior::Healthy,
        Some("WCDB_NATIVE_SCHEMA_MISMATCH"),
    );
    bootstrap(&mut schema_runtime, &schema_root);
    let failed_open = open(&mut schema_runtime, 1);
    assert!(!failed_open.response.ok);
    assert!(!failed_open.should_shutdown);
    assert_eq!(
        failed_open.response.error.expect("schema").code,
        "CACHE_SCHEMA_MISMATCH_QUARANTINE_REQUIRED"
    );
    let mut input = rebuild_input(SNAPSHOT_HASH);
    input.expected_reason = CacheRecoveryReason::DecryptedSchemaMismatch;
    assert!(rebuild(&mut schema_runtime, 2, &input).response.ok);
    assert!(complete(&mut schema_runtime, 3, 0).response.ok);
    schema_runtime.shutdown_on_eof();
    remove_root(&schema_root);

    let wrong_key_root = recovery_root("wrong-key");
    let (mut wrong_key_runtime, _, _) = recovery_runtime(
        IntegrityBehavior::Healthy,
        Some("WCDB_NATIVE_SCOPE_KEY_REJECTED"),
    );
    bootstrap(&mut wrong_key_runtime, &wrong_key_root);
    let wrong_key = open(&mut wrong_key_runtime, 1);
    assert!(!wrong_key.response.ok);
    assert!(wrong_key.should_shutdown);
    assert_eq!(
        wrong_key.response.error.expect("wrong key").code,
        "WCDB_NATIVE_SCOPE_KEY_REJECTED"
    );
    assert_eq!(count_directories(&wrong_key_root.join("quarantine")), 0);
    assert_eq!(
        count_directories(&wrong_key_root.join("recovery").join("active")),
        0
    );
    wrong_key_runtime.shutdown_on_eof();
    remove_root(&wrong_key_root);
}

#[test]
fn forged_or_mismatched_recovery_state_fails_closed_without_moving_partial_data() {
    let root = recovery_root("forged");
    let input = rebuild_input(SNAPSHOT_HASH);
    let (mut first, _, _) = recovery_runtime(IntegrityBehavior::ConfirmedCorrupt, None);
    bootstrap(&mut first, &root);
    assert!(open(&mut first, 1).response.ok);
    assert!(check(&mut first, 2).response.ok);
    assert!(rebuild(&mut first, 3, &input).response.ok);
    first.shutdown_on_eof();

    let active = root.join("recovery").join("active").join(digest());
    let latest = active.join("record-0002.json");
    let mut forged: Value =
        serde_json::from_slice(&std::fs::read(&latest).expect("journal")).expect("json");
    forged["unknown_field"] = json!("forged");
    std::fs::write(
        &latest,
        serde_json::to_vec(&forged).expect("forged journal"),
    )
    .expect("write forged journal");
    let quarantine_before = count_directories(&root.join("quarantine"));
    let scopes_before = count_directories(&root.join("scopes"));

    let (mut resumed, _, _) = recovery_runtime(IntegrityBehavior::Healthy, None);
    bootstrap(&mut resumed, &root);
    let rejected = rebuild(&mut resumed, 1, &input);
    assert!(!rejected.response.ok);
    assert!(rejected.should_shutdown);
    assert_eq!(
        rejected.response.error.expect("invalid journal").code,
        "CACHE_RECOVERY_JOURNAL_INVALID"
    );
    assert_eq!(
        count_directories(&root.join("quarantine")),
        quarantine_before
    );
    assert_eq!(count_directories(&root.join("scopes")), scopes_before);
    resumed.shutdown_on_eof();
    remove_root(&root);
}

#[cfg(unix)]
#[test]
fn symlinked_recovery_directory_is_rejected_before_any_quarantine() {
    use std::os::unix::fs::symlink;

    let root = recovery_root("symlink");
    let outside = recovery_root("outside");
    let (mut runtime, _, _) = recovery_runtime(IntegrityBehavior::Healthy, None);
    bootstrap(&mut runtime, &root);
    std::fs::create_dir_all(&outside).expect("outside");
    symlink(
        &outside,
        root.join("recovery").join("active").join(digest()),
    )
    .expect("active symlink");
    let rejected = rebuild(&mut runtime, 1, &rebuild_input(SNAPSHOT_HASH));
    assert!(!rejected.response.ok);
    assert!(rejected.should_shutdown);
    assert_eq!(
        rejected.response.error.expect("unsafe").code,
        "CACHE_RECOVERY_PATH_UNSAFE"
    );
    assert_eq!(count_directories(&root.join("quarantine")), 0);
    runtime.shutdown_on_eof();
    remove_root(&root);
    remove_root(&outside);
}
