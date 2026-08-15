use super::contracts::LocalCapabilityError;
use super::file_contracts::{FilePathAdmitInput, FileTargetKind, safe_segment};
use super::file_execution_contracts::{
    DirectoryEntry, DirectoryEntryKind, DirectoryListOutput, LOCAL_DIRECTORY_MAX_RESULT_NAME_BYTES,
    LOCAL_DIRECTORY_MAX_SCAN_ENTRIES,
};
use super::file_path::{AdmittedFileRoot, FilePathAdmission, FileSnapshot, capability_identity};
use std::io::Read;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedFileRead {
    pub bytes: Vec<u8>,
}

impl AdmittedFileRoot {
    pub fn read_bounded(
        &self,
        input: &FilePathAdmitInput,
        expected: &FilePathAdmission,
    ) -> Result<BoundedFileRead, LocalCapabilityError> {
        let maximum = input
            .max_bytes
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_READ_BUDGET_REQUIRED"))?;
        if expected.target_kind != FileTargetKind::File {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_TARGET_INTENT_MISMATCH",
            ));
        }
        let relative = relative_path(&input.relative_segments);
        let mut file = self
            .capability_dir
            .open(relative)
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_CAPABILITY_OPEN_FAILED"))?;
        let before =
            capability_snapshot(&file.metadata().map_err(|_| {
                LocalCapabilityError::new("LOCAL_FILE_CAPABILITY_METADATA_FAILED")
            })?)?;
        if before != expected.snapshot {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_OPENED_IDENTITY_MISMATCH",
            ));
        }
        let mut bytes = Vec::with_capacity(maximum as usize);
        file.by_ref()
            .take(maximum.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_BOUNDED_READ_FAILED"))?;
        if bytes.len() as u64 > maximum {
            return Err(LocalCapabilityError::new("LOCAL_FILE_TARGET_TOO_LARGE"));
        }
        let after =
            capability_snapshot(&file.metadata().map_err(|_| {
                LocalCapabilityError::new("LOCAL_FILE_CAPABILITY_METADATA_FAILED")
            })?)?;
        if after != before {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_OPENED_IDENTITY_CHANGED",
            ));
        }
        self.revalidate_after_execution(input, expected)?;
        Ok(BoundedFileRead { bytes })
    }

    pub fn list_bounded(
        &self,
        input: &FilePathAdmitInput,
        expected: &FilePathAdmission,
        max_entries: usize,
    ) -> Result<DirectoryListOutput, LocalCapabilityError> {
        if expected.target_kind != FileTargetKind::Directory {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_TARGET_INTENT_MISMATCH",
            ));
        }
        let directory = if input.relative_segments.is_empty() {
            self.capability_dir
                .try_clone()
                .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_HANDLE_FAILED"))?
        } else {
            self.capability_dir
                .open_dir(relative_path(&input.relative_segments))
                .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_HANDLE_FAILED"))?
        };
        let before = capability_snapshot(
            &directory
                .dir_metadata()
                .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_METADATA_FAILED"))?,
        )?;
        if before != expected.snapshot {
            return Err(LocalCapabilityError::new(
                "LOCAL_DIRECTORY_OPENED_IDENTITY_MISMATCH",
            ));
        }

        let mut entries = collect_directory_entries(&directory)?;
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        let truncated = entries.len() > max_entries;
        entries.truncate(max_entries);

        let after = capability_snapshot(
            &directory
                .dir_metadata()
                .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_METADATA_FAILED"))?,
        )?;
        if after != before {
            return Err(LocalCapabilityError::new(
                "LOCAL_DIRECTORY_OPENED_IDENTITY_CHANGED",
            ));
        }
        self.revalidate_after_execution(input, expected)?;
        Ok(DirectoryListOutput { entries, truncated })
    }

    fn revalidate_after_execution(
        &self,
        input: &FilePathAdmitInput,
        expected: &FilePathAdmission,
    ) -> Result<(), LocalCapabilityError> {
        let after = self.admit_path(input)?;
        if after.target_fingerprint != expected.target_fingerprint
            || after.snapshot != expected.snapshot
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_TARGET_IDENTITY_CHANGED",
            ));
        }
        Ok(())
    }
}

fn collect_directory_entries(
    directory: &cap_std::fs::Dir,
) -> Result<Vec<DirectoryEntry>, LocalCapabilityError> {
    let mut entries = Vec::new();
    let mut total_name_bytes = 0usize;
    let iterator = directory
        .entries()
        .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_LIST_FAILED"))?;
    for (index, entry) in iterator.enumerate() {
        if index >= LOCAL_DIRECTORY_MAX_SCAN_ENTRIES {
            return Err(LocalCapabilityError::new(
                "LOCAL_DIRECTORY_SCAN_LIMIT_EXCEEDED",
            ));
        }
        let entry = entry.map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_LIST_FAILED"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_NAME_UNSUPPORTED"))?;
        if !safe_segment(&name) {
            return Err(LocalCapabilityError::new("LOCAL_DIRECTORY_NAME_UNSAFE"));
        }
        total_name_bytes = total_name_bytes.saturating_add(name.len());
        if total_name_bytes > LOCAL_DIRECTORY_MAX_RESULT_NAME_BYTES {
            return Err(LocalCapabilityError::new(
                "LOCAL_DIRECTORY_NAME_BUDGET_EXCEEDED",
            ));
        }
        let file_type = entry
            .file_type()
            .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_ENTRY_TYPE_FAILED"))?;
        let (entry_kind, size_bytes) = if file_type.is_file() {
            let metadata = entry
                .metadata()
                .map_err(|_| LocalCapabilityError::new("LOCAL_DIRECTORY_ENTRY_METADATA_FAILED"))?;
            if !metadata.is_file() {
                return Err(LocalCapabilityError::new(
                    "LOCAL_DIRECTORY_ENTRY_IDENTITY_CHANGED",
                ));
            }
            (DirectoryEntryKind::File, Some(metadata.len()))
        } else if file_type.is_dir() {
            (DirectoryEntryKind::Directory, None)
        } else {
            (DirectoryEntryKind::Unsupported, None)
        };
        entries.push(DirectoryEntry {
            name,
            entry_kind,
            size_bytes,
        });
    }
    Ok(entries)
}

fn relative_path(segments: &[String]) -> PathBuf {
    segments.iter().collect()
}

pub(super) fn capability_snapshot(
    metadata: &cap_std::fs::Metadata,
) -> Result<FileSnapshot, LocalCapabilityError> {
    let kind = if metadata.is_file() {
        FileTargetKind::File
    } else if metadata.is_dir() {
        FileTargetKind::Directory
    } else {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_TARGET_TYPE_UNSUPPORTED",
        ));
    };
    Ok(FileSnapshot {
        identity: capability_identity(metadata)?,
        kind,
        size_bytes: metadata.len(),
    })
}
