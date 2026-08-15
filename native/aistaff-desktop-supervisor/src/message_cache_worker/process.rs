use super::contracts::{
    MAX_WORKER_REQUEST_FRAME_BYTES, MAX_WORKER_RESPONSE_FRAME_BYTES,
    MESSAGE_CACHE_WORKER_PROTOCOL_VERSION, MessageCacheWorkerResponse, valid_error_code,
};
use super::random::random_hex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

const MINIMUM_TIMEOUT: Duration = Duration::from_millis(100);
const MAXIMUM_TIMEOUT: Duration = Duration::from_secs(60);
const MAXIMUM_ENVIRONMENT_VALUE_BYTES: usize = 4096;
const WORKER_ENVIRONMENT_KEYS: [&str; 6] = [
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "TMPDIR",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageCacheWorkerProcessError {
    pub code: String,
}

impl MessageCacheWorkerProcessError {
    pub(super) fn new(code: impl Into<String>) -> Self {
        Self { code: code.into() }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerHelloResult {
    worker_protocol_version: String,
    pid: u32,
    native_adapter: String,
    adapter_id: String,
    native_adapter_reason: Option<String>,
}

#[derive(Serialize)]
struct OutboundWorkerRequest<'a> {
    protocol_version: &'static str,
    request_id: &'a str,
    sequence: u64,
    auth_token: &'a str,
    command: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
}

pub struct MessageCacheWorkerProcess {
    child: Child,
    input: ChildStdin,
    responses: Receiver<Result<Vec<u8>, &'static str>>,
    reader_thread: Option<JoinHandle<()>>,
    auth_token: Zeroizing<String>,
    next_sequence: u64,
    timeout: Duration,
    native_adapter: String,
    adapter_id: String,
    native_adapter_reason: Option<String>,
}

impl MessageCacheWorkerProcess {
    pub fn spawn(
        binary_path: &Path,
        cache_root: &Path,
        timeout: Duration,
    ) -> Result<Self, MessageCacheWorkerProcessError> {
        validate_spawn_inputs(binary_path, cache_root, timeout)?;
        let auth_token = Zeroizing::new(
            random_hex(32)
                .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_RANDOM_UNAVAILABLE"))?,
        );
        let mut command = Command::new(binary_path);
        command
            .arg("--message-cache-worker")
            .current_dir(
                binary_path
                    .parent()
                    .ok_or_else(|| MessageCacheWorkerProcessError::new("WORKER_BINARY_INVALID"))?,
            )
            .env_clear()
            .envs(worker_environment(std::env::vars()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_SPAWN_FAILED"))?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| MessageCacheWorkerProcessError::new("WORKER_STDIN_UNAVAILABLE"))?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| MessageCacheWorkerProcessError::new("WORKER_STDOUT_UNAVAILABLE"))?;
        let (sender, responses) = mpsc::channel();
        let reader_thread = thread::spawn(move || read_worker_responses(output, sender));
        let mut process = Self {
            child,
            input,
            responses,
            reader_thread: Some(reader_thread),
            auth_token,
            next_sequence: 0,
            timeout,
            native_adapter: String::new(),
            adapter_id: String::new(),
            native_adapter_reason: None,
        };
        let cache_root = cache_root
            .to_str()
            .ok_or_else(|| MessageCacheWorkerProcessError::new("CACHE_ROOT_INVALID"))?;
        let hello: WorkerHelloResult =
            process.request("worker.hello", Some(json!({ "cache_root": cache_root })))?;
        if hello.worker_protocol_version != MESSAGE_CACHE_WORKER_PROTOCOL_VERSION
            || hello.pid == 0
            || !matches!(
                hello.native_adapter.as_str(),
                "available" | "adapter_unavailable"
            )
            || !valid_adapter_id(&hello.adapter_id)
            || !valid_adapter_reason(
                &hello.native_adapter,
                hello.native_adapter_reason.as_deref(),
            )
        {
            process.terminate();
            return Err(MessageCacheWorkerProcessError::new(
                "WORKER_HANDSHAKE_INVALID",
            ));
        }
        process.native_adapter = hello.native_adapter;
        process.adapter_id = hello.adapter_id;
        process.native_adapter_reason = hello.native_adapter_reason;
        Ok(process)
    }

    pub fn native_adapter(&self) -> &str {
        &self.native_adapter
    }

    pub fn adapter_id(&self) -> &str {
        &self.adapter_id
    }

    pub fn native_adapter_reason(&self) -> Option<&str> {
        self.native_adapter_reason.as_deref()
    }

    pub fn force_stop(mut self) -> Result<(), MessageCacheWorkerProcessError> {
        self.terminate_checked()
    }

    pub(super) fn request<T: for<'de> Deserialize<'de>>(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<T, MessageCacheWorkerProcessError> {
        let request_id = random_hex(16)
            .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_RANDOM_UNAVAILABLE"))?;
        let sequence = self.take_sequence()?;
        let request = OutboundWorkerRequest {
            protocol_version: MESSAGE_CACHE_WORKER_PROTOCOL_VERSION,
            request_id: &request_id,
            sequence,
            auth_token: &self.auth_token,
            command,
            payload,
        };
        let serialized = match serialize_request(&request) {
            Ok(serialized) => serialized,
            Err(error) => {
                self.terminate();
                return Err(error);
            }
        };
        self.write_request(serialized)?;
        let response = self.read_response(&request_id, sequence)?;
        self.decode_response(response)
    }

    fn take_sequence(&mut self) -> Result<u64, MessageCacheWorkerProcessError> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.checked_add(1).ok_or_else(|| {
            self.terminate();
            MessageCacheWorkerProcessError::new("WORKER_SEQUENCE_EXHAUSTED")
        })?;
        Ok(sequence)
    }

    fn write_request(
        &mut self,
        mut serialized: Zeroizing<Vec<u8>>,
    ) -> Result<(), MessageCacheWorkerProcessError> {
        serialized.push(b'\n');
        if self.input.write_all(&serialized).is_err() || self.input.flush().is_err() {
            serialized.zeroize();
            self.terminate();
            return Err(MessageCacheWorkerProcessError::new(
                "WORKER_REQUEST_WRITE_FAILED",
            ));
        }
        serialized.zeroize();
        Ok(())
    }

    fn read_response(
        &mut self,
        request_id: &str,
        sequence: u64,
    ) -> Result<MessageCacheWorkerResponse, MessageCacheWorkerProcessError> {
        let line = receive_response_line(&self.responses, self.timeout).inspect_err(|_| {
            self.terminate();
        })?;
        let response: MessageCacheWorkerResponse = serde_json::from_slice(&line).map_err(|_| {
            self.terminate();
            MessageCacheWorkerProcessError::new("WORKER_RESPONSE_INVALID")
        })?;
        if response.protocol_version != MESSAGE_CACHE_WORKER_PROTOCOL_VERSION
            || response.request_id != request_id
            || response.sequence != sequence
            || response.ok == response.error.is_some()
            || response.ok == response.result.is_none()
        {
            self.terminate();
            return Err(MessageCacheWorkerProcessError::new(
                "WORKER_RESPONSE_INVALID",
            ));
        }
        Ok(response)
    }

    fn decode_response<T: for<'de> Deserialize<'de>>(
        &mut self,
        response: MessageCacheWorkerResponse,
    ) -> Result<T, MessageCacheWorkerProcessError> {
        if let Some(error) = response.error {
            if !valid_error_code(&error.code) {
                self.terminate();
                return Err(MessageCacheWorkerProcessError::new(
                    "WORKER_ERROR_CODE_INVALID",
                ));
            }
            return Err(MessageCacheWorkerProcessError::new(error.code));
        }
        let Some(result) = response.result else {
            self.terminate();
            return Err(MessageCacheWorkerProcessError::new(
                "WORKER_RESPONSE_INVALID",
            ));
        };
        serde_json::from_value(result).map_err(|_| {
            self.terminate();
            MessageCacheWorkerProcessError::new("WORKER_RESPONSE_INVALID")
        })
    }

    pub(super) fn wait_for_exit(&mut self) -> Result<(), MessageCacheWorkerProcessError> {
        let deadline = Instant::now() + self.timeout;
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    self.join_reader();
                    return Ok(());
                }
                Ok(Some(_)) | Err(_) => {
                    self.join_reader();
                    return Err(MessageCacheWorkerProcessError::new("WORKER_EXIT_FAILED"));
                }
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(5));
                }
                Ok(None) => {
                    self.terminate();
                    return Err(MessageCacheWorkerProcessError::new(
                        "WORKER_EXIT_TIMEOUT_RECONCILE_REQUIRED",
                    ));
                }
            }
        }
    }

    pub(super) fn terminate(&mut self) {
        let _ = self.terminate_checked();
    }

    fn terminate_checked(&mut self) -> Result<(), MessageCacheWorkerProcessError> {
        match self.child.try_wait() {
            Ok(Some(_)) => {
                self.join_reader();
                Ok(())
            }
            Ok(None) => {
                if self.child.kill().is_err() || self.child.wait().is_err() {
                    return Err(MessageCacheWorkerProcessError::new(
                        "WORKER_FORCE_STOP_FAILED",
                    ));
                }
                self.join_reader();
                Ok(())
            }
            Err(_) => Err(MessageCacheWorkerProcessError::new(
                "WORKER_FORCE_STOP_FAILED",
            )),
        }
    }

    fn join_reader(&mut self) {
        if let Some(reader_thread) = self.reader_thread.take() {
            let _ = reader_thread.join();
        }
    }
}

