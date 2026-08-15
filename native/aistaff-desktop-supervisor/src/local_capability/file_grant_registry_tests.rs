use super::contracts::{CapabilityScope, LOCAL_CAPABILITY_PROTOCOL_VERSION};
use super::file_grant_registry::SharedFileGrantRegistry;
use super::file_service::{LocalFileCapabilityCommandHandler, LocalFileCapabilityService};
use super::process_contracts::{
    ProcessDescriptorAdmitInput, ProcessEnvironmentRef, ProcessWorkingDirectoryRef,
};
use super::process_execution_context::{
    FileGrantProcessExecutionContextProvider, ProcessExecutionContextProvider,
    UnavailableProcessSecretStore,
};
use super::process_execution_test_support::{
    NOW_MS, OPERATION_ID, POLICY_HANDLE, POLICY_REVISION, test_resource_policy,
};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const GRANT_HANDLE: &str = "55555555-5555-4555-8555-555555555555";
const GRANT_REVISION: &str = "66666666-6666-4666-8666-666666666666";
const GRANT_OPERATION_ID: &str = "77777777-7777-4777-8777-777777777777";
const PATH_OPERATION_ID: &str = "88888888-8888-4888-8888-888888888888";
const REVOKE_OPERATION_ID: &str = "99999999-9999-4999-8999-999999999999";

struct SharedGrantFixture {
    file_service: LocalFileCapabilityService,
    registry: SharedFileGrantRegistry,
    descriptor_hash: String,
    _root: super::process_execution_test_support::TestRoot,
}

fn scope() -> CapabilityScope {
    CapabilityScope {
        tenant_id: "tenant-1".to_owned(),
        session_id: "session-1".to_owned(),
        run_id: "run-1".to_owned(),
    }
}

fn handle(
    service: &mut LocalFileCapabilityService,
    command: &str,
    payload: Value,
) -> Result<Value, &'static str> {
    service
        .handle(command, Some(payload))
        .map_err(|error| error.code)
}

fn shared_grant_fixture<F>(now_ms: F) -> SharedGrantFixture
where
    F: Fn() -> u64 + Send + Sync + 'static,
{
    let root = super::process_execution_test_support::TestRoot::new();
    let registry = SharedFileGrantRegistry::new();
    let mut file_service =
        LocalFileCapabilityService::with_clock_and_registry(now_ms, registry.clone());
    handle(
        &mut file_service,
        "capability.file.grant.register",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": GRANT_OPERATION_ID,
            "grant_handle": GRANT_HANDLE,
            "grant_revision": GRANT_REVISION,
            "scope": scope(),
            "root_path": root.root.to_str().expect("utf8 root"),
            "access": "read_only",
            "allowed_intents": ["metadata_read"],
            "source": "system_directory_picker",
            "expires_at_ms": NOW_MS + 60_000
        }),
    )
    .expect("register shared grant");
    let admitted = handle(
        &mut file_service,
        "capability.file.path.admit",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": PATH_OPERATION_ID,
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION,
            "scope": scope(),
            "intent": "metadata_read",
            "relative_segments": ["cwd"],
            "max_bytes": null
        }),
    )
    .expect("admit shared cwd");
    assert_eq!(admitted["capability_id"], "local_file_path_admission.v1");
    SharedGrantFixture {
        file_service,
        registry,
        descriptor_hash: admitted["target_descriptor_hash"]
            .as_str()
            .expect("descriptor hash")
            .to_owned(),
        _root: root,
    }
}

