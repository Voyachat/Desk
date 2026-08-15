use super::{MemoryMessageCacheAdapter, MessageCacheService};
use crate::{ErrorBody, PROTOCOL_VERSION, ProcessedRequest, SupervisorRuntime};
use serde_json::{Value, json};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";
const SCOPE_A: &str = "11111111-1111-4111-8111-111111111111";
const SCOPE_B: &str = "22222222-2222-4222-8222-222222222222";
const OPERATION_A: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION_B: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

fn request(command: &str, payload: Option<Value>) -> Vec<u8> {
    let mut value = json!({
        "protocol_version": PROTOCOL_VERSION,
        "request_id": "cache-request-1",
        "auth_token": TOKEN,
        "command": command
    });
    if let Some(payload) = payload {
        value["payload"] = payload;
    }
    serde_json::to_vec(&value).expect("cache request fixture")
}

fn projection(thread_id: &str, sequence: u64) -> Value {
    json!({
        "thread_id": thread_id,
        "sequence": sequence,
        "event_type": "message.created",
        "actor_type": "user",
        "occurred_at": "2026-07-29T08:00:00.000Z",
        "masked_summary": "Masked fixture summary",
        "payload_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "run_id": null,
        "server_cursor": format!("cursor-{sequence}"),
        "delivery_state": "confirmed",
        "redaction_profile": "summary_only.v1"
    })
}

fn local_history_projection(
    conversation_id: &str,
    operation_id: &str,
    provider_identity_digest: &str,
    status: &str,
) -> Value {
    let (reason_code, result) = match status {
        "processing" => (Value::Null, Value::Null),
        "completed" => (
            Value::Null,
            json!({
                "turn_count": 1,
                "reasoning_observed": false,
                "tool_call_count": 0,
                "tool_execution": false,
                "filesystem_execution": false
            }),
        ),
        _ => panic!("unsupported local history status fixture"),
    };
    json!({
        "schema_revision": 1,
        "origin": "client_local",
        "server_scope_consumed": false,
        "task_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "conversation_id": conversation_id,
        "operation_id": operation_id,
        "mode": "ask",
        "status": status,
        "reason_code": reason_code,
        "title": "bounded local task",
        "updated_at_epoch_ms": 1_786_489_200_000_u64,
        "provider_identity_digest": provider_identity_digest,
        "context_restore_required": false,
        "messages": [{ "sequence": 1, "role": "user", "text": "question" }],
        "result": result
    })
}

fn memory_runtime() -> SupervisorRuntime {
    SupervisorRuntime::with_message_cache(Box::new(MessageCacheService::new(
        MemoryMessageCacheAdapter::default(),
    )))
}

fn process(
    runtime: &mut SupervisorRuntime,
    command: &str,
    payload: Option<Value>,
) -> ProcessedRequest {
    runtime.process_request_line(&request(command, payload), TOKEN)
}

#[test]
fn production_cache_capability_fails_closed_without_wcdb() {
    let mut runtime = SupervisorRuntime::new();
    let capabilities = process(&mut runtime, "cache.capabilities", None);

    assert!(capabilities.response.ok);
    let result = capabilities.response.result.expect("capabilities");
    assert_eq!(result["availability"], "adapter_unavailable");
    assert_eq!(result["persistent"], false);
    assert!(matches!(
        result["reason_code"].as_str(),
        Some("CACHE_WORKER_UNAVAILABLE")
            | Some("WCDB_NATIVE_PACKAGE_MISSING")
            | Some("WCDB_NATIVE_PACKAGE_NOT_ADMITTED")
            | Some("WCDB_NATIVE_ABI_REJECTED")
            | Some("WCDB_ADAPTER_NOT_IMPLEMENTED")
    ));

    let open = process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    assert_eq!(
        open.response.error,
        Some(ErrorBody {
            code: "CACHE_ADAPTER_UNAVAILABLE"
        })
    );
}

#[test]
fn production_local_history_fails_closed_without_v2_wcdb_and_key_provider() {
    let mut runtime = SupervisorRuntime::new();
    let snapshot = process(
        &mut runtime,
        "cache.local_history.snapshot",
        Some(json!({
            "scope_handle": SCOPE_A,
            "provider_identity_digest": "a".repeat(64),
            "limit": 8
        })),
    );
    assert_eq!(
        snapshot.response.error,
        Some(ErrorBody {
            code: "CACHE_ADAPTER_UNAVAILABLE"
        })
    );
}