fn serialize_request(
    request: &OutboundWorkerRequest<'_>,
) -> Result<Zeroizing<Vec<u8>>, MessageCacheWorkerProcessError> {
    let serialized = Zeroizing::new(
        serde_json::to_vec(request)
            .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_REQUEST_INVALID"))?,
    );
    if serialized.len() > MAX_WORKER_REQUEST_FRAME_BYTES {
        return Err(MessageCacheWorkerProcessError::new(
            "WORKER_REQUEST_TOO_LARGE",
        ));
    }
    Ok(serialized)
}

impl Drop for MessageCacheWorkerProcess {
    fn drop(&mut self) {
        self.terminate();
        self.auth_token.zeroize();
    }
}

fn validate_spawn_inputs(
    binary_path: &Path,
    cache_root: &Path,
    timeout: Duration,
) -> Result<(), MessageCacheWorkerProcessError> {
    if !binary_path.is_absolute() || !cache_root.is_absolute() {
        return Err(MessageCacheWorkerProcessError::new(
            "WORKER_SPAWN_INPUT_INVALID",
        ));
    }
    let binary_metadata = std::fs::symlink_metadata(binary_path)
        .map_err(|_| MessageCacheWorkerProcessError::new("WORKER_BINARY_UNAVAILABLE"))?;
    if !binary_metadata.is_file() || binary_metadata.file_type().is_symlink() {
        return Err(MessageCacheWorkerProcessError::new("WORKER_BINARY_INVALID"));
    }
    if !(MINIMUM_TIMEOUT..=MAXIMUM_TIMEOUT).contains(&timeout) {
        return Err(MessageCacheWorkerProcessError::new(
            "WORKER_TIMEOUT_INVALID",
        ));
    }
    Ok(())
}

