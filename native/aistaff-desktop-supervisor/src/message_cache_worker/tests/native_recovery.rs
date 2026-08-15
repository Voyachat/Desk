use super::contracts::{MESSAGE_CACHE_WORKER_PROTOCOL_VERSION, ProcessedWorkerRequest};
use super::key_provider::{CacheKeyProviderError, CacheKeyProviderPort, CacheScopeKey};
use super::packaged_scope_driver::PackagedEncryptedScopeDriver;
use super::recovery_contracts::{
    CacheRecoveryReason, MessageCacheWorkerCompleteRebuildInput, MessageCacheWorkerRebuildInput,
};
use super::retention::{CacheClockError, CacheClockPort, CacheRetentionPolicy};
use super::runtime::MessageCacheWorkerRuntime;
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, PageInput, PutConfirmedInput,
    RedactionProfile,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const SCOPE: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REBUILD_OPERATION: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PUT_OPERATION: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SNAPSHOT_HASH: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct NativeE2eKeyProvider;

impl CacheKeyProviderPort for NativeE2eKeyProvider {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        CacheScopeKey::new(vec![0x42; 32])
    }

    fn revoke_scope(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct FixedClock;

impl CacheClockPort for FixedClock {
    fn now_epoch_seconds(&self) -> Result<i64, CacheClockError> {
        Ok(3_000)
    }
}

type NativeRuntime =
    MessageCacheWorkerRuntime<NativeE2eKeyProvider, PackagedEncryptedScopeDriver, FixedClock>;

#[test]
fn packaged_native_runtime_rebuilds_confirmed_corruption_when_required() {
    let Some((executable, fixture)) = required_native_e2e_paths() else {
        return;
    };
    let root = native_recovery_root();
    let mut runtime = native_runtime(&executable);
    bootstrap(&mut runtime, &root);
    install_corrupt_fixture(&root, &fixture);
    assert!(
        send(&mut runtime, 1, "scope.open", scope_payload())
            .response
            .ok
    );
    let integrity = send(&mut runtime, 2, "scope.check_integrity", scope_payload());
    assert_eq!(
        integrity.response.result.expect("confirmed corruption"),
        json!({
            "integrity_status": "confirmed_corrupt",
            "scope_status": "quarantine_required",
            "reason": "integrity_confirmed_corrupt"
        })
    );
    let rebuild = rebuild_scope(&mut runtime, 3);
    assert!(rebuild.response.ok);
    assert_eq!(
        rebuild.response.result.as_ref().expect("rebuild")["scope_status"],
        "restoring_from_server"
    );
    assert!(put_projection(&mut runtime, 4).response.ok);
    let completed = complete_rebuild(&mut runtime, 5);
    assert!(completed.response.ok);
    assert!(completed.should_shutdown);
    runtime.shutdown_on_eof();
    assert_recovery_artifacts(&root);
    assert_completed_replay(&executable, &root);
    assert_restored_projection(&executable, &root);
    fs::remove_dir_all(&root).expect("remove native recovery root");
}

fn required_native_e2e_paths() -> Option<(PathBuf, PathBuf)> {
    let required = std::env::var("AISTAFF_WCDB_NATIVE_E2E_REQUIRED").as_deref() == Ok("1");
    let executable = std::env::var_os("AISTAFF_WCDB_NATIVE_E2E_EXECUTABLE");
    let fixture = std::env::var_os("AISTAFF_WCDB_NATIVE_E2E_CORRUPT_FIXTURE");
    match (executable, fixture) {
        (Some(executable), Some(fixture)) => {
            let executable = PathBuf::from(executable);
            let fixture = PathBuf::from(fixture);
            assert!(executable.is_absolute());
            assert!(fixture.is_absolute());
            Some((executable, fixture))
        }
        (None, None) if !required => None,
        _ => panic!("required packaged native recovery E2E input is missing"),
    }
}

fn native_runtime(executable: &Path) -> NativeRuntime {
    MessageCacheWorkerRuntime::with_clock(
        NativeE2eKeyProvider,
        PackagedEncryptedScopeDriver::from_executable(executable),
        FixedClock,
        CacheRetentionPolicy::default(),
    )
}

fn native_recovery_root() -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::current_dir()
        .expect("cwd")
        .join("target")
        .join("packaged-native-recovery-e2e")
        .join(format!("{}-{nonce}-{sequence}", std::process::id()))
}

