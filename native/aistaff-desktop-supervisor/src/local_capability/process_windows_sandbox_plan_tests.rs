use super::process_resource_policy::{
    PROCESS_RESOURCE_POLICY_SCHEMA_VERSION, ProcessNetworkAccess, ProcessResourcePolicy,
    ProcessSandboxProfile,
};
use super::process_windows_sandbox_plan::{
    WINDOWS_PROCESS_SANDBOX_PLAN_SCHEMA_VERSION, WINDOWS_REQUIRED_STARTUP_ATTRIBUTES,
    WindowsPathGrant, WindowsProcessSandboxPlan, build_windows_command_line,
    build_windows_environment_block,
};

fn policy() -> ProcessResourcePolicy {
    ProcessResourcePolicy {
        schema_version: PROCESS_RESOURCE_POLICY_SCHEMA_VERSION.to_string(),
        cpu_time_limit_ms: 4_000,
        memory_limit_bytes: 64 * 1024 * 1024,
        process_count_limit: 3,
        network_access: ProcessNetworkAccess::Denied,
        sandbox_profile: ProcessSandboxProfile::RestrictedProcessV1,
    }
}

#[test]
fn windows_plan_maps_exact_tree_limits_and_zero_capability_lpac() {
    let plan = WindowsProcessSandboxPlan::from_policy(&policy()).expect("valid plan");
    assert_eq!(
        plan.schema_version,
        WINDOWS_PROCESS_SANDBOX_PLAN_SCHEMA_VERSION
    );
    assert_eq!(plan.job_user_time_limit_100ns, 40_000_000);
    assert_eq!(plan.job_memory_limit_bytes, 64 * 1024 * 1024);
    assert_eq!(plan.active_process_limit, 3);
    assert!(plan.kill_on_job_close);
    assert!(!plan.breakaway_allowed);
    assert!(plan.create_suspended);
    assert!(plan.lpac);
    assert_eq!(plan.network_capability_count, 0);
    assert_eq!(plan.startup_attributes, WINDOWS_REQUIRED_STARTUP_ATTRIBUTES);
    assert_eq!(
        plan.path_grants,
        [
            WindowsPathGrant::ExecutableReadExecute,
            WindowsPathGrant::WorkingDirectoryTraverseMetadata,
        ]
    );
}

#[test]
fn windows_spawn_encoding_quotes_without_shell_and_sorts_environment() {
    let executable = r"C:\Program Files\AiStaff\worker.exe"
        .encode_utf16()
        .collect::<Vec<_>>();
    let command_line = build_windows_command_line(
        &executable,
        &[
            "plain".to_string(),
            "two words\\\"quoted".to_string(),
            String::new(),
        ],
    )
    .expect("valid command line");
    assert_eq!(
        String::from_utf16(&command_line[..command_line.len() - 1]).expect("utf16"),
        r#""C:\Program Files\AiStaff\worker.exe" plain "two words\\\"quoted" """#
    );

    let environment = build_windows_environment_block(&[
        ("TEMP", r"C:\Temp"),
        ("AISTAFF_SECRET", "bounded-value"),
    ])
    .expect("valid environment");
    let decoded = String::from_utf16(&environment).expect("utf16");
    assert_eq!(decoded, "AISTAFF_SECRET=bounded-value\0TEMP=C:\\Temp\0\0");
}

#[test]
fn windows_spawn_encoding_rejects_duplicate_environment_and_nul() {
    assert_eq!(
        build_windows_environment_block(&[("TEMP", "one"), ("temp", "two")])
            .expect_err("duplicate case-insensitive key")
            .code,
        "LOCAL_PROCESS_ENVIRONMENT_BLOCK_REJECTED"
    );
    assert_eq!(
        build_windows_command_line(&['x' as u16, 0], &[])
            .expect_err("nul command line")
            .code,
        "LOCAL_PROCESS_COMMAND_LINE_REJECTED"
    );
    assert_eq!(
        build_windows_environment_block(&[("BAD NAME", "value")])
            .expect_err("invalid environment name")
            .code,
        "LOCAL_PROCESS_ENVIRONMENT_BLOCK_REJECTED"
    );
    assert_eq!(
        build_windows_environment_block(&[])
            .expect("empty environment")
            .as_slice(),
        &[0, 0]
    );
}

#[test]
fn windows_plan_rejects_policy_drift_before_native_mapping() {
    let mut invalid = policy();
    invalid.process_count_limit = 0;
    assert_eq!(
        WindowsProcessSandboxPlan::from_policy(&invalid)
            .expect_err("invalid policy")
            .code,
        "INVALID_LOCAL_PROCESS_RESOURCE_POLICY"
    );
}
