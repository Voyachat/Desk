use super::contracts::{CapabilityScope, LOCAL_CAPABILITY_PROTOCOL_VERSION, LocalCapabilityError};
use super::file_contracts::{FileCapabilityIntent, FilePathAdmitInput};
use super::file_execution_contracts::{
    DirectoryEntryKind, LOCAL_DIRECTORY_MAX_RESULT_ENTRIES, LOCAL_FILE_MAX_READ_OUTPUT_BYTES,
};
use super::file_path::AdmittedFileRoot;

const INTERNAL_OPERATION_ID: &str = "00000000-0000-4000-8000-000000000001";
const INTERNAL_GRANT_HANDLE: &str = "00000000-0000-4000-8000-000000000002";
const INTERNAL_GRANT_REVISION: &str = "00000000-0000-4000-8000-000000000003";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ControlDirectoryEntry {
    pub name: String,
    pub kind: &'static str,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ControlReadPayload {
    File(Vec<u8>),
    Directory(Vec<ControlDirectoryEntry>),
}

pub(crate) struct ControlAdmittedRoot {
    pub canonical_path: String,
    pub fingerprint: String,
}

pub(crate) fn admit_control_root(
    root_path: &str,
) -> Result<ControlAdmittedRoot, LocalCapabilityError> {
    let root = AdmittedFileRoot::admit(root_path)?;
    let canonical_path = root
        .canonical_root()
        .to_str()
        .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_ROOT_NOT_ADMISSIBLE"))?
        .to_owned();
    Ok(ControlAdmittedRoot {
        canonical_path,
        fingerprint: root.fingerprint().to_owned(),
    })
}

pub(crate) fn read_control_capability(
    root_path: &str,
    expected_root_fingerprint: &str,
    intent: &str,
    relative_segments: Vec<String>,
    max_bytes: u64,
) -> Result<ControlReadPayload, LocalCapabilityError> {
    if max_bytes > LOCAL_FILE_MAX_READ_OUTPUT_BYTES {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_READ_OUTPUT_BUDGET_EXCEEDED",
        ));
    }
    let (file_intent, path_maximum) = match intent {
        "file/read_text" => (FileCapabilityIntent::ReadFile, Some(max_bytes)),
        "directory/list" => (FileCapabilityIntent::ListDirectory, None),
        _ => {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_GRANT_INTENT_NOT_ALLOWED",
            ));
        }
    };
    let path_request = FilePathAdmitInput {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION.to_owned(),
        operation_id: INTERNAL_OPERATION_ID.to_owned(),
        grant_handle: INTERNAL_GRANT_HANDLE.to_owned(),
        expected_grant_revision: INTERNAL_GRANT_REVISION.to_owned(),
        scope: CapabilityScope {
            tenant_id: "local-control".to_owned(),
            session_id: "local-control".to_owned(),
            run_id: "local-control".to_owned(),
        },
        intent: file_intent,
        relative_segments,
        max_bytes: path_maximum,
    };
    path_request.validate()?;

    let root = AdmittedFileRoot::admit(root_path)?;
    if root.fingerprint() != expected_root_fingerprint {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_ROOT_IDENTITY_CHANGED",
        ));
    }
    let admission = root.admit_path(&path_request)?;
    match file_intent {
        FileCapabilityIntent::ReadFile => {
            let bytes = root.read_bounded(&path_request, &admission)?.bytes;
            std::str::from_utf8(&bytes)
                .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_TEXT_ENCODING_UNSUPPORTED"))?;
            Ok(ControlReadPayload::File(bytes))
        }
        FileCapabilityIntent::ListDirectory => {
            let output = root.list_bounded(
                &path_request,
                &admission,
                LOCAL_DIRECTORY_MAX_RESULT_ENTRIES as usize,
            )?;
            if output.truncated {
                return Err(LocalCapabilityError::new(
                    "LOCAL_DIRECTORY_RESULT_LIMIT_EXCEEDED",
                ));
            }
            let entries = output
                .entries
                .into_iter()
                .map(|entry| {
                    let kind = match entry.entry_kind {
                        DirectoryEntryKind::File => "file",
                        DirectoryEntryKind::Directory => "directory",
                        DirectoryEntryKind::Unsupported => {
                            return Err(LocalCapabilityError::new(
                                "LOCAL_DIRECTORY_ENTRY_TYPE_UNSUPPORTED",
                            ));
                        }
                    };
                    Ok(ControlDirectoryEntry {
                        name: entry.name,
                        kind,
                        size_bytes: entry.size_bytes,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ControlReadPayload::Directory(entries))
        }
        FileCapabilityIntent::MetadataRead | FileCapabilityIntent::ApplyWorkspaceChanges => Err(
            LocalCapabilityError::new("LOCAL_FILE_GRANT_INTENT_NOT_ALLOWED"),
        ),
    }
}
