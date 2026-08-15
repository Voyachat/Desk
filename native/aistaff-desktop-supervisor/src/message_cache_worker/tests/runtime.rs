use super::*;
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, PageInput, PurgeScopeInput,
    PutConfirmedInput, RedactionProfile,
};
use crate::message_cache_worker::{
    CACHE_CIPHER_KEY_BYTES, CacheClockError, CacheClockPort, CacheKeyProviderError, CacheScopeKey,
    EncryptedScopeDriverError, EncryptedScopeIntegrity, EncryptedScopeMutationResult,
    EncryptedScopeOpenContext, EncryptedScopeOpenResult, EncryptedScopePage,
    WorkerAdapterAvailability,
};
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_TOKEN: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const SCOPE: &str = "11111111-1111-4111-8111-111111111111";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestKeyProvider {
    revoke_calls: Rc<Cell<usize>>,
}

impl CacheKeyProviderPort for TestKeyProvider {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        CacheScopeKey::new(vec![0x42; CACHE_CIPHER_KEY_BYTES])
    }

    fn revoke_scope(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        assert_eq!(scope_handle, SCOPE);
        self.revoke_calls.set(self.revoke_calls.get() + 1);
        Ok(())
    }
}

struct TestDriver {
    path: Rc<RefCell<Option<PathBuf>>>,
    open_calls: Rc<Cell<usize>>,
    close_calls: Rc<Cell<usize>>,
    fail_close: bool,
}

#[derive(Clone)]
struct FixedClock {
    now: Rc<Cell<i64>>,
}

impl CacheClockPort for FixedClock {
    fn now_epoch_seconds(&self) -> Result<i64, CacheClockError> {
        Ok(self.now.get())
    }
}

#[derive(Default)]
struct CrudState {
    put_hashes: Vec<[u8; 32]>,
    put_times: Vec<(i64, i64)>,
    purge_hashes: Vec<[u8; 32]>,
    projection: Option<ConfirmedTimelineProjection>,
    close_calls: usize,
}

struct CrudDriver {
    state: Rc<RefCell<CrudState>>,
    unknown_put: bool,
}

impl EncryptedScopeDriver for CrudDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        WorkerAdapterAvailability::Available
    }

    fn adapter_id(&self) -> &'static str {
        "test.wcdb"
    }

    fn open_scope(
        &mut self,
        _database_path: &Path,
        _cipher_key: &[u8],
        context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        assert_eq!(context.now_epoch_s, 1_000);
        assert_eq!(
            context.retention,
            CacheRetentionPolicy {
                retention_seconds: 100,
                sweep_limit: 20,
            }
        );
        Ok(EncryptedScopeOpenResult { reopened: false })
    }

    fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
        request_hash: &[u8; 32],
        confirmed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        let mut state = self.state.borrow_mut();
        state.put_hashes.push(*request_hash);
        state
            .put_times
            .push((confirmed_at_epoch_s, expires_at_epoch_s));
        if self.unknown_put {
            return Err(EncryptedScopeDriverError::new(
                "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED",
            ));
        }
        state.projection = Some(input.projection.clone());
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: state.put_hashes.len() > 1,
        })
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        Ok(EncryptedScopeIntegrity::Healthy)
    }

    fn page(
        &mut self,
        _input: &PageInput,
        now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        assert_eq!(now_epoch_s, 1_000);
        let projections = self
            .state
            .borrow()
            .projection
            .clone()
            .into_iter()
            .collect::<Vec<_>>();
        Ok(EncryptedScopePage {
            next_after_sequence: projections.last().map(|item| item.sequence),
            projections,
            has_more: false,
        })
    }

    fn purge_scope(
        &mut self,
        _input: &PurgeScopeInput,
        request_hash: &[u8; 32],
        committed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        assert_eq!((committed_at_epoch_s, expires_at_epoch_s), (1_000, 1_100));
        let mut state = self.state.borrow_mut();
        state.purge_hashes.push(*request_hash);
        state.projection = None;
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: false,
        })
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        self.state.borrow_mut().close_calls += 1;
        Ok(())
    }
}

