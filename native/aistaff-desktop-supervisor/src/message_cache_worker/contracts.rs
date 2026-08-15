use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MESSAGE_CACHE_WORKER_PROTOCOL_VERSION: &str = "aistaff.message-cache-worker.v1";
pub const MAX_WORKER_REQUEST_FRAME_BYTES: usize = 16 * 1024;
pub const MAX_WORKER_RESPONSE_FRAME_BYTES: usize = 256 * 1024;
pub const MAX_WORKER_REQUEST_ID_BYTES: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MessageCacheWorkerRequest {
    pub protocol_version: String,
    pub request_id: String,
    pub sequence: u64,
    pub auth_token: String,
    pub command: String,
    #[serde(default)]
    pub payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkerHelloInput {
    pub cache_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkerScopeInput {
    pub scope_handle: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MessageCacheWorkerError {
    pub code: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MessageCacheWorkerResponse {
    pub protocol_version: String,
    pub request_id: String,
    pub sequence: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<MessageCacheWorkerError>,
}

pub(crate) struct ProcessedWorkerRequest {
    pub response: MessageCacheWorkerResponse,
    pub should_shutdown: bool,
}

pub(crate) fn success_response(
    request_id: String,
    sequence: u64,
    result: Value,
    should_shutdown: bool,
) -> ProcessedWorkerRequest {
    ProcessedWorkerRequest {
        response: MessageCacheWorkerResponse {
            protocol_version: MESSAGE_CACHE_WORKER_PROTOCOL_VERSION.to_owned(),
            request_id,
            sequence,
            ok: true,
            result: Some(result),
            error: None,
        },
        should_shutdown,
    }
}

pub(crate) fn error_response(
    request_id: String,
    sequence: u64,
    code: &'static str,
    should_shutdown: bool,
) -> ProcessedWorkerRequest {
    ProcessedWorkerRequest {
        response: MessageCacheWorkerResponse {
            protocol_version: MESSAGE_CACHE_WORKER_PROTOCOL_VERSION.to_owned(),
            request_id,
            sequence,
            ok: false,
            result: None,
            error: Some(MessageCacheWorkerError {
                code: code.to_owned(),
            }),
        },
        should_shutdown,
    }
}

pub(crate) fn valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_WORKER_REQUEST_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

pub(crate) fn valid_auth_token(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(crate) fn valid_error_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}
