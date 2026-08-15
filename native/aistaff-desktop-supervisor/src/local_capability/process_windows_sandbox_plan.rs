use super::contracts::LocalCapabilityError;
use super::process_resource_policy::ProcessResourcePolicy;
#[cfg(any(test, windows))]
use zeroize::Zeroizing;

pub const WINDOWS_PROCESS_SANDBOX_PLAN_SCHEMA_VERSION: &str =
    "aistaff.local-process-windows-sandbox-plan.v1";
const WINDOWS_JOB_TIME_TICKS_PER_MILLISECOND: u64 = 10_000;
#[cfg(any(test, windows))]
const WINDOWS_MAX_COMMAND_LINE_UNITS: usize = 32_767;
#[cfg(any(test, windows))]
const WINDOWS_MAX_ENVIRONMENT_BLOCK_UNITS: usize = 32_767;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WindowsStartupAttribute {
    LpacSecurityCapabilities,
    AllApplicationPackagesOptOut,
    JobList,
    ExactHandleList,
}

pub(super) const WINDOWS_REQUIRED_STARTUP_ATTRIBUTES: [WindowsStartupAttribute; 4] = [
    WindowsStartupAttribute::LpacSecurityCapabilities,
    WindowsStartupAttribute::AllApplicationPackagesOptOut,
    WindowsStartupAttribute::JobList,
    WindowsStartupAttribute::ExactHandleList,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WindowsPathGrant {
    ExecutableReadExecute,
    WorkingDirectoryTraverseMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WindowsProcessSandboxPlan {
    pub schema_version: &'static str,
    pub job_user_time_limit_100ns: i64,
    pub job_memory_limit_bytes: usize,
    pub active_process_limit: u32,
    pub kill_on_job_close: bool,
    pub breakaway_allowed: bool,
    pub create_suspended: bool,
    pub lpac: bool,
    pub network_capability_count: u32,
    pub startup_attributes: [WindowsStartupAttribute; 4],
    pub path_grants: [WindowsPathGrant; 2],
}

impl WindowsProcessSandboxPlan {
    pub fn from_policy(policy: &ProcessResourcePolicy) -> Result<Self, LocalCapabilityError> {
        policy.validate()?;
        let ticks = policy
            .cpu_time_limit_ms
            .checked_mul(WINDOWS_JOB_TIME_TICKS_PER_MILLISECOND)
            .and_then(|value| i64::try_from(value).ok())
            .ok_or_else(|| LocalCapabilityError::new("INVALID_LOCAL_PROCESS_RESOURCE_POLICY"))?;
        let memory = usize::try_from(policy.memory_limit_bytes)
            .map_err(|_| LocalCapabilityError::new("INVALID_LOCAL_PROCESS_RESOURCE_POLICY"))?;
        Ok(Self {
            schema_version: WINDOWS_PROCESS_SANDBOX_PLAN_SCHEMA_VERSION,
            job_user_time_limit_100ns: ticks,
            job_memory_limit_bytes: memory,
            active_process_limit: u32::from(policy.process_count_limit),
            kill_on_job_close: true,
            breakaway_allowed: false,
            create_suspended: true,
            lpac: true,
            network_capability_count: 0,
            startup_attributes: WINDOWS_REQUIRED_STARTUP_ATTRIBUTES,
            path_grants: [
                WindowsPathGrant::ExecutableReadExecute,
                WindowsPathGrant::WorkingDirectoryTraverseMetadata,
            ],
        })
    }
}

pub(super) fn validate_windows_sandbox_policy(
    policy: &ProcessResourcePolicy,
) -> Result<(), LocalCapabilityError> {
    let plan = WindowsProcessSandboxPlan::from_policy(policy)?;
    if plan.schema_version != WINDOWS_PROCESS_SANDBOX_PLAN_SCHEMA_VERSION
        || plan.job_user_time_limit_100ns <= 0
        || plan.job_memory_limit_bytes == 0
        || plan.active_process_limit == 0
        || !plan.kill_on_job_close
        || plan.breakaway_allowed
        || !plan.create_suspended
        || !plan.lpac
        || plan.network_capability_count != 0
        || plan.startup_attributes != WINDOWS_REQUIRED_STARTUP_ATTRIBUTES
        || plan.path_grants
            != [
                WindowsPathGrant::ExecutableReadExecute,
                WindowsPathGrant::WorkingDirectoryTraverseMetadata,
            ]
    {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_PROCESS_RESOURCE_POLICY",
        ));
    }
    Ok(())
}

#[cfg(any(test, windows))]
pub(super) fn build_windows_command_line(
    executable: &[u16],
    argv: &[String],
) -> Result<Zeroizing<Vec<u16>>, LocalCapabilityError> {
    let mut output = Zeroizing::new(Vec::new());
    append_windows_quoted_argument(executable, &mut output)?;
    for argument in argv {
        output.push(u16::from(b' '));
        let encoded = argument.encode_utf16().collect::<Vec<_>>();
        append_windows_quoted_argument(&encoded, &mut output)?;
    }
    output.push(0);
    if output.len() > WINDOWS_MAX_COMMAND_LINE_UNITS {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_COMMAND_LINE_REJECTED",
        ));
    }
    Ok(output)
}

#[cfg(any(test, windows))]
pub(super) fn build_windows_environment_block(
    entries: &[(&str, &str)],
) -> Result<Zeroizing<Vec<u16>>, LocalCapabilityError> {
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| {
        left.0
            .to_ascii_uppercase()
            .cmp(&right.0.to_ascii_uppercase())
    });
    if sorted.windows(2).any(|pair| {
        pair[0].0.eq_ignore_ascii_case(pair[1].0)
            || !valid_windows_environment_entry(pair[0].0, pair[0].1)
    }) || sorted
        .last()
        .is_some_and(|entry| !valid_windows_environment_entry(entry.0, entry.1))
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_ENVIRONMENT_BLOCK_REJECTED",
        ));
    }
    let mut block = Zeroizing::new(Vec::new());
    for (name, value) in sorted {
        block.extend(name.encode_utf16());
        block.push(u16::from(b'='));
        block.extend(value.encode_utf16());
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    if block.len() > WINDOWS_MAX_ENVIRONMENT_BLOCK_UNITS {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_ENVIRONMENT_BLOCK_REJECTED",
        ));
    }
    Ok(block)
}

#[cfg(any(test, windows))]
fn append_windows_quoted_argument(
    argument: &[u16],
    output: &mut Vec<u16>,
) -> Result<(), LocalCapabilityError> {
    if argument.contains(&0) {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_COMMAND_LINE_REJECTED",
        ));
    }
    let requires_quotes = argument.is_empty()
        || argument
            .iter()
            .any(|unit| matches!(*unit, 0x09..=0x0d | 0x20 | 0x22));
    if !requires_quotes {
        output.extend_from_slice(argument);
        return Ok(());
    }
    output.push(u16::from(b'"'));
    let mut backslashes = 0;
    for unit in argument {
        match *unit {
            value if value == u16::from(b'\\') => backslashes += 1,
            value if value == u16::from(b'"') => {
                output.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes * 2 + 1));
                output.push(value);
                backslashes = 0;
            }
            value => {
                output.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes));
                output.push(value);
                backslashes = 0;
            }
        }
    }
    output.extend(std::iter::repeat_n(u16::from(b'\\'), backslashes * 2));
    output.push(u16::from(b'"'));
    Ok(())
}

#[cfg(any(test, windows))]
fn valid_windows_environment_entry(name: &str, value: &str) -> bool {
    !name.is_empty()
        && name.is_ascii()
        && !name.contains('=')
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && name
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && !value.contains('\0')
}