#[test]
fn memory_fixture_interrupts_processing_and_isolates_provider_history() {
    let mut runtime = memory_runtime();
    assert!(
        process(
            &mut runtime,
            "cache.open_scope",
            Some(json!({ "scope_handle": SCOPE_A }))
        )
        .response
        .ok
    );
    let provider_a = "a".repeat(64);
    let provider_b = "b".repeat(64);
    let conversation_a = "44444444-4444-4444-8444-444444444444";
    let conversation_b = "55555555-5555-4555-8555-555555555555";
    let operation_a = "66666666-6666-4666-8666-666666666666";
    let operation_b = "77777777-7777-4777-8777-777777777777";
    for (conversation, operation, provider, status) in [
        (
            conversation_a,
            operation_a,
            provider_a.as_str(),
            "processing",
        ),
        (
            conversation_b,
            operation_b,
            provider_b.as_str(),
            "completed",
        ),
    ] {
        assert!(
            process(
                &mut runtime,
                "cache.local_history.put",
                Some(json!({
                    "scope_handle": SCOPE_A,
                    "operation_id": operation,
                    "projection": local_history_projection(
                        conversation,
                        operation,
                        provider,
                        status
                    )
                }))
            )
            .response
            .ok
        );
    }
    let snapshot = process(
        &mut runtime,
        "cache.local_history.snapshot",
        Some(json!({
            "scope_handle": SCOPE_A,
            "provider_identity_digest": provider_a,
            "limit": 8
        })),
    );
    let result = snapshot.response.result.expect("local history snapshot");
    assert_eq!(result["interrupted_count"], 1);
    let projections = result["projections"].as_array().expect("projections");
    assert_eq!(projections.len(), 1);
    assert_eq!(projections[0]["conversation_id"], conversation_a);
    assert_eq!(projections[0]["status"], "interrupted");
    assert_eq!(projections[0]["reason_code"], "CLIENT_RESTART_INTERRUPTED");
}

#[test]
fn memory_fixture_releases_local_history_without_server_timeline_fields() {
    let mut runtime = memory_runtime();
    process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    let conversation = "44444444-4444-4444-8444-444444444444";
    let operation = "66666666-6666-4666-8666-666666666666";
    let release_operation = "88888888-8888-4888-8888-888888888888";
    process(
        &mut runtime,
        "cache.local_history.put",
        Some(json!({
            "scope_handle": SCOPE_A,
            "operation_id": operation,
            "projection": local_history_projection(
                conversation,
                operation,
                &"a".repeat(64),
                "completed"
            )
        })),
    );
    let released = process(
        &mut runtime,
        "cache.local_history.release",
        Some(json!({
            "scope_handle": SCOPE_A,
            "operation_id": release_operation,
            "conversation_id": conversation,
            "confirmed": true
        })),
    );
    assert_eq!(
        released.response.result.expect("released")["released"],
        true
    );
    let snapshot = process(
        &mut runtime,
        "cache.local_history.snapshot",
        Some(json!({
            "scope_handle": SCOPE_A,
            "provider_identity_digest": "a".repeat(64),
            "limit": 8
        })),
    );
    assert_eq!(
        snapshot.response.result.expect("empty")["projections"],
        json!([])
    );
}

#[test]
fn memory_fixture_bounds_local_history_to_eight_recent_conversations() {
    let mut runtime = memory_runtime();
    process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    let provider = "a".repeat(64);
    let mut oldest = String::new();
    for index in 1_u64..=9 {
        let conversation = format!("44444444-4444-4444-8444-{index:012x}");
        let model_operation = format!("66666666-6666-4666-8666-{index:012x}");
        let cache_operation = format!("99999999-9999-4999-8999-{index:012x}");
        if index == 1 {
            oldest.clone_from(&conversation);
        }
        let mut projection =
            local_history_projection(&conversation, &model_operation, &provider, "completed");
        projection["updated_at_epoch_ms"] = json!(1_786_489_200_000_u64 + index);
        assert!(
            process(
                &mut runtime,
                "cache.local_history.put",
                Some(json!({
                    "scope_handle": SCOPE_A,
                    "operation_id": cache_operation,
                    "projection": projection
                }))
            )
            .response
            .ok
        );
    }
    let snapshot = process(
        &mut runtime,
        "cache.local_history.snapshot",
        Some(json!({
            "scope_handle": SCOPE_A,
            "provider_identity_digest": provider,
            "limit": 8
        })),
    );
    let projections = snapshot.response.result.expect("snapshot")["projections"]
        .as_array()
        .expect("projections")
        .to_owned();
    assert_eq!(projections.len(), 8);
    assert!(
        projections
            .iter()
            .all(|projection| projection["conversation_id"] != oldest)
    );
}

#[test]
fn memory_fixture_supports_confirmed_projection_and_reconcile() {
    let mut runtime = memory_runtime();
    assert!(
        process(
            &mut runtime,
            "cache.open_scope",
            Some(json!({ "scope_handle": SCOPE_A }))
        )
        .response
        .ok
    );
    let put_payload = json!({
        "scope_handle": SCOPE_A,
        "operation_id": OPERATION_A,
        "projection": projection("session-1", 1)
    });
    let put = process(
        &mut runtime,
        "cache.put_confirmed",
        Some(put_payload.clone()),
    );
    assert!(put.response.ok);
    assert_eq!(
        put.response.result.as_ref().expect("put")["idempotency_replayed"],
        false
    );
    let replay = process(&mut runtime, "cache.put_confirmed", Some(put_payload));
    assert_eq!(
        replay.response.result.expect("replay")["idempotency_replayed"],
        true
    );

    let page = process(
        &mut runtime,
        "cache.page",
        Some(json!({
            "scope_handle": SCOPE_A,
            "thread_id": "session-1",
            "after_sequence": null,
            "limit": 20
        })),
    );
    assert_eq!(
        page.response.result.as_ref().expect("page")["projections"]
            .as_array()
            .expect("projections")
            .len(),
        1
    );

    let reconcile = process(
        &mut runtime,
        "cache.reconcile",
        Some(json!({
            "scope_handle": SCOPE_A,
            "thread_id": "session-1",
            "server_last_sequence": 1,
            "server_cursor": "cursor-1",
            "side_effect_state": "known"
        })),
    );
    assert_eq!(
        reconcile.response.result.expect("reconcile")["decision"],
        "use_cache"
    );
}

