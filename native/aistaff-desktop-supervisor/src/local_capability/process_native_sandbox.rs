use super::process_contracts::ProcessTarget;

pub const NATIVE_PROCESS_SANDBOX_SCHEMA_VERSION: &str = "aistaff.local-process-native-sandbox.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NativeProcessSandboxControl {
    CpuTime,
    Memory,
    ProcessCount,
    Network,
    Filesystem,
    ProcessTree,
}

pub(super) const REQUIRED_NATIVE_PROCESS_SANDBOX_CONTROLS: [NativeProcessSandboxControl; 6] = [
    NativeProcessSandboxControl::CpuTime,
    NativeProcessSandboxControl::Memory,
    NativeProcessSandboxControl::ProcessCount,
    NativeProcessSandboxControl::Network,
    NativeProcessSandboxControl::Filesystem,
    NativeProcessSandboxControl::ProcessTree,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NativeProcessSandboxControlState {
    #[cfg(test)]
    Enforced,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct NativeProcessSandboxControlAssessment {
    pub control: NativeProcessSandboxControl,
    pub state: NativeProcessSandboxControlState,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeProcessSandboxEvidenceLevel {
    CandidateOnly,
    #[cfg(test)]
    TestOnlyKernel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct NativeProcessSandboxAdmission {
    pub schema_version: &'static str,
    pub target: Option<ProcessTarget>,
    evidence_level: NativeProcessSandboxEvidenceLevel,
    pub controls: [NativeProcessSandboxControlAssessment; 6],
}

impl NativeProcessSandboxAdmission {
    pub fn candidate(target: Option<ProcessTarget>) -> Self {
        let controls = match target {
            Some(ProcessTarget::MacosX64 | ProcessTarget::MacosArm64) => macos_candidate_controls(),
            Some(ProcessTarget::WindowsX64) => windows_candidate_controls(),
            None => unsupported_target_controls(),
        };
        Self {
            schema_version: NATIVE_PROCESS_SANDBOX_SCHEMA_VERSION,
            target,
            evidence_level: NativeProcessSandboxEvidenceLevel::CandidateOnly,
            controls,
        }
    }

    pub fn permits_execution_kernel(&self) -> bool {
        #[cfg(test)]
        if self.evidence_level == NativeProcessSandboxEvidenceLevel::TestOnlyKernel {
            return true;
        }
        self.is_production_fully_enforced()
    }

    pub fn is_production_fully_enforced(&self) -> bool {
        false
    }

    #[cfg(test)]
    pub fn test_only(target: ProcessTarget) -> Self {
        Self {
            schema_version: NATIVE_PROCESS_SANDBOX_SCHEMA_VERSION,
            target: Some(target),
            evidence_level: NativeProcessSandboxEvidenceLevel::TestOnlyKernel,
            controls: REQUIRED_NATIVE_PROCESS_SANDBOX_CONTROLS.map(|control| {
                NativeProcessSandboxControlAssessment {
                    control,
                    state: NativeProcessSandboxControlState::Enforced,
                    reason_code: "TEST_ONLY_PROCESS_KERNEL",
                }
            }),
        }
    }
}

fn macos_candidate_controls() -> [NativeProcessSandboxControlAssessment; 6] {
    assessments([
        (
            NativeProcessSandboxControlState::Partial,
            "MACOS_RLIMIT_CPU_IS_PER_PROCESS",
        ),
        (
            NativeProcessSandboxControlState::Partial,
            "MACOS_RLIMIT_MEMORY_IS_PER_PROCESS",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "MACOS_TREE_PROCESS_LIMIT_UNAVAILABLE",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "MACOS_SIGNED_XPC_NETWORK_SANDBOX_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "MACOS_SIGNED_XPC_FILESYSTEM_SANDBOX_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Partial,
            "MACOS_PROCESS_GROUP_IS_NOT_CONTAINMENT",
        ),
    ])
}

fn windows_candidate_controls() -> [NativeProcessSandboxControlAssessment; 6] {
    assessments([
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_JOB_OBJECT_CPU_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_JOB_OBJECT_MEMORY_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_JOB_OBJECT_PROCESS_LIMIT_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_LPAC_NETWORK_ISOLATION_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_LPAC_FILESYSTEM_ISOLATION_UNVERIFIED",
        ),
        (
            NativeProcessSandboxControlState::Unavailable,
            "WINDOWS_JOB_OBJECT_TREE_CONTAINMENT_UNVERIFIED",
        ),
    ])
}

fn unsupported_target_controls() -> [NativeProcessSandboxControlAssessment; 6] {
    assessments(
        [(
            NativeProcessSandboxControlState::Unavailable,
            "LOCAL_PROCESS_NATIVE_SANDBOX_TARGET_UNSUPPORTED",
        ); 6],
    )
}

fn assessments(
    states: [(NativeProcessSandboxControlState, &'static str); 6],
) -> [NativeProcessSandboxControlAssessment; 6] {
    std::array::from_fn(|index| NativeProcessSandboxControlAssessment {
        control: REQUIRED_NATIVE_PROCESS_SANDBOX_CONTROLS[index],
        state: states[index].0,
        reason_code: states[index].1,
    })
}