impl EncryptedScopeDriver for TestDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        WorkerAdapterAvailability::Available
    }

    fn adapter_id(&self) -> &'static str {
        "test.wcdb"
    }

    fn open_scope(
        &mut self,
        database_path: &Path,
        cipher_key: &[u8],
        context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        assert_eq!(cipher_key, &[0x42; CACHE_CIPHER_KEY_BYTES]);
        assert!(context.now_epoch_s > 0);
        assert_eq!(context.retention, CacheRetentionPolicy::default());
        self.open_calls.set(self.open_calls.get() + 1);
        self.path.replace(Some(database_path.to_path_buf()));
        Ok(EncryptedScopeOpenResult { reopened: false })
    }

    fn put_confirmed(
        &mut self,
        _input: &PutConfirmedInput,
        _request_hash: &[u8; 32],
        _confirmed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: false,
        })
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        Ok(EncryptedScopeIntegrity::Healthy)
    }

    fn page(
        &mut self,
        _input: &PageInput,
        _now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        Ok(EncryptedScopePage {
            projections: Vec::new(),
            next_after_sequence: None,
            has_more: false,
        })
    }

    fn purge_scope(
        &mut self,
        _input: &PurgeScopeInput,
        _request_hash: &[u8; 32],
        _committed_at_epoch_s: i64,
        _expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        Ok(EncryptedScopeMutationResult {
            idempotency_replayed: false,
        })
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        self.close_calls.set(self.close_calls.get() + 1);
        if self.fail_close {
            Err(EncryptedScopeDriverError::new("WCDB_NATIVE_CLOSE_UNKNOWN"))
        } else {
            Ok(())
        }
    }
}

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join("worker-tests")
        .join(format!("{label}-{}-{sequence}", std::process::id()))
}

fn remove_test_root(root: &Path) {
    if root.exists() {
        std::fs::remove_dir_all(root).expect("remove exact test root");
    }
}

fn frame(sequence: u64, token: &str, command: &str, payload: Option<Value>) -> Vec<u8> {
    let mut request = json!({
        "protocol_version": MESSAGE_CACHE_WORKER_PROTOCOL_VERSION,
        "request_id": format!("request-{sequence}"),
        "sequence": sequence,
        "auth_token": token,
        "command": command
    });
    if let Some(payload) = payload {
        request["payload"] = payload;
    }
    serde_json::to_vec(&request).expect("request")
}

fn projection() -> ConfirmedTimelineProjection {
    ConfirmedTimelineProjection {
        thread_id: "thread:fixture".to_owned(),
        sequence: 1,
        event_type: "message.confirmed".to_owned(),
        actor_type: ActorType::User,
        occurred_at: "2026-07-29T00:00:00Z".to_owned(),
        masked_summary: "summary".to_owned(),
        payload_hash: "a".repeat(64),
        run_id: Some("run:fixture".to_owned()),
        server_cursor: Some("cursor:fixture".to_owned()),
        delivery_state: DeliveryState::Confirmed,
        redaction_profile: RedactionProfile::SummaryOnlyV1,
    }
}

fn bootstrap<K: CacheKeyProviderPort, D: EncryptedScopeDriver, C: CacheClockPort>(
    runtime: &mut MessageCacheWorkerRuntime<K, D, C>,
    root: &Path,
) -> ProcessedWorkerRequest {
    runtime.process_request_line(&frame(
        0,
        TOKEN,
        "worker.hello",
        Some(json!({ "cache_root": root })),
    ))
}

type CrudRuntime = MessageCacheWorkerRuntime<TestKeyProvider, CrudDriver, FixedClock>;

fn crud_runtime(
    state: &Rc<RefCell<CrudState>>,
    revoke_calls: &Rc<Cell<usize>>,
    unknown_put: bool,
) -> CrudRuntime {
    MessageCacheWorkerRuntime::with_clock(
        TestKeyProvider {
            revoke_calls: Rc::clone(revoke_calls),
        },
        CrudDriver {
            state: Rc::clone(state),
            unknown_put,
        },
        FixedClock {
            now: Rc::new(Cell::new(1_000)),
        },
        CacheRetentionPolicy {
            retention_seconds: 100,
            sweep_limit: 20,
        },
    )
}

