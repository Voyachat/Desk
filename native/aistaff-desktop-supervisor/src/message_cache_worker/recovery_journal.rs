use super::path::restrict_root_permissions;
use super::recovery_contracts::{
    QuarantineManifest, RECOVERY_FILE_BYTES_LIMIT, RECOVERY_RECORD_LIMIT, RecoveryJournalRecord,
    RecoveryJournalState,
};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions, create_dir, read_dir, symlink_metadata};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const JOURNAL_RECORD_PREFIX: &str = "record-";
const JOURNAL_RECORD_SUFFIX: &str = ".json";
const MANIFEST_FILENAME: &str = "manifest.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RecoveryFsError {
    pub code: &'static str,
}

impl RecoveryFsError {
    const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LoadedJournal {
    pub directory: PathBuf,
    pub latest: RecoveryJournalRecord,
}

pub(crate) fn create_journal(
    directory: &Path,
    mut initial: RecoveryJournalRecord,
) -> Result<LoadedJournal, RecoveryFsError> {
    if initial.sequence != 0
        || initial.state != RecoveryJournalState::Prepared
        || initial.restart_count != 0
        || initial.restored_projection_count != 0
    {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    initial.evidence_hash = evidence_hash(&initial)?;
    validate_record(&initial)?;
    create_dir(directory).map_err(|_| unknown_outcome())?;
    restrict_root_permissions(directory).map_err(|_| unknown_outcome())?;
    sync_parent(directory)?;
    write_record(directory, &initial)?;
    Ok(LoadedJournal {
        directory: directory.to_path_buf(),
        latest: initial,
    })
}

pub(crate) fn load_journal(directory: &Path) -> Result<LoadedJournal, RecoveryFsError> {
    require_directory(directory)?;
    let mut records = Vec::new();
    let entries = read_dir(directory)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNAVAILABLE"))?;
    for entry in entries {
        let entry =
            entry.map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNAVAILABLE"))?;
        if records.len() >= usize::from(RECOVERY_RECORD_LIMIT) {
            return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
        }
        let file_type = entry
            .file_type()
            .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNAVAILABLE"))?;
        if !file_type.is_file() || file_type.is_symlink() {
            return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNSAFE"));
        }
        let sequence = parse_record_filename(&entry.file_name().to_string_lossy())
            .ok_or_else(|| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"))?;
        records.push((sequence, read_record(&entry.path())?));
    }
    records.sort_by_key(|(sequence, _)| *sequence);
    if records.is_empty() {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    for (index, (sequence, record)) in records.iter().enumerate() {
        if usize::from(*sequence) != index || record.sequence != *sequence {
            return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
        }
        validate_record(record)?;
        if index == 0 {
            if record.state != RecoveryJournalState::Prepared
                || record.restart_count != 0
                || record.restored_projection_count != 0
            {
                return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
            }
        } else if let Some((_, previous)) =
            index.checked_sub(1).and_then(|value| records.get(value))
        {
            validate_identity(previous, record)?;
            validate_transition(previous, record)?;
        }
    }
    let latest = records
        .pop()
        .map(|(_, record)| record)
        .ok_or_else(|| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"))?;
    Ok(LoadedJournal {
        directory: directory.to_path_buf(),
        latest,
    })
}

pub(crate) fn append_record(
    journal: &mut LoadedJournal,
    mut next: RecoveryJournalRecord,
) -> Result<(), RecoveryFsError> {
    let sequence = journal
        .latest
        .sequence
        .checked_add(1)
        .filter(|value| *value < RECOVERY_RECORD_LIMIT)
        .ok_or_else(|| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_LIMIT_EXCEEDED"))?;
    next.sequence = sequence;
    validate_identity(&journal.latest, &next)?;
    validate_transition(&journal.latest, &next)?;
    next.evidence_hash = evidence_hash(&next)?;
    validate_record(&next)?;
    write_record(&journal.directory, &next)?;
    journal.latest = next;
    Ok(())
}

pub(crate) fn relocate_journal(
    journal: &mut LoadedJournal,
    destination: &Path,
) -> Result<(), RecoveryFsError> {
    rename_directory(&journal.directory, destination)?;
    journal.directory = destination.to_path_buf();
    Ok(())
}

pub(crate) fn rename_directory(source: &Path, destination: &Path) -> Result<(), RecoveryFsError> {
    require_directory(source)?;
    if path_exists(destination)? {
        return Err(RecoveryFsError::new(
            "CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED",
        ));
    }
    atomic_rename(source, destination).map_err(|_| unknown_outcome())?;
    sync_parent(source)?;
    if source.parent() != destination.parent() {
        sync_parent(destination)?;
    }
    Ok(())
}

pub(crate) fn write_or_validate_manifest(
    directory: &Path,
    mut manifest: QuarantineManifest,
) -> Result<String, RecoveryFsError> {
    require_directory(directory)?;
    let final_path = directory.join(MANIFEST_FILENAME);
    let temporary_path = directory.join("manifest.tmp");
    if path_exists(&temporary_path)? {
        return Err(RecoveryFsError::new("CACHE_QUARANTINE_MANIFEST_INVALID"));
    }
    manifest.evidence_hash = manifest_evidence_hash(&manifest)?;
    manifest.validate_shape().map_err(RecoveryFsError::new)?;
    if path_exists(&final_path)? {
        let existing: QuarantineManifest = read_json(&final_path)?;
        existing.validate_shape().map_err(RecoveryFsError::new)?;
        if existing != manifest || manifest_evidence_hash(&existing)? != existing.evidence_hash {
            return Err(RecoveryFsError::new("CACHE_QUARANTINE_MANIFEST_INVALID"));
        }
        return Ok(existing.evidence_hash);
    }
    atomic_write_json(&temporary_path, &final_path, &manifest)?;
    Ok(manifest.evidence_hash)
}

pub(crate) fn path_exists(path: &Path) -> Result<bool, RecoveryFsError> {
    match symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(RecoveryFsError::new("CACHE_RECOVERY_PATH_UNSAFE"))
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(RecoveryFsError::new("CACHE_RECOVERY_PATH_UNAVAILABLE")),
    }
}

pub(crate) fn require_directory(path: &Path) -> Result<(), RecoveryFsError> {
    let metadata = symlink_metadata(path)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_PATH_UNAVAILABLE"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_PATH_UNSAFE"));
    }
    Ok(())
}

fn write_record(directory: &Path, record: &RecoveryJournalRecord) -> Result<(), RecoveryFsError> {
    let stem = format!("{JOURNAL_RECORD_PREFIX}{:04}", record.sequence);
    atomic_write_json(
        &directory.join(format!("{stem}.tmp")),
        &directory.join(format!("{stem}{JOURNAL_RECORD_SUFFIX}")),
        record,
    )
}

fn read_record(path: &Path) -> Result<RecoveryJournalRecord, RecoveryFsError> {
    read_json(path)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, RecoveryFsError> {
    let metadata = symlink_metadata(path)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNAVAILABLE"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > RECOVERY_FILE_BYTES_LIMIT as u64
    {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| {
            file.take((RECOVERY_FILE_BYTES_LIMIT + 1) as u64)
                .read_to_end(&mut bytes)
        })
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_UNAVAILABLE"))?;
    if bytes.len() > RECOVERY_FILE_BYTES_LIMIT {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"))
}

fn atomic_write_json(
    temporary_path: &Path,
    final_path: &Path,
    value: &impl serde::Serialize,
) -> Result<(), RecoveryFsError> {
    if path_exists(temporary_path)? || path_exists(final_path)? {
        return Err(RecoveryFsError::new(
            "CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED",
        ));
    }
    let bytes = serde_json::to_vec(value)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"))?;
    if bytes.len() > RECOVERY_FILE_BYTES_LIMIT {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary_path)
        .map_err(|_| unknown_outcome())?;
    restrict_file_permissions(temporary_path)?;
    file.write_all(&bytes).map_err(|_| unknown_outcome())?;
    file.sync_all().map_err(|_| unknown_outcome())?;
    drop(file);
    atomic_rename(temporary_path, final_path).map_err(|_| unknown_outcome())?;
    sync_parent(final_path)
}

fn validate_record(record: &RecoveryJournalRecord) -> Result<(), RecoveryFsError> {
    record.validate_shape().map_err(RecoveryFsError::new)?;
    if evidence_hash(record)? != record.evidence_hash {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    Ok(())
}

fn validate_identity(
    previous: &RecoveryJournalRecord,
    next: &RecoveryJournalRecord,
) -> Result<(), RecoveryFsError> {
    if previous.schema != next.schema
        || previous.version != next.version
        || previous.scope_digest != next.scope_digest
        || previous.operation_id != next.operation_id
        || previous.request_hash != next.request_hash
        || previous.incident_id != next.incident_id
        || previous.reason != next.reason
        || previous.created_at_epoch_s != next.created_at_epoch_s
        || previous.server_snapshot_hash != next.server_snapshot_hash
        || next.updated_at_epoch_s < previous.updated_at_epoch_s
        || next.restart_count < previous.restart_count
    {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    Ok(())
}

fn validate_transition(
    previous: &RecoveryJournalRecord,
    next: &RecoveryJournalRecord,
) -> Result<(), RecoveryFsError> {
    let valid_state = matches!(
        (previous.state, next.state),
        (
            RecoveryJournalState::Prepared,
            RecoveryJournalState::Quarantined
        ) | (
            RecoveryJournalState::Quarantined,
            RecoveryJournalState::Quarantined
        ) | (
            RecoveryJournalState::Quarantined,
            RecoveryJournalState::Restoring
        ) | (
            RecoveryJournalState::Restoring,
            RecoveryJournalState::Quarantined
        ) | (
            RecoveryJournalState::Restoring,
            RecoveryJournalState::Completed
        )
    );
    let increments_restart = matches!(
        (previous.state, next.state),
        (
            RecoveryJournalState::Quarantined,
            RecoveryJournalState::Quarantined
        ) | (
            RecoveryJournalState::Restoring,
            RecoveryJournalState::Quarantined
        )
    );
    let expected_restart = if increments_restart {
        previous.restart_count.checked_add(1)
    } else {
        Some(previous.restart_count)
    };
    let valid_count =
        next.state == RecoveryJournalState::Completed || next.restored_projection_count == 0;
    if !valid_state || expected_restart != Some(next.restart_count) || !valid_count {
        return Err(RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"));
    }
    Ok(())
}

fn evidence_hash(record: &RecoveryJournalRecord) -> Result<String, RecoveryFsError> {
    let mut normalized = record.clone();
    normalized.evidence_hash.clear();
    hash_json(b"aistaff.message-cache-recovery-record.v1", &normalized)
}

fn manifest_evidence_hash(manifest: &QuarantineManifest) -> Result<String, RecoveryFsError> {
    let mut normalized = manifest.clone();
    normalized.evidence_hash.clear();
    hash_json(b"aistaff.message-cache-quarantine-manifest.v1", &normalized)
}

fn hash_json(domain: &[u8], value: &impl serde::Serialize) -> Result<String, RecoveryFsError> {
    let serialized = serde_json::to_vec(value)
        .map_err(|_| RecoveryFsError::new("CACHE_RECOVERY_JOURNAL_INVALID"))?;
    let mut hash = Sha256::new();
    hash.update((domain.len() as u32).to_be_bytes());
    hash.update(domain);
    hash.update((serialized.len() as u64).to_be_bytes());
    hash.update(serialized);
    let digest: [u8; 32] = hash.finalize().into();
    Ok(super::request_hash::hex_hash(&digest))
}

fn parse_record_filename(value: &str) -> Option<u16> {
    let sequence = value
        .strip_prefix(JOURNAL_RECORD_PREFIX)?
        .strip_suffix(JOURNAL_RECORD_SUFFIX)?;
    if sequence.len() != 4 || !sequence.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    sequence.parse().ok()
}

fn sync_parent(path: &Path) -> Result<(), RecoveryFsError> {
    let parent = path
        .parent()
        .ok_or_else(|| RecoveryFsError::new("CACHE_RECOVERY_PATH_UNSAFE"))?;
    sync_directory(parent)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), RecoveryFsError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| unknown_outcome())
}

#[cfg(windows)]
fn sync_directory(_path: &Path) -> Result<(), RecoveryFsError> {
    // Windows has no portable directory fsync. Every owned rename uses
    // MoveFileExW(MOVEFILE_WRITE_THROUGH), while file contents are sync_all'ed first.
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn sync_directory(_path: &Path) -> Result<(), RecoveryFsError> {
    Err(unknown_outcome())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<(), RecoveryFsError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|_| unknown_outcome())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<(), RecoveryFsError> {
    Ok(())
}

#[cfg(not(windows))]
fn atomic_rename(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
fn atomic_rename(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // SAFETY: Both UTF-16 buffers are NUL-terminated and remain live for the call.
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn unknown_outcome() -> RecoveryFsError {
    RecoveryFsError::new("CACHE_RECOVERY_OUTCOME_UNKNOWN_RECONCILE_REQUIRED")
}