fn worker_environment(source: impl IntoIterator<Item = (String, String)>) -> Vec<(String, String)> {
    let source: Vec<_> = source.into_iter().collect();
    WORKER_ENVIRONMENT_KEYS
        .into_iter()
        .filter_map(|allowed| {
            let entry = source.iter().find(|(key, _)| key == allowed).or_else(|| {
                source
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case(allowed))
            })?;
            if entry.1.len() > MAXIMUM_ENVIRONMENT_VALUE_BYTES || entry.1.contains('\0') {
                return None;
            }
            Some((allowed.to_owned(), entry.1.clone()))
        })
        .collect()
}

fn read_worker_responses(output: impl Read, sender: mpsc::Sender<Result<Vec<u8>, &'static str>>) {
    let mut reader = BufReader::new(output);
    loop {
        let mut line = Vec::new();
        let read_result = reader
            .by_ref()
            .take((MAX_WORKER_RESPONSE_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line);
        match read_result {
            Ok(0) => {
                let _ = sender.send(Err("WORKER_STDOUT_CLOSED"));
                break;
            }
            Ok(_) => {
                if line.last() == Some(&b'\n') {
                    line.pop();
                    if line.last() == Some(&b'\r') {
                        line.pop();
                    }
                }
                if line.len() > MAX_WORKER_RESPONSE_FRAME_BYTES {
                    let _ = sender.send(Err("WORKER_RESPONSE_TOO_LARGE"));
                    break;
                }
                if sender.send(Ok(line)).is_err() {
                    break;
                }
            }
            Err(_) => {
                let _ = sender.send(Err("WORKER_RESPONSE_READ_FAILED"));
                break;
            }
        }
    }
}

fn receive_response_line(
    responses: &Receiver<Result<Vec<u8>, &'static str>>,
    timeout: Duration,
) -> Result<Vec<u8>, MessageCacheWorkerProcessError> {
    match responses.recv_timeout(timeout) {
        Ok(Ok(line)) => Ok(line),
        Ok(Err(code)) => Err(MessageCacheWorkerProcessError::new(code)),
        Err(RecvTimeoutError::Timeout) => Err(MessageCacheWorkerProcessError::new(
            "WORKER_RESPONSE_TIMEOUT_RECONCILE_REQUIRED",
        )),
        Err(RecvTimeoutError::Disconnected) => Err(MessageCacheWorkerProcessError::new(
            "WORKER_RESPONSE_CHANNEL_CLOSED",
        )),
    }
}

pub(super) fn valid_adapter_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            if index == 0 {
                byte.is_ascii_lowercase()
            } else {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'.' | b'_' | b'-')
            }
        })
}

fn valid_adapter_reason(availability: &str, reason: Option<&str>) -> bool {
    match availability {
        "available" => reason.is_none(),
        "adapter_unavailable" => reason.is_some_and(valid_error_code),
        _ => false,
    }
}

#[cfg(test)]
#[path = "process_tests.rs"]
mod tests;
