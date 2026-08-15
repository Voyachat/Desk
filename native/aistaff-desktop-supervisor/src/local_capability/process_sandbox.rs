use super::contracts::LocalCapabilityError;
#[cfg(test)]
use super::process_contracts::current_process_target;
#[cfg(test)]
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_spawn_spec::SandboxedProcessSpawnSpec;
#[cfg(test)]
use command_group::{CommandGroup, GroupChild};
use std::io::Read;
use std::process::ExitStatus;
#[cfg(test)]
use std::process::{Command, Stdio};

pub(super) type SandboxedProcessOutput = Box<dyn Read + Send>;

pub(super) trait SandboxedProcessChild: Send {
    fn resume(&mut self) -> std::io::Result<()>;
    fn take_stdout(&mut self) -> Option<SandboxedProcessOutput>;
    fn take_stderr(&mut self) -> Option<SandboxedProcessOutput>;
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>>;
    fn kill(&mut self) -> std::io::Result<()>;
    fn wait(&mut self) -> std::io::Result<ExitStatus>;
}

pub(super) trait ProcessSandboxPort: Send {
    fn spawn(
        &mut self,
        spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, LocalCapabilityError>;
}

#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
pub(super) struct UnavailableProcessSandboxPort;

#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
impl ProcessSandboxPort for UnavailableProcessSandboxPort {
    fn spawn(
        &mut self,
        _spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, LocalCapabilityError> {
        Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_SANDBOX_UNAVAILABLE",
        ))
    }
}

#[cfg(test)]
pub(super) struct TestOnlyProcessSandboxPort;

#[cfg(test)]
impl ProcessSandboxPort for TestOnlyProcessSandboxPort {
    fn spawn(
        &mut self,
        spec: SandboxedProcessSpawnSpec<'_>,
    ) -> Result<Box<dyn SandboxedProcessChild>, LocalCapabilityError> {
        if current_process_target() != Some(spec.target) {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_SANDBOX_TARGET_MISMATCH",
            ));
        }
        if spec.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
            || spec.operation_id.is_empty()
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_PROCESS_EXECUTION_SPEC",
            ));
        }
        spec.scope.validate()?;
        spec.resource_policy.validate()?;
        let mut command = test_only_command(&spec);
        spawn_test_only_group(&mut command)
            .map(|child| {
                Box::new(TestOnlyGroupChild {
                    child,
                    resumed: false,
                }) as Box<dyn SandboxedProcessChild>
            })
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_SPAWN_FAILED"))
    }
}

#[cfg(test)]
struct TestOnlyGroupChild {
    child: GroupChild,
    resumed: bool,
}

#[cfg(test)]
impl SandboxedProcessChild for TestOnlyGroupChild {
    fn resume(&mut self) -> std::io::Result<()> {
        if self.resumed {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "test-only sandbox child already resumed",
            ));
        }
        self.resumed = true;
        Ok(())
    }

    fn take_stdout(&mut self) -> Option<SandboxedProcessOutput> {
        if !self.resumed {
            return None;
        }
        self.child
            .inner()
            .stdout
            .take()
            .map(|stdout| Box::new(stdout) as SandboxedProcessOutput)
    }

    fn take_stderr(&mut self) -> Option<SandboxedProcessOutput> {
        if !self.resumed {
            return None;
        }
        self.child
            .inner()
            .stderr
            .take()
            .map(|stderr| Box::new(stderr) as SandboxedProcessOutput)
    }

    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        if !self.resumed {
            return Err(std::io::Error::other("test-only sandbox child not resumed"));
        }
        self.child.try_wait()
    }

    fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill()
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.child.wait()
    }
}

#[cfg(test)]
fn test_only_command(spec: &SandboxedProcessSpawnSpec<'_>) -> Command {
    let mut command = Command::new(spec.executable_path);
    command
        .args(spec.argv)
        .env_clear()
        .envs(
            spec.inherited_environment
                .iter()
                .map(|(name, value)| (name, value)),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = spec.working_directory {
        command.current_dir(directory);
    }
    for entry in spec.environment {
        command.env(&entry.name, entry.value.as_str());
    }
    command
}

#[cfg(all(test, windows))]
fn spawn_test_only_group(command: &mut Command) -> std::io::Result<GroupChild> {
    command.group().kill_on_drop(true).spawn()
}

#[cfg(all(test, not(windows)))]
fn spawn_test_only_group(command: &mut Command) -> std::io::Result<GroupChild> {
    command.group_spawn()
}
