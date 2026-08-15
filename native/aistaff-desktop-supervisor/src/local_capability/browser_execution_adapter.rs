#[cfg(test)]
use super::browser_execution_contracts::BrowserExecutionEvidence;
use super::browser_execution_contracts::{
    BrowserExecutionNavigateInput, BrowserExecutionNavigateResult,
    LOCAL_BROWSER_EXECUTION_CAPABILITY_ID,
};
#[cfg(test)]
use super::contracts::LOCAL_CAPABILITY_PROTOCOL_VERSION;
use super::contracts::LocalCapabilityError;

pub(crate) trait BrowserAutomationAdapter: Send {
    fn navigate(
        &mut self,
        input: &BrowserExecutionNavigateInput,
        request_hash: &str,
        descriptor_hash: &str,
    ) -> Result<BrowserExecutionNavigateResult, LocalCapabilityError>;
}

pub(crate) struct ProductionDisabledBrowserAdapter;

impl BrowserAutomationAdapter for ProductionDisabledBrowserAdapter {
    fn navigate(
        &mut self,
        _input: &BrowserExecutionNavigateInput,
        _request_hash: &str,
        _descriptor_hash: &str,
    ) -> Result<BrowserExecutionNavigateResult, LocalCapabilityError> {
        let _ = LOCAL_BROWSER_EXECUTION_CAPABILITY_ID;
        Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_PRODUCTION_EXECUTION_DISABLED",
        ))
    }
}

#[cfg(test)]
pub(crate) struct TestOnlyBrowserAdapter;

#[cfg(test)]
impl BrowserAutomationAdapter for TestOnlyBrowserAdapter {
    fn navigate(
        &mut self,
        input: &BrowserExecutionNavigateInput,
        request_hash: &str,
        descriptor_hash: &str,
    ) -> Result<BrowserExecutionNavigateResult, LocalCapabilityError> {
        Ok(BrowserExecutionNavigateResult {
            protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION,
            capability_id: LOCAL_BROWSER_EXECUTION_CAPABILITY_ID,
            operation_id: input.descriptor_request.operation_id.clone(),
            request_hash: request_hash.to_owned(),
            browser_descriptor_hash: descriptor_hash.to_owned(),
            expected_origin: input.descriptor_request.expected_origin.clone(),
            execution_state: "completed",
            execution_mode: "test_only",
            production_enabled: false,
            idempotency_replayed: false,
            reason_code: "LOCAL_BROWSER_NAVIGATED_TEST_ONLY",
            evidence: BrowserExecutionEvidence {
                schema_version: "aistaff.local-browser-execution-evidence.v1",
                capability_id: LOCAL_BROWSER_EXECUTION_CAPABILITY_ID,
                operation_id: input.descriptor_request.operation_id.clone(),
                request_hash: request_hash.to_owned(),
                browser_descriptor_hash: descriptor_hash.to_owned(),
                expected_origin: input.descriptor_request.expected_origin.clone(),
                cloud_audit_ref: input.capability_request.authorization.audit_ref.clone(),
                side_effect_state: "none",
                redaction_profile: "browser_execution_metadata_only.v1",
            },
        })
    }
}
