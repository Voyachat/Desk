use super::contracts::{CapabilityScope, LocalCapabilityError};
use super::process_contracts::ProcessEnvironmentRef;
use super::process_execution_context::ProcessSecretMaterializationPort;
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_secret_store::{
    BoundedProcessSecretLookup, CredentialEntryReader, PROCESS_SECRET_MAX_BYTES,
    PROCESS_SECRET_SERVICE, ProcessSecretLookupFailure, ProcessSecretLookupPort,
    TenantScopedProcessSecretStore, process_secret_account,
};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use zeroize::Zeroizing;

type LookupCall = (String, String);
type LookupCalls = Arc<Mutex<Vec<LookupCall>>>;

#[derive(Clone)]
enum LookupOutcome {
    Secret(String),
    Failure(ProcessSecretLookupFailure),
}

struct RecordingLookup {
    outcome: LookupOutcome,
    calls: LookupCalls,
}

impl ProcessSecretLookupPort for RecordingLookup {
    fn lookup(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure> {
        self.calls
            .lock()
            .expect("lookup calls")
            .push((service.to_owned(), account.to_owned()));
        match &self.outcome {
            LookupOutcome::Secret(value) => Ok(Zeroizing::new(value.clone())),
            LookupOutcome::Failure(error) => Err(*error),
        }
    }
}

struct FixedCredentialReader {
    delay: Duration,
    outcome: LookupOutcome,
}

impl CredentialEntryReader for FixedCredentialReader {
    fn read_password(
        &self,
        _service: &str,
        _account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure> {
        thread::sleep(self.delay);
        match &self.outcome {
            LookupOutcome::Secret(value) => Ok(Zeroizing::new(value.clone())),
            LookupOutcome::Failure(error) => Err(*error),
        }
    }
}

fn scope(tenant_id: &str) -> CapabilityScope {
    CapabilityScope {
        tenant_id: tenant_id.to_owned(),
        session_id: "session-1".to_owned(),
        run_id: "run-1".to_owned(),
    }
}

fn reference() -> ProcessEnvironmentRef {
    ProcessEnvironmentRef {
        name: "REPORT_API_TOKEN".to_owned(),
        secret_ref: "vault.report_api_token".to_owned(),
    }
}

fn store_with_outcome(outcome: LookupOutcome) -> (TenantScopedProcessSecretStore, LookupCalls) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let lookup = RecordingLookup {
        outcome,
        calls: calls.clone(),
    };
    (TenantScopedProcessSecretStore::new(Box::new(lookup)), calls)
}

#[test]
fn account_contract_is_stable_tenant_bound_and_reference_private() {
    let capability_id = LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
    let account = process_secret_account(capability_id, "tenant-1", "vault.report_api_token");
    assert_eq!(
        account,
        "v1:a860e2b2131cf1b05126ed6ef7b3d02524e6d9738f9ea7530d72192abcd9bc3e"
    );
    assert_ne!(
        account,
        process_secret_account(capability_id, "tenant-2", "vault.report_api_token")
    );
    assert_ne!(
        account,
        process_secret_account(capability_id, "tenant-1", "vault.other_token")
    );
    assert_ne!(
        account,
        process_secret_account(
            "other_local_capability.v1",
            "tenant-1",
            "vault.report_api_token"
        )
    );
    assert!(!account.contains("tenant-1"));
    assert!(!account.contains("vault.report_api_token"));
}

#[test]
fn materialization_uses_fixed_service_and_tenant_scoped_account() {
    let (store, calls) = store_with_outcome(LookupOutcome::Secret("test-secret".to_owned()));
    let secret = store
        .materialize(&scope("tenant-1"), &reference())
        .expect("materialize secret");
    assert_eq!(secret.as_str(), "test-secret");
    assert_eq!(
        *calls.lock().expect("lookup calls"),
        vec![(
            PROCESS_SECRET_SERVICE.to_owned(),
            process_secret_account(
                LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
                "tenant-1",
                "vault.report_api_token"
            )
        )]
    );
}

#[test]
fn lookup_failures_map_to_stable_secret_safe_codes() {
    for (failure, code) in [
        (
            ProcessSecretLookupFailure::NotFound,
            "LOCAL_PROCESS_SECRET_NOT_FOUND",
        ),
        (
            ProcessSecretLookupFailure::AccessDenied,
            "LOCAL_PROCESS_SECRET_ACCESS_DENIED",
        ),
        (
            ProcessSecretLookupFailure::Invalid,
            "LOCAL_PROCESS_SECRET_INVALID",
        ),
        (
            ProcessSecretLookupFailure::Unavailable,
            "LOCAL_PROCESS_SECRET_STORE_UNAVAILABLE",
        ),
        (
            ProcessSecretLookupFailure::Timeout,
            "LOCAL_PROCESS_SECRET_LOOKUP_TIMEOUT",
        ),
        (
            ProcessSecretLookupFailure::Busy,
            "LOCAL_PROCESS_SECRET_LOOKUP_BUSY",
        ),
    ] {
        let (store, _) = store_with_outcome(LookupOutcome::Failure(failure));
        assert_eq!(
            store
                .materialize(&scope("tenant-1"), &reference())
                .map(|_| ()),
            Err(LocalCapabilityError::new(code))
        );
    }
}

#[test]
fn invalid_secret_values_are_dropped_before_process_context() {
    for value in [
        String::new(),
        "contains\0nul".to_owned(),
        "contains\nnewline".to_owned(),
        "x".repeat(PROCESS_SECRET_MAX_BYTES + 1),
    ] {
        let (store, _) = store_with_outcome(LookupOutcome::Secret(value));
        assert_eq!(
            store
                .materialize(&scope("tenant-1"), &reference())
                .map(|_| ()),
            Err(LocalCapabilityError::new("LOCAL_PROCESS_SECRET_INVALID"))
        );
    }
}

#[test]
fn bounded_lookup_serializes_success_and_times_out_a_stuck_store() {
    let available = BoundedProcessSecretLookup::with_reader(
        Box::new(FixedCredentialReader {
            delay: Duration::ZERO,
            outcome: LookupOutcome::Secret("test-secret".to_owned()),
        }),
        Duration::from_millis(50),
    )
    .expect("spawn available lookup");
    assert_eq!(
        available
            .lookup(PROCESS_SECRET_SERVICE, "v1:test")
            .expect("bounded lookup")
            .as_str(),
        "test-secret"
    );

    let stuck = BoundedProcessSecretLookup::with_reader(
        Box::new(FixedCredentialReader {
            delay: Duration::from_millis(50),
            outcome: LookupOutcome::Secret("late-secret".to_owned()),
        }),
        Duration::from_millis(1),
    )
    .expect("spawn slow lookup");
    assert_eq!(
        stuck.lookup(PROCESS_SECRET_SERVICE, "v1:test"),
        Err(ProcessSecretLookupFailure::Timeout)
    );
}
