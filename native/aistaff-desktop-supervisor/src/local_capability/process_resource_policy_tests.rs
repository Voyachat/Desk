use super::process_resource_policy::{
    MAX_CPU_TIME_MS, MAX_MEMORY_BYTES, MAX_PROCESS_COUNT, ProcessNetworkAccess,
    ProcessResourcePolicy, ProcessSandboxProfile,
};

fn policy() -> ProcessResourcePolicy {
    ProcessResourcePolicy {
        schema_version: "aistaff.local-process-resource-policy.v1".to_owned(),
        cpu_time_limit_ms: 1_000,
        memory_limit_bytes: 64 * 1024 * 1024,
        process_count_limit: 4,
        network_access: ProcessNetworkAccess::Denied,
        sandbox_profile: ProcessSandboxProfile::RestrictedProcessV1,
    }
}

#[test]
fn exact_bounded_resource_policy_is_valid() {
    policy().validate().expect("valid resource policy");
}

#[test]
fn unaligned_and_out_of_range_resource_policy_fails_closed() {
    for candidate in [
        ProcessResourcePolicy {
            schema_version: "resource-policy.latest".to_owned(),
            ..policy()
        },
        ProcessResourcePolicy {
            cpu_time_limit_ms: 1_001,
            ..policy()
        },
        ProcessResourcePolicy {
            cpu_time_limit_ms: MAX_CPU_TIME_MS + 1_000,
            ..policy()
        },
        ProcessResourcePolicy {
            memory_limit_bytes: 64 * 1024 * 1024 + 1,
            ..policy()
        },
        ProcessResourcePolicy {
            memory_limit_bytes: MAX_MEMORY_BYTES + 1024 * 1024,
            ..policy()
        },
        ProcessResourcePolicy {
            process_count_limit: MAX_PROCESS_COUNT + 1,
            ..policy()
        },
    ] {
        assert_eq!(
            candidate.validate().map_err(|error| error.code),
            Err("INVALID_LOCAL_PROCESS_RESOURCE_POLICY")
        );
    }
}