fn process_descriptor(descriptor_hash: &str) -> ProcessDescriptorAdmitInput {
    ProcessDescriptorAdmitInput {
        protocol_version: LOCAL_CAPABILITY_PROTOCOL_VERSION.to_owned(),
        operation_id: OPERATION_ID.to_owned(),
        policy_handle: POLICY_HANDLE.to_owned(),
        expected_policy_revision: POLICY_REVISION.to_owned(),
        scope: scope(),
        argv: vec!["--mode".to_owned(), "report".to_owned()],
        environment_refs: Vec::new(),
        working_directory: Some(ProcessWorkingDirectoryRef {
            grant_handle: GRANT_HANDLE.to_owned(),
            expected_grant_revision: GRANT_REVISION.to_owned(),
            relative_segments: vec!["cwd".to_owned()],
            target_descriptor_hash: descriptor_hash.to_owned(),
        }),
        timeout_ms: 1_000,
        output_limit_bytes: 1_024,
        resource_policy: test_resource_policy(),
    }
}

fn context_provider<F>(
    registry: SharedFileGrantRegistry,
    now_ms: F,
) -> FileGrantProcessExecutionContextProvider
where
    F: Fn() -> u64 + Send + Sync + 'static,
{
    FileGrantProcessExecutionContextProvider::new(
        registry,
        Box::new(UnavailableProcessSecretStore),
        now_ms,
    )
}

#[test]
fn shared_grant_context_re_admits_cwd_and_revoke_removes_the_admission() {
    let mut fixture = shared_grant_fixture(|| NOW_MS);
    let descriptor = process_descriptor(&fixture.descriptor_hash);
    let provider = context_provider(fixture.registry.clone(), || NOW_MS);
    let prepared = provider.prepare(&descriptor).expect("prepare shared cwd");
    assert_eq!(prepared.capability_id, "local_process_execution.v1");
    assert_eq!(
        prepared.working_directory,
        Some(
            fixture
                ._root
                .working_directory
                .canonicalize()
                .expect("canonical cwd")
        )
    );
    assert!(prepared.environment.is_empty());

    handle(
        &mut fixture.file_service,
        "capability.file.grant.revoke",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": REVOKE_OPERATION_ID,
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION
        }),
    )
    .expect("revoke shared grant");
    assert_eq!(
        provider.prepare(&descriptor).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_NOT_ACTIVE"
        ))
    );
}

#[test]
fn shared_grant_context_rejects_binding_secret_and_identity_drift() {
    let fixture = shared_grant_fixture(|| NOW_MS);
    let provider = context_provider(fixture.registry.clone(), || NOW_MS);
    let mut scope_drift = process_descriptor(&fixture.descriptor_hash);
    scope_drift.scope.tenant_id = "tenant-2".to_owned();
    assert_eq!(
        provider.prepare(&scope_drift).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_BINDING_MISMATCH"
        ))
    );

    let mut revision_drift = process_descriptor(&fixture.descriptor_hash);
    revision_drift
        .working_directory
        .as_mut()
        .expect("working directory")
        .expected_grant_revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".to_owned();
    assert_eq!(
        provider.prepare(&revision_drift).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_BINDING_MISMATCH"
        ))
    );

    let mut segment_drift = process_descriptor(&fixture.descriptor_hash);
    segment_drift
        .working_directory
        .as_mut()
        .expect("working directory")
        .relative_segments = vec!["other".to_owned()];
    assert_eq!(
        provider.prepare(&segment_drift).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_BINDING_MISMATCH"
        ))
    );

    let mut unknown_admission = process_descriptor(&"f".repeat(64));
    unknown_admission.environment_refs = vec![ProcessEnvironmentRef {
        name: "PROCESS_TEST_TOKEN".to_owned(),
        secret_ref: "vault.process_test_token".to_owned(),
    }];
    assert_eq!(
        provider.prepare(&unknown_admission).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_FILE_PATH_ADMISSION_NOT_ACTIVE"
        ))
    );

    let mut secret_requested = process_descriptor(&fixture.descriptor_hash);
    secret_requested.environment_refs = vec![ProcessEnvironmentRef {
        name: "PROCESS_TEST_TOKEN".to_owned(),
        secret_ref: "vault.process_test_token".to_owned(),
    }];
    assert_eq!(
        provider.prepare(&secret_requested).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_SECRET_STORE_UNAVAILABLE"
        ))
    );

    let moved = fixture._root.root.join("cwd-before-swap");
    std::fs::rename(&fixture._root.working_directory, &moved).expect("move admitted cwd");
    std::fs::create_dir(&fixture._root.working_directory).expect("replace admitted cwd");
    assert_eq!(
        provider
            .prepare(&process_descriptor(&fixture.descriptor_hash))
            .map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_IDENTITY_CHANGED"
        ))
    );
}

