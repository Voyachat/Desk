use super::capability_hash::digest_hex;
use super::contracts::{CapabilityScope, LocalCapabilityError, SideEffectClass};
use super::process_contracts::{
    ProcessDescriptorAdmitInput, ProcessEnvironmentRef, ProcessTarget, ProcessWorkingDirectoryMode,
    ProcessWorkingDirectoryRef,
};
use super::process_executable::AdmittedExecutable;
use super::process_resource_policy::ProcessResourcePolicy;
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub(super) struct RegisteredProcessPolicy {
    pub revision: String,
    pub scope: CapabilityScope,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub target: ProcessTarget,
    pub fixed_argv: Vec<String>,
    pub required_environment_refs: Vec<ProcessEnvironmentRef>,
    pub working_directory_mode: ProcessWorkingDirectoryMode,
    pub side_effect: SideEffectClass,
    pub max_timeout_ms: u64,
    pub max_output_bytes: u64,
    pub resource_policy: ProcessResourcePolicy,
    pub expires_at_ms: u64,
    pub executable: AdmittedExecutable,
}

#[derive(Serialize)]
struct ProcessDescriptorHashMaterial<'a> {
    schema_version: &'static str,
    policy_handle: &'a str,
    policy_revision: &'a str,
    scope: &'a CapabilityScope,
    policy_id: &'a str,
    action_id: &'a str,
    capability_id: &'a str,
    target: ProcessTarget,
    side_effect: SideEffectClass,
    executable_sha256: &'a str,
    executable_fingerprint: &'a str,
    argv: &'a [String],
    environment_refs: &'a [ProcessEnvironmentRef],
    working_directory: Option<&'a ProcessWorkingDirectoryRef>,
    timeout_ms: u64,
    output_limit_bytes: u64,
    resource_policy: &'a ProcessResourcePolicy,
}

pub(super) fn validate_descriptor_against_policy(
    input: &ProcessDescriptorAdmitInput,
    policy: &RegisteredProcessPolicy,
) -> Result<(), LocalCapabilityError> {
    if policy.revision != input.expected_policy_revision {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_POLICY_REVISION_MISMATCH",
        ));
    }
    if policy.scope != input.scope {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_POLICY_SCOPE_MISMATCH",
        ));
    }
    if policy.fixed_argv != input.argv {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_ARGUMENT_POLICY_MISMATCH",
        ));
    }
    if input.environment_refs != policy.required_environment_refs {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_ENVIRONMENT_POLICY_MISMATCH",
        ));
    }
    let working_directory_matches = matches!(
        (policy.working_directory_mode, &input.working_directory),
        (ProcessWorkingDirectoryMode::Forbidden, None)
            | (
                ProcessWorkingDirectoryMode::RequiredScopedDirectory,
                Some(_)
            )
    );
    if !working_directory_matches {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_POLICY_MISMATCH",
        ));
    }
    if input.timeout_ms > policy.max_timeout_ms
        || input.output_limit_bytes > policy.max_output_bytes
        || input.resource_policy != policy.resource_policy
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_RESOURCE_POLICY_EXCEEDED",
        ));
    }
    Ok(())
}

pub(super) fn process_descriptor_hash(
    input: &ProcessDescriptorAdmitInput,
    policy: &RegisteredProcessPolicy,
) -> Result<String, LocalCapabilityError> {
    let material = ProcessDescriptorHashMaterial {
        schema_version: "aistaff.local-process-descriptor.v2",
        policy_handle: &input.policy_handle,
        policy_revision: &policy.revision,
        scope: &policy.scope,
        policy_id: &policy.policy_id,
        action_id: &policy.action_id,
        capability_id: &policy.capability_id,
        target: policy.target,
        side_effect: policy.side_effect,
        executable_sha256: policy.executable.sha256(),
        executable_fingerprint: policy.executable.fingerprint(),
        argv: &input.argv,
        environment_refs: &input.environment_refs,
        working_directory: input.working_directory.as_ref(),
        timeout_ms: input.timeout_ms,
        output_limit_bytes: input.output_limit_bytes,
        resource_policy: &input.resource_policy,
    };
    let bytes = serde_json::to_vec(&material)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_DESCRIPTOR_HASH_FAILED"))?;
    digest_hex(Sha256::digest(bytes).as_slice())
}
