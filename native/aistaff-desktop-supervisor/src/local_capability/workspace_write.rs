use super::capability_hash::{digest_hex, hash_value};
use super::contracts::LocalCapabilityError;
use super::file_contracts::{FileCapabilityIntent, FileGrantAccess};
use super::file_execution::capability_snapshot;
use super::file_grant_registry::{RegisteredGrant, RegisteredGrantScope};
use super::file_path::{AdmittedFileRoot, safe_metadata};
use super::file_service::LocalFileCapabilityService;
use super::workspace_write_contracts::{
    CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY_COMMAND, CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILE_BYTES,
    CLIENT_LOCAL_WORKSPACE_WRITE_REGISTER_COMMAND, CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
    WorkspaceChangeApplyInput, WorkspaceChangeApplyResult, WorkspaceChangeEvidence,
    WorkspaceChangeOperation, WorkspaceFileChangeInput, WorkspaceFileChangeResult,
    WorkspaceWriteAccessMode, WorkspaceWriteGrantRegisterInput, WorkspaceWriteGrantRegisterResult,
};
use cap_std::fs::{Dir, OpenOptions};
use getrandom::fill;
use serde_json::{Value, to_value};
use sha2::{Digest, Sha256};
use std::io::{ErrorKind, Read, Write};

const CLIENT_LOCAL_WRITE_GRANT_LIFETIME_MS: u64 = 10 * 60 * 1_000;

#[derive(Debug, Clone)]
struct PreparedChange {
    input: WorkspaceFileChangeInput,
    segments: Vec<String>,
    before_sha256: Option<String>,
    after_sha256: Option<String>,
    temp_name: Option<String>,
    backup_name: String,
}

#[derive(Debug, Clone, Copy)]
struct CommitState {
    index: usize,
    backup_moved: bool,
    target_installed: bool,
}

impl LocalFileCapabilityService {
    pub(super) fn register_workspace_write_grant(
        &mut self,
        input: WorkspaceWriteGrantRegisterInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms)?;
        let request_hash = hash_value(&input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash, None)? {
            let grant_handle = response["grant_handle"]
                .as_str()
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_REPLAY_CORRUPTED"))?;
            let grant_revision = response["grant_revision"]
                .as_str()
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_REPLAY_CORRUPTED"))?;
            let grant = self.grant_registry.active_client_local_write_grant(
                grant_handle,
                grant_revision,
                &input.binding_handle,
                &input.binding_revision,
            )?;
            grant.root.validate()?;
            return Ok(response);
        }
        let grant_handle = random_uuid()?;
        let grant_revision = random_uuid()?;
        self.grant_registry
            .ensure_registration_available(&grant_handle)?;
        let root = AdmittedFileRoot::admit(&input.root_path)?;
        let result = WorkspaceWriteGrantRegisterResult {
            schema_version: CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
            action_id: CLIENT_LOCAL_WORKSPACE_WRITE_REGISTER_COMMAND,
            operation_id: input.operation_id.clone(),
            binding_handle: input.binding_handle.clone(),
            binding_revision: input.binding_revision.clone(),
            grant_handle: grant_handle.clone(),
            grant_revision: grant_revision.clone(),
            grant_status: "registered",
            access_mode: WorkspaceWriteAccessMode::ReadWrite,
            idempotency_replayed: false,
            absolute_path_exposed: false,
            server_scope_consumed: false,
            reason_code: "LOCAL_WORKSPACE_WRITE_GRANT_REGISTERED",
            production_ready: false,
        };
        let response = serialize(result)?;
        self.grant_registry.register(
            grant_handle,
            RegisteredGrant {
                revision: grant_revision,
                scope: RegisteredGrantScope::ClientLocal {
                    binding_handle: input.binding_handle,
                    binding_revision: input.binding_revision,
                },
                access: FileGrantAccess::ReadWrite,
                allowed_intents: vec![FileCapabilityIntent::ApplyWorkspaceChanges],
                expires_at_ms: now_ms.saturating_add(CLIENT_LOCAL_WRITE_GRANT_LIFETIME_MS),
                root,
            },
        )?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }

    pub(super) fn apply_workspace_changes(
        &mut self,
        input: WorkspaceChangeApplyInput,
    ) -> Result<Value, LocalCapabilityError> {
        input.validate()?;
        let request_hash = hash_value(&input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash, None)? {
            return Ok(response);
        }
        let now_ms = (self.now_ms)();
        self.prune_expired(now_ms)?;
        let grant = self.grant_registry.active_client_local_write_grant(
            &input.grant_handle,
            &input.grant_revision,
            &input.binding_handle,
            &input.binding_revision,
        )?;
        grant.root.validate()?;
        let files = apply_transaction(&grant.root, &input.operation_id, &input.changes)?;
        let change_sha256 = hash_value(&files)?;
        let result = WorkspaceChangeApplyResult {
            schema_version: CLIENT_LOCAL_WORKSPACE_WRITE_SCHEMA_VERSION,
            action_id: CLIENT_LOCAL_WORKSPACE_CHANGE_APPLY_COMMAND,
            operation_id: input.operation_id.clone(),
            execution_state: "completed",
            files,
            change_sha256: change_sha256.clone(),
            idempotency_replayed: false,
            reason_code: "LOCAL_WORKSPACE_CHANGE_APPLIED",
            evidence: WorkspaceChangeEvidence {
                schema_version: "aistaff.client-local-workspace-change-evidence.v1",
                operation_id: input.operation_id.clone(),
                request_sha256: request_hash.clone(),
                change_sha256,
                side_effect_state: "confirmed",
                redaction_profile: "relative_path_and_digest_only.v1",
                absolute_path_exposed: false,
                content_exposed: false,
                server_scope_consumed: false,
                idempotency_scope: "supervisor_process_lifetime",
                restart_reconcile: "unavailable_fail_closed",
                cleanup_state: "completed",
                production_ready: false,
            },
            production_ready: false,
        };
        let response = serialize(result)?;
        self.record_replay(input.operation_id, request_hash, response.clone());
        Ok(response)
    }
}

