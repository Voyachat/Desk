use super::contracts::LocalCapabilityError;
use serde::{Deserialize, Serialize};

pub const PROCESS_RESOURCE_POLICY_SCHEMA_VERSION: &str = "aistaff.local-process-resource-policy.v1";
pub const MIN_CPU_TIME_MS: u64 = 1_000;
pub const MAX_CPU_TIME_MS: u64 = 5 * 60 * 1_000;
pub const MIN_MEMORY_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_MEMORY_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MEMORY_ALIGNMENT_BYTES: u64 = 1024 * 1024;
pub const MAX_PROCESS_COUNT: u16 = 16;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessNetworkAccess {
    Denied,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ProcessSandboxProfile {
    #[serde(rename = "aistaff.restricted-process.v1")]
    RestrictedProcessV1,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProcessResourcePolicy {
    pub schema_version: String,
    pub cpu_time_limit_ms: u64,
    pub memory_limit_bytes: u64,
    pub process_count_limit: u16,
    pub network_access: ProcessNetworkAccess,
    pub sandbox_profile: ProcessSandboxProfile,
}

impl ProcessResourcePolicy {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != PROCESS_RESOURCE_POLICY_SCHEMA_VERSION
            || !(MIN_CPU_TIME_MS..=MAX_CPU_TIME_MS).contains(&self.cpu_time_limit_ms)
            || !self.cpu_time_limit_ms.is_multiple_of(MIN_CPU_TIME_MS)
            || !(MIN_MEMORY_BYTES..=MAX_MEMORY_BYTES).contains(&self.memory_limit_bytes)
            || !self
                .memory_limit_bytes
                .is_multiple_of(MEMORY_ALIGNMENT_BYTES)
            || !(1..=MAX_PROCESS_COUNT).contains(&self.process_count_limit)
            || self.network_access != ProcessNetworkAccess::Denied
            || self.sandbox_profile != ProcessSandboxProfile::RestrictedProcessV1
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_RESOURCE_POLICY",
            ));
        }
        Ok(())
    }
}
