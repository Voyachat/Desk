use aistaff_desktop_supervisor::message_cache_worker::MessageCacheWorkerProcess;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

const SCOPE: &str = "11111111-1111-4111-8111-111111111111";
static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn worker_test_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("system clock")
        .as_nanos();
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::current_dir()
        .expect("current directory")
        .join("services")
        .join("desktop-supervisor")
        .join("target")
        .join("worker-process-tests")
        .join(format!("{}-{nonce}-{sequence}", std::process::id()))
}

fn remove_worker_test_root(root: &Path) {
    if root.exists() {
        std::fs::remove_dir_all(root).expect("remove exact worker test root");
    }
}

#[test]
fn owned_binary_runs_an_isolated_fail_closed_worker_lifecycle() {
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_aistaff-desktop-supervisor"));
    let root = worker_test_root();
    let mut worker = MessageCacheWorkerProcess::spawn(&binary, &root, Duration::from_secs(5))
        .expect("worker starts");
    assert_eq!(worker.native_adapter(), "adapter_unavailable");
    assert_eq!(worker.adapter_id(), "unavailable");
    let expected_reason = if cfg!(any(
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64")
    )) {
        "WCDB_NATIVE_PACKAGE_LAYOUT_INVALID"
    } else {
        "WCDB_NATIVE_PLATFORM_UNSUPPORTED"
    };
    assert_eq!(worker.native_adapter_reason(), Some(expected_reason));

    let error = worker
        .open_scope(SCOPE)
        .expect_err("unpackaged native adapter remains unavailable");
    assert_eq!(error.code, expected_reason);
    worker.force_stop().expect("worker is already fail-closed");
    remove_worker_test_root(&root);
}

#[test]
fn parent_can_force_stop_a_worker_after_an_unknown_or_cancelled_operation() {
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_aistaff-desktop-supervisor"));
    let root = worker_test_root();
    let worker = MessageCacheWorkerProcess::spawn(&binary, &root, Duration::from_secs(5))
        .expect("worker starts");
    worker.force_stop().expect("worker force stops");
    remove_worker_test_root(&root);
}
