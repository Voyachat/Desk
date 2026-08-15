use super::contracts::{CapabilityScope, LocalCapabilityError};
use super::process_contracts::ProcessEnvironmentRef;
use super::process_execution_context::{
    ProcessSecretMaterializationPort, UnavailableProcessSecretStore,
};
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use keyring_core::{CredentialStore, Error as KeyringError};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::thread;
use std::time::Duration;
use zeroize::Zeroizing;

pub(super) const PROCESS_SECRET_SERVICE: &str = "com.voyachat.aistaff.client.process-secret.v1";
pub(super) const PROCESS_SECRET_MAX_BYTES: usize = 8 * 1024;
const PROCESS_SECRET_LOOKUP_TIMEOUT: Duration = Duration::from_secs(3);
const PROCESS_SECRET_LOOKUP_QUEUE_CAPACITY: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProcessSecretLookupFailure {
    NotFound,
    AccessDenied,
    Invalid,
    Unavailable,
    Timeout,
    Busy,
}

pub(super) trait ProcessSecretLookupPort: Send + Sync {
    fn lookup(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure>;
}

pub(super) trait CredentialEntryReader: Send + 'static {
    fn read_password(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure>;
}

struct LookupRequest {
    service: String,
    account: String,
    response: SyncSender<Result<Zeroizing<String>, ProcessSecretLookupFailure>>,
}

pub(super) struct BoundedProcessSecretLookup {
    requests: SyncSender<LookupRequest>,
    timeout: Duration,
}

impl BoundedProcessSecretLookup {
    pub(super) fn production() -> Result<Self, ProcessSecretLookupFailure> {
        Self::with_reader(
            Box::new(PlatformCredentialEntryReader),
            PROCESS_SECRET_LOOKUP_TIMEOUT,
        )
    }

