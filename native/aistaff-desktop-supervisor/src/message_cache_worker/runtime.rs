use super::contracts::{
    MAX_WORKER_REQUEST_FRAME_BYTES, MAX_WORKER_RESPONSE_FRAME_BYTES,
    MESSAGE_CACHE_WORKER_PROTOCOL_VERSION, MessageCacheWorkerRequest, ProcessedWorkerRequest,
    WorkerHelloInput, error_response, success_response, valid_auth_token, valid_request_id,
};
use super::key_provider::{
    CacheKeyProviderPort, OsVaultCacheKeyProvider, UnavailableCacheKeyProvider,
};
use super::packaged_scope_driver::PackagedEncryptedScopeDriver;
use super::path::AdmittedCacheRoot;
use super::recovery_contracts::{ActiveRestore, RecoveryAdmission};
use super::retention::{CacheClockPort, CacheRetentionPolicy, SystemCacheClock};
use super::scope_driver::EncryptedScopeDriver;
#[cfg(test)]
use super::scope_driver::UnavailableEncryptedScopeDriver;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
use std::path::Path;
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, Zeroizing};

pub struct MessageCacheWorkerRuntime<
    K: CacheKeyProviderPort,
    D: EncryptedScopeDriver,
    C: CacheClockPort = SystemCacheClock,
> {
    pub(super) expected_token: Option<Zeroizing<String>>,
    pub(super) next_sequence: u64,
    pub(super) cache_root: Option<AdmittedCacheRoot>,
    pub(super) active_scope: Option<String>,
    pub(super) recovery_admission: Option<RecoveryAdmission>,
    pub(super) active_restore: Option<ActiveRestore>,
    pub(super) key_provider: K,
    pub(super) driver: D,
    pub(super) clock: C,
    pub(super) retention: CacheRetentionPolicy,
}

impl<K: CacheKeyProviderPort, D: EncryptedScopeDriver>
    MessageCacheWorkerRuntime<K, D, SystemCacheClock>
{
    pub fn new(key_provider: K, driver: D) -> Self {
        Self::with_clock(
            key_provider,
            driver,
            SystemCacheClock,
            CacheRetentionPolicy::default(),
        )
    }
}

impl<K: CacheKeyProviderPort, D: EncryptedScopeDriver, C: CacheClockPort>
    MessageCacheWorkerRuntime<K, D, C>
{
    pub const fn with_clock(
        key_provider: K,
        driver: D,
        clock: C,
        retention: CacheRetentionPolicy,
    ) -> Self {
        Self {
            expected_token: None,
            next_sequence: 0,
            cache_root: None,
            active_scope: None,
            recovery_admission: None,
            active_restore: None,
            key_provider,
            driver,
            clock,
            retention,
        }
    }

    pub(crate) fn process_request_line(&mut self, line: &[u8]) -> ProcessedWorkerRequest {
        if line.len() > MAX_WORKER_REQUEST_FRAME_BYTES {
            return error_response(
                "unknown".to_owned(),
                self.next_sequence,
                "WORKER_REQUEST_TOO_LARGE",
                true,
            );
        }
        let mut request: MessageCacheWorkerRequest = match serde_json::from_slice(line) {
            Ok(request) => request,
            Err(_) => {
                return error_response(
                    "unknown".to_owned(),
                    self.next_sequence,
                    "WORKER_INVALID_REQUEST",
                    true,
                );
            }
        };
        let request_id = if valid_request_id(&request.request_id) {
            request.request_id.clone()
        } else {
            return error_response(
                "unknown".to_owned(),
                request.sequence,
                "WORKER_INVALID_REQUEST_ID",
                true,
            );
        };
        if request.protocol_version != MESSAGE_CACHE_WORKER_PROTOCOL_VERSION {
            return error_response(
                request_id,
                request.sequence,
                "WORKER_PROTOCOL_MISMATCH",
                true,
            );
        }
        let actual_token = Zeroizing::new(std::mem::take(&mut request.auth_token));
        if self.expected_token.is_none() {
            return self.bootstrap(request, actual_token);
        }
        let Some(expected_token) = self.expected_token.as_deref() else {
            return error_response(request_id, request.sequence, "WORKER_STATE_INVALID", true);
        };
        if !constant_time_token_match(expected_token, &actual_token) {
            return error_response(request_id, request.sequence, "WORKER_UNAUTHORIZED", true);
        }
        if request.sequence != self.next_sequence {
            return error_response(
                request_id,
                request.sequence,
                "WORKER_SEQUENCE_MISMATCH",
                true,
            );
        }
        self.next_sequence = match self.next_sequence.checked_add(1) {
            Some(next) => next,
            None => {
                return error_response(
                    request_id,
                    request.sequence,
                    "WORKER_SEQUENCE_EXHAUSTED",
                    true,
                );
            }
        };
        self.dispatch(request)
    }

    pub fn shutdown_on_eof(&mut self) {
        let _ = self.close_active_scope();
        self.recovery_admission = None;
        self.active_restore = None;
        self.expected_token = None;
    }

    fn bootstrap(
        &mut self,
        request: MessageCacheWorkerRequest,
        actual_token: Zeroizing<String>,
    ) -> ProcessedWorkerRequest {
        if !valid_auth_token(&actual_token) {
            return error_response(
                request.request_id,
                request.sequence,
                "WORKER_UNAUTHORIZED",
                true,
            );
        }
        if request.sequence != 0 {
            return error_response(
                request.request_id,
                request.sequence,
                "WORKER_SEQUENCE_MISMATCH",
                true,
            );
        }
        if request.command != "worker.hello" {
            return error_response(
                request.request_id,
                request.sequence,
                "WORKER_BOOTSTRAP_REQUIRED",
                true,
            );
        }
        let input: WorkerHelloInput = match parse_payload(request.payload) {
            Ok(input) => input,
            Err(code) => {
                return error_response(request.request_id, request.sequence, code, true);
            }
        };
        let cache_root = match AdmittedCacheRoot::admit(Path::new(&input.cache_root)) {
            Ok(root) => root,
            Err(error) => {
                return error_response(request.request_id, request.sequence, error.code, true);
            }
        };
        self.expected_token = Some(actual_token);
        self.next_sequence = 1;
        self.cache_root = Some(cache_root);
        success_response(
            request.request_id,
            request.sequence,
            json!({
                "worker_protocol_version": MESSAGE_CACHE_WORKER_PROTOCOL_VERSION,
                "pid": std::process::id(),
                "native_adapter": self.driver.availability().as_str(),
                "adapter_id": self.driver.adapter_id(),
                "native_adapter_reason": self.driver.unavailable_reason()
            }),
            false,
        )
    }

    fn dispatch(&mut self, request: MessageCacheWorkerRequest) -> ProcessedWorkerRequest {
        match request.command.as_str() {
            "worker.hello" => error_response(
                request.request_id,
                request.sequence,
                "WORKER_ALREADY_INITIALIZED",
                false,
            ),
            "scope.open" => self.open_scope(request),
            "scope.check_integrity" => self.check_integrity(request),
            "scope.rebuild" => self.rebuild_scope(request),
            "scope.put_confirmed" => self.put_confirmed(request),
            "scope.page" => self.page(request),
            "scope.complete_rebuild" => self.complete_rebuild(request),
            "scope.purge" => self.purge_scope(request),
            "scope.local_history.put" => self.put_local_history(request),
            "scope.local_history.snapshot" => self.snapshot_local_history(request),
            "scope.local_history.release" => self.release_local_history(request),
            "scope.close" => self.close_scope(request),
            "worker.shutdown" => self.shutdown(request),
            _ => error_response(
                request.request_id,
                request.sequence,
                "WORKER_UNKNOWN_COMMAND",
                false,
            ),
        }
    }
}

