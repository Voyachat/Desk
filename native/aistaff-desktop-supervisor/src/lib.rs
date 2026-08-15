pub mod local_capability;
pub mod message_cache;
pub mod message_cache_abi;
pub mod message_cache_worker;
mod protocol;
mod supervisor_control;
#[cfg(windows)]
mod windows_file_identity;

use local_capability::{
    CLIENT_LOCAL_WORKSPACE_WRITE_SUPERVISOR_CAPABILITY, LOCAL_CAPABILITY_SUPERVISOR_CAPABILITY,
    LocalBrowserCapabilityCommandHandler, LocalBrowserCapabilityService,
    LocalCapabilityBrokerService, LocalCapabilityCommandHandler, LocalCapabilityError,
    LocalFileCapabilityCommandHandler, LocalFileCapabilityService,
    LocalProcessCapabilityCommandHandler, LocalProcessCapabilityService, SharedFileGrantRegistry,
    invoke_local_mcp_supervisor_command, is_local_browser_capability_command,
    is_local_capability_command, is_local_file_capability_command,
    is_local_process_capability_command,
};
use message_cache::{
    MESSAGE_CACHE_CAPABILITY, MessageCacheCommandHandler, MessageCacheService,
    WorkerMessageCacheAdapter, is_message_cache_command,
};
use serde_json::json;
use std::path::Path;
use std::time::Instant;
use supervisor_control::{SupervisorControlRuntime, is_supervisor_control_command};

pub use protocol::{ErrorBody, MAX_LINE_BYTES, PROTOCOL_VERSION, ProcessedRequest, Response};
use protocol::{authenticate_request, error_response, success_response};
pub use supervisor_control::SupervisorControlFailure;

pub struct SupervisorRuntime {
    started_at: Instant,
    local_capability: Box<dyn LocalCapabilityCommandHandler>,
    local_browser_capability: Box<dyn LocalBrowserCapabilityCommandHandler>,
    local_file_capability: Box<dyn LocalFileCapabilityCommandHandler>,
    local_process_capability: Box<dyn LocalProcessCapabilityCommandHandler>,
    message_cache: Box<dyn MessageCacheCommandHandler>,
    supervisor_control: SupervisorControlRuntime,
}

impl Default for SupervisorRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl SupervisorRuntime {
    pub fn new() -> Self {
        Self::with_control_runtime(
            SupervisorControlRuntime::unavailable()
                .expect("operating-system random source is required"),
        )
    }

    pub fn with_supervisor_control_state(
        state_directory: &Path,
        data_key: [u8; 32],
    ) -> Result<Self, SupervisorControlFailure> {
        Ok(Self::with_control_runtime(
            SupervisorControlRuntime::with_sqlite_state(state_directory, data_key)?,
        ))
    }

