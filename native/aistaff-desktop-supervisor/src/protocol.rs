use serde::{Deserialize, Serialize};
use serde_json::Value;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

pub const PROTOCOL_VERSION: &str = "aistaff.desktop-supervisor.v1";
pub const MAX_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    protocol_version: String,
    request_id: String,
    auth_token: String,
    command: String,
    #[serde(default)]
    payload: Option<Value>,
}

#[derive(Debug)]
pub struct AuthenticatedRequest {
    pub request_id: String,
    pub command: String,
    pub payload: Option<Value>,
}

#[derive(Debug)]
pub struct ProtocolFailure {
    pub request_id: String,
    pub code: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ErrorBody {
    pub code: &'static str,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Response {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, PartialEq)]
pub struct ProcessedRequest {
    pub response: Response,
    pub should_shutdown: bool,
}

fn constant_time_token_match(expected: &str, actual: &str) -> bool {
    expected.len() == actual.len() && bool::from(expected.as_bytes().ct_eq(actual.as_bytes()))
}

pub fn authenticate_request(
    line: &[u8],
    expected_token: &str,
) -> Result<AuthenticatedRequest, ProtocolFailure> {
    if line.len() > MAX_LINE_BYTES {
        return Err(ProtocolFailure {
            request_id: "unknown".to_owned(),
            code: "REQUEST_TOO_LARGE",
        });
    }

    let request: Request = serde_json::from_slice(line).map_err(|_| ProtocolFailure {
        request_id: "unknown".to_owned(),
        code: "INVALID_REQUEST",
    })?;

    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || !request.request_id.is_ascii()
    {
        return Err(ProtocolFailure {
            request_id: "unknown".to_owned(),
            code: "INVALID_REQUEST_ID",
        });
    }
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(ProtocolFailure {
            request_id: request.request_id,
            code: "PROTOCOL_MISMATCH",
        });
    }
    let actual_token = Zeroizing::new(request.auth_token);
    if !constant_time_token_match(expected_token, &actual_token) {
        return Err(ProtocolFailure {
            request_id: request.request_id,
            code: "UNAUTHORIZED",
        });
    }

    Ok(AuthenticatedRequest {
        request_id: request.request_id,
        command: request.command,
        payload: request.payload,
    })
}

pub fn error_response(request_id: String, code: &'static str) -> ProcessedRequest {
    ProcessedRequest {
        response: Response {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody { code }),
        },
        should_shutdown: false,
    }
}

pub fn success_response(
    request_id: String,
    result: Value,
    should_shutdown: bool,
) -> ProcessedRequest {
    ProcessedRequest {
        response: Response {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        },
        should_shutdown,
    }
}