fn apply_transaction(
    root: &AdmittedFileRoot,
    operation_id: &str,
    changes: &[WorkspaceFileChangeInput],
) -> Result<Vec<WorkspaceFileChangeResult>, LocalCapabilityError> {
    let prepared = changes
        .iter()
        .enumerate()
        .map(|(index, change)| preflight_change(root, operation_id, index, change))
        .collect::<Result<Vec<_>, _>>()?;

    if let Err(error) = create_all_temporary_files(root, &prepared) {
        cleanup_temporary_files(root, &prepared);
        return Err(error);
    }
    if let Err(error) = revalidate_all_targets(root, &prepared) {
        cleanup_temporary_files(root, &prepared);
        return Err(error);
    }

    let mut committed = Vec::with_capacity(prepared.len());
    for (index, change) in prepared.iter().enumerate() {
        let mut state = CommitState {
            index,
            backup_moved: false,
            target_installed: false,
        };
        let commit = commit_change(root, change, &mut state);
        committed.push(state);
        if let Err(error) = commit {
            let rollback_ok = rollback_changes(root, &prepared, &committed);
            cleanup_temporary_files(root, &prepared);
            return if rollback_ok {
                Err(error)
            } else {
                Err(LocalCapabilityError::new(
                    "LOCAL_WORKSPACE_CHANGE_ROLLBACK_FAILED",
                ))
            };
        }
    }

    cleanup_backups(root, &prepared, &committed)?;
    Ok(prepared
        .into_iter()
        .map(|change| WorkspaceFileChangeResult {
            path: change.input.path,
            operation: change.input.operation,
            before_sha256: change.before_sha256,
            after_sha256: change.after_sha256,
        })
        .collect())
}

fn preflight_change(
    root: &AdmittedFileRoot,
    operation_id: &str,
    index: usize,
    input: &WorkspaceFileChangeInput,
) -> Result<PreparedChange, LocalCapabilityError> {
    root.validate()?;
    let segments = input.segments();
    validate_ambient_parent_chain(root, &segments)?;
    let (parent, name) = open_parent(root, &segments)?;
    let marker = operation_id.replace('-', "");
    let temp_name = (input.operation != WorkspaceChangeOperation::Delete)
        .then(|| format!(".aistaff-{marker}-{index}.tmp"));
    let backup_name = format!(".aistaff-{marker}-{index}.bak");
    ensure_absent(&parent, &backup_name, "LOCAL_WORKSPACE_BACKUP_COLLISION")?;
    if let Some(temp) = &temp_name {
        ensure_absent(&parent, temp, "LOCAL_WORKSPACE_TEMP_COLLISION")?;
    }

    let (before_sha256, after_sha256) = match input.operation {
        WorkspaceChangeOperation::Create => {
            ensure_absent(
                &parent,
                &name,
                "LOCAL_WORKSPACE_CHANGE_STATE_DIVERGED_RECONCILE_REQUIRED",
            )?;
            let after = sha256(input.content.as_deref().unwrap_or_default().as_bytes())?;
            (None, Some(after))
        }
        WorkspaceChangeOperation::Modify | WorkspaceChangeOperation::Delete => {
            let before = read_regular_file_sha256(&parent, &name)?;
            if input.base_sha256.as_deref() != Some(&before) {
                return Err(LocalCapabilityError::new(
                    "LOCAL_WORKSPACE_CHANGE_STATE_DIVERGED_RECONCILE_REQUIRED",
                ));
            }
            let after = input
                .content
                .as_ref()
                .map(|content| sha256(content.as_bytes()))
                .transpose()?;
            (Some(before), after)
        }
    };
    Ok(PreparedChange {
        input: input.clone(),
        segments,
        before_sha256,
        after_sha256,
        temp_name,
        backup_name,
    })
}

