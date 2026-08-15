use super::contracts::CapabilityScope;
use super::process_contracts::ProcessTarget;
use super::process_resource_policy::ProcessResourcePolicy;
use std::path::Path;
use zeroize::Zeroizing;

pub(super) struct MaterializedProcessEnvironment {
    pub name: String,
    pub value: Zeroizing<String>,
}

#[cfg_attr(
    not(any(test, windows)),
    allow(
        dead_code,
        reason = "production Process engine remains disconnected outside the target-native candidate"
    )
)]
pub(super) struct SandboxedProcessSpawnSpec<'a> {
    pub capability_id: &'static str,
    pub operation_id: &'a str,
    pub scope: &'a CapabilityScope,
    pub executable_path: &'a Path,
    pub argv: &'a [String],
    pub inherited_environment: Vec<(String, String)>,
    pub environment: &'a [MaterializedProcessEnvironment],
    pub working_directory: Option<&'a Path>,
    pub target: ProcessTarget,
    pub resource_policy: &'a ProcessResourcePolicy,
}
