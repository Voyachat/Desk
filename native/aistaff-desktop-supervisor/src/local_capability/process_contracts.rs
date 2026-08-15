use super::contracts::{
    CapabilityScope, LocalCapabilityError, SideEffectClass, is_lower_sha256, is_lower_uuid,
    is_safe_identifier, validate_protocol,
};
use super::file_contracts::safe_segment;
use super::process_resource_policy::ProcessResourcePolicy;
use super::process_windows_sandbox_plan::validate_windows_sandbox_policy;
use serde::{Deserialize, Serialize};

pub const LOCAL_PROCESS_CAPABILITY_COMMANDS: [&str; 3] = [
    "capability.process.policy.register",
    "capability.process.policy.revoke",
    "capability.process.descriptor.admit",
];
pub const LOCAL_PROCESS_DESCRIPTOR_ADMISSION_CAPABILITY_ID: &str =
    "local_process_descriptor_admission.v1";
pub const LOCAL_PROCESS_MAX_ARGUMENTS: usize = 16;
pub const LOCAL_PROCESS_MAX_ARGUMENT_BYTES: usize = 512;
pub const LOCAL_PROCESS_MAX_ARGUMENT_TOTAL_BYTES: usize = 4 * 1024;
pub const LOCAL_PROCESS_MAX_ENVIRONMENT_REFS: usize = 16;
pub const LOCAL_PROCESS_MAX_TIMEOUT_MS: u64 = 5 * 60 * 1_000;
pub const LOCAL_PROCESS_MAX_OUTPUT_BYTES: u64 = 64 * 1024;

const MAX_EXECUTABLE_PATH_BYTES: usize = 4_096;
const MAX_RELATIVE_SEGMENTS: usize = 32;
const MAX_RELATIVE_PATH_BYTES: usize = 2_048;
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessTarget {
    MacosX64,
    MacosArm64,
    WindowsX64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessWorkingDirectoryMode {
    Forbidden,
    RequiredScopedDirectory,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessPolicySource {
    TrustedPolicyPort,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessPolicyRegisterInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub policy_revision: String,
    pub scope: CapabilityScope,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub executable_path: String,
    pub expected_executable_sha256: String,
    pub target: ProcessTarget,
    pub fixed_argv: Vec<String>,
    pub required_environment_refs: Vec<ProcessEnvironmentRef>,
    pub working_directory_mode: ProcessWorkingDirectoryMode,
    pub side_effect: SideEffectClass,
    pub max_timeout_ms: u64,
    pub max_output_bytes: u64,
    pub resource_policy: ProcessResourcePolicy,
    pub source: ProcessPolicySource,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessPolicyRegisterResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub policy_revision: String,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub target: ProcessTarget,
    pub executable_sha256: String,
    pub executable_fingerprint: String,
    pub policy_status: &'static str,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessPolicyRevokeInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_policy_revision: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessPolicyRevokeResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub revoke_status: &'static str,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessEnvironmentRef {
    pub name: String,
    pub secret_ref: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessWorkingDirectoryRef {
    pub grant_handle: String,
    pub expected_grant_revision: String,
    pub relative_segments: Vec<String>,
    pub target_descriptor_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessDescriptorAdmitInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_policy_revision: String,
    pub scope: CapabilityScope,
    pub argv: Vec<String>,
    pub environment_refs: Vec<ProcessEnvironmentRef>,
    pub working_directory: Option<ProcessWorkingDirectoryRef>,
    pub timeout_ms: u64,
    pub output_limit_bytes: u64,
    pub resource_policy: ProcessResourcePolicy,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessDescriptorEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub executable_fingerprint: String,
    pub process_descriptor_hash: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProcessDescriptorAdmitResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub policy_id: String,
    pub action_id: String,
    pub process_capability_id: String,
    pub target: ProcessTarget,
    pub side_effect: SideEffectClass,
    pub admission_status: &'static str,
    pub executable_fingerprint: String,
    pub process_descriptor_hash: String,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: ProcessDescriptorEvidence,
}

pub fn is_local_process_capability_command(command: &str) -> bool {
    LOCAL_PROCESS_CAPABILITY_COMMANDS.contains(&command)
}

pub fn current_process_target() -> Option<ProcessTarget> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => Some(ProcessTarget::MacosX64),
        ("macos", "aarch64") => Some(ProcessTarget::MacosArm64),
        ("windows", "x86_64") => Some(ProcessTarget::WindowsX64),
        _ => None,
    }
}

impl ProcessPolicyRegisterInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.policy_revision)
            || !is_safe_identifier(&self.policy_id)
            || !is_safe_identifier(&self.action_id)
            || !is_safe_identifier(&self.capability_id)
            || self.executable_path.is_empty()
            || self.executable_path.len() > MAX_EXECUTABLE_PATH_BYTES
            || self.executable_path.contains('\0')
            || !is_lower_sha256(&self.expected_executable_sha256)
            || self.expires_at_ms == 0
            || self.expires_at_ms > JAVASCRIPT_MAX_SAFE_INTEGER
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_POLICY_REGISTER",
            ));
        }
        validate_arguments(&self.fixed_argv)?;
        validate_environment_refs(&self.required_environment_refs)?;
        validate_budget(self.max_timeout_ms, self.max_output_bytes)?;
        self.resource_policy.validate()?;
        if self.target == ProcessTarget::WindowsX64 {
            validate_windows_sandbox_policy(&self.resource_policy)?;
        }
        Ok(())
    }
}

impl ProcessPolicyRevokeInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.expected_policy_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_POLICY_REVOKE",
            ));
        }
        Ok(())
    }
}

impl ProcessDescriptorAdmitInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.expected_policy_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_DESCRIPTOR_ADMIT",
            ));
        }
        validate_arguments(&self.argv)?;
        validate_environment_refs(&self.environment_refs)?;
        if let Some(directory) = &self.working_directory {
            directory.validate()?;
        }
        validate_budget(self.timeout_ms, self.output_limit_bytes)?;
        self.resource_policy.validate()
    }
}

impl ProcessWorkingDirectoryRef {
    fn validate(&self) -> Result<(), LocalCapabilityError> {
        let relative_bytes = self
            .relative_segments
            .iter()
            .map(String::len)
            .sum::<usize>()
            .saturating_add(self.relative_segments.len().saturating_sub(1));
        if !is_lower_uuid(&self.grant_handle)
            || !is_lower_uuid(&self.expected_grant_revision)
            || !is_lower_sha256(&self.target_descriptor_hash)
            || self.relative_segments.len() > MAX_RELATIVE_SEGMENTS
            || relative_bytes > MAX_RELATIVE_PATH_BYTES
            || self
                .relative_segments
                .iter()
                .any(|segment| !safe_segment(segment))
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_WORKING_DIRECTORY",
            ));
        }
        Ok(())
    }
}

fn validate_arguments(arguments: &[String]) -> Result<(), LocalCapabilityError> {
    let total_bytes = arguments.iter().map(String::len).sum::<usize>();
    if arguments.len() > LOCAL_PROCESS_MAX_ARGUMENTS
        || total_bytes > LOCAL_PROCESS_MAX_ARGUMENT_TOTAL_BYTES
        || arguments.iter().any(|argument| {
            argument.is_empty()
                || argument.len() > LOCAL_PROCESS_MAX_ARGUMENT_BYTES
                || argument.chars().any(char::is_control)
        })
    {
        return Err(LocalCapabilityError::new("INVALID_LOCAL_PROCESS_ARGUMENTS"));
    }
    Ok(())
}

fn validate_environment_refs(refs: &[ProcessEnvironmentRef]) -> Result<(), LocalCapabilityError> {
    if refs.len() > LOCAL_PROCESS_MAX_ENVIRONMENT_REFS
        || refs.iter().any(|entry| {
            !safe_environment_name(&entry.name) || !is_safe_identifier(&entry.secret_ref)
        })
        || refs.windows(2).any(|pair| pair[0].name >= pair[1].name)
    {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_PROCESS_ENVIRONMENT_REFS",
        ));
    }
    Ok(())
}

fn safe_environment_name(name: &str) -> bool {
    let valid_shape = !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_uppercase() || byte == b'_')
        && name
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_');
    valid_shape
        && !matches!(
            name,
            "PATH"
                | "PATHEXT"
                | "COMSPEC"
                | "SYSTEMROOT"
                | "WINDIR"
                | "HOME"
                | "SHELL"
                | "NODE_OPTIONS"
                | "ELECTRON_RUN_AS_NODE"
                | "RUSTC_WRAPPER"
                | "CARGO_HOME"
        )
        && !name.starts_with("LD_")
        && !name.starts_with("DYLD_")
}

fn validate_budget(timeout_ms: u64, output_bytes: u64) -> Result<(), LocalCapabilityError> {
    if timeout_ms == 0
        || timeout_ms > LOCAL_PROCESS_MAX_TIMEOUT_MS
        || output_bytes == 0
        || output_bytes > LOCAL_PROCESS_MAX_OUTPUT_BYTES
    {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_PROCESS_RESOURCE_BUDGET",
        ));
    }
    Ok(())
}