fn open_crud_scope(runtime: &mut CrudRuntime, root: &Path) {
    assert!(bootstrap(runtime, root).response.ok);
    assert!(
        runtime
            .process_request_line(&frame(
                1,
                TOKEN,
                "scope.open",
                Some(json!({ "scope_handle": SCOPE })),
            ))
            .response
            .ok
    );
}

fn exercise_put_replay(runtime: &mut CrudRuntime) {
    let put_payload = json!({
        "scope_handle": SCOPE,
        "operation_id": "22222222-2222-4222-8222-222222222222",
        "projection": projection()
    });
    let first = runtime.process_request_line(&frame(
        2,
        TOKEN,
        "scope.put_confirmed",
        Some(put_payload.clone()),
    ));
    let replayed =
        runtime.process_request_line(&frame(3, TOKEN, "scope.put_confirmed", Some(put_payload)));
    assert_eq!(
        first.response.result.expect("first put")["idempotency_replayed"],
        false
    );
    assert_eq!(
        replayed.response.result.expect("replayed put")["idempotency_replayed"],
        true
    );
}

fn exercise_page_and_purge(runtime: &mut CrudRuntime) {
    let page = runtime.process_request_line(&frame(
        4,
        TOKEN,
        "scope.page",
        Some(json!({
            "scope_handle": SCOPE,
            "thread_id": "thread:fixture",
            "after_sequence": null,
            "limit": 10
        })),
    ));
    let page_result = page.response.result.expect("page");
    assert_eq!(page_result["projections"][0]["sequence"], 1);
    assert_eq!(page_result["next_after_sequence"], 1);

    let purge = runtime.process_request_line(&frame(
        5,
        TOKEN,
        "scope.purge",
        Some(json!({
            "scope_handle": SCOPE,
            "operation_id": "33333333-3333-4333-8333-333333333333",
            "confirmed": true
        })),
    ));
    assert!(purge.response.ok);
    assert!(purge.should_shutdown);
    assert_eq!(purge.response.result.expect("purge")["purged"], true);
}

#[test]
fn worker_bootstrap_open_and_close_keep_scope_path_and_key_private() {
    let root = test_root("runtime");
    let path = Rc::new(RefCell::new(None));
    let open_calls = Rc::new(Cell::new(0));
    let close_calls = Rc::new(Cell::new(0));
    let revoke_calls = Rc::new(Cell::new(0));
    let mut runtime = MessageCacheWorkerRuntime::new(
        TestKeyProvider {
            revoke_calls: Rc::clone(&revoke_calls),
        },
        TestDriver {
            path: Rc::clone(&path),
            open_calls: Rc::clone(&open_calls),
            close_calls: Rc::clone(&close_calls),
            fail_close: false,
        },
    );

    let hello = bootstrap(&mut runtime, &root);
    assert!(hello.response.ok);
    assert_eq!(
        hello.response.result.as_ref().expect("hello")["native_adapter"],
        "available"
    );
    let opened = runtime.process_request_line(&frame(
        1,
        TOKEN,
        "scope.open",
        Some(json!({ "scope_handle": SCOPE })),
    ));
    assert!(opened.response.ok);
    assert!(!opened.should_shutdown);
    let serialized = serde_json::to_string(&opened.response).expect("response");
    assert!(!serialized.contains(TOKEN));
    assert!(!serialized.contains(SCOPE));
    let database_path = path.borrow().clone().expect("database path");
    let canonical_root = root.canonicalize().expect("canonical root");
    assert_eq!(
        database_path
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent),
        Some(canonical_root.as_path())
    );
    assert_eq!(
        database_path.file_name().and_then(|value| value.to_str()),
        Some("cache.db")
    );
    assert!(!database_path.to_string_lossy().contains(SCOPE));
    assert_eq!(open_calls.get(), 1);

    let closed = runtime.process_request_line(&frame(
        2,
        TOKEN,
        "scope.close",
        Some(json!({ "scope_handle": SCOPE })),
    ));
    assert!(closed.response.ok);
    assert!(closed.should_shutdown);
    assert_eq!(close_calls.get(), 1);
    assert_eq!(revoke_calls.get(), 1);
    remove_test_root(&root);
}