#[test]
fn memory_fixture_isolates_scopes_and_rejects_regression() {
    let mut runtime = memory_runtime();
    for scope in [SCOPE_A, SCOPE_B] {
        assert!(
            process(
                &mut runtime,
                "cache.open_scope",
                Some(json!({ "scope_handle": scope }))
            )
            .response
            .ok
        );
    }
    assert!(
        process(
            &mut runtime,
            "cache.put_confirmed",
            Some(json!({
                "scope_handle": SCOPE_A,
                "operation_id": OPERATION_A,
                "projection": projection("session-1", 2)
            }))
        )
        .response
        .ok
    );
    let other_scope_page = process(
        &mut runtime,
        "cache.page",
        Some(json!({
            "scope_handle": SCOPE_B,
            "thread_id": "session-1",
            "after_sequence": null,
            "limit": 20
        })),
    );
    assert_eq!(
        other_scope_page.response.result.expect("page")["projections"],
        json!([])
    );
    let regression = process(
        &mut runtime,
        "cache.put_confirmed",
        Some(json!({
            "scope_handle": SCOPE_A,
            "operation_id": OPERATION_B,
            "projection": projection("session-1", 1)
        })),
    );
    assert_eq!(
        regression.response.error,
        Some(ErrorBody {
            code: "CACHE_SEQUENCE_REGRESSION"
        })
    );
}

#[test]
fn memory_fixture_purge_is_idempotent_and_revokes_old_scope() {
    let mut runtime = memory_runtime();
    process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    let purge_payload = json!({
        "scope_handle": SCOPE_A,
        "operation_id": OPERATION_A,
        "confirmed": true
    });
    let purge = process(
        &mut runtime,
        "cache.purge_scope",
        Some(purge_payload.clone()),
    );
    assert_eq!(
        purge.response.result.as_ref().expect("purge")["idempotency_replayed"],
        false
    );
    let replay = process(&mut runtime, "cache.purge_scope", Some(purge_payload));
    assert_eq!(
        replay.response.result.expect("replay")["idempotency_replayed"],
        true
    );
    let reopen = process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    assert_eq!(
        reopen.response.error,
        Some(ErrorBody {
            code: "CACHE_SCOPE_REVOKED"
        })
    );
}

#[test]
fn cache_rejects_forged_fields_unconfirmed_data_and_unknown_side_effects() {
    let mut runtime = memory_runtime();
    process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({ "scope_handle": SCOPE_A })),
    );
    let forged_scope = process(
        &mut runtime,
        "cache.open_scope",
        Some(json!({
            "scope_handle": SCOPE_B,
            "tenant_id": "forbidden",
            "database_path": "/tmp/forbidden",
            "sql": "select *"
        })),
    );
    assert_eq!(
        forged_scope.response.error,
        Some(ErrorBody {
            code: "INVALID_CACHE_COMMAND_PAYLOAD"
        })
    );

    let mut pending_projection = projection("session-1", 1);
    pending_projection["delivery_state"] = json!("pending");
    let pending = process(
        &mut runtime,
        "cache.put_confirmed",
        Some(json!({
            "scope_handle": SCOPE_A,
            "operation_id": OPERATION_A,
            "projection": pending_projection
        })),
    );
    assert_eq!(
        pending.response.error,
        Some(ErrorBody {
            code: "CACHE_PROJECTION_NOT_CONFIRMED"
        })
    );

    let path_like_thread = process(
        &mut runtime,
        "cache.put_confirmed",
        Some(json!({
            "scope_handle": SCOPE_A,
            "operation_id": OPERATION_B,
            "projection": projection("../other-scope", 1)
        })),
    );
    assert_eq!(
        path_like_thread.response.error,
        Some(ErrorBody {
            code: "INVALID_CACHE_THREAD_ID"
        })
    );

    let unknown = process(
        &mut runtime,
        "cache.reconcile",
        Some(json!({
            "scope_handle": SCOPE_A,
            "thread_id": "session-1",
            "server_last_sequence": 0,
            "server_cursor": null,
            "side_effect_state": "unknown"
        })),
    );
    assert_eq!(
        unknown.response.result.expect("unknown")["decision"],
        "reconcile_required"
    );
}
