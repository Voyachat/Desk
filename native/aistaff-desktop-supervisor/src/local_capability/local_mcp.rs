use super::contracts::LocalCapabilityError;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MCP_MAX_FRAME_BYTES: usize = 64 * 1024;
const MCP_MAX_SUMMARY_BYTES: usize = 1024;

/// This descriptor has already passed the Main-process catalogue and confirmation gates.
/// It intentionally has no executable, argv, environment, path, or endpoint fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalMcpDescriptor {
    Time,
    SequentialThinking,
}

impl LocalMcpDescriptor {
    fn tool_key(self) -> &'static str {
        match self {
            Self::Time => "get_current_time",
            Self::SequentialThinking => "sequentialthinking",
        }
    }
}

/// There is no free-form tool name or JSON argument bag. Each descriptor owns its exact call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalMcpInvocation {
    Time {
        timezone: Option<String>,
    },
    SequentialThinking {
        thought: String,
        next_thought_needed: bool,
        thought_number: u16,
        total_thoughts: u16,
    },
}

impl LocalMcpInvocation {
    fn descriptor(&self) -> LocalMcpDescriptor {
        match self {
            Self::Time { .. } => LocalMcpDescriptor::Time,
            Self::SequentialThinking { .. } => LocalMcpDescriptor::SequentialThinking,
        }
    }