fn bootstrap(runtime: &mut NativeRuntime, root: &Path) {
    fs::create_dir_all(root).expect("native recovery root");
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

fn install_corrupt_fixture(root: &Path, fixture: &Path) {
    let digest: [u8; 32] = Sha256::digest(SCOPE.as_bytes()).into();
    let scope = root.join("scopes").join(
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    );
    fs::create_dir(&scope).expect("fixture scope");
    let mut copied = 0;
    for suffix in ["", "-wal", "-shm"] {
        let source = family_path(fixture, suffix);
        let Ok(metadata) = fs::symlink_metadata(&source) else {
            continue;
        };
        assert!(metadata.is_file() && !metadata.file_type().is_symlink());
        if metadata.len() == 0 {
            assert!(!suffix.is_empty());
            continue;
        }
        assert!(metadata.len() <= 32 * 1024 * 1024);
        fs::copy(&source, family_path(&scope.join("cache.db"), suffix))
            .expect("copy corrupt fixture family");
        copied += 1;
    }
    assert!(copied >= 1);
}

fn family_path(base: &Path, suffix: &str) -> PathBuf {
    let mut path = OsString::from(base.as_os_str());
    path.push(suffix);
    PathBuf::from(path)
}

fn frame(sequence: u64, command: &str, payload: Option<Value>) -> Vec<u8> {
    let mut request = json!({
        "protocol_version": MESSAGE_CACHE_WORKER_PROTOCOL_VERSION,
        "request_id": format!("native-recovery-{sequence}"),
        "sequence": sequence,
        "auth_token": TOKEN,
        "command": command
    });
    if let Some(payload) = payload {
        request["payload"] = payload;
    }
    serde_json::to_vec(&request).expect("native recovery request")
}

fn send(
    runtime: &mut NativeRuntime,
    sequence: u64,
    command: &str,
    payload: Option<Value>,
) -> ProcessedWorkerRequest {
    runtime.process_request_line(&frame(sequence, command, payload))
}

fn scope_payload() -> Option<Value> {
    Some(json!({ "scope_handle": SCOPE }))
}

fn rebuild_input() -> MessageCacheWorkerRebuildInput {
    MessageCacheWorkerRebuildInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: REBUILD_OPERATION.to_owned(),
        expected_reason: CacheRecoveryReason::IntegrityConfirmedCorrupt,
        server_snapshot_hash: SNAPSHOT_HASH.to_owned(),
        confirmed: true,
    }
}

fn rebuild_scope(runtime: &mut NativeRuntime, sequence: u64) -> ProcessedWorkerRequest {
    send(
        runtime,
        sequence,
        "scope.rebuild",
        Some(serde_json::to_value(rebuild_input()).expect("rebuild input")),
    )
}

fn projection() -> ConfirmedTimelineProjection {
    ConfirmedTimelineProjection {
        thread_id: "thread:native-recovery".to_owned(),
        sequence: 1,
        event_type: "message.confirmed".to_owned(),
        actor_type: ActorType::Service,
        occurred_at: "2026-07-29T00:00:00Z".to_owned(),
        masked_summary: "native recovery summary".to_owned(),
        payload_hash: "f".repeat(64),
        run_id: Some("run:native-recovery".to_owned()),
        server_cursor: Some("cursor:native-recovery".to_owned()),
        delivery_state: DeliveryState::Confirmed,
        redaction_profile: RedactionProfile::SummaryOnlyV1,
    }
}

fn put_projection(runtime: &mut NativeRuntime, sequence: u64) -> ProcessedWorkerRequest {
    let input = PutConfirmedInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: PUT_OPERATION.to_owned(),
        projection: projection(),
    };
    send(
        runtime,
        sequence,
        "scope.put_confirmed",
        Some(serde_json::to_value(input).expect("put input")),
    )
}

fn complete_rebuild(runtime: &mut NativeRuntime, sequence: u64) -> ProcessedWorkerRequest {
    let input = MessageCacheWorkerCompleteRebuildInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: REBUILD_OPERATION.to_owned(),
        server_snapshot_hash: SNAPSHOT_HASH.to_owned(),
        restored_projection_count: 1,
        confirmed: true,
    };
    send(
        runtime,
        sequence,
        "scope.complete_rebuild",
        Some(serde_json::to_value(input).expect("complete input")),
    )
}

fn assert_recovery_artifacts(root: &Path) {
    assert_eq!(directory_count(&root.join("quarantine")), 1);
    assert_eq!(directory_count(&root.join("recovery").join("completed")), 1);
    assert_eq!(directory_count(&root.join("recovery").join("active")), 0);
}

fn assert_completed_replay(executable: &Path, root: &Path) {
    let mut replay = native_runtime(executable);
    bootstrap(&mut replay, root);
    let completed = rebuild_scope(&mut replay, 1);
    assert!(completed.response.ok);
    assert!(completed.should_shutdown);
    let result = completed.response.result.expect("completed replay");
    assert_eq!(result["scope_status"], "restore_completed");
    assert_eq!(result["idempotency_replayed"], true);
    assert_eq!(result["restored_projection_count"], 1);
    replay.shutdown_on_eof();
}

fn assert_restored_projection(executable: &Path, root: &Path) {
    let mut reader = native_runtime(executable);
    bootstrap(&mut reader, root);
    assert!(
        send(&mut reader, 1, "scope.open", scope_payload())
            .response
            .ok
    );
    let page = PageInput {
        scope_handle: SCOPE.to_owned(),
        thread_id: projection().thread_id,
        after_sequence: None,
        limit: 10,
    };
    let result = send(
        &mut reader,
        2,
        "scope.page",
        Some(serde_json::to_value(page).expect("page input")),
    );
    assert_eq!(
        result.response.result.expect("restored page")["projections"],
        json!([projection()])
    );
    let closed = send(&mut reader, 3, "scope.close", scope_payload());
    assert!(closed.response.ok);
    assert!(closed.should_shutdown);
    reader.shutdown_on_eof();
}

fn directory_count(path: &Path) -> usize {
    fs::read_dir(path)
        .expect("recovery directory")
        .map(|entry| entry.expect("recovery entry"))
        .filter(|entry| entry.file_type().expect("entry type").is_dir())
        .count()
}