    fn with_control_runtime(supervisor_control: SupervisorControlRuntime) -> Self {
        let (local_file_capability, local_process_capability) =
            local_file_and_process_capabilities();
        Self {
            started_at: Instant::now(),
            local_capability: Box::new(LocalCapabilityBrokerService::new()),
            local_browser_capability: Box::new(LocalBrowserCapabilityService::new()),
            local_file_capability: Box::new(local_file_capability),
            local_process_capability: Box::new(local_process_capability),
            message_cache: Box::new(MessageCacheService::new(
                WorkerMessageCacheAdapter::from_current_process(),
            )),
            supervisor_control,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_message_cache(message_cache: Box<dyn MessageCacheCommandHandler>) -> Self {
        let (local_file_capability, local_process_capability) =
            local_file_and_process_capabilities();
        Self {
            started_at: Instant::now(),
            local_capability: Box::new(LocalCapabilityBrokerService::new()),
            local_browser_capability: Box::new(LocalBrowserCapabilityService::new()),
            local_file_capability: Box::new(local_file_capability),
            local_process_capability: Box::new(local_process_capability),
            message_cache,
            supervisor_control: SupervisorControlRuntime::unavailable()
                .expect("operating-system random source is required"),
        }
    }

    pub fn process_request_line(&mut self, line: &[u8], expected_token: &str) -> ProcessedRequest {
        let request = match authenticate_request(line, expected_token) {
            Ok(request) => request,
            Err(error) => return error_response(error.request_id, error.code),
        };

        if is_supervisor_control_command(&request.command) {
            return match self
                .supervisor_control
                .handle(&request.command, request.payload)
            {
                Ok(result) => success_response(request.request_id, result, false),
                Err(error) => error_response(request.request_id, error.code),
            };
        }

        if is_local_file_capability_command(&request.command) {
            let result = self
                .local_file_capability
                .handle(&request.command, request.payload);
            return local_capability_response(request.request_id, result);
        }

        if is_local_browser_capability_command(&request.command) {
            let result = self
                .local_browser_capability
                .handle(&request.command, request.payload);
            return local_capability_response(request.request_id, result);
        }

        if is_local_capability_command(&request.command) {
            let result = self
                .local_capability
                .handle(&request.command, request.payload);
            return local_capability_response(request.request_id, result);
        }

        if is_local_process_capability_command(&request.command) {
            let result = self
                .local_process_capability
                .handle(&request.command, request.payload);
            return local_capability_response(request.request_id, result);
        }

        if request.command == "capability.local-mcp.invoke" {
            return local_capability_response(
                request.request_id,
                invoke_local_mcp_supervisor_command(request.payload),
            );
        }

        if is_message_cache_command(&request.command) {
            return match self.message_cache.handle(&request.command, request.payload) {
                Ok(result) => success_response(request.request_id, result, false),
                Err(error) => error_response(request.request_id, error.code),
            };
        }

        if request.payload.is_some() {
            return error_response(request.request_id, "INVALID_COMMAND_PAYLOAD");
        }
        match request.command.as_str() {
            "hello" => success_response(
                request.request_id,
                json!({
                    "protocol_version": PROTOCOL_VERSION,
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "pid": std::process::id(),
                    "capabilities": [
                        "health",
                        "shutdown",
                        MESSAGE_CACHE_CAPABILITY,
                        LOCAL_CAPABILITY_SUPERVISOR_CAPABILITY,
                        CLIENT_LOCAL_WORKSPACE_WRITE_SUPERVISOR_CAPABILITY
                    ],
                    "authentication": "per_launch_token"
                }),
                false,
            ),
            "health" => success_response(
                request.request_id,
                json!({
                    "status": "ok",
                    "uptime_ms": self.started_at.elapsed().as_millis()
                }),
                false,
            ),
            "shutdown" => success_response(
                request.request_id,
                json!({ "status": "shutting_down" }),
                true,
            ),
            _ => error_response(request.request_id, "UNKNOWN_COMMAND"),
        }
    }
}

fn local_file_and_process_capabilities()
-> (LocalFileCapabilityService, LocalProcessCapabilityService) {
    let grant_registry = SharedFileGrantRegistry::new();
    (
        LocalFileCapabilityService::with_shared_grants(grant_registry.clone()),
        LocalProcessCapabilityService::with_shared_file_grants(grant_registry),
    )
}

fn local_capability_response(
    request_id: String,
    result: Result<serde_json::Value, LocalCapabilityError>,
) -> ProcessedRequest {
    match result {
        Ok(value) => success_response(request_id, value, false),
        Err(error) => error_response(request_id, error.code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    fn request(command: &str, token: &str, payload: Option<Value>) -> Vec<u8> {
        let mut value = json!({
            "protocol_version": PROTOCOL_VERSION,
            "request_id": "request-1",
            "auth_token": token,
            "command": command
        });
        if let Some(payload) = payload {
            value["payload"] = payload;
        }
        serde_json::to_vec(&value).expect("request fixture must serialize")
    }

    fn process(
        runtime: &mut SupervisorRuntime,
        command: &str,
        payload: Option<Value>,
    ) -> ProcessedRequest {
        runtime.process_request_line(&request(command, TOKEN, payload), TOKEN)
    }

    #[test]
    fn authenticated_local_mcp_time_command_rejects_unconfirmed_and_non_allowlisted_payloads() {
        let mut runtime = SupervisorRuntime::new();
        let denied = process(
            &mut runtime,
            "capability.local-mcp.invoke",
            Some(json!({
                "operation_id": "local-mcp-time-2",
                "tool": "time",
                "confirmed": false,
            })),
        );
        assert_eq!(
            denied.response.error.expect("confirmation error").code,
            "LOCAL_MCP_CONFIRMATION_REQUIRED"
        );

        let malformed = process(
            &mut runtime,
            "capability.local-mcp.invoke",
            Some(json!({
                "operation_id": "local-mcp-time-3",
                "tool": "sequential-thinking",
                "confirmed": true,
            })),
        );
        assert_eq!(
            malformed.response.error.expect("allowlist error").code,
            "LOCAL_MCP_TOOL_NOT_ALLOWLISTED"
        );
    }

    fn local_file_scope() -> Value {
        json!({
            "tenant_id": "tenant-1",
            "session_id": "session-1",
            "run_id": "run-1"
        })
    }

    fn file_grant_payload(root: &std::path::Path, expires_at_ms: u64) -> Value {
        json!({
            "protocol_version": "aistaff.local-capability.v1",
            "operation_id": "11111111-1111-4111-8111-111111111111",
            "grant_handle": "22222222-2222-4222-8222-222222222222",
            "grant_revision": "33333333-3333-4333-8333-333333333333",
            "scope": local_file_scope(),
            "root_path": root.to_str().expect("utf-8 root"),
            "access": "read_only",
            "allowed_intents": ["read_file"],
            "source": "system_directory_picker",
            "expires_at_ms": expires_at_ms
        })
    }

    fn file_path_payload() -> Value {
        json!({
            "protocol_version": "aistaff.local-capability.v1",
            "operation_id": "44444444-4444-4444-8444-444444444444",
            "grant_handle": "22222222-2222-4222-8222-222222222222",
            "expected_grant_revision": "33333333-3333-4333-8333-333333333333",
            "scope": local_file_scope(),
            "intent": "read_file",
            "relative_segments": ["private.txt"],
            "max_bytes": 1024
        })
    }

    fn file_execution_payload(path_request: Value, descriptor: &str, expires_at_ms: u64) -> Value {
        json!({
            "protocol_version": "aistaff.local-capability.v1",
            "capability_request": {
                "protocol_version": "aistaff.local-capability.v1",
                "scope": local_file_scope(),
                "authorization": {
                    "tenant_id": "tenant-1",
                    "source_decision_id": "decision-1",
                    "outcome": "allow",
                    "action_id": "local.file.read",
                    "capability_id": "file.read",
                    "resource_revision": "revision-1",
                    "policy_revision": "policy-1",
                    "audit_ref": "audit-1",
                    "expires_at_ms": expires_at_ms
                },
                "artifact": {
                    "artifact_id": "artifact-1",
                    "artifact_version": "1.0.0",
                    "artifact_sha256": "a".repeat(64),
                    "admission_status": "verified"
                },
                "operation": {
                    "operation_id": "44444444-4444-4444-8444-444444444444",
                    "idempotency_key": "55555555-5555-4555-8555-555555555555",
                    "action_id": "local.file.read",
                    "capability_id": "file.read",
                    "expected_revision": "revision-1",
                    "adapter_kind": "file",
                    "side_effect": "read_only",
                    "risk_level": "low",
                    "descriptor_hash": descriptor,
                    "confirmation": "not_required"
                }
            },
            "path_request": path_request,
            "expected_target_descriptor_hash": descriptor
        })
    }

    #[test]
    fn authenticated_hello_returns_owned_protocol_metadata() {
        let mut runtime = SupervisorRuntime::new();
        let processed = process(&mut runtime, "hello", None);

        assert!(processed.response.ok);
        assert!(!processed.should_shutdown);
        let result = processed.response.result.expect("hello result");
        assert_eq!(result["protocol_version"], PROTOCOL_VERSION);
        assert_eq!(result["authentication"], "per_launch_token");
        assert_eq!(
            result["capabilities"],
            json!([
                "health",
                "shutdown",
                "message_cache.v1",
                "local_capability_broker.v1",
                "client_local_workspace_write.v1"
            ])
        );
    }

    #[test]
    fn authenticated_local_capability_command_is_policy_only() {
        let mut runtime = SupervisorRuntime::new();
        let processed = process(&mut runtime, "capability.capabilities", None);

        assert!(processed.response.ok);
        let result = processed.response.result.expect("capabilities");
        assert_eq!(result["availability"], "policy_only");
        assert_eq!(result["execution_enabled"], false);
    }

    #[test]
    fn authenticated_file_grant_registration_keeps_path_private() {
        let root = std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join(format!("local-file-router-test-{}", std::process::id()));
        if root.exists() {
            std::fs::remove_dir_all(&root).expect("clean exact root");
        }
        std::fs::create_dir_all(&root).expect("create root");
        std::fs::write(root.join("private.txt"), b"must-not-be-read").expect("fixture");
        let expires_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_millis() as u64
            + 60_000;
        let mut runtime = SupervisorRuntime::new();
        let processed = process(
            &mut runtime,
            "capability.file.grant.register",
            Some(file_grant_payload(&root, expires_at_ms)),
        );

        assert!(processed.response.ok);
        let serialized = serde_json::to_string(&processed.response).expect("response");
        assert!(!serialized.contains(root.to_str().expect("root")));
        assert_eq!(
            processed.response.result.expect("result")["execution_enabled"],
            false
        );

        let path_request = file_path_payload();
        let admitted = process(
            &mut runtime,
            "capability.file.path.admit",
            Some(path_request.clone()),
        );
        let descriptor = admitted.response.result.expect("admission")["target_descriptor_hash"]
            .as_str()
            .expect("descriptor")
            .to_owned();
        let execution = process(
            &mut runtime,
            "capability.file.read",
            Some(file_execution_payload(
                path_request,
                &descriptor,
                expires_at_ms,
            )),
        );
        assert_eq!(
            execution.response.error,
            Some(ErrorBody {
                code: "LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED"
            })
        );
        let execution_json = serde_json::to_string(&execution.response).expect("response");
        assert!(!execution_json.contains("must-not-be-read"));
        assert!(!execution_json.contains(root.to_str().expect("root")));
        drop(runtime);
        std::fs::remove_dir_all(&root).expect("remove exact root");
    }

    #[test]
    fn rejects_invalid_auth_without_echoing_secret() {
        let mut runtime = SupervisorRuntime::new();
        let processed =
            runtime.process_request_line(&request("health", "wrong-token", None), TOKEN);
        let serialized = serde_json::to_string(&processed.response).expect("response");

        assert_eq!(
            processed.response.error,
            Some(ErrorBody {
                code: "UNAUTHORIZED"
            })
        );
        assert!(!serialized.contains(TOKEN));
        assert!(!serialized.contains("wrong-token"));
    }

    #[test]
    fn rejects_protocol_downgrade() {
        let line = serde_json::to_vec(&json!({
            "protocol_version": "aistaff.desktop-supervisor.v0",
            "request_id": "request-2",
            "auth_token": TOKEN,
            "command": "health"
        }))
        .expect("fixture");
        let mut runtime = SupervisorRuntime::new();
        let processed = runtime.process_request_line(&line, TOKEN);

        assert_eq!(
            processed.response.error,
            Some(ErrorBody {
                code: "PROTOCOL_MISMATCH"
            })
        );
    }

    #[test]
    fn rejects_unknown_fields_commands_and_base_payload() {
        let unknown_field = serde_json::to_vec(&json!({
            "protocol_version": PROTOCOL_VERSION,
            "request_id": "request-3",
            "auth_token": TOKEN,
            "command": "health",
            "tenant_id": "forbidden"
        }))
        .expect("fixture");
        let mut runtime = SupervisorRuntime::new();
        assert_eq!(
            runtime
                .process_request_line(&unknown_field, TOKEN)
                .response
                .error,
            Some(ErrorBody {
                code: "INVALID_REQUEST"
            })
        );
        assert_eq!(
            process(&mut runtime, "shell", None).response.error,
            Some(ErrorBody {
                code: "UNKNOWN_COMMAND"
            })
        );
        assert_eq!(
            process(&mut runtime, "health", Some(json!({})))
                .response
                .error,
            Some(ErrorBody {
                code: "INVALID_COMMAND_PAYLOAD"
            })
        );
    }

    #[test]
    fn shutdown_is_explicit_and_authenticated() {
        let mut runtime = SupervisorRuntime::new();
        let processed = process(&mut runtime, "shutdown", None);

        assert!(processed.response.ok);
        assert!(processed.should_shutdown);
    }

    #[test]
    fn rejects_oversized_request() {
        let oversized = vec![b'a'; MAX_LINE_BYTES + 1];
        let mut runtime = SupervisorRuntime::new();
        let processed = runtime.process_request_line(&oversized, TOKEN);

        assert_eq!(
            processed.response.error,
            Some(ErrorBody {
                code: "REQUEST_TOO_LARGE"
            })
        );
    }
}
