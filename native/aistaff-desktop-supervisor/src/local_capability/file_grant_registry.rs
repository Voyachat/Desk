use super::capability_hash::digest_hex;
use super::contracts::{CapabilityScope, LocalCapabilityError};
use super::file_contracts::{
    FileCapabilityIntent, FileGrantAccess, FilePathAdmitInput, FileTargetKind,
    LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
};
use super::file_path::{AdmittedFileRoot, FilePathAdmission};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RegisteredGrantScope {
    Server(CapabilityScope),
    ClientLocal {
        binding_handle: String,
        binding_revision: String,
    },
}

const MAX_ACTIVE_GRANTS: usize = 64;
const MAX_USED_GRANT_HANDLES: usize = 256;
const PATH_ADMISSION_CAPACITY: usize = 256;

#[derive(Debug, Clone)]
pub(super) struct RegisteredGrant {
    pub(super) revision: String,
    pub(super) scope: RegisteredGrantScope,
    pub(super) access: FileGrantAccess,
    pub(super) allowed_intents: Vec<FileCapabilityIntent>,
    pub(super) expires_at_ms: u64,
    pub(super) root: AdmittedFileRoot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PathAdmissionRecord {
    capability_id: &'static str,
    input: FilePathAdmitInput,
    descriptor_hash: String,
    target_kind: FileTargetKind,
}

#[derive(Default)]
struct FileGrantRegistryState {
    grants: HashMap<String, RegisteredGrant>,
    used_grant_handles: HashSet<String>,
    path_admissions: HashMap<String, PathAdmissionRecord>,
    path_admission_order: VecDeque<String>,
}

#[derive(Clone, Default)]
pub(crate) struct SharedFileGrantRegistry {
    state: Arc<RwLock<FileGrantRegistryState>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GrantRevokeOutcome {
    Revoked,
    NotFound,
}

impl SharedFileGrantRegistry {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(super) fn ensure_registration_available(
        &self,
        grant_handle: &str,
    ) -> Result<(), LocalCapabilityError> {
        let state = self.read_state()?;
        validate_registration_state(&state, grant_handle)
    }

    pub(super) fn register(
        &self,
        grant_handle: String,
        grant: RegisteredGrant,
    ) -> Result<(), LocalCapabilityError> {
        let mut state = self.write_state()?;
        validate_registration_state(&state, &grant_handle)?;
        state.used_grant_handles.insert(grant_handle.clone());
        state.grants.insert(grant_handle, grant);
        Ok(())
    }