#[test]
fn worker_replay_or_wrong_token_fails_closed_without_echoing_token() {
    let root = test_root("auth");
    let mut runtime = MessageCacheWorkerRuntime::new(
        UnavailableCacheKeyProvider,
        UnavailableEncryptedScopeDriver,
    );
    assert!(bootstrap(&mut runtime, &root).response.ok);
    let replay = runtime.process_request_line(&frame(0, TOKEN, "worker.shutdown", None));
    assert!(replay.should_shutdown);
    assert_eq!(
        replay.response.error.expect("error").code,
        "WORKER_SEQUENCE_MISMATCH"
    );

    let mut runtime = MessageCacheWorkerRuntime::new(
        UnavailableCacheKeyProvider,
        UnavailableEncryptedScopeDriver,
    );
    assert!(bootstrap(&mut runtime, &root).response.ok);
    let rejected = runtime.process_request_line(&frame(1, OTHER_TOKEN, "worker.shutdown", None));
    let serialized = serde_json::to_string(&rejected.response).expect("response");
    assert!(rejected.should_shutdown);
    assert_eq!(
        rejected.response.error.expect("error").code,
        "WORKER_UNAUTHORIZED"
    );
    assert!(!serialized.contains(TOKEN));
    assert!(!serialized.contains(OTHER_TOKEN));
    remove_test_root(&root);
}

#[test]
fn unknown_close_outcome_is_not_retried_and_forces_worker_exit() {
    let root = test_root("unknown-close");
    let close_calls = Rc::new(Cell::new(0));
    let revoke_calls = Rc::new(Cell::new(0));
    let mut runtime = MessageCacheWorkerRuntime::new(
        TestKeyProvider {
            revoke_calls: Rc::clone(&revoke_calls),
        },
        TestDriver {
            path: Rc::new(RefCell::new(None)),
            open_calls: Rc::new(Cell::new(0)),
            close_calls: Rc::clone(&close_calls),
            fail_close: true,
        },
    );
    assert!(bootstrap(&mut runtime, &root).response.ok);
    assert!(
        runtime
            .process_request_line(&frame(
                1,
                TOKEN,
                "scope.open",
                Some(json!({ "scope_handle": SCOPE })),
            ))
            .response
            .ok
    );
    let closed = runtime.process_request_line(&frame(
        2,
        TOKEN,
        "scope.close",
        Some(json!({ "scope_handle": SCOPE })),
    ));
    assert!(closed.should_shutdown);
    assert_eq!(
        closed.response.error.expect("error").code,
        "WCDB_NATIVE_CLOSE_UNKNOWN"
    );
    runtime.shutdown_on_eof();
    assert_eq!(close_calls.get(), 1);
    assert_eq!(revoke_calls.get(), 1);
    remove_test_root(&root);
}

#[test]
fn production_worker_keeps_native_and_key_provider_unavailable() {
    let root = test_root("unavailable");
    let mut runtime = MessageCacheWorkerRuntime::new(
        UnavailableCacheKeyProvider,
        UnavailableEncryptedScopeDriver,
    );
    assert!(bootstrap(&mut runtime, &root).response.ok);
    let opened = runtime.process_request_line(&frame(
        1,
        TOKEN,
        "scope.open",
        Some(json!({ "scope_handle": SCOPE })),
    ));
    assert!(!opened.response.ok);
    assert!(!opened.should_shutdown);
    assert_eq!(
        opened.response.error.expect("error").code,
        "WCDB_ADAPTER_NOT_IMPLEMENTED"
    );
    remove_test_root(&root);
}

