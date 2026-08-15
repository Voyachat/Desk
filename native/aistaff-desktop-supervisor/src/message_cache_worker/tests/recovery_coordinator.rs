use super::*;
use crate::message_cache_worker::path::AdmittedCacheRoot;
use crate::message_cache_worker::recovery_contracts::{
    CacheRecoveryReason, RECOVERY_SCHEMA, RECOVERY_SCHEMA_VERSION, RecoveryJournalRecord,
    RecoveryJournalState,
};
use crate::message_cache_worker::recovery_journal::{append_record, create_journal};
use crate::message_cache_worker::request_hash::{hex_hash, rebuild_request_hash};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const SCOPE: &str = "11111111-1111-4111-8111-111111111111";
const OPERATION: &str = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const INCIDENT: &str = "11111111111111111111111111111111";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join("recovery-coordinator-tests")
        .join(format!("{label}-{}-{sequence}", std::process::id()))
}

fn remove_test_root(root: &Path) {
    if root.exists() {
        std::fs::remove_dir_all(root).expect("remove exact coordinator test root");
    }
}

fn input() -> MessageCacheWorkerRebuildInput {
    MessageCacheWorkerRebuildInput {
        scope_handle: SCOPE.to_owned(),
        operation_id: OPERATION.to_owned(),
        expected_reason: CacheRecoveryReason::IntegrityConfirmedCorrupt,
        server_snapshot_hash: SNAPSHOT.to_owned(),
        confirmed: true,
    }
}

fn initial_record(
    scope_digest: &str,
    input: &MessageCacheWorkerRebuildInput,
) -> RecoveryJournalRecord {
    RecoveryJournalRecord {
        schema: RECOVERY_SCHEMA.to_owned(),
        version: RECOVERY_SCHEMA_VERSION,
        sequence: 0,
        scope_digest: scope_digest.to_owned(),
        operation_id: input.operation_id.clone(),
        request_hash: hex_hash(&rebuild_request_hash(input)),
        incident_id: INCIDENT.to_owned(),
        reason: input.expected_reason,
        state: RecoveryJournalState::Prepared,
        created_at_epoch_s: 1_000,
        updated_at_epoch_s: 1_000,
        server_snapshot_hash: input.server_snapshot_hash.clone(),
        restored_projection_count: 0,
        restart_count: 0,
        evidence_hash: String::new(),
    }
}

fn admitted_with_scope(label: &str) -> (PathBuf, AdmittedCacheRoot, ScopeCachePaths) {
    let root = test_root(label);
    let admitted = AdmittedCacheRoot::admit(&root).expect("admitted root");
    let paths = admitted.scope_paths(SCOPE).expect("scope paths");
    admitted
        .ensure_scope_directory(&paths.scope_directory)
        .expect("scope directory");
    std::fs::write(&paths.database_path, b"encrypted-cache").expect("database");
    (root, admitted, paths)
}

#[test]
fn preparing_journal_resumes_through_atomic_quarantine() {
    let input = input();
    let (root, admitted, paths) = admitted_with_scope("preparing");
    let preparing = paths.preparing_recovery_directory.clone();
    create_journal(&preparing, initial_record(&paths.scope_digest, &input))
        .expect("prepared journal");

    let start = RecoveryCoordinator::new(&admitted)
        .start(&input, None, 1_001)
        .expect("resume");
    assert!(matches!(start, RecoveryStart::Open(_)));
    assert!(!preparing.exists());
    assert!(paths.active_recovery_directory.is_dir());
    assert!(admitted.quarantine_root().join(INCIDENT).is_dir());
    assert!(paths.scope_directory.is_dir());
    remove_test_root(&root);
}

#[test]
fn rename_committed_before_journal_append_is_reconciled() {
    let input = input();
    let (root, admitted, paths) = admitted_with_scope("renamed");
    create_journal(
        &paths.active_recovery_directory,
        initial_record(&paths.scope_digest, &input),
    )
    .expect("active prepared journal");
    let quarantined = admitted.quarantine_root().join(INCIDENT);
    std::fs::rename(&paths.scope_directory, &quarantined).expect("simulate committed rename");

    let start = RecoveryCoordinator::new(&admitted)
        .start(&input, None, 1_001)
        .expect("reconcile");
    assert!(matches!(start, RecoveryStart::Open(_)));
    assert!(quarantined.join("manifest.json").is_file());
    assert!(paths.scope_directory.is_dir());
    remove_test_root(&root);
}

#[test]
fn completed_record_is_archived_and_replayed_without_reopening() {
    let input = input();
    let (root, admitted, paths) = admitted_with_scope("completed");
    let mut journal = create_journal(
        &paths.active_recovery_directory,
        initial_record(&paths.scope_digest, &input),
    )
    .expect("active journal");
    let quarantined = next_record(
        &journal.latest,
        RecoveryJournalState::Quarantined,
        1_001,
        0,
        0,
    );
    append_record(&mut journal, quarantined).expect("quarantined");
    let restoring = next_record(
        &journal.latest,
        RecoveryJournalState::Restoring,
        1_002,
        0,
        0,
    );
    append_record(&mut journal, restoring).expect("restoring");
    let completed = next_record(
        &journal.latest,
        RecoveryJournalState::Completed,
        1_003,
        7,
        0,
    );
    append_record(&mut journal, completed).expect("completed");

    let start = RecoveryCoordinator::new(&admitted)
        .start(&input, None, 1_004)
        .expect("archive completion");
    let RecoveryStart::Completed(evidence) = start else {
        panic!("expected completed recovery");
    };
    assert_eq!(evidence.restored_projection_count, 7);
    assert!(!paths.active_recovery_directory.exists());
    assert_eq!(
        std::fs::read_dir(admitted.recovery_completed_root())
            .expect("completed root")
            .count(),
        1
    );
    remove_test_root(&root);
}

#[test]
fn duplicate_or_oversized_journal_state_fails_closed() {
    let input = input();
    let (root, admitted, paths) = admitted_with_scope("invalid");
    let preparing = paths.preparing_recovery_directory.clone();
    std::fs::create_dir(&preparing).expect("preparing");
    std::fs::create_dir(&paths.active_recovery_directory).expect("active");
    let duplicate = RecoveryCoordinator::new(&admitted)
        .start(&input, None, 1_001)
        .expect_err("duplicate state");
    assert_eq!(
        duplicate.code,
        "CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
    );
    remove_test_root(&root);

    let (root, admitted, paths) = admitted_with_scope("oversized");
    std::fs::create_dir(&paths.active_recovery_directory).expect("active");
    std::fs::write(
        paths.active_recovery_directory.join("record-0000.json"),
        vec![b'x'; 8 * 1024 + 1],
    )
    .expect("oversized record");
    let oversized = RecoveryCoordinator::new(&admitted)
        .start(&input, None, 1_001)
        .expect_err("oversized state");
    assert_eq!(oversized.code, "CACHE_RECOVERY_JOURNAL_INVALID");
    remove_test_root(&root);
}
