use super::path::{AdmittedCacheRoot, ScopeCachePaths};
use super::random::random_hex;
use super::recovery_completed::reject_completed_operation_mismatch;
use super::recovery_contracts::{
    ActiveRestore, MessageCacheWorkerRebuildInput, QuarantineKind, QuarantineManifest,
    RECOVERY_SCHEMA, RECOVERY_SCHEMA_VERSION, RecoveryAdmission, RecoveryJournalRecord,
    RecoveryJournalState,
};
use super::recovery_journal::{
    LoadedJournal, RecoveryFsError, append_record, create_journal, load_journal, path_exists,
    relocate_journal, require_directory, write_or_validate_manifest,
};
use super::recovery_state::{
    evidence, invalid_journal, next_record, reconcile_rename, unknown_state,
};
use super::request_hash::{hex_hash, rebuild_request_hash};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RecoveryError {
    pub code: &'static str,
}

impl From<RecoveryFsError> for RecoveryError {
    fn from(value: RecoveryFsError) -> Self {
        Self { code: value.code }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecoveryEvidence {
    pub incident_id: String,
    pub evidence_hash: String,
    pub restored_projection_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecoveryOpenPlan {
    pub database_path: PathBuf,
    pub restore: ActiveRestore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RecoveryStart {
    Open(RecoveryOpenPlan),
    Completed(RecoveryEvidence),
}

struct RecoveryLocations {
    paths: ScopeCachePaths,
    request_hash: [u8; 32],
    request_hash_hex: String,
    preparing: PathBuf,
    completed: PathBuf,
}

enum StartingRecovery {
    Journal(LoadedJournal),
    Completed(RecoveryEvidence),
}

pub(crate) struct RecoveryCoordinator<'root> {
    root: &'root AdmittedCacheRoot,
}

impl<'root> RecoveryCoordinator<'root> {
    pub const fn new(root: &'root AdmittedCacheRoot) -> Self {
        Self { root }
    }

    pub fn start(
        &self,
        input: &MessageCacheWorkerRebuildInput,
        admission: Option<&RecoveryAdmission>,
        now_epoch_s: i64,
    ) -> Result<RecoveryStart, RecoveryError> {
        input.validate().map_err(|code| RecoveryError { code })?;
        if now_epoch_s <= 0 {
            return Err(RecoveryError {
                code: "CACHE_CLOCK_UNAVAILABLE",
            });
        }
        let locations = self.recovery_locations(input)?;
        let mut journal =
            match self.load_starting_recovery(input, admission, &locations, now_epoch_s)? {
                StartingRecovery::Journal(journal) => journal,
                StartingRecovery::Completed(evidence) => {
                    return Ok(RecoveryStart::Completed(evidence));
                }
            };
        self.match_request(
            &journal,
            input,
            &locations.paths,
            &locations.request_hash_hex,
        )?;
        if journal.latest.state == RecoveryJournalState::Completed {
            self.archive_completed(&mut journal, &locations.completed)?;
            return Ok(RecoveryStart::Completed(evidence(&journal.latest)));
        }
        if journal.latest.state == RecoveryJournalState::Prepared {
            self.quarantine_original(&locations.paths, &mut journal, now_epoch_s)?;
        }
        if journal.latest.state == RecoveryJournalState::Restoring {
            self.quarantine_partial(&locations.paths, &mut journal, now_epoch_s, true)?;
        } else if journal.latest.state == RecoveryJournalState::Quarantined {
            self.quarantine_partial(&locations.paths, &mut journal, now_epoch_s, false)?;
        }
        if journal.latest.state != RecoveryJournalState::Quarantined {
            return Err(invalid_journal());
        }
        self.root
            .ensure_scope_directory(&locations.paths.scope_directory)
            .map_err(|error| RecoveryError { code: error.code })?;
        Ok(RecoveryStart::Open(RecoveryOpenPlan {
            database_path: locations.paths.database_path,
            restore: ActiveRestore {
                scope_handle: input.scope_handle.clone(),
                operation_id: input.operation_id.clone(),
                request_hash: locations.request_hash,
                server_snapshot_hash: input.server_snapshot_hash.clone(),
                incident_id: journal.latest.incident_id.clone(),
                evidence_hash: journal.latest.evidence_hash.clone(),
                restored_projection_count: 0,
            },
        }))
    }

    fn recovery_locations(
        &self,
        input: &MessageCacheWorkerRebuildInput,
    ) -> Result<RecoveryLocations, RecoveryError> {
        let paths = self
            .root
            .scope_paths(&input.scope_handle)
            .map_err(|error| RecoveryError { code: error.code })?;
        let request_hash = rebuild_request_hash(input);
        let request_hash_hex = hex_hash(&request_hash);
        let preparing = paths.preparing_recovery_directory.clone();
        let completed = self.completed_path(&paths.scope_digest, &request_hash_hex);
        Ok(RecoveryLocations {
            paths,
            request_hash,
            request_hash_hex,
            preparing,
            completed,
        })
    }

    fn load_starting_recovery(
        &self,
        input: &MessageCacheWorkerRebuildInput,
        admission: Option<&RecoveryAdmission>,
        locations: &RecoveryLocations,
        now_epoch_s: i64,
    ) -> Result<StartingRecovery, RecoveryError> {
        let active = &locations.paths.active_recovery_directory;
        let preparing_exists = path_exists(&locations.preparing)?;
        let active_exists = path_exists(active)?;
        if path_exists(&locations.completed)? {
            if preparing_exists || active_exists {
                return Err(unknown_state());
            }
            let journal = load_journal(&locations.completed)?;
            self.match_request(
                &journal,
                input,
                &locations.paths,
                &locations.request_hash_hex,
            )?;
            if journal.latest.state != RecoveryJournalState::Completed {
                return Err(invalid_journal());
            }
            return Ok(StartingRecovery::Completed(evidence(&journal.latest)));
        }
        if preparing_exists && active_exists {
            return Err(unknown_state());
        }
        if !preparing_exists && !active_exists {
            reject_completed_operation_mismatch(
                self.root,
                input,
                &locations.paths,
                &locations.request_hash_hex,
            )?;
        }
        let journal = if active_exists {
            load_journal(active)?
        } else if preparing_exists {
            let mut journal = load_journal(&locations.preparing)?;
            self.match_request(
                &journal,
                input,
                &locations.paths,
                &locations.request_hash_hex,
            )?;
            relocate_journal(&mut journal, active)?;
            journal
        } else {
            self.create_prepared_journal(
                input,
                admission,
                &locations.paths,
                &locations.request_hash_hex,
                &locations.preparing,
                now_epoch_s,
            )?
        };
        Ok(StartingRecovery::Journal(journal))
    }

    pub fn mark_restoring(
        &self,
        restore: &mut ActiveRestore,
        now_epoch_s: i64,
    ) -> Result<(), RecoveryError> {
        let paths = self
            .root
            .scope_paths(&restore.scope_handle)
            .map_err(|error| RecoveryError { code: error.code })?;
        let mut journal = load_journal(&paths.active_recovery_directory)?;
        self.match_restore(&journal, restore, &paths)?;
        if journal.latest.state != RecoveryJournalState::Quarantined {
            return Err(invalid_journal());
        }
        let next = next_record(
            &journal.latest,
            RecoveryJournalState::Restoring,
            now_epoch_s,
            0,
            journal.latest.restart_count,
        );
        append_record(&mut journal, next)?;
        restore.evidence_hash = journal.latest.evidence_hash;
        Ok(())
    }

    pub fn complete(
        &self,
        restore: &ActiveRestore,
        now_epoch_s: i64,
    ) -> Result<RecoveryEvidence, RecoveryError> {
        let paths = self
            .root
            .scope_paths(&restore.scope_handle)
            .map_err(|error| RecoveryError { code: error.code })?;
        let mut journal = load_journal(&paths.active_recovery_directory)?;
        self.match_restore(&journal, restore, &paths)?;
        if journal.latest.state != RecoveryJournalState::Restoring {
            return Err(invalid_journal());
        }
        let next = next_record(
            &journal.latest,
            RecoveryJournalState::Completed,
            now_epoch_s,
            restore.restored_projection_count,
            journal.latest.restart_count,
        );
        append_record(&mut journal, next)?;
        let completed = self.completed_path(&paths.scope_digest, &journal.latest.request_hash);
        self.archive_completed(&mut journal, &completed)?;
        Ok(evidence(&journal.latest))
    }

    fn create_prepared_journal(
        &self,
        input: &MessageCacheWorkerRebuildInput,
        admission: Option<&RecoveryAdmission>,
        paths: &ScopeCachePaths,
        request_hash: &str,
        preparing: &Path,
        now_epoch_s: i64,
    ) -> Result<LoadedJournal, RecoveryError> {
        let admission = admission.ok_or(RecoveryError {
            code: "CACHE_RECOVERY_ADMISSION_REQUIRED",
        })?;
        if admission.scope_handle != input.scope_handle || admission.reason != input.expected_reason
        {
            return Err(RecoveryError {
                code: "CACHE_RECOVERY_ADMISSION_MISMATCH",
            });
        }
        require_directory(&paths.scope_directory)?;
        let incident_id = random_hex(16).map_err(|_| RecoveryError {
            code: "CACHE_RECOVERY_RANDOM_UNAVAILABLE",
        })?;
        let initial = RecoveryJournalRecord {
            schema: RECOVERY_SCHEMA.to_owned(),
            version: RECOVERY_SCHEMA_VERSION,
            sequence: 0,
            scope_digest: paths.scope_digest.clone(),
            operation_id: input.operation_id.clone(),
            request_hash: request_hash.to_owned(),
            incident_id,
            reason: input.expected_reason,
            state: RecoveryJournalState::Prepared,
            created_at_epoch_s: now_epoch_s,
            updated_at_epoch_s: now_epoch_s,
            server_snapshot_hash: input.server_snapshot_hash.clone(),
            restored_projection_count: 0,
            restart_count: 0,
            evidence_hash: String::new(),
        };
        let mut journal = create_journal(preparing, initial)?;
        relocate_journal(&mut journal, &paths.active_recovery_directory)?;
        Ok(journal)
    }

    fn quarantine_original(
        &self,
        paths: &ScopeCachePaths,
        journal: &mut LoadedJournal,
        now_epoch_s: i64,
    ) -> Result<(), RecoveryError> {
        let destination = self
            .root
            .quarantine_root()
            .join(&journal.latest.incident_id);
        reconcile_rename(&paths.scope_directory, &destination)?;
        self.write_manifest(
            &destination,
            journal,
            &journal.latest.incident_id,
            QuarantineKind::CorruptProjection,
            journal.latest.created_at_epoch_s,
        )?;
        let next = next_record(
            &journal.latest,
            RecoveryJournalState::Quarantined,
            now_epoch_s,
            0,
            journal.latest.restart_count,
        );
        append_record(journal, next)?;
        Ok(())
    }

    fn quarantine_partial(
        &self,
        paths: &ScopeCachePaths,
        journal: &mut LoadedJournal,
        now_epoch_s: i64,
        source_required: bool,
    ) -> Result<(), RecoveryError> {
        let source_exists = path_exists(&paths.scope_directory)?;
        if !source_exists && !source_required {
            return Ok(());
        }
        let next_restart = journal
            .latest
            .restart_count
            .checked_add(1)
            .ok_or_else(invalid_journal)?;
        let quarantine_id = format!("partial-{next_restart:04}");
        let destination = self
            .root
            .quarantine_root()
            .join(format!("{}-{quarantine_id}", journal.latest.incident_id));
        reconcile_rename(&paths.scope_directory, &destination)?;
        self.write_manifest(
            &destination,
            journal,
            &quarantine_id,
            QuarantineKind::PartialRestore,
            journal.latest.updated_at_epoch_s,
        )?;
        let next = next_record(
            &journal.latest,
            RecoveryJournalState::Quarantined,
            now_epoch_s,
            0,
            next_restart,
        );
        append_record(journal, next)?;
        Ok(())
    }

    fn write_manifest(
        &self,
        directory: &Path,
        journal: &LoadedJournal,
        quarantine_id: &str,
        kind: QuarantineKind,
        timestamp: i64,
    ) -> Result<(), RecoveryError> {
        write_or_validate_manifest(
            directory,
            QuarantineManifest {
                schema: RECOVERY_SCHEMA.to_owned(),
                version: RECOVERY_SCHEMA_VERSION,
                scope_digest: journal.latest.scope_digest.clone(),
                operation_id: journal.latest.operation_id.clone(),
                request_hash: journal.latest.request_hash.clone(),
                incident_id: journal.latest.incident_id.clone(),
                quarantine_id: quarantine_id.to_owned(),
                reason: journal.latest.reason,
                kind,
                quarantined_at_epoch_s: timestamp,
                evidence_hash: String::new(),
            },
        )?;
        Ok(())
    }

    fn match_request(
        &self,
        journal: &LoadedJournal,
        input: &MessageCacheWorkerRebuildInput,
        paths: &ScopeCachePaths,
        request_hash: &str,
    ) -> Result<(), RecoveryError> {
        if journal.latest.scope_digest != paths.scope_digest
            || journal.latest.operation_id != input.operation_id
            || journal.latest.request_hash != request_hash
            || journal.latest.reason != input.expected_reason
            || journal.latest.server_snapshot_hash != input.server_snapshot_hash
        {
            return Err(RecoveryError {
                code: "CACHE_RECOVERY_OPERATION_REPLAY_MISMATCH",
            });
        }
        Ok(())
    }

    fn match_restore(
        &self,
        journal: &LoadedJournal,
        restore: &ActiveRestore,
        paths: &ScopeCachePaths,
    ) -> Result<(), RecoveryError> {
        if journal.latest.scope_digest != paths.scope_digest
            || journal.latest.operation_id != restore.operation_id
            || journal.latest.request_hash != hex_hash(&restore.request_hash)
            || journal.latest.server_snapshot_hash != restore.server_snapshot_hash
            || journal.latest.incident_id != restore.incident_id
        {
            return Err(RecoveryError {
                code: "CACHE_RECOVERY_OPERATION_REPLAY_MISMATCH",
            });
        }
        Ok(())
    }

    fn archive_completed(
        &self,
        journal: &mut LoadedJournal,
        destination: &Path,
    ) -> Result<(), RecoveryError> {
        let active_exists = path_exists(&journal.directory)?;
        let completed_exists = path_exists(destination)?;
        match (active_exists, completed_exists) {
            (true, false) => relocate_journal(journal, destination).map_err(Into::into),
            (false, true) => {
                journal.directory = destination.to_path_buf();
                Ok(())
            }
            _ => Err(unknown_state()),
        }
    }

    fn completed_path(&self, scope_digest: &str, request_hash: &str) -> PathBuf {
        self.root
            .recovery_completed_root()
            .join(format!("{scope_digest}-{request_hash}"))
    }
}

#[cfg(test)]
#[path = "tests/recovery_coordinator.rs"]
mod tests;