#[test]
fn worker_rejects_scope_mismatch_without_closing_the_active_handle() {
    let root = test_root("scope-mismatch");
    let close_calls = Rc::new(Cell::new(0));
    let revoke_calls = Rc::new(Cell::new(0));
    let mut runtime = MessageCacheWorkerRuntime::new(
        TestKeyProvider {
            revoke_calls: Rc::clone(&revoke_calls),
        },
        TestDriver {
            path: Rc::new(RefCell::new(None)),
            open_calls: Rc::new(Cell::new(0)),
            close_calls: Rc::clone(&close_calls),
            fail_close: false,
        },
    );
    assert!(bootstrap(&mut runtime, &root).response.ok);
    assert!(
        runtime
            .process_request_line(&frame(
                1,
                TOKEN,
                "scope.open",
                Some(json!({ "scope_handle": SCOPE })),
            ))
            .response
            .ok
    );
    let mismatched = runtime.process_request_line(&frame(
        2,
        TOKEN,
        "scope.close",
        Some(json!({
            "scope_handle": "22222222-2222-4222-8222-222222222222"
        })),
    ));
    assert_eq!(
        mismatched.response.error.expect("error").code,
        "CACHE_SCOPE_MISMATCH"
    );
    assert!(!mismatched.should_shutdown);
    assert_eq!(close_calls.get(), 0);
    assert_eq!(revoke_calls.get(), 0);
    runtime.shutdown_on_eof();
    assert_eq!(close_calls.get(), 1);
    assert_eq!(revoke_calls.get(), 1);
    remove_test_root(&root);
}

#[test]
fn worker_crud_uses_stable_hashes_retention_and_purge_shutdown() {
    let root = test_root("crud");
    let state = Rc::new(RefCell::new(CrudState::default()));
    let revoke_calls = Rc::new(Cell::new(0));
    let mut runtime = crud_runtime(&state, &revoke_calls, false);
    open_crud_scope(&mut runtime, &root);
    exercise_put_replay(&mut runtime);
    exercise_page_and_purge(&mut runtime);
    assert_eq!(revoke_calls.get(), 1);

    let state = state.borrow();
    assert_eq!(state.put_hashes.len(), 2);
    assert_eq!(state.put_hashes[0], state.put_hashes[1]);
    assert_eq!(state.put_times, vec![(1_000, 1_100), (1_000, 1_100)]);
    assert_eq!(state.purge_hashes.len(), 1);
    assert_ne!(state.put_hashes[0], state.purge_hashes[0]);
    assert_eq!(state.close_calls, 1);
    drop(state);
    remove_test_root(&root);
}

#[test]
fn unknown_mutation_is_never_retried_and_revokes_scope_before_exit() {
    let root = test_root("unknown-mutation");
    let state = Rc::new(RefCell::new(CrudState::default()));
    let revoke_calls = Rc::new(Cell::new(0));
    let mut runtime = crud_runtime(&state, &revoke_calls, true);
    open_crud_scope(&mut runtime, &root);
    let failed = runtime.process_request_line(&frame(
        2,
        TOKEN,
        "scope.put_confirmed",
        Some(json!({
            "scope_handle": SCOPE,
            "operation_id": "22222222-2222-4222-8222-222222222222",
            "projection": projection()
        })),
    ));
    assert!(!failed.response.ok);
    assert!(failed.should_shutdown);
    assert_eq!(
        failed.response.error.expect("error").code,
        "CACHE_MUTATION_OUTCOME_UNKNOWN_RECONCILE_REQUIRED"
    );
    runtime.shutdown_on_eof();
    let state = state.borrow();
    assert_eq!(state.put_hashes.len(), 1);
    assert_eq!(state.close_calls, 1);
    assert_eq!(revoke_calls.get(), 1);
    drop(state);
    remove_test_root(&root);
}

#[test]
fn worker_request_and_response_frames_have_separate_fail_closed_limits() {
    let mut runtime = MessageCacheWorkerRuntime::new(
        UnavailableCacheKeyProvider,
        UnavailableEncryptedScopeDriver,
    );
    let oversized_request = vec![b'x'; MAX_WORKER_REQUEST_FRAME_BYTES + 1];
    let rejected = runtime.process_request_line(&oversized_request);
    assert!(rejected.should_shutdown);
    assert_eq!(
        rejected.response.error.expect("request error").code,
        "WORKER_REQUEST_TOO_LARGE"
    );

    let oversized_response = success_response(
        "request-1".to_owned(),
        1,
        json!({ "data": "x".repeat(MAX_WORKER_RESPONSE_FRAME_BYTES) }),
        false,
    );
    let mut output = Vec::new();
    let error = write_response(&mut output, &oversized_response.response)
        .expect_err("response must be rejected");
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(output.is_empty());
}