    fn arguments(&self) -> Result<Value, LocalMcpInvocationError> {
        match self {
            Self::Time { timezone } => {
                if timezone.as_ref().is_some_and(|value| value.len() > 120) {
                    return Err(LocalMcpInvocationError::new("LOCAL_MCP_ARGUMENTS_INVALID"));
                }
                Ok(match timezone {
                    Some(timezone) => json!({ "timezone": timezone }),
                    None => json!({}),
                })
            }
            Self::SequentialThinking {
                thought,
                next_thought_needed,
                thought_number,
                total_thoughts,
            } => {
                if thought.is_empty()
                    || thought.len() > 8 * 1024
                    || *thought_number == 0
                    || *total_thoughts == 0
                    || thought_number > total_thoughts
                {
                    return Err(LocalMcpInvocationError::new("LOCAL_MCP_ARGUMENTS_INVALID"));
                }
                Ok(json!({
                    "thought": thought,
                    "nextThoughtNeeded": next_thought_needed,
                    "thoughtNumber": thought_number,
                    "totalThoughts": total_thoughts,
                }))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalMcpInvocationRequest {
    pub operation_id: String,
    pub invocation: LocalMcpInvocation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalMcpInvocationStatus {
    Succeeded,
    ToolReportedError,
}

impl LocalMcpInvocationStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::ToolReportedError => "tool_reported_error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalMcpInvocationSummary {
    pub tool_key: &'static str,
    pub status: LocalMcpInvocationStatus,
    pub reason_code: &'static str,
    pub text_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalMcpInvocationError {
    pub reason_code: &'static str,
}

impl LocalMcpInvocationError {
    const fn new(reason_code: &'static str) -> Self {
        Self { reason_code }
    }
}

/// The Supervisor's single-request, stdio-only MCP execution boundary.
pub trait LocalMcpInvocationPort {
    fn invoke(
        &self,
        request: LocalMcpInvocationRequest,
    ) -> Result<LocalMcpInvocationSummary, LocalMcpInvocationError>;
}

pub struct NativeLocalMcpInvocationPort {
    request_timeout: Duration,
}

impl Default for NativeLocalMcpInvocationPort {
    fn default() -> Self {
        Self {
            request_timeout: MCP_REQUEST_TIMEOUT,
        }
    }
}

impl LocalMcpInvocationPort for NativeLocalMcpInvocationPort {
    fn invoke(
        &self,
        request: LocalMcpInvocationRequest,
    ) -> Result<LocalMcpInvocationSummary, LocalMcpInvocationError> {
        validate_operation_id(&request.operation_id)?;
        match request.invocation {
            invocation @ LocalMcpInvocation::Time { .. } => invoke_over_transport(
                ChildStdioTransport::spawn_time_server()?,
                invocation,
                self.request_timeout,
            ),
            // Sequential-thinking requires user/model supplied thought context. No such typed
            // contract is admitted yet, so this boundary must not fabricate it.
            LocalMcpInvocation::SequentialThinking { .. } => Err(LocalMcpInvocationError::new(
                "LOCAL_MCP_DESCRIPTOR_UNAVAILABLE",
            )),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalMcpSupervisorInput {
    operation_id: String,
    tool: String,
    confirmed: bool,
}

/// Authenticated Supervisor command boundary. Only the built-in time tool is represented in the
/// payload schema; descriptor selection, paths, commands, arguments and environment are absent.
pub fn invoke_local_mcp_supervisor_command(
    payload: Option<Value>,
) -> Result<Value, LocalCapabilityError> {
    let input: LocalMcpSupervisorInput = serde_json::from_value(
        payload.ok_or_else(|| LocalCapabilityError::new("LOCAL_MCP_PAYLOAD_REQUIRED"))?,
    )
    .map_err(|_| LocalCapabilityError::new("LOCAL_MCP_PAYLOAD_INVALID"))?;
    if !input.confirmed {
        return Err(LocalCapabilityError::new("LOCAL_MCP_CONFIRMATION_REQUIRED"));
    }
    if input.tool != "time" {
        return Err(LocalCapabilityError::new("LOCAL_MCP_TOOL_NOT_ALLOWLISTED"));
    }
    let summary = NativeLocalMcpInvocationPort::default()
        .invoke(LocalMcpInvocationRequest {
            operation_id: input.operation_id.clone(),
            // The renderer exposes only this fixed label. The service reports it
            // as request metadata and never claims timezone conversion.
            invocation: LocalMcpInvocation::Time {
                timezone: Some("Asia/Shanghai".to_owned()),
            },
        })
        .map_err(|error| LocalCapabilityError::new(error.reason_code))?;
    Ok(json!({
        "operation_id": input.operation_id,
        "tool": "time",
        "status": summary.status.as_str(),
        "reason_code": summary.reason_code,
        "summary": summary.text_summary,
        "production_ready": false,
    }))
}

/// Child mode for the owned, built-in time MCP server. It exposes exactly one tool and exits
/// after exactly one `tools/call`; it never reads host commands, paths, environment or network.
pub fn run_local_mcp_time_server_stdio() -> io::Result<()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mut call_seen = false;
    loop {
        let mut line = Vec::new();
        let read = input.read_until(b'\n', &mut line)?;
        if read == 0 || line.len() > MCP_MAX_FRAME_BYTES {
            return Ok(());
        }
        let Ok(frame) = serde_json::from_slice::<Value>(&line) else {
            return Ok(());
        };
        let Some(method) = frame.get("method").and_then(Value::as_str) else {
            return Ok(());
        };
        let Some(id) = frame.get("id").cloned() else {
            if method == "notifications/initialized" {
                continue;
            }
            return Ok(());
        };
        let result = match method {
            "initialize" => json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "aistaff-local-time", "version": "0.1" },
            }),
            "tools/list" if !call_seen => json!({ "tools": [{ "name": "get_current_time" }] }),
            "tools/call" if !call_seen && frame["params"]["name"] == "get_current_time" => {
                call_seen = true;
                let timezone = frame["params"]["arguments"]["timezone"]
                    .as_str()
                    .filter(|value| value.len() <= 120)
                    .unwrap_or("local");
                time_tool_result(timezone)
            }
            _ => return Ok(()),
        };
        serde_json::to_writer(
            &mut output,
            &json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        )?;
        output.write_all(b"\n")?;
        output.flush()?;
        if call_seen {
            return Ok(());
        }
    }
}

pub(super) fn time_tool_result(requested_timezone: &str) -> Value {
    let epoch_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    json!({ "content": [{ "type": "text", "text": format!("unix_epoch_seconds: {epoch_seconds}; requested_timezone: {requested_timezone}") }] })
}

fn validate_operation_id(operation_id: &str) -> Result<(), LocalMcpInvocationError> {
    if operation_id.is_empty() || operation_id.len() > 180 {
        return Err(LocalMcpInvocationError::new("LOCAL_MCP_OPERATION_INVALID"));
    }
    Ok(())
}

pub(super) trait McpStdioTransport {
    fn write_frame(&mut self, frame: &Value) -> Result<(), LocalMcpInvocationError>;
    fn read_frame(&mut self, timeout: Duration) -> Result<Value, LocalMcpInvocationError>;
    fn close(&mut self) -> Result<(), LocalMcpInvocationError>;
}

pub(super) fn invoke_over_transport<T: McpStdioTransport>(
    mut transport: T,
    invocation: LocalMcpInvocation,
    timeout: Duration,
) -> Result<LocalMcpInvocationSummary, LocalMcpInvocationError> {
    let result = invoke_protocol(&mut transport, &invocation, timeout);
    let cleanup = transport.close();
    match (result, cleanup) {
        (Ok(summary), Ok(())) => Ok(summary),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), _) => Err(error),
    }
}

fn invoke_protocol<T: McpStdioTransport>(
    transport: &mut T,
    invocation: &LocalMcpInvocation,
    timeout: Duration,
) -> Result<LocalMcpInvocationSummary, LocalMcpInvocationError> {
    let descriptor = invocation.descriptor();
    let arguments = invocation.arguments()?;
    transport.write_frame(&request_frame(
        1,
        "initialize",
        json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "aistaff-desktop-supervisor", "version": "0.1" },
        }),
    ))?;
    require_response(
        &transport.read_frame(timeout)?,
        1,
        "LOCAL_MCP_INITIALIZE_REJECTED",
    )?;
    transport.write_frame(&notification_frame("notifications/initialized", json!({})))?;

    transport.write_frame(&request_frame(2, "tools/list", json!({})))?;
    let tools_frame = transport.read_frame(timeout)?;
    let advertised = require_response(&tools_frame, 2, "LOCAL_MCP_TOOLS_LIST_REJECTED")?;
    if !tool_is_advertised(advertised, descriptor.tool_key()) {
        return Err(LocalMcpInvocationError::new(
            "LOCAL_MCP_TOOL_NOT_ADVERTISED",
        ));
    }

    transport.write_frame(&request_frame(
        3,
        "tools/call",
        json!({
            "name": descriptor.tool_key(),
            "arguments": arguments,
        }),
    ))?;
    let call_frame = transport.read_frame(timeout)?;
    let result = require_response(&call_frame, 3, "LOCAL_MCP_TOOL_CALL_REJECTED")?;
    summarize_tool_result(descriptor, result)
}

