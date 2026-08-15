use super::contracts::{CapabilityScope, LocalCapabilityError, is_lower_sha256, is_lower_uuid};
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt::Write as _;

pub(super) const WINDOWS_ACL_LEASE_INTENT_SCHEMA_VERSION: &str =
    "aistaff.windows-process-acl-lease-intent.v1";
pub(super) const WINDOWS_ACL_LEASE_BOUND_SCHEMA_VERSION: &str =
    "aistaff.windows-process-acl-lease-bound.v1";
pub(super) const WINDOWS_ACL_LEASE_PROFILE_PREFIX: &str = "aistaff.worker.";
pub(super) const WINDOWS_ACL_LEASE_MAX_TARGETS: usize = 64;
const WINDOWS_PATH_MAX_UNITS: usize = 32_767;
const WINDOWS_SID_MAX_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum WindowsAclGrantClass {
    DirectoryTraverseMetadata,
    ExecutableReadExecute,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct WindowsAclTargetIdentity {
    pub volume_serial_number: u32,
    pub file_index: u64,
    pub directory: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct WindowsAclLeaseTarget {
    pub path_utf16le_base64: String,
    pub identity: WindowsAclTargetIdentity,
    pub grant_class: WindowsAclGrantClass,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct WindowsAclLeaseIntent {
    pub schema_version: String,
    pub capability_id: String,
    pub operation_id: String,
    pub scope_sha256: String,
    pub profile_name: String,
    pub targets: Vec<WindowsAclLeaseTarget>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct WindowsAclLeaseBinding {
    pub schema_version: String,
    pub intent: WindowsAclLeaseIntent,
    pub app_container_sid_base64: String,
    pub app_container_sid_sha256: String,
}

impl WindowsAclLeaseIntent {
    pub(super) fn new(
        operation_id: &str,
        scope: &CapabilityScope,
        targets: Vec<WindowsAclLeaseTarget>,
    ) -> Result<Self, LocalCapabilityError> {
        scope.validate().map_err(|_| lease_error())?;
        let intent = Self {
            schema_version: WINDOWS_ACL_LEASE_INTENT_SCHEMA_VERSION.to_owned(),
            capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID.to_owned(),
            operation_id: operation_id.to_owned(),
            scope_sha256: scope_digest(scope)?,
            profile_name: profile_name(operation_id)?,
            targets,
        };
        intent.validate()?;
        Ok(intent)
    }

    pub(super) fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != WINDOWS_ACL_LEASE_INTENT_SCHEMA_VERSION
            || self.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
            || !is_lower_uuid(&self.operation_id)
            || !is_lower_sha256(&self.scope_sha256)
            || self.profile_name != profile_name(&self.operation_id)?
            || self.targets.is_empty()
            || self.targets.len() > WINDOWS_ACL_LEASE_MAX_TARGETS
        {
            return Err(lease_error());
        }
        let mut paths = HashSet::with_capacity(self.targets.len());
        for target in &self.targets {
            target.validate()?;
            if !paths.insert(&target.path_utf16le_base64) {
                return Err(lease_error());
            }
        }
        Ok(())
    }
}

impl WindowsAclLeaseBinding {
    pub(super) fn new(
        intent: WindowsAclLeaseIntent,
        sid_bytes: &[u8],
        sid_sha256: String,
    ) -> Result<Self, LocalCapabilityError> {
        let binding = Self {
            schema_version: WINDOWS_ACL_LEASE_BOUND_SCHEMA_VERSION.to_owned(),
            intent,
            app_container_sid_base64: STANDARD.encode(sid_bytes),
            app_container_sid_sha256: sid_sha256,
        };
        binding.validate()?;
        Ok(binding)
    }

    pub(super) fn validate(&self) -> Result<(), LocalCapabilityError> {
        self.intent.validate()?;
        let sid = self.sid_bytes()?;
        if self.schema_version != WINDOWS_ACL_LEASE_BOUND_SCHEMA_VERSION
            || !is_lower_sha256(&self.app_container_sid_sha256)
            || sid.is_empty()
            || sid.len() > WINDOWS_SID_MAX_BYTES
            || self.app_container_sid_sha256 != sha256_hex(&sid)?
        {
            return Err(lease_error());
        }
        Ok(())
    }

    pub(super) fn sid_bytes(&self) -> Result<Vec<u8>, LocalCapabilityError> {
        STANDARD
            .decode(&self.app_container_sid_base64)
            .map_err(|_| lease_error())
    }
}

impl WindowsAclLeaseTarget {
    fn validate(&self) -> Result<(), LocalCapabilityError> {
        let bytes = STANDARD
            .decode(&self.path_utf16le_base64)
            .map_err(|_| lease_error())?;
        if bytes.is_empty()
            || bytes.len() % 2 != 0
            || bytes.len() > WINDOWS_PATH_MAX_UNITS * 2
            || bytes
                .chunks_exact(2)
                .any(|pair| u16::from_le_bytes([pair[0], pair[1]]) == 0)
            || self.identity.directory
                != matches!(
                    self.grant_class,
                    WindowsAclGrantClass::DirectoryTraverseMetadata
                )
        {
            return Err(lease_error());
        }
        Ok(())
    }
}

pub(super) fn profile_name(operation_id: &str) -> Result<String, LocalCapabilityError> {
    if !is_lower_uuid(operation_id) {
        return Err(lease_error());
    }
    let profile = format!("{WINDOWS_ACL_LEASE_PROFILE_PREFIX}{operation_id}");
    if profile.len() > 64
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b' '))
    {
        return Err(lease_error());
    }
    Ok(profile)
}

pub(super) fn lease_error() -> LocalCapabilityError {
    LocalCapabilityError::new("LOCAL_PROCESS_SANDBOX_ACL_LEASE_INVALID")
}

pub(super) fn sha256_hex(bytes: &[u8]) -> Result<String, LocalCapabilityError> {
    let digest = Sha256::digest(bytes);
    hex_encode(&digest)
}

fn scope_digest(scope: &CapabilityScope) -> Result<String, LocalCapabilityError> {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.windows-process-acl-lease-scope.v1\0");
    for value in [&scope.tenant_id, &scope.session_id, &scope.run_id] {
        let length = u64::try_from(value.len()).map_err(|_| lease_error())?;
        hasher.update(length.to_le_bytes());
        hasher.update(value.as_bytes());
    }
    let digest = hasher.finalize();
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> Result<String, LocalCapabilityError> {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut output, "{byte:02x}").map_err(|_| lease_error())?;
    }
    Ok(output)
}

mod journal;

#[cfg(windows)]
mod native;

#[cfg(test)]
#[path = "process_windows_acl_lease_tests.rs"]
mod tests;
