use super::process_contracts::ProcessTarget;
use super::process_native_sandbox::{
    NATIVE_PROCESS_SANDBOX_SCHEMA_VERSION, NativeProcessSandboxAdmission,
    NativeProcessSandboxControlState, REQUIRED_NATIVE_PROCESS_SANDBOX_CONTROLS,
};

#[test]
fn target_candidate_matrices_are_exact_and_never_execution_admitted() {
    for target in [
        ProcessTarget::MacosX64,
        ProcessTarget::MacosArm64,
        ProcessTarget::WindowsX64,
    ] {
        let admission = NativeProcessSandboxAdmission::candidate(Some(target));
        assert_eq!(
            admission.schema_version,
            NATIVE_PROCESS_SANDBOX_SCHEMA_VERSION
        );
        assert_eq!(admission.target, Some(target));
        assert_eq!(
            admission.controls.map(|assessment| assessment.control),
            REQUIRED_NATIVE_PROCESS_SANDBOX_CONTROLS
        );
        assert!(!admission.permits_execution_kernel());
        assert!(!admission.is_production_fully_enforced());
    }
}

#[test]
fn macos_partial_rlimits_and_process_groups_never_claim_full_sandbox() {
    let admission = NativeProcessSandboxAdmission::candidate(Some(ProcessTarget::MacosX64));
    assert_eq!(
        admission.controls.map(|assessment| assessment.state),
        [
            NativeProcessSandboxControlState::Partial,
            NativeProcessSandboxControlState::Partial,
            NativeProcessSandboxControlState::Unavailable,
            NativeProcessSandboxControlState::Unavailable,
            NativeProcessSandboxControlState::Unavailable,
            NativeProcessSandboxControlState::Partial,
        ]
    );
    assert_eq!(
        admission.controls[3].reason_code,
        "MACOS_SIGNED_XPC_NETWORK_SANDBOX_UNVERIFIED"
    );
}

#[test]
fn windows_requires_job_object_and_lpac_evidence_together() {
    let admission = NativeProcessSandboxAdmission::candidate(Some(ProcessTarget::WindowsX64));
    assert!(
        admission.controls.iter().all(|assessment| {
            assessment.state == NativeProcessSandboxControlState::Unavailable
        })
    );
    assert_eq!(
        admission.controls[0].reason_code,
        "WINDOWS_JOB_OBJECT_CPU_UNVERIFIED"
    );
    assert_eq!(
        admission.controls[3].reason_code,
        "WINDOWS_LPAC_NETWORK_ISOLATION_UNVERIFIED"
    );
    assert!(!admission.permits_execution_kernel());
}

#[test]
fn test_only_kernel_admission_cannot_become_production_evidence() {
    let admission = NativeProcessSandboxAdmission::test_only(ProcessTarget::MacosX64);
    assert!(admission.permits_execution_kernel());
    assert!(!admission.is_production_fully_enforced());
}

#[test]
fn unsupported_host_is_explicitly_unavailable() {
    let admission = NativeProcessSandboxAdmission::candidate(None);
    assert!(admission.target.is_none());
    assert!(admission.controls.iter().all(|assessment| {
        assessment.state == NativeProcessSandboxControlState::Unavailable
            && assessment.reason_code == "LOCAL_PROCESS_NATIVE_SANDBOX_TARGET_UNSUPPORTED"
    }));
    assert!(!admission.permits_execution_kernel());
}