fn request_frame(id: u8, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn notification_frame(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

fn require_response<'a>(
    value: &'a Value,
    expected_id: u8,
    error_code: &'static str,
) -> Result<&'a Value, LocalMcpInvocationError> {
    let object = value
        .as_object()
        .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_FRAME_NOT_OBJECT"))?;
    if object.get("jsonrpc") != Some(&Value::String("2.0".into()))
        || object.get("id") != Some(&json!(expected_id))
        || object.contains_key("method")
    {
        return Err(LocalMcpInvocationError::new("LOCAL_MCP_UNEXPECTED_FRAME"));
    }
    if object.contains_key("error") {
        return Err(LocalMcpInvocationError::new(error_code));
    }
    object
        .get("result")
        .filter(|result| result.is_object())
        .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_RESPONSE_MALFORMED"))
}

fn tool_is_advertised(result: &Value, expected_tool: &str) -> bool {
    result
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| {
            tools.iter().any(|tool| {
                tool.as_object()
                    .and_then(|item| item.get("name"))
                    .and_then(Value::as_str)
                    == Some(expected_tool)
            })
        })
}

fn summarize_tool_result(
    descriptor: LocalMcpDescriptor,
    result: &Value,
) -> Result<LocalMcpInvocationSummary, LocalMcpInvocationError> {
    let object = result
        .as_object()
        .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_TOOL_RESULT_MALFORMED"))?;
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_TOOL_RESULT_MALFORMED"))?;
    let mut summary = String::new();
    for item in content {
        let item = item
            .as_object()
            .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_TOOL_RESULT_MALFORMED"))?;
        if item.get("type").and_then(Value::as_str) != Some("text") {
            return Err(LocalMcpInvocationError::new(
                "LOCAL_MCP_TOOL_RESULT_UNSUPPORTED_CONTENT",
            ));
        }
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_TOOL_RESULT_MALFORMED"))?;
        append_summary(&mut summary, text);
    }
    let is_error = object
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(LocalMcpInvocationSummary {
        tool_key: descriptor.tool_key(),
        status: if is_error {
            LocalMcpInvocationStatus::ToolReportedError
        } else {
            LocalMcpInvocationStatus::Succeeded
        },
        reason_code: if is_error {
            "LOCAL_MCP_TOOL_REPORTED_ERROR"
        } else {
            "LOCAL_MCP_SUCCEEDED"
        },
        text_summary: summary,
    })
}

