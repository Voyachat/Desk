use super::contracts::{CapabilityScope, LocalCapabilityError, is_lower_uuid, validate_protocol};
use serde::{Deserialize, Serialize};

pub const LOCAL_FILE_CAPABILITY_COMMANDS: [&str; 3] = [
    "capability.file.grant.register",
    "capability.file.grant.revoke",
    "capability.file.path.admit",
];
pub const LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID: &str = "local_file_path_admission.v1";

const MAX_ROOT_PATH_BYTES: usize = 4_096;
const MAX_SEGMENTS: usize = 32;
const MAX_RELATIVE_PATH_BYTES: usize = 2_048;
const MAX_SEGMENT_BYTES: usize = 255;
const MAX_READ_BYTES: u64 = 16 * 1024 * 1024;
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileCapabilityIntent {
    MetadataRead,
    ReadFile,
    ListDirectory,
    ApplyWorkspaceChanges,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileGrantAccess {
    ReadOnly,
    ReadWrite,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileGrantSource {
    SystemDirectoryPicker,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTargetKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileGrantRegisterInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub grant_handle: String,
    pub grant_revision: String,
    pub scope: CapabilityScope,
    pub root_path: String,
    pub access: FileGrantAccess,
    pub allowed_intents: Vec<FileCapabilityIntent>,
    pub source: FileGrantSource,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileGrantRegisterResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub grant_handle: String,
    pub grant_revision: String,
    pub grant_status: &'static str,
    pub access: FileGrantAccess,
    pub allowed_intents: Vec<FileCapabilityIntent>,
    pub expires_at_ms: u64,
    pub root_fingerprint: String,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileGrantRevokeInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub grant_handle: String,
    pub expected_grant_revision: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileGrantRevokeResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub grant_handle: String,
    pub revoke_status: &'static str,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FilePathAdmitInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub grant_handle: String,
    pub expected_grant_revision: String,
    pub scope: CapabilityScope,
    pub intent: FileCapabilityIntent,
    pub relative_segments: Vec<String>,
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FilePathEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub grant_handle: String,
    pub target_descriptor_hash: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FilePathAdmitResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub grant_handle: String,
    pub admission_status: &'static str,
    pub intent: FileCapabilityIntent,
    pub target_kind: FileTargetKind,
    pub size_bytes: Option<u64>,
    pub root_fingerprint: String,
    pub target_descriptor_hash: String,
    pub execution_enabled: bool,
    pub reason_code: &'static str,
    pub evidence: FilePathEvidence,
}

pub(super) fn is_local_file_admission_command(command: &str) -> bool {
    LOCAL_FILE_CAPABILITY_COMMANDS.contains(&command)
}

pub(super) fn safe_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    let stem = lower.split('.').next().unwrap_or("");
    let windows_reserved = matches!(
        stem,
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    );
    !segment.is_empty()
        && segment.len() <= MAX_SEGMENT_BYTES
        && segment != "."
        && segment != ".."
        && !segment.contains(['/', '\\', ':', '\0'])
        && !segment.chars().any(|character| character.is_control())
        && !segment.ends_with(['.', ' '])
        && !windows_reserved
}

impl FileGrantRegisterInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.grant_handle)
            || !is_lower_uuid(&self.grant_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_GRANT_IDENTITY",
            ));
        }
        if self.root_path.is_empty()
            || self.root_path.len() > MAX_ROOT_PATH_BYTES
            || self.root_path.contains('\0')
        {
            return Err(LocalCapabilityError::new("INVALID_LOCAL_FILE_ROOT_PATH"));
        }
        if self.access != FileGrantAccess::ReadOnly
            || self
                .allowed_intents
                .contains(&FileCapabilityIntent::ApplyWorkspaceChanges)
            || self.allowed_intents.is_empty()
            || self.allowed_intents.len() > 3
            || self
                .allowed_intents
                .iter()
                .enumerate()
                .any(|(index, intent)| self.allowed_intents[..index].contains(intent))
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_ALLOWED_INTENTS",
            ));
        }
        if self.expires_at_ms == 0 || self.expires_at_ms > JAVASCRIPT_MAX_SAFE_INTEGER {
            return Err(LocalCapabilityError::new("INVALID_LOCAL_FILE_GRANT_EXPIRY"));
        }
        Ok(())
    }
}

impl FileGrantRevokeInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.grant_handle)
            || !is_lower_uuid(&self.expected_grant_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_GRANT_IDENTITY",
            ));
        }
        Ok(())
    }
}

impl FilePathAdmitInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.grant_handle)
            || !is_lower_uuid(&self.expected_grant_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_GRANT_IDENTITY",
            ));
        }
        if self.relative_segments.len() > MAX_SEGMENTS
            || self
                .relative_segments
                .iter()
                .any(|segment| !safe_segment(segment))
            || self
                .relative_segments
                .iter()
                .map(String::len)
                .sum::<usize>()
                .saturating_add(self.relative_segments.len().saturating_sub(1))
                > MAX_RELATIVE_PATH_BYTES
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_RELATIVE_SEGMENTS",
            ));
        }
        match (self.intent, self.max_bytes) {
            (FileCapabilityIntent::ReadFile, Some(maximum))
                if !self.relative_segments.is_empty()
                    && (1..=MAX_READ_BYTES).contains(&maximum) =>
            {
                Ok(())
            }
            (FileCapabilityIntent::MetadataRead | FileCapabilityIntent::ListDirectory, None) => {
                Ok(())
            }
            _ => Err(LocalCapabilityError::new("INVALID_LOCAL_FILE_MAX_BYTES")),
        }
    }
}
