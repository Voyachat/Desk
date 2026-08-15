use super::contracts::{
    AdapterKind, CapabilityRequest, LocalCapabilityError, SideEffectClass, is_lower_sha256,
    is_lower_uuid, validate_protocol,
};
use super::file_contracts::{FileCapabilityIntent, FilePathAdmitInput};
use serde::{Deserialize, Serialize};

pub const LOCAL_FILE_EXECUTION_COMMANDS: [&str; 3] = [
    "capability.file.read",
    "capability.directory.list",
    "capability.file.execution.reconcile",
];
pub const LOCAL_FILE_READ_CAPABILITY_ID: &str = "local_file_read.v1";
pub const LOCAL_DIRECTORY_LIST_CAPABILITY_ID: &str = "local_directory_list.v1";
pub const LOCAL_FILE_MAX_READ_OUTPUT_BYTES: u64 = 24 * 1024;
pub const LOCAL_DIRECTORY_MAX_RESULT_ENTRIES: u64 = 64;
pub const LOCAL_DIRECTORY_MAX_RESULT_NAME_BYTES: usize = 8 * 1024;
pub const LOCAL_DIRECTORY_MAX_SCAN_ENTRIES: usize = 256;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileReadExecutionInput {
    pub protocol_version: String,
    pub capability_request: CapabilityRequest,
    pub path_request: FilePathAdmitInput,
    pub expected_target_descriptor_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DirectoryListExecutionInput {
    pub protocol_version: String,
    pub capability_request: CapabilityRequest,
    pub path_request: FilePathAdmitInput,
    pub expected_target_descriptor_hash: String,
    pub max_entries: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileExecutionEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub request_hash: String,
    pub target_descriptor_hash: String,
    pub output_sha256: String,
    pub cloud_audit_ref: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileReadExecutionResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub execution_state: &'static str,
    pub side_effect_state: &'static str,
    pub target_descriptor_hash: String,
    pub request_hash: String,
    pub content_encoding: &'static str,
    pub content_base64: String,
    pub bytes_read: u64,
    pub content_sha256: String,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: FileExecutionEvidence,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryEntryKind {
    File,
    Directory,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DirectoryEntry {
    pub name: String,
    pub entry_kind: DirectoryEntryKind,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DirectoryListOutput {
    pub entries: Vec<DirectoryEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DirectoryListExecutionResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub execution_state: &'static str,
    pub side_effect_state: &'static str,
    pub target_descriptor_hash: String,
    pub request_hash: String,
    pub entries: Vec<DirectoryEntry>,
    pub truncated: bool,
    pub output_sha256: String,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: FileExecutionEvidence,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObservedFileExecutionState {
    None,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FileExecutionReconcileInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub request_hash: String,
    pub observed_execution_state: ObservedFileExecutionState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileExecutionReconcileResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub decision: &'static str,
    pub execution_state: &'static str,
    pub request_hash: String,
    pub output_sha256: Option<String>,
    pub side_effect_state: &'static str,
    pub reason_code: &'static str,
}

pub fn is_local_file_execution_command(command: &str) -> bool {
    LOCAL_FILE_EXECUTION_COMMANDS.contains(&command)
}

fn validate_binding(
    capability_request: &CapabilityRequest,
    path_request: &FilePathAdmitInput,
    descriptor_hash: &str,
    expected_adapter: AdapterKind,
    expected_intent: FileCapabilityIntent,
) -> Result<(), LocalCapabilityError> {
    if capability_request.operation.operation_id != path_request.operation_id
        || capability_request.operation.adapter_kind != expected_adapter
        || capability_request.operation.side_effect != SideEffectClass::ReadOnly
        || capability_request.operation.descriptor_hash != descriptor_hash
        || path_request.intent != expected_intent
        || capability_request.scope != path_request.scope
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_EXECUTION_BINDING_MISMATCH",
        ));
    }
    Ok(())
}

impl FileReadExecutionInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.capability_request.validate()?;
        self.path_request.validate()?;
        if !is_lower_sha256(&self.expected_target_descriptor_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_TARGET_DESCRIPTOR_HASH",
            ));
        }
        validate_binding(
            &self.capability_request,
            &self.path_request,
            &self.expected_target_descriptor_hash,
            AdapterKind::File,
            FileCapabilityIntent::ReadFile,
        )?;
        match self.path_request.max_bytes {
            Some(maximum) if maximum <= LOCAL_FILE_MAX_READ_OUTPUT_BYTES => Ok(()),
            _ => Err(LocalCapabilityError::new(
                "LOCAL_FILE_READ_OUTPUT_BUDGET_EXCEEDED",
            )),
        }
    }
}

impl DirectoryListExecutionInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.capability_request.validate()?;
        self.path_request.validate()?;
        if !is_lower_sha256(&self.expected_target_descriptor_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_TARGET_DESCRIPTOR_HASH",
            ));
        }
        validate_binding(
            &self.capability_request,
            &self.path_request,
            &self.expected_target_descriptor_hash,
            AdapterKind::Directory,
            FileCapabilityIntent::ListDirectory,
        )?;
        if !(1..=LOCAL_DIRECTORY_MAX_RESULT_ENTRIES).contains(&self.max_entries) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_DIRECTORY_MAX_ENTRIES",
            ));
        }
        Ok(())
    }
}

impl FileExecutionReconcileInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id) || !is_lower_sha256(&self.request_hash) {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_FILE_EXECUTION_RECONCILE",
            ));
        }
        Ok(())
    }
}