    pub(super) fn revoke(
        &self,
        grant_handle: &str,
        expected_revision: &str,
    ) -> Result<GrantRevokeOutcome, LocalCapabilityError> {
        let mut state = self.write_state()?;
        if state
            .grants
            .get(grant_handle)
            .is_some_and(|grant| grant.revision != expected_revision)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_GRANT_REVISION_MISMATCH",
            ));
        }
        let outcome = if state.grants.remove(grant_handle).is_some() {
            GrantRevokeOutcome::Revoked
        } else {
            GrantRevokeOutcome::NotFound
        };
        if state.used_grant_handles.len() < MAX_USED_GRANT_HANDLES {
            state.used_grant_handles.insert(grant_handle.to_owned());
        }
        remove_grant_path_admissions(&mut state, grant_handle);
        Ok(outcome)
    }

    pub(super) fn active_grant(
        &self,
        grant_handle: &str,
    ) -> Result<Option<RegisteredGrant>, LocalCapabilityError> {
        Ok(self.read_state()?.grants.get(grant_handle).cloned())
    }

    pub(super) fn active_grant_for_path(
        &self,
        input: &FilePathAdmitInput,
    ) -> Result<RegisteredGrant, LocalCapabilityError> {
        let state = self.read_state()?;
        let grant = state
            .grants
            .get(&input.grant_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_NOT_ACTIVE"))?;
        validate_path_grant(grant, input)?;
        Ok(grant.clone())
    }

    pub(super) fn active_client_local_write_grant(
        &self,
        grant_handle: &str,
        expected_grant_revision: &str,
        binding_handle: &str,
        expected_binding_revision: &str,
    ) -> Result<RegisteredGrant, LocalCapabilityError> {
        let state = self.read_state()?;
        let grant = state
            .grants
            .get(grant_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_NOT_ACTIVE"))?;
        if grant.revision != expected_grant_revision {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_GRANT_REVISION_MISMATCH",
            ));
        }
        if grant.access != FileGrantAccess::ReadWrite
            || !grant
                .allowed_intents
                .contains(&FileCapabilityIntent::ApplyWorkspaceChanges)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_WORKSPACE_WRITE_GRANT_NOT_ALLOWED",
            ));
        }
        if grant.scope
            != (RegisteredGrantScope::ClientLocal {
                binding_handle: binding_handle.to_owned(),
                binding_revision: expected_binding_revision.to_owned(),
            })
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_WORKSPACE_BINDING_REVISION_MISMATCH",
            ));
        }
        Ok(grant.clone())
    }

    pub(super) fn record_path_admission(
        &self,
        input: &FilePathAdmitInput,
        descriptor_hash: &str,
        target_kind: FileTargetKind,
    ) -> Result<(), LocalCapabilityError> {
        let mut state = self.write_state()?;
        let grant = state
            .grants
            .get(&input.grant_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_NOT_ACTIVE"))?;
        validate_path_grant(grant, input)?;
        let record = PathAdmissionRecord {
            capability_id: LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID,
            input: input.clone(),
            descriptor_hash: descriptor_hash.to_owned(),
            target_kind,
        };
        if let Some(existing) = state.path_admissions.get(descriptor_hash) {
            return if existing == &record {
                Ok(())
            } else {
                Err(LocalCapabilityError::new(
                    "LOCAL_FILE_PATH_DESCRIPTOR_COLLISION",
                ))
            };
        }
        while state.path_admissions.len() >= PATH_ADMISSION_CAPACITY {
            let Some(oldest) = state.path_admission_order.pop_front() else {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_PATH_ADMISSION_CAPACITY_REACHED",
                ));
            };
            state.path_admissions.remove(&oldest);
        }
        state
            .path_admission_order
            .push_back(descriptor_hash.to_owned());
        state
            .path_admissions
            .insert(descriptor_hash.to_owned(), record);
        Ok(())
    }

    pub(super) fn prepare_working_directory(
        &self,
        grant_handle: &str,
        expected_revision: &str,
        scope: &CapabilityScope,
        relative_segments: &[String],
        expected_descriptor_hash: &str,
    ) -> Result<PathBuf, LocalCapabilityError> {
        let (grant, record) = {
            let state = self.read_state()?;
            let grant = state
                .grants
                .get(grant_handle)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_GRANT_NOT_ACTIVE"))?;
            let record = state
                .path_admissions
                .get(expected_descriptor_hash)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_FILE_PATH_ADMISSION_NOT_ACTIVE"))?;
            if grant.revision != expected_revision
                || grant.scope != RegisteredGrantScope::Server(scope.clone())
                || grant.access != FileGrantAccess::ReadOnly
                || !grant
                    .allowed_intents
                    .contains(&FileCapabilityIntent::MetadataRead)
                || record.input.grant_handle != grant_handle
                || record.input.expected_grant_revision != expected_revision
                || record.input.scope != *scope
                || record.input.intent != FileCapabilityIntent::MetadataRead
                || record.input.max_bytes.is_some()
                || record.input.relative_segments != relative_segments
                || record.capability_id != LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID
                || record.descriptor_hash != expected_descriptor_hash
                || record.target_kind != FileTargetKind::Directory
            {
                return Err(LocalCapabilityError::new(
                    "LOCAL_PROCESS_WORKING_DIRECTORY_BINDING_MISMATCH",
                ));
            }
            (grant.clone(), record.clone())
        };
        let admission = grant.root.admit_path(&record.input)?;
        if admission.target_kind != FileTargetKind::Directory
            || descriptor_hash(&grant, &record.input, &admission)? != expected_descriptor_hash
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_WORKING_DIRECTORY_IDENTITY_CHANGED",
            ));
        }
        Ok(admission.canonical_path)
    }

    pub(super) fn prune_expired(&self, now_ms: u64) -> Result<(), LocalCapabilityError> {
        let mut state = self.write_state()?;
        let expired = state
            .grants
            .iter()
            .filter(|(_, grant)| grant.expires_at_ms <= now_ms)
            .map(|(handle, _)| handle.clone())
            .collect::<HashSet<_>>();
        state.grants.retain(|handle, _| !expired.contains(handle));
        if !expired.is_empty() {
            state
                .path_admissions
                .retain(|_, record| !expired.contains(&record.input.grant_handle));
            compact_path_order(&mut state);
        }
        Ok(())
    }

    fn read_state(
        &self,
    ) -> Result<RwLockReadGuard<'_, FileGrantRegistryState>, LocalCapabilityError> {
        self.state
            .read()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_GRANT_REGISTRY_UNAVAILABLE"))
    }

    fn write_state(
        &self,
    ) -> Result<RwLockWriteGuard<'_, FileGrantRegistryState>, LocalCapabilityError> {
        self.state
            .write()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_GRANT_REGISTRY_UNAVAILABLE"))
    }
}

