use super::browser_contracts::{
    BrowserDescriptorAdmitInput, BrowserDownloadPolicy, BrowserEvidencePolicy,
    BrowserPermissionPolicy,
};
use super::capability_hash::digest_hex;
use super::contracts::{CapabilityScope, LocalCapabilityError};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub(super) struct RegisteredBrowserPolicy {
    pub revision: String,
    pub scope: CapabilityScope,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub allowed_origins: Vec<String>,
    pub download_policy: BrowserDownloadPolicy,
    pub permission_policy: BrowserPermissionPolicy,
    pub evidence_policy: BrowserEvidencePolicy,
    pub max_timeout_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Serialize)]
struct BrowserDescriptorHashMaterial<'a> {
    schema_version: &'static str,
    policy_handle: &'a str,
    policy_revision: &'a str,
    scope: &'a CapabilityScope,
    policy_id: &'a str,
    action_id: &'a str,
    capability_id: &'a str,
    allowed_origins: &'a [String],
    start_url: &'a str,
    expected_origin: &'a str,
    timeout_ms: u64,
    download_policy: &'a BrowserDownloadPolicy,
    permission_policy: &'a BrowserPermissionPolicy,
    evidence_policy: &'a BrowserEvidencePolicy,
}

pub(super) fn validate_descriptor_against_policy(
    input: &BrowserDescriptorAdmitInput,
    policy: &RegisteredBrowserPolicy,
) -> Result<(), LocalCapabilityError> {
    if policy.revision != input.expected_policy_revision {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_POLICY_REVISION_MISMATCH",
        ));
    }
    if policy.scope != input.scope {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_POLICY_SCOPE_MISMATCH",
        ));
    }
    if !policy.allowed_origins.contains(&input.expected_origin) {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_ORIGIN_POLICY_MISMATCH",
        ));
    }
    if input.timeout_ms > policy.max_timeout_ms
        || input.download_policy != policy.download_policy
        || input.permission_policy != policy.permission_policy
        || input.evidence_policy != policy.evidence_policy
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_DESCRIPTOR_POLICY_MISMATCH",
        ));
    }
    Ok(())
}

pub(super) fn browser_descriptor_hash(
    input: &BrowserDescriptorAdmitInput,
    policy: &RegisteredBrowserPolicy,
) -> Result<String, LocalCapabilityError> {
    let material = BrowserDescriptorHashMaterial {
        schema_version: "aistaff.local-browser-descriptor.v1",
        policy_handle: &input.policy_handle,
        policy_revision: &policy.revision,
        scope: &policy.scope,
        policy_id: &policy.policy_id,
        action_id: &policy.action_id,
        capability_id: &policy.capability_id,
        allowed_origins: &policy.allowed_origins,
        start_url: &input.start_url,
        expected_origin: &input.expected_origin,
        timeout_ms: input.timeout_ms,
        download_policy: &input.download_policy,
        permission_policy: &input.permission_policy,
        evidence_policy: &input.evidence_policy,
    };
    let bytes = serde_json::to_vec(&material)
        .map_err(|_| LocalCapabilityError::new("LOCAL_BROWSER_DESCRIPTOR_HASH_FAILED"))?;
    digest_hex(Sha256::digest(bytes).as_slice())
}