fn create_all_temporary_files(
    root: &AdmittedFileRoot,
    changes: &[PreparedChange],
) -> Result<(), LocalCapabilityError> {
    for change in changes {
        let Some(temp_name) = &change.temp_name else {
            continue;
        };
        let (parent, _) = open_parent(root, &change.segments)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = parent
            .open_with(temp_name, &options)
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TEMP_CREATE_FAILED"))?;
        file.write_all(
            change
                .input
                .content
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        )
        .and_then(|()| file.sync_all())
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TEMP_WRITE_FAILED"))?;
    }
    Ok(())
}

fn revalidate_all_targets(
    root: &AdmittedFileRoot,
    changes: &[PreparedChange],
) -> Result<(), LocalCapabilityError> {
    root.validate()?;
    for change in changes {
        validate_ambient_parent_chain(root, &change.segments)?;
        let (parent, name) = open_parent(root, &change.segments)?;
        match change.input.operation {
            WorkspaceChangeOperation::Create => {
                ensure_absent(&parent, &name, "LOCAL_WORKSPACE_CREATE_TARGET_CHANGED")?;
            }
            WorkspaceChangeOperation::Modify | WorkspaceChangeOperation::Delete => {
                if Some(read_regular_file_sha256(&parent, &name)?) != change.before_sha256 {
                    return Err(LocalCapabilityError::new(
                        "LOCAL_WORKSPACE_TARGET_CHANGED_AFTER_PREFLIGHT",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn commit_change(
    root: &AdmittedFileRoot,
    change: &PreparedChange,
    state: &mut CommitState,
) -> Result<(), LocalCapabilityError> {
    let (parent, name) = open_parent(root, &change.segments)?;
    match change.input.operation {
        WorkspaceChangeOperation::Create => {
            install_temp_without_overwrite(
                &parent,
                change.temp_name.as_ref().expect("create temp"),
                &name,
                state,
            )?;
        }
        WorkspaceChangeOperation::Modify => {
            parent
                .rename(&name, &parent, &change.backup_name)
                .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_BACKUP_CREATE_FAILED"))?;
            state.backup_moved = true;
            install_temp_without_overwrite(
                &parent,
                change.temp_name.as_ref().expect("modify temp"),
                &name,
                state,
            )?;
        }
        WorkspaceChangeOperation::Delete => {
            parent
                .rename(&name, &parent, &change.backup_name)
                .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_BACKUP_CREATE_FAILED"))?;
            state.backup_moved = true;
        }
    }
    Ok(())
}

fn install_temp_without_overwrite(
    parent: &Dir,
    temp_name: &str,
    target_name: &str,
    state: &mut CommitState,
) -> Result<(), LocalCapabilityError> {
    parent
        .hard_link(temp_name, parent, target_name)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_CHANGE_COMMIT_FAILED"))?;
    state.target_installed = true;
    parent
        .remove_file(temp_name)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TEMP_CLEANUP_FAILED"))?;
    Ok(())
}

fn rollback_changes(
    root: &AdmittedFileRoot,
    prepared: &[PreparedChange],
    committed: &[CommitState],
) -> bool {
    let mut success = true;
    for state in committed.iter().rev() {
        let change = &prepared[state.index];
        let Ok((parent, name)) = open_parent(root, &change.segments) else {
            success = false;
            continue;
        };
        if state.target_installed && parent.remove_file(&name).is_err() {
            success = false;
        }
        if state.backup_moved && parent.rename(&change.backup_name, &parent, &name).is_err() {
            success = false;
        }
    }
    success
}

fn cleanup_temporary_files(root: &AdmittedFileRoot, changes: &[PreparedChange]) {
    for change in changes {
        if let (Some(temp), Ok((parent, _))) =
            (&change.temp_name, open_parent(root, &change.segments))
        {
            let _ = parent.remove_file(temp);
        }
    }
}

fn cleanup_backups(
    root: &AdmittedFileRoot,
    prepared: &[PreparedChange],
    committed: &[CommitState],
) -> Result<(), LocalCapabilityError> {
    for state in committed {
        if state.backup_moved {
            let (parent, _) = open_parent(root, &prepared[state.index].segments)?;
            parent
                .remove_file(&prepared[state.index].backup_name)
                .map_err(|_| {
                    LocalCapabilityError::new("LOCAL_WORKSPACE_BACKUP_CLEANUP_FAILED_AFTER_COMMIT")
                })?;
        }
    }
    Ok(())
}

fn validate_ambient_parent_chain(
    root: &AdmittedFileRoot,
    segments: &[String],
) -> Result<(), LocalCapabilityError> {
    let mut candidate = root.canonical_root.clone();
    for segment in &segments[..segments.len().saturating_sub(1)] {
        candidate.push(segment);
        let metadata = safe_metadata(&candidate)?;
        if !metadata.is_dir() {
            return Err(LocalCapabilityError::new(
                "LOCAL_WORKSPACE_PARENT_NOT_DIRECTORY",
            ));
        }
    }
    Ok(())
}

fn open_parent(
    root: &AdmittedFileRoot,
    segments: &[String],
) -> Result<(Dir, String), LocalCapabilityError> {
    let (name, parents) = segments
        .split_last()
        .ok_or_else(|| LocalCapabilityError::new("INVALID_CLIENT_LOCAL_WORKSPACE_CHANGE_PATH"))?;
    let mut directory = root
        .capability_dir
        .try_clone()
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_PARENT_OPEN_FAILED"))?;
    for segment in parents {
        let before = directory
            .symlink_metadata(segment)
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_PARENT_OPEN_FAILED"))?;
        if before.file_type().is_symlink() || !before.is_dir() {
            return Err(LocalCapabilityError::new(
                "LOCAL_WORKSPACE_SYMLINK_OR_SPECIAL_REJECTED",
            ));
        }
        let opened = directory
            .open_dir(segment)
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_PARENT_OPEN_FAILED"))?;
        let after = directory
            .symlink_metadata(segment)
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_PARENT_OPEN_FAILED"))?;
        if after.file_type().is_symlink()
            || !after.is_dir()
            || !opened
                .dir_metadata()
                .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_PARENT_OPEN_FAILED"))?
                .is_dir()
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_WORKSPACE_SYMLINK_OR_SPECIAL_REJECTED",
            ));
        }
        directory = opened;
    }
    Ok((directory, name.clone()))
}

fn ensure_absent(
    parent: &Dir,
    name: &str,
    error_code: &'static str,
) -> Result<(), LocalCapabilityError> {
    match parent.symlink_metadata(name) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        _ => Err(LocalCapabilityError::new(error_code)),
    }
}

fn read_regular_file_sha256(parent: &Dir, name: &str) -> Result<String, LocalCapabilityError> {
    let metadata = parent
        .symlink_metadata(name)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_UNAVAILABLE"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(LocalCapabilityError::new(
            "LOCAL_WORKSPACE_SYMLINK_OR_SPECIAL_REJECTED",
        ));
    }
    let before = capability_snapshot(&metadata)?;
    let mut file = parent
        .open(name)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_OPEN_FAILED"))?;
    let opened = file
        .metadata()
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_OPEN_FAILED"))?;
    if capability_snapshot(&opened)? != before {
        return Err(LocalCapabilityError::new(
            "LOCAL_WORKSPACE_TARGET_CHANGED_AFTER_PREFLIGHT",
        ));
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_READ_FAILED"))?;
    if bytes.len() > CLIENT_LOCAL_WORKSPACE_WRITE_MAX_FILE_BYTES {
        return Err(LocalCapabilityError::new(
            "CLIENT_LOCAL_WORKSPACE_CHANGE_FILE_BUDGET_EXCEEDED",
        ));
    }
    let after = capability_snapshot(
        &file
            .metadata()
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_READ_FAILED"))?,
    )?;
    let named_after = capability_snapshot(
        &parent
            .symlink_metadata(name)
            .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_TARGET_UNAVAILABLE"))?,
    )?;
    if after != before || named_after != before {
        return Err(LocalCapabilityError::new(
            "LOCAL_WORKSPACE_TARGET_CHANGED_AFTER_PREFLIGHT",
        ));
    }
    sha256(&bytes)
}

fn sha256(bytes: &[u8]) -> Result<String, LocalCapabilityError> {
    digest_hex(Sha256::digest(bytes).as_slice())
}

fn random_uuid() -> Result<String, LocalCapabilityError> {
    let mut bytes = [0u8; 16];
    fill(&mut bytes)
        .map_err(|_| LocalCapabilityError::new("LOCAL_WORKSPACE_GRANT_RANDOM_FAILED"))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    ))
}

fn serialize<T: serde::Serialize>(value: T) -> Result<Value, LocalCapabilityError> {
    to_value(value)
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_RESPONSE_SERIALIZATION_FAILED"))
}