#[test]
fn shared_grant_context_rejects_a_file_as_process_working_directory() {
    let mut fixture = shared_grant_fixture(|| NOW_MS);
    let admitted_file = handle(
        &mut fixture.file_service,
        "capability.file.path.admit",
        json!({
            "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
            "operation_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "grant_handle": GRANT_HANDLE,
            "expected_grant_revision": GRANT_REVISION,
            "scope": scope(),
            "intent": "metadata_read",
            "relative_segments": ["cwd", "process-context-marker"],
            "max_bytes": null
        }),
    )
    .expect("admit file metadata");
    let file_descriptor_hash = admitted_file["target_descriptor_hash"]
        .as_str()
        .expect("file descriptor hash");
    let mut descriptor = process_descriptor(file_descriptor_hash);
    descriptor
        .working_directory
        .as_mut()
        .expect("working directory")
        .relative_segments = vec!["cwd".to_owned(), "process-context-marker".to_owned()];
    let provider = context_provider(fixture.registry, || NOW_MS);
    assert_eq!(
        provider.prepare(&descriptor).map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_PROCESS_WORKING_DIRECTORY_BINDING_MISMATCH"
        ))
    );
}

#[test]
fn shared_grant_context_prunes_expired_grant_and_path_admission() {
    let clock = Arc::new(AtomicU64::new(NOW_MS));
    let file_clock = clock.clone();
    let fixture = shared_grant_fixture(move || file_clock.load(Ordering::Relaxed));
    let context_clock = clock.clone();
    let provider = context_provider(fixture.registry, move || {
        context_clock.load(Ordering::Relaxed)
    });
    clock.store(NOW_MS + 60_001, Ordering::Relaxed);
    assert_eq!(
        provider
            .prepare(&process_descriptor(&fixture.descriptor_hash))
            .map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_FILE_GRANT_NOT_ACTIVE"
        ))
    );
}

#[test]
fn shared_path_admission_registry_is_bounded_and_eviction_fails_closed() {
    let mut fixture = shared_grant_fixture(|| NOW_MS);
    let mut first_hash = None;
    let mut last_hash = None;
    for index in 0_u16..=256 {
        let admitted = handle(
            &mut fixture.file_service,
            "capability.file.path.admit",
            json!({
                "protocol_version": LOCAL_CAPABILITY_PROTOCOL_VERSION,
                "operation_id": format!("{index:08x}-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                "grant_handle": GRANT_HANDLE,
                "expected_grant_revision": GRANT_REVISION,
                "scope": scope(),
                "intent": "metadata_read",
                "relative_segments": ["cwd"],
                "max_bytes": null
            }),
        )
        .expect("record bounded path admission");
        let descriptor_hash = admitted["target_descriptor_hash"]
            .as_str()
            .expect("descriptor hash")
            .to_owned();
        first_hash.get_or_insert_with(|| descriptor_hash.clone());
        last_hash = Some(descriptor_hash);
    }
    let provider = context_provider(fixture.registry, || NOW_MS);
    assert_eq!(
        provider
            .prepare(&process_descriptor(
                first_hash.as_deref().expect("first hash")
            ))
            .map(|_| ()),
        Err(super::contracts::LocalCapabilityError::new(
            "LOCAL_FILE_PATH_ADMISSION_NOT_ACTIVE"
        ))
    );
    provider
        .prepare(&process_descriptor(
            last_hash.as_deref().expect("last hash"),
        ))
        .expect("latest bounded admission remains active");
}