    pub(super) fn with_reader(
        reader: Box<dyn CredentialEntryReader>,
        timeout: Duration,
    ) -> Result<Self, ProcessSecretLookupFailure> {
        let (requests, receiver) = sync_channel(PROCESS_SECRET_LOOKUP_QUEUE_CAPACITY);
        thread::Builder::new()
            .name("aistaff-process-secret-store".to_owned())
            .spawn(move || serve_lookups(reader, receiver))
            .map_err(|_| ProcessSecretLookupFailure::Unavailable)?;
        Ok(Self { requests, timeout })
    }
}

impl ProcessSecretLookupPort for BoundedProcessSecretLookup {
    fn lookup(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure> {
        let (response, receiver) = sync_channel(1);
        let request = LookupRequest {
            service: service.to_owned(),
            account: account.to_owned(),
            response,
        };
        self.requests
            .try_send(request)
            .map_err(|error| match error {
                TrySendError::Full(_) => ProcessSecretLookupFailure::Busy,
                TrySendError::Disconnected(_) => ProcessSecretLookupFailure::Unavailable,
            })?;
        receiver
            .recv_timeout(self.timeout)
            .map_err(|error| match error {
                RecvTimeoutError::Timeout => ProcessSecretLookupFailure::Timeout,
                RecvTimeoutError::Disconnected => ProcessSecretLookupFailure::Unavailable,
            })?
    }
}

fn serve_lookups(reader: Box<dyn CredentialEntryReader>, requests: Receiver<LookupRequest>) {
    while let Ok(request) = requests.recv() {
        let result = reader.read_password(&request.service, &request.account);
        let _ = request.response.try_send(result);
    }
}

struct PlatformCredentialEntryReader;

impl CredentialEntryReader for PlatformCredentialEntryReader {
    fn read_password(
        &self,
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<String>, ProcessSecretLookupFailure> {
        let store = platform_credential_store()?;
        let entry = store
            .build(service, account, None)
            .map_err(map_keyring_error)?;
        entry
            .get_password()
            .map(Zeroizing::new)
            .map_err(map_keyring_error)
    }
}

#[cfg(target_os = "macos")]
fn platform_credential_store() -> Result<Arc<CredentialStore>, ProcessSecretLookupFailure> {
    let store: Arc<CredentialStore> =
        apple_native_keyring_store::keychain::Store::new().map_err(map_keyring_error)?;
    Ok(store)
}

#[cfg(target_os = "windows")]
fn platform_credential_store() -> Result<Arc<CredentialStore>, ProcessSecretLookupFailure> {
    let store: Arc<CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(map_keyring_error)?;
    Ok(store)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_credential_store() -> Result<Arc<CredentialStore>, ProcessSecretLookupFailure> {
    Err(ProcessSecretLookupFailure::Unavailable)
}

fn map_keyring_error(error: KeyringError) -> ProcessSecretLookupFailure {
    match error {
        KeyringError::NoEntry => ProcessSecretLookupFailure::NotFound,
        KeyringError::NoStorageAccess(_) => ProcessSecretLookupFailure::AccessDenied,
        KeyringError::BadEncoding(_)
        | KeyringError::BadDataFormat(_, _)
        | KeyringError::BadStoreFormat(_)
        | KeyringError::TooLong(_, _)
        | KeyringError::Invalid(_, _)
        | KeyringError::Ambiguous(_) => ProcessSecretLookupFailure::Invalid,
        _ => ProcessSecretLookupFailure::Unavailable,
    }
}

pub(super) struct TenantScopedProcessSecretStore {
    lookup: Box<dyn ProcessSecretLookupPort>,
}

impl TenantScopedProcessSecretStore {
    pub(super) fn new(lookup: Box<dyn ProcessSecretLookupPort>) -> Self {
        Self { lookup }
    }
}

impl ProcessSecretMaterializationPort for TenantScopedProcessSecretStore {
    fn materialize(
        &self,
        scope: &CapabilityScope,
        reference: &ProcessEnvironmentRef,
    ) -> Result<Zeroizing<String>, LocalCapabilityError> {
        let account = process_secret_account(
            LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            &scope.tenant_id,
            &reference.secret_ref,
        );
        let secret = self
            .lookup
            .lookup(PROCESS_SECRET_SERVICE, &account)
            .map_err(lookup_error)?;
        if secret.is_empty()
            || secret.len() > PROCESS_SECRET_MAX_BYTES
            || secret.chars().any(char::is_control)
        {
            return Err(LocalCapabilityError::new("LOCAL_PROCESS_SECRET_INVALID"));
        }
        Ok(secret)
    }
}

pub(super) fn production_process_secret_store() -> Box<dyn ProcessSecretMaterializationPort> {
    match BoundedProcessSecretLookup::production() {
        Ok(lookup) => Box::new(TenantScopedProcessSecretStore::new(Box::new(lookup))),
        Err(_) => Box::new(UnavailableProcessSecretStore),
    }
}

pub(super) fn process_secret_account(
    capability_id: &str,
    tenant_id: &str,
    secret_ref: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.process-secret-account.v1\0");
    for field in [capability_id, tenant_id, secret_ref] {
        hasher.update((field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    let digest = hasher.finalize();
    let mut account = String::with_capacity(3 + digest.len() * 2);
    account.push_str("v1:");
    for byte in digest {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        account.push(HEX[(byte >> 4) as usize] as char);
        account.push(HEX[(byte & 0x0f) as usize] as char);
    }
    account
}

fn lookup_error(error: ProcessSecretLookupFailure) -> LocalCapabilityError {
    let code = match error {
        ProcessSecretLookupFailure::NotFound => "LOCAL_PROCESS_SECRET_NOT_FOUND",
        ProcessSecretLookupFailure::AccessDenied => "LOCAL_PROCESS_SECRET_ACCESS_DENIED",
        ProcessSecretLookupFailure::Invalid => "LOCAL_PROCESS_SECRET_INVALID",
        ProcessSecretLookupFailure::Unavailable => "LOCAL_PROCESS_SECRET_STORE_UNAVAILABLE",
        ProcessSecretLookupFailure::Timeout => "LOCAL_PROCESS_SECRET_LOOKUP_TIMEOUT",
        ProcessSecretLookupFailure::Busy => "LOCAL_PROCESS_SECRET_LOOKUP_BUSY",
    };
    LocalCapabilityError::new(code)
}
