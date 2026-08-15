use super::contracts::LocalCapabilityError;
use super::process_contracts::{
    ProcessDescriptorAdmitInput, ProcessTarget, current_process_target,
};
use super::process_execution::MaterializedProcessEnvironment;
use super::process_execution_context::{
    PreparedProcessExecutionContext, ProcessExecutionContextProvider,
};
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_resource_policy::{
    ProcessNetworkAccess, ProcessResourcePolicy, ProcessSandboxProfile,
};
use super::process_service::{LocalProcessCapabilityCommandHandler, LocalProcessCapabilityService};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::Zeroizing;

pub(super) const NOW_MS: u64 = 1_900_000_000_000;
pub(super) const POLICY_HANDLE: &str = "11111111-1111-4111-8111-111111111111";
pub(super) const POLICY_REVISION: &str = "22222222-2222-4222-8222-222222222222";
pub(super) const OPERATION_ID: &str = "44444444-4444-4444-8444-444444444444";
pub(super) const CWD_DESCRIPTOR_HASH: &str =
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
pub(super) const LEGACY_DESCRIPTOR_HASH: &str =
    "01f02a6674349542757c78a29223d4997bfda13b09355069d683d7f546b65cb6";
pub(super) const TEST_SECRET: &str = "fixture-secret-value";
pub(super) const CONTEXT_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_child_context_fixture";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn test_resource_policy() -> ProcessResourcePolicy {
    ProcessResourcePolicy {
        schema_version: "aistaff.local-process-resource-policy.v1".to_owned(),
        cpu_time_limit_ms: 1_000,
        memory_limit_bytes: 64 * 1024 * 1024,
        process_count_limit: 4,
        network_access: ProcessNetworkAccess::Denied,
        sandbox_profile: ProcessSandboxProfile::RestrictedProcessV1,
    }
}

pub(super) fn handle(
    service: &mut LocalProcessCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

pub(super) struct TestRoot {
    pub root: PathBuf,
    pub executable: PathBuf,
    pub working_directory: PathBuf,
}

impl TestRoot {
    pub fn new() -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join(format!(
                "local-process-execution-{}-{sequence}",
                std::process::id()
            ));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("clean exact root");
        }
        let working_directory = root.join("cwd");
        std::fs::create_dir_all(&working_directory).expect("create cwd");
        std::fs::write(working_directory.join("process-context-marker"), b"marker")
            .expect("write marker");
        let executable = root.join(if cfg!(windows) { "tool.exe" } else { "tool" });
        std::fs::write(&executable, native_executable_content()).expect("write executable");
        make_executable(&executable);
        Self {
            root,
            executable,
            working_directory,
        }
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root).expect("remove exact root");
        }
    }
}

pub(super) struct TestContextProvider {
    pub working_directory: PathBuf,
}

impl ProcessExecutionContextProvider for TestContextProvider {
    fn prepare(
        &self,
        descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<PreparedProcessExecutionContext, LocalCapabilityError> {
        let working_directory = descriptor
            .working_directory
            .as_ref()
            .filter(|directory| {
                directory.target_descriptor_hash == CWD_DESCRIPTOR_HASH
                    && directory.relative_segments == ["reports"]
            })
            .ok_or_else(|| {
                LocalCapabilityError::new("LOCAL_PROCESS_TEST_CWD_DESCRIPTOR_MISMATCH")
            })?;
        if descriptor.environment_refs.len() != 1
            || descriptor.environment_refs[0].name != "PROCESS_TEST_TOKEN"
            || descriptor.environment_refs[0].secret_ref != "vault.process_test_token"
            || working_directory.grant_handle != "55555555-5555-4555-8555-555555555555"
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_TEST_CONTEXT_MISMATCH",
            ));
        }
        let canonical = self
            .working_directory
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_TEST_CWD_UNAVAILABLE"))?;
        let metadata = std::fs::symlink_metadata(&canonical)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_TEST_CWD_UNAVAILABLE"))?;
        if canonical != self.working_directory || !metadata.is_dir() {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_TEST_CWD_IDENTITY_CHANGED",
            ));
        }
        Ok(PreparedProcessExecutionContext {
            capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            environment: vec![MaterializedProcessEnvironment {
                name: "PROCESS_TEST_TOKEN".to_owned(),
                value: Zeroizing::new(TEST_SECRET.to_owned()),
            }],
            working_directory: Some(canonical),
        })
    }
}

pub(super) struct DriftedContextProvider {
    pub working_directory: PathBuf,
}

impl ProcessExecutionContextProvider for DriftedContextProvider {
    fn prepare(
        &self,
        descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<PreparedProcessExecutionContext, LocalCapabilityError> {
        let mut context = TestContextProvider {
            working_directory: self.working_directory.clone(),
        }
        .prepare(descriptor)?;
        context.environment[0].name = "UNAUTHORIZED_SECRET".to_owned();
        Ok(context)
    }
}

pub(super) fn test_target() -> ProcessTarget {
    current_process_target().unwrap_or(ProcessTarget::MacosX64)
}

pub(super) fn target_name() -> &'static str {
    match test_target() {
        ProcessTarget::MacosX64 => "macos_x64",
        ProcessTarget::MacosArm64 => "macos_arm64",
        ProcessTarget::WindowsX64 => "windows_x64",
    }
}

pub(super) fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn native_executable_content() -> Vec<u8> {
    match test_target() {
        ProcessTarget::MacosX64 | ProcessTarget::MacosArm64 => {
            let mut bytes = vec![0_u8; 64];
            bytes[0..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
            let cpu = match test_target() {
                ProcessTarget::MacosX64 => 0x0100_0007_u32,
                ProcessTarget::MacosArm64 => 0x0100_000c_u32,
                ProcessTarget::WindowsX64 => unreachable!(),
            };
            bytes[4..8].copy_from_slice(&cpu.to_le_bytes());
            bytes
        }
        ProcessTarget::WindowsX64 => {
            let mut bytes = vec![0_u8; 128];
            bytes[0..2].copy_from_slice(b"MZ");
            bytes[0x3c..0x40].copy_from_slice(&64_u32.to_le_bytes());
            bytes[64..68].copy_from_slice(b"PE\0\0");
            bytes[68..70].copy_from_slice(&0x8664_u16.to_le_bytes());
            bytes
        }
    }
}

fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path).expect("metadata").permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(path, permissions).expect("permissions");
    }
    #[cfg(not(unix))]
    let _ = path;
}