fn append_summary(summary: &mut String, text: &str) {
    let remaining = MCP_MAX_SUMMARY_BYTES.saturating_sub(summary.len());
    if remaining == 0 {
        return;
    }
    let mut accepted = 0;
    for (index, character) in text.char_indices() {
        let end = index + character.len_utf8();
        if end > remaining {
            break;
        }
        accepted = end;
    }
    summary.push_str(&text[..accepted]);
}

struct ChildStdioTransport {
    child: Child,
    stdin: Option<ChildStdin>,
    frames: Receiver<Result<Value, LocalMcpInvocationError>>,
    reader: Option<JoinHandle<()>>,
}

impl ChildStdioTransport {
    fn spawn_time_server() -> Result<Self, LocalMcpInvocationError> {
        let executable = std::env::current_exe()
            .map_err(|_| LocalMcpInvocationError::new("LOCAL_MCP_RUNTIME_UNAVAILABLE"))?;
        let mut child = Command::new(executable)
            .arg("--local-mcp-time-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| LocalMcpInvocationError::new("LOCAL_MCP_RUNTIME_UNAVAILABLE"))?;
        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            LocalMcpInvocationError::new("LOCAL_MCP_STDIN_UNAVAILABLE")
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            LocalMcpInvocationError::new("LOCAL_MCP_STDOUT_UNAVAILABLE")
        })?;
        let (sender, frames) = mpsc::channel();
        let reader = thread::spawn(move || read_json_frames(BufReader::new(stdout), sender));
        Ok(Self {
            child,
            stdin: Some(stdin),
            frames,
            reader: Some(reader),
        })
    }
}

fn read_json_frames(
    mut reader: impl BufRead,
    sender: mpsc::Sender<Result<Value, LocalMcpInvocationError>>,
) {
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => {
                let _ = sender.send(Err(LocalMcpInvocationError::new("LOCAL_MCP_EOF")));
                return;
            }
            Ok(_) if line.len() > MCP_MAX_FRAME_BYTES => {
                let _ = sender.send(Err(LocalMcpInvocationError::new(
                    "LOCAL_MCP_FRAME_TOO_LARGE",
                )));
                return;
            }
            Ok(_) => match serde_json::from_slice::<Value>(&line) {
                Ok(frame) => {
                    if sender.send(Ok(frame)).is_err() {
                        return;
                    }
                }
                Err(_) => {
                    let _ = sender.send(Err(LocalMcpInvocationError::new(
                        "LOCAL_MCP_FRAME_NOT_JSON",
                    )));
                    return;
                }
            },
            Err(_) => {
                let _ = sender.send(Err(LocalMcpInvocationError::new("LOCAL_MCP_READ_FAILED")));
                return;
            }
        }
    }
}

impl McpStdioTransport for ChildStdioTransport {
    fn write_frame(&mut self, frame: &Value) -> Result<(), LocalMcpInvocationError> {
        let mut encoded = serde_json::to_vec(frame)
            .map_err(|_| LocalMcpInvocationError::new("LOCAL_MCP_FRAME_SERIALIZE_FAILED"))?;
        encoded.push(b'\n');
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| LocalMcpInvocationError::new("LOCAL_MCP_STDIN_UNAVAILABLE"))?;
        stdin
            .write_all(&encoded)
            .and_then(|_| stdin.flush())
            .map_err(|_| LocalMcpInvocationError::new("LOCAL_MCP_WRITE_FAILED"))
    }

    fn read_frame(&mut self, timeout: Duration) -> Result<Value, LocalMcpInvocationError> {
        self.frames
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => {
                    LocalMcpInvocationError::new("LOCAL_MCP_TIMEOUT")
                }
                mpsc::RecvTimeoutError::Disconnected => {
                    LocalMcpInvocationError::new("LOCAL_MCP_EOF")
                }
            })?
    }

    fn close(&mut self) -> Result<(), LocalMcpInvocationError> {
        drop(self.stdin.take());
        let killed = self.child.kill().or_else(|error| {
            if error.kind() == io::ErrorKind::InvalidInput {
                Ok(())
            } else {
                Err(error)
            }
        });
        let waited = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if killed.is_err() || waited.is_err() {
            return Err(LocalMcpInvocationError::new("LOCAL_MCP_CLEANUP_FAILED"));
        }
        Ok(())
    }
}
