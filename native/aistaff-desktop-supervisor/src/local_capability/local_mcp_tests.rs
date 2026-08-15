use super::local_mcp::{
    LocalMcpInvocation, LocalMcpInvocationError, LocalMcpInvocationStatus, McpStdioTransport,
    invoke_over_transport, time_tool_result,
};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct FakeTransport {
    state: Arc<Mutex<FakeState>>,
    cleanup_fails: bool,
}

struct FakeState {
    responses: VecDeque<Result<Value, LocalMcpInvocationError>>,
    writes: Vec<Value>,
    closed: bool,
}

impl FakeTransport {
    fn with_state(
        responses: VecDeque<Result<Value, LocalMcpInvocationError>>,
        cleanup_fails: bool,
    ) -> (Self, Arc<Mutex<FakeState>>) {
        let state = Arc::new(Mutex::new(FakeState {
            responses,
            writes: Vec::new(),
            closed: false,
        }));
        (
            Self {
                state: state.clone(),
                cleanup_fails,
            },
            state,
        )
    }
}

impl McpStdioTransport for FakeTransport {
    fn write_frame(&mut self, frame: &Value) -> Result<(), LocalMcpInvocationError> {
        self.state.lock().unwrap().writes.push(frame.clone());
        Ok(())
    }

    fn read_frame(&mut self, _timeout: Duration) -> Result<Value, LocalMcpInvocationError> {
        self.state.lock().unwrap().responses.pop_front().unwrap_or({
            Err(LocalMcpInvocationError {
                reason_code: "LOCAL_MCP_EOF",
            })
        })
    }

    fn close(&mut self) -> Result<(), LocalMcpInvocationError> {
        self.state.lock().unwrap().closed = true;
        if self.cleanup_fails {
            Err(LocalMcpInvocationError {
                reason_code: "LOCAL_MCP_CLEANUP_FAILED",
            })
        } else {
            Ok(())
        }
    }
}

fn success_frames(tool: &str) -> [Value; 3] {
    [
        json!({"jsonrpc":"2.0", "id":1, "result":{"protocolVersion":"2025-06-18"}}),
        json!({"jsonrpc":"2.0", "id":2, "result":{"tools":[{"name":tool}]}}),
        json!({"jsonrpc":"2.0", "id":3, "result":{"content":[{"type":"text", "text":"safe result"}]}}),
    ]
}

#[test]
fn invokes_only_the_descriptor_fixed_tool_in_the_required_protocol_order() {
    let (transport, state) = FakeTransport::with_state(
        success_frames("get_current_time")
            .into_iter()
            .map(Ok)
            .collect(),
        false,
    );
    let summary = invoke_over_transport(
        transport,
        LocalMcpInvocation::Time {
            timezone: Some("Asia/Shanghai".into()),
        },
        Duration::from_millis(1),
    )
    .unwrap();
    assert_eq!(summary.tool_key, "get_current_time");
    assert_eq!(summary.status, LocalMcpInvocationStatus::Succeeded);
    assert_eq!(summary.text_summary, "safe result");
    let state = state.lock().unwrap();
    assert!(state.closed);
    assert_eq!(state.writes.len(), 4);
    assert_eq!(state.writes[0]["method"], "initialize");
    assert_eq!(state.writes[1]["method"], "notifications/initialized");
    assert_eq!(state.writes[2]["method"], "tools/list");
    assert_eq!(state.writes[3]["params"]["name"], "get_current_time");
    assert_eq!(
        state.writes[3]["params"]["arguments"]["timezone"],
        "Asia/Shanghai"
    );
}

#[test]
fn rejects_unadvertised_or_unexpected_protocol_frames_and_closes_the_transport() {
    let (transport, state) = FakeTransport::with_state(
        [
            Ok(json!({"jsonrpc":"2.0", "id":1, "result":{}})),
            Ok(json!({"jsonrpc":"2.0", "id":2, "result":{"tools":[]}})),
        ]
        .into_iter()
        .collect(),
        false,
    );
    let error = invoke_over_transport(
        transport,
        LocalMcpInvocation::Time { timezone: None },
        Duration::from_millis(1),
    )
    .unwrap_err();
    assert_eq!(error.reason_code, "LOCAL_MCP_TOOL_NOT_ADVERTISED");
    assert!(state.lock().unwrap().closed);

    let (transport, state) = FakeTransport::with_state(
        [Ok(json!({"jsonrpc":"2.0", "id":99, "result":{}}))]
            .into_iter()
            .collect(),
        false,
    );
    let error = invoke_over_transport(
        transport,
        LocalMcpInvocation::Time { timezone: None },
        Duration::from_millis(1),
    )
    .unwrap_err();
    assert_eq!(error.reason_code, "LOCAL_MCP_UNEXPECTED_FRAME");
    assert!(state.lock().unwrap().closed);
}

#[test]
fn cleanup_failure_closes_successful_result_and_public_input_is_strictly_typed() {
    let (transport, state) = FakeTransport::with_state(
        success_frames("sequentialthinking")
            .into_iter()
            .map(Ok)
            .collect(),
        true,
    );
    let error = invoke_over_transport(
        transport,
        LocalMcpInvocation::SequentialThinking {
            thought: "inspect constraints".into(),
            next_thought_needed: false,
            thought_number: 1,
            total_thoughts: 1,
        },
        Duration::from_millis(1),
    )
    .unwrap_err();
    assert_eq!(error.reason_code, "LOCAL_MCP_CLEANUP_FAILED");
    assert!(state.lock().unwrap().closed);

    let (transport, _) = FakeTransport::with_state(VecDeque::new(), false);
    let error = invoke_over_transport(
        transport,
        LocalMcpInvocation::SequentialThinking {
            thought: String::new(),
            next_thought_needed: false,
            thought_number: 0,
            total_thoughts: 0,
        },
        Duration::from_millis(1),
    )
    .unwrap_err();
    assert_eq!(error.reason_code, "LOCAL_MCP_ARGUMENTS_INVALID");
}

#[test]
fn built_in_time_result_reports_real_epoch_seconds_and_only_labels_requested_timezone() {
    let result = time_tool_result("UTC");
    let text = result["content"][0]["text"]
        .as_str()
        .expect("built-in time result is text");
    let (epoch, timezone) = text
        .strip_prefix("unix_epoch_seconds: ")
        .and_then(|value| value.split_once("; requested_timezone: "))
        .expect("stable summary format");
    assert!(epoch.parse::<u64>().expect("epoch seconds") > 1_700_000_000);
    assert_eq!(timezone, "UTC");
}
