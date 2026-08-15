mod browser_contracts;
mod browser_execution_adapter;
mod browser_execution_contracts;
mod browser_policy;
mod browser_service;
mod capability_hash;
mod contracts;
mod control_read;
mod file_contracts;
mod file_execution;
mod file_execution_contracts;
mod file_execution_service;
mod file_grant_registry;
mod file_path;
mod file_service;
mod local_mcp;
mod process_contracts;
mod process_executable;
mod process_execution;
mod process_execution_context;
mod process_execution_contracts;
mod process_execution_monitor;
mod process_execution_results;
mod process_execution_service;
mod process_native_sandbox;
mod process_output;
mod process_policy;
mod process_resource_policy;
mod process_sandbox;
mod process_secret_store;
mod process_service;
mod process_spawn_spec;
#[cfg(any(test, windows))]
#[allow(
    dead_code,
    reason = "compiled Windows ACL lease candidate remains disconnected pending native runtime evidence"
)]
mod process_windows_acl_lease;
#[cfg(windows)]
#[allow(
    dead_code,
    reason = "compiled Windows source candidate remains disconnected until c3b2c ACL leases and native evidence"
)]
mod process_windows_sandbox;
mod process_windows_sandbox_plan;
mod service;
mod workspace_write;
mod workspace_write_contracts;

pub use browser_service::{LocalBrowserCapabilityCommandHandler, LocalBrowserCapabilityService};
pub use contracts::{
    LOCAL_CAPABILITY_SUPERVISOR_CAPABILITY, LocalCapabilityError, is_local_capability_command,
};
pub(crate) use control_read::{ControlReadPayload, admit_control_root, read_control_capability};
pub(crate) use file_grant_registry::SharedFileGrantRegistry;
pub use file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
pub use local_mcp::{
    LocalMcpDescriptor, LocalMcpInvocationError, LocalMcpInvocationPort, LocalMcpInvocationRequest,
    LocalMcpInvocationSummary, NativeLocalMcpInvocationPort, invoke_local_mcp_supervisor_command,
    run_local_mcp_time_server_stdio,
};
pub use process_service::{LocalProcessCapabilityCommandHandler, LocalProcessCapabilityService};
pub use service::{LocalCapabilityBrokerService, LocalCapabilityCommandHandler};
pub use workspace_write_contracts::CLIENT_LOCAL_WORKSPACE_WRITE_SUPERVISOR_CAPABILITY;

pub fn is_local_file_capability_command(command: &str) -> bool {
    file_contracts::is_local_file_admission_command(command)
        || file_execution_contracts::is_local_file_execution_command(command)
        || workspace_write_contracts::is_workspace_write_command(command)
}

pub fn is_local_process_capability_command(command: &str) -> bool {
    process_contracts::is_local_process_capability_command(command)
        || process_execution_contracts::is_local_process_execution_command(command)
}

pub fn is_local_browser_capability_command(command: &str) -> bool {
    browser_contracts::is_local_browser_capability_command(command)
        || browser_execution_contracts::is_local_browser_execution_command(command)
}

#[cfg(test)]
mod browser_execution_tests;
#[cfg(test)]
mod browser_tests;
#[cfg(test)]
mod file_execution_tests;
#[cfg(test)]
mod file_grant_registry_tests;
#[cfg(test)]
mod file_runtime_tests;
#[cfg(test)]
mod local_mcp_tests;
#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
mod process_execution_engine_tests;
#[cfg(test)]
mod process_execution_hash_fixture_tests;
#[cfg(test)]
mod process_execution_shared_context_tests;
#[cfg(test)]
mod process_execution_test_support;
#[cfg(test)]
mod process_execution_tests;
#[cfg(test)]
mod process_hash_tests;
#[cfg(test)]
mod process_native_sandbox_tests;
#[cfg(test)]
mod process_resource_policy_tests;
#[cfg(test)]
mod process_secret_store_tests;
#[cfg(test)]
mod process_tests;
#[cfg(test)]
mod process_windows_sandbox_plan_tests;
#[cfg(test)]
mod runtime_tests;
#[cfg(test)]
mod workspace_write_tests;