pub(super) fn descriptor_hash(
    grant: &RegisteredGrant,
    input: &FilePathAdmitInput,
    admission: &FilePathAdmission,
) -> Result<String, LocalCapabilityError> {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.local-file-admission.v1\0");
    hasher.update(LOCAL_FILE_PATH_ADMISSION_CAPABILITY_ID.as_bytes());
    for field in [
        input.operation_id.as_str(),
        input.grant_handle.as_str(),
        input.expected_grant_revision.as_str(),
        input.scope.tenant_id.as_str(),
        input.scope.session_id.as_str(),
        input.scope.run_id.as_str(),
        grant.root.fingerprint(),
        admission.target_fingerprint.as_str(),
    ] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    hasher.update(match input.intent {
        FileCapabilityIntent::MetadataRead => b"metadata_read".as_slice(),
        FileCapabilityIntent::ReadFile => b"read_file".as_slice(),
        FileCapabilityIntent::ListDirectory => b"list_directory".as_slice(),
        FileCapabilityIntent::ApplyWorkspaceChanges => b"apply_workspace_changes".as_slice(),
    });
    hasher.update(input.max_bytes.unwrap_or(0).to_le_bytes());
    digest_hex(hasher.finalize().as_slice())
}

fn validate_path_grant(
    grant: &RegisteredGrant,
    input: &FilePathAdmitInput,
) -> Result<(), LocalCapabilityError> {
    if grant.revision != input.expected_grant_revision {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_REVISION_MISMATCH",
        ));
    }
    if grant.scope != RegisteredGrantScope::Server(input.scope.clone()) {
        return Err(LocalCapabilityError::new("LOCAL_FILE_GRANT_SCOPE_MISMATCH"));
    }
    if grant.access != FileGrantAccess::ReadOnly || !grant.allowed_intents.contains(&input.intent) {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_INTENT_NOT_ALLOWED",
        ));
    }
    Ok(())
}

fn validate_registration_state(
    state: &FileGrantRegistryState,
    grant_handle: &str,
) -> Result<(), LocalCapabilityError> {
    if state.grants.len() >= MAX_ACTIVE_GRANTS {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_CAPACITY_REACHED",
        ));
    }
    if state.used_grant_handles.len() >= MAX_USED_GRANT_HANDLES {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_HANDLE_CAPACITY_REACHED",
        ));
    }
    if state.used_grant_handles.contains(grant_handle) {
        return Err(LocalCapabilityError::new("LOCAL_FILE_GRANT_HANDLE_REUSED"));
    }
    Ok(())
}

fn remove_grant_path_admissions(state: &mut FileGrantRegistryState, grant_handle: &str) {
    state
        .path_admissions
        .retain(|_, record| record.input.grant_handle != grant_handle);
    compact_path_order(state);
}

fn compact_path_order(state: &mut FileGrantRegistryState) {
    let active = state
        .path_admissions
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    state
        .path_admission_order
        .retain(|descriptor| active.contains(descriptor));
}
