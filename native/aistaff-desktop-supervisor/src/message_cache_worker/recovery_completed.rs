use super::path::{AdmittedCacheRoot, ScopeCachePaths};
use super::recovery::RecoveryError;
use super::recovery_contracts::{
    MessageCacheWorkerRebuildInput, RecoveryJournalState, valid_sha256,
};
use super::recovery_journal::load_journal;
use std::fs::read_dir;

const COMPLETED_SCAN_LIMIT: usize = 512;

pub(crate) fn reject_completed_operation_mismatch(
    root: &AdmittedCacheRoot,
    input: &MessageCacheWorkerRebuildInput,
    paths: &ScopeCachePaths,
    request_hash: &str,
) -> Result<(), RecoveryError> {
    let prefix = format!("{}-", paths.scope_digest);
    let entries = read_dir(root.recovery_completed_root()).map_err(|_| RecoveryError {
        code: "CACHE_RECOVERY_COMPLETED_INDEX_UNAVAILABLE",
    })?;
    for (index, entry) in entries.enumerate() {
        if index >= COMPLETED_SCAN_LIMIT {
            return Err(RecoveryError {
                code: "CACHE_RECOVERY_COMPLETED_INDEX_LIMIT_EXCEEDED",
            });
        }
        let entry = entry.map_err(|_| RecoveryError {
            code: "CACHE_RECOVERY_COMPLETED_INDEX_UNAVAILABLE",
        })?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(stored_hash) = name.strip_prefix(&prefix) else {
            continue;
        };
        let file_type = entry.file_type().map_err(|_| RecoveryError {
            code: "CACHE_RECOVERY_COMPLETED_INDEX_UNAVAILABLE",
        })?;
        if !valid_sha256(stored_hash) || file_type.is_symlink() || !file_type.is_dir() {
            return Err(invalid_journal());
        }
        let journal = load_journal(&entry.path()).map_err(RecoveryError::from)?;
        if journal.latest.state != RecoveryJournalState::Completed
            || journal.latest.scope_digest != paths.scope_digest
            || journal.latest.request_hash != stored_hash
        {
            return Err(invalid_journal());
        }
        if journal.latest.operation_id == input.operation_id {
            if stored_hash != request_hash {
                return Err(RecoveryError {
                    code: "CACHE_RECOVERY_OPERATION_REPLAY_MISMATCH",
                });
            }
            return Err(RecoveryError {
                code: "CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED",
            });
        }
    }
    Ok(())
}

fn invalid_journal() -> RecoveryError {
    RecoveryError {
        code: "CACHE_RECOVERY_JOURNAL_INVALID",
    }
}