pub(super) fn parse_payload<T: DeserializeOwned>(
    payload: Option<Value>,
) -> Result<T, &'static str> {
    serde_json::from_value(payload.ok_or("WORKER_COMMAND_PAYLOAD_REQUIRED")?)
        .map_err(|_| "WORKER_INVALID_COMMAND_PAYLOAD")
}

fn constant_time_token_match(expected: &str, actual: &str) -> bool {
    expected.len() == actual.len() && bool::from(expected.as_bytes().ct_eq(actual.as_bytes()))
}

fn write_response(
    output: &mut impl Write,
    response: &super::contracts::MessageCacheWorkerResponse,
) -> io::Result<()> {
    let serialized = serde_json::to_vec(response)?;
    if serialized.len() > MAX_WORKER_RESPONSE_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "worker response exceeds the owned frame limit",
        ));
    }
    output.write_all(&serialized)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn run_worker_io<K, D, C>(
    runtime: &mut MessageCacheWorkerRuntime<K, D, C>,
    input: &mut impl BufRead,
    output: &mut impl Write,
) -> io::Result<()>
where
    K: CacheKeyProviderPort,
    D: EncryptedScopeDriver,
    C: CacheClockPort,
{
    loop {
        let mut line = Zeroizing::new(Vec::new());
        let bytes_read = input
            .by_ref()
            .take((MAX_WORKER_REQUEST_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if bytes_read == 0 {
            runtime.shutdown_on_eof();
            break;
        }
        if line.last() == Some(&b'\n') {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
        }
        let processed = runtime.process_request_line(&line);
        write_response(output, &processed.response)?;
        if processed.should_shutdown || line.len() > MAX_WORKER_REQUEST_FRAME_BYTES {
            runtime.shutdown_on_eof();
            break;
        }
        line.zeroize();
    }
    Ok(())
}

pub fn run_message_cache_worker_stdio() -> io::Result<()> {
    let key_provider: Box<dyn CacheKeyProviderPort> = match OsVaultCacheKeyProvider::production() {
        Ok(provider) => Box::new(provider),
        Err(_) => Box::new(UnavailableCacheKeyProvider),
    };
    let mut runtime = MessageCacheWorkerRuntime::new(
        key_provider,
        PackagedEncryptedScopeDriver::from_current_executable(),
    );
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    run_worker_io(&mut runtime, &mut input, &mut output)
}

#[cfg(test)]
#[path = "tests/runtime.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/recovery.rs"]
mod recovery_tests;
