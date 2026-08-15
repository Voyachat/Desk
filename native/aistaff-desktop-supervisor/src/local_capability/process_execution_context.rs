use super::contracts::{CapabilityScope, LocalCapabilityError};
use super::file_grant_registry::SharedFileGrantRegistry;
use super::process_contracts::{
    ProcessDescriptorAdmitInput, ProcessEnvironmentRef, ProcessWorkingDirectoryRef,
};
use super::process_execution::MaterializedProcessEnvironment;
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use std::path::PathBuf;
use zeroize::Zeroizing;

pub(super) struct PreparedProcessExecutionContext {
    pub capability_id: &'static str,
    pub environment: Vec<MaterializedProcessEnvironment>,
    pub working_directory: Option<PathBuf>,
}

pub(super) fn validate_prepared_process_context(
    descriptor: &ProcessDescriptorAdmitInput,
    context: &PreparedProcessExecutionContext,
) -> Result<(), LocalCapabilityError> {
    let environment_matches = context.capability_id == LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
        && descriptor.environment_refs.len() == context.environment.len()
        && descriptor
            .environment_refs
            .iter()
            .zip(&context.environment)
            .all(|(expected, materialized)| expected.name == materialized.name);
    let working_directory_matches =
        descriptor.working_directory.is_some() == context.working_directory.is_some();
    if !environment_matches || !working_directory_matches {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTION_CONTEXT_BINDING_MISMATCH",
        ));
    }
    Ok(())
}

pub(super) trait ProcessExecutionContextProvider {
    fn prepare(
        &self,
        descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<PreparedProcessExecutionContext, LocalCapabilityError>;
}

pub(super) trait ProcessSecretMaterializationPort {
    fn materialize(
        &self,
        scope: &CapabilityScope,
        reference: &ProcessEnvironmentRef,
    ) -> Result<Zeroizing<String>, LocalCapabilityError>;
}

pub(super) struct UnavailableProcessSecretStore;

impl ProcessSecretMaterializationPort for UnavailableProcessSecretStore {
    fn materialize(
        &self,
        _scope: &CapabilityScope,
        _reference: &ProcessEnvironmentRef,
    ) -> Result<Zeroizing<String>, LocalCapabilityError> {
        Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_SECRET_STORE_UNAVAILABLE",
        ))
    }
}

pub(super) struct FileGrantProcessExecutionContextProvider {
    grant_registry: SharedFileGrantRegistry,
    secret_store: Box<dyn ProcessSecretMaterializationPort>,
    now_ms: Box<dyn Fn() -> u64 + Send + Sync>,
}

impl FileGrantProcessExecutionContextProvider {
    pub(super) fn new<F>(
        grant_registry: SharedFileGrantRegistry,
        secret_store: Box<dyn ProcessSecretMaterializationPort>,
        now_ms: F,
    ) -> Self
    where
        F: Fn() -> u64 + Send + Sync + 'static,
    {
        Self {
            grant_registry,
            secret_store,
            now_ms: Box::new(now_ms),
        }
    }

    fn prepare_working_directory(
        &self,
        scope: &CapabilityScope,
        directory: Option<&ProcessWorkingDirectoryRef>,
    ) -> Result<Option<PathBuf>, LocalCapabilityError> {
        directory
            .map(|reference| {
                self.grant_registry.prepare_working_directory(
                    &reference.grant_handle,
                    &reference.expected_grant_revision,
                    scope,
                    &reference.relative_segments,
                    &reference.target_descriptor_hash,
                )
            })
            .transpose()
    }

    fn materialize_environment(
        &self,
        descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<Vec<MaterializedProcessEnvironment>, LocalCapabilityError> {
        descriptor
            .environment_refs
            .iter()
            .map(|reference| {
                Ok(MaterializedProcessEnvironment {
                    name: reference.name.clone(),
                    value: self
                        .secret_store
                        .materialize(&descriptor.scope, reference)?,
                })
            })
            .collect()
    }
}

impl ProcessExecutionContextProvider for FileGrantProcessExecutionContextProvider {
    fn prepare(
        &self,
        descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<PreparedProcessExecutionContext, LocalCapabilityError> {
        self.grant_registry.prune_expired((self.now_ms)())?;
        let working_directory = self
            .prepare_working_directory(&descriptor.scope, descriptor.working_directory.as_ref())?;
        let environment = self.materialize_environment(descriptor)?;
        Ok(PreparedProcessExecutionContext {
            capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            environment,
            working_directory,
        })
    }
}

pub(super) struct UnavailableProcessExecutionContextProvider;

impl ProcessExecutionContextProvider for UnavailableProcessExecutionContextProvider {
    fn prepare(
        &self,
        _descriptor: &ProcessDescriptorAdmitInput,
    ) -> Result<PreparedProcessExecutionContext, LocalCapabilityError> {
        Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTION_CONTEXT_UNAVAILABLE",
        ))
    }
}
