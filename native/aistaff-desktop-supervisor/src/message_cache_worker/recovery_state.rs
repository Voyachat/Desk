use super::recovery::{RecoveryError, RecoveryEvidence};
use super::recovery_contracts::{RecoveryJournalRecord, RecoveryJournalState};
use super::recovery_journal::{path_exists, rename_directory, require_directory};
use std::path::Path;

pub(crate) fn next_record(
    current: &RecoveryJournalRecord,
    state: RecoveryJournalState,
    now_epoch_s: i64,
    restored_projection_count: u64,
    restart_count: u16,
) -> RecoveryJournalRecord {
    let mut next = current.clone();
    next.state = state;
    next.updated_at_epoch_s = now_epoch_s.max(current.updated_at_epoch_s);
    next.restored_projection_count = restored_projection_count;
    next.restart_count = restart_count;
    next.evidence_hash.clear();
    next
}

pub(crate) fn reconcile_rename(source: &Path, destination: &Path) -> Result<(), RecoveryError> {
    let source_exists = path_exists(source)?;
    let destination_exists = path_exists(destination)?;
    match (source_exists, destination_exists) {
        (true, false) => rename_directory(source, destination).map_err(Into::into),
        (false, true) => {
            require_directory(destination)?;
            Ok(())
        }
        _ => Err(unknown_state()),
    }
}

pub(crate) fn evidence(record: &RecoveryJournalRecord) -> RecoveryEvidence {
    RecoveryEvidence {
        incident_id: record.incident_id.clone(),
        evidence_hash: record.evidence_hash.clone(),
        restored_projection_count: record.restored_projection_count,
    }
}

pub(crate) fn invalid_journal() -> RecoveryError {
    RecoveryError {
        code: "CACHE_RECOVERY_JOURNAL_INVALID",
    }
}

pub(crate) fn unknown_state() -> RecoveryError {
    RecoveryError {
        code: "CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED",
    }
}
