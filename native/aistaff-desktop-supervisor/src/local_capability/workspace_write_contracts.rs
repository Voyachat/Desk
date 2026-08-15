use super::contracts::{LocalCapabilityError, is_lower_sha256, is_lower_uuid};
use super::file_contracts::safe_segment;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION: &str =
    "aistaff.client-local-workspace-write.v1";
pub const CLIENT_LOCAL_WORKSPACE_WRITE_SUPERVISOR_CAPABILITY: &str =
    "client_local_workspace_write.v1";
pub const CLIENT_LOCAL_WORKSPACE_WRITE_REGISTER_COMMAND: &str =
    "capability.workspace.grant.register";
pub const CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY_COMMAND: &str = "capability.workspace.change.apply";
pub const CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILES: usize = 12;
pub const CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILE_BYTES: usize = 24 * 1024;
pub const CLIENT_LOCAL_WORKSPACE_WRITE_MAX_TOTAL_BYTES: usize = 64 * 1024;

const MAX_ROOT_PATH_BYTES: usize = 4_096;
const MAX_RELATIVE_PATH_BYTES: usize = 2_048;
const MAX_RELATIVE_SEGMENTS: usize = 32;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceWriteGrantRegisterInput {
    pub schema_version: String,
    pub action_id: String,
    pub operation_id: String,
    pub binding_handle: String,
    pub binding_revision: String,
    pub root_path: String,
    pub access_mode: WorkspaceWriteAccessMode,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceWriteAccessMode {
    ReadWrite,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspaceWriteGrantRegisterResult {
    pub schema_version: &'static str,
    pub action_id: &'static str,
    pub operation_id: String,
    pub binding_handle: String,
    pub binding_revision: String,
    pub grant_handle: String,
    pub grant_revision: String,
    pub grant_status: &'static str,
    pub access_mode: WorkspaceWriteAccessMode,
    pub idempotency_replayed: bool,
    pub absolute_path_exposed: bool,
    pub server_scope_consumed: bool,
    pub reason_code: &'static str,
    pub production_ready: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceChangeOperation {
    Create,
    Modify,
    Delete,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceFileChangeInput {
    pub path: String,
    pub operation: WorkspaceChangeOperation,
    pub base_sha256: Option<String>,
    pub content: Option<String>,
}

impl WorkspaceFileChangeInput {
    pub(super) fn segments(&self) -> Vec<String> {
        self.path.split('/').map(ToOwned::to_owned).collect()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceChangeApplyInput {
    pub schema_version: String,
    pub action_id: String,
    pub operation_id: String,
    pub binding_handle: String,
    pub binding_revision: String,
    pub grant_handle: String,
    pub grant_revision: String,
    pub confirmed: bool,
    pub changes: Vec<WorkspaceFileChangeInput>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspaceFileChangeResult {
    pub path: String,
    pub operation: WorkspaceChangeOperation,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspaceChangeEvidence {
    pub schema_version: &'static str,
    pub operation_id: String,
    pub request_sha256: String,
    pub change_sha256: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
    pub absolute_path_exposed: bool,
    pub content_exposed: bool,
    pub server_scope_consumed: bool,
    pub idempotency_scope: &'static str,
    pub restart_reconcile: &'static str,
    pub cleanup_state: &'static str,
    pub production_ready: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspaceChangeApplyResult {
    pub schema_version: &'static str,
    pub action_id: &'static str,
    pub operation_id: String,
    pub execution_state: &'static str,
    pub files: Vec<WorkspaceFileChangeResult>,
    pub change_sha256: String,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: WorkspaceChangeEvidence,
    pub production_ready: bool,
}

pub fn is_workspace_write_command(command: &str) -> bool {
    matches!(
        command,
        CLIENT_LOCAL_WORKSPACE_WRITE_REGISTER_COMMAND | CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY_COMMAND
    )
}

impl WorkspaceWriteGrantRegisterInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION
            || self.action_id != CLIENT_LOCAL_WORKSPACE_WRITE_REGISTER_COMMAND
            || !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.binding_handle)
            || !is_lower_uuid(&self.binding_revision)
            || self.root_path.is_empty()
            || self.root_path.len() > MAX_ROOT_PATH_BYTES
            || self.root_path.contains('\0')
        {
            return Err(LocalCapabilityError::new(
                "INVALID_CLIENT_LOCAL_WORKSPACE_WRITE_GRANT",
            ));
        }
        Ok(())
    }
}

impl WorkspaceChangeApplyInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION
            || self.action_id != CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY_COMMAND
            || !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.binding_handle)
            || !is_lower_uuid(&self.binding_revision)
            || !is_lower_uuid(&self.grant_handle)
            || !is_lower_uuid(&self.grant_revision)
            || !self.confirmed
            || self.changes.is_empty()
            || self.changes.len() > CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILES
        {
            return Err(LocalCapabilityError::new(
                "INVALID_CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY",
            ));
        }
        let mut paths = HashSet::new();
        let mut total_bytes = 0usize;
        for change in &self.changes {
            validate_change(change)?;
            if !paths.insert(change.path.to_lowercase()) {
                return Err(LocalCapabilityError::new(
                    "CLIENT_LOCAL_WORKSPACE_CHANGE_DUPLICATE_PATH",
                ));
            }
            total_bytes = total_bytes
                .saturating_add(change.content.as_ref().map_or(0, |content| content.len()));
        }
        if total_bytes > CLIENT_LOCAL_WORKSPACE_WRITE_MAX_TOTAL_BYTES {
            return Err(LocalCapabilityError::new(
                "CLIENT_LOCAL_WORKSPACE_CHANGE_TOTAL_BUDGET_EXCEEDED",
            ));
        }
        Ok(())
    }
}

fn validate_change(change: &WorkspaceFileChangeInput) -> Result<(), LocalCapabilityError> {
    let segments = change.segments();
    if change.path.is_empty()
        || change.path.starts_with('/')
        || change.path.ends_with('/')
        || change.path.contains('\\')
        || change.path.len() > MAX_RELATIVE_PATH_BYTES
        || segments.is_empty()
        || segments.len() > MAX_RELATIVE_SEGMENTS
        || segments.iter().any(|segment| !safe_segment(segment))
    {
        return Err(LocalCapabilityError::new(
            "INVALID_CLIENT_LOCAL_WORKSPACE_CHANGE_PATH",
        ));
    }
    let shape_valid = match change.operation {
        WorkspaceChangeOperation::Create => {
            change.base_sha256.is_none() && change.content.is_some()
        }
        WorkspaceChangeOperation::Modify => {
            change.base_sha256.as_deref().is_some_and(is_lower_sha256) && change.content.is_some()
        }
        WorkspaceChangeOperation::Delete => {
            change.base_sha256.as_deref().is_some_and(is_lower_sha256) && change.content.is_none()
        }
    };
    if !shape_valid {
        return Err(LocalCapabilityError::new(
            "INVALID_CLIENT_LOCAL_WORKSPACE_FILE_CHANGE",
        ));
    }
    if change
        .content
        .as_ref()
        .is_some_and(|content| content.len() > CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILE_BYTES)
    {
        return Err(LocalCapabilityError::new(
            "CLIENT_LOCAL_WORKSPACE_CHANGE_FILE_BUDGET_EXCEEDED",
        ));
    }
    Ok(())
}
