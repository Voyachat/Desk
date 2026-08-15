use super::contracts::{CancelReason, CapabilityScope, SideEffectClass};
use super::process_contracts::current_process_target;
use super::process_execution::{
    MaterializedProcessEnvironment, NativeProcessExecutionEngine, NativeProcessExecutionSnapshot,
    NativeProcessExecutionSpec, ProcessCancelOutcome, inherited_environment,
};
use super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use super::process_execution_contracts::ProcessExecutionState;
use super::process_execution_test_support::test_resource_policy;
use std::thread;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

const OPERATION_ID: &str = "44444444-4444-4444-8444-444444444444";
const OUTPUT_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_child_output_fixture";
const WAIT_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_child_wait_fixture";
const TREE_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_child_tree_fixture";
const TREE_GRANDCHILD_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_tree_grandchild_fixture";
const SPAWN_MARKER_FIXTURE: &str =
    "local_capability::process_execution_engine_tests::process_child_spawn_marker_fixture";

#[test]
fn inherited_environment_keeps_bootstrap_keys_and_drops_unapproved_or_unsafe_values() {
    let selected = inherited_environment([
        ("systemdrive".to_owned(), "C:".to_owned()),
        ("systemroot".to_owned(), r"C:\Windows".to_owned()),
        (
            "localappdata".to_owned(),
            r"C:\Users\runner\AppData\Local".to_owned(),
        ),
        ("TEMP".to_owned(), r"C:\Temp".to_owned()),
        ("TMP".to_owned(), r"C:\Tmp".to_owned()),
        ("WINDIR".to_owned(), "contains\0nul".to_owned()),
        ("USERPROFILE".to_owned(), "x".repeat(4 * 1024 + 1)),
        ("TMPDIR".to_owned(), r"C:\TmpOne".to_owned()),
        ("tmpdir".to_owned(), r"C:\TmpTwo".to_owned()),
        ("AISTAFF_TEST_TOKEN".to_owned(), "must-not-leak".to_owned()),
    ]);

    assert_eq!(
        selected,
        vec![
            ("SystemDrive".to_owned(), "C:".to_owned()),
            ("SystemRoot".to_owned(), r"C:\Windows".to_owned()),
            (
                "LOCALAPPDATA".to_owned(),
                r"C:\Users\runner\AppData\Local".to_owned(),
            ),
            ("TEMP".to_owned(), r"C:\Temp".to_owned()),
            ("TMP".to_owned(), r"C:\Tmp".to_owned()),
        ]
    );
    assert!(
        selected
            .iter()
            .all(|(name, _)| name != "AISTAFF_TEST_TOKEN")
    );
}

#[test]
#[ignore]
fn process_child_output_fixture() {
    println!("fixture-stdout");
    eprintln!("fixture-stderr");
}

#[test]
#[ignore]
fn process_child_wait_fixture() {
    thread::sleep(Duration::from_secs(30));
}

#[test]
#[ignore]
fn process_child_tree_fixture() {
    let marker = std::env::var("PROCESS_TREE_MARKER").expect("tree marker");
    let mut grandchild =
        std::process::Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--ignored",
                "--exact",
                TREE_GRANDCHILD_FIXTURE,
                "--nocapture",
            ])
            .spawn()
            .expect("spawn tree grandchild");
    std::fs::write(format!("{marker}.ready"), b"ready").expect("write tree ready");
    grandchild.wait().expect("wait for tree grandchild");
}

#[test]
#[ignore]
fn process_tree_grandchild_fixture() {
    let marker = std::env::var("PROCESS_TREE_MARKER").expect("tree marker");
    thread::sleep(Duration::from_secs(1));
    std::fs::write(format!("{marker}.survived"), b"survived").expect("write survival marker");
}

#[test]
#[ignore]
fn process_child_context_fixture() {
    let token = std::env::var("PROCESS_TEST_TOKEN").expect("fixture token");
    assert!(std::path::Path::new("process-context-marker").is_file());
    println!("fixture-token={token};cwd-marker=present");
    if std::path::Path::new("process-context-wait").is_file() {
        thread::sleep(Duration::from_secs(30));
    }
}

#[test]
#[ignore]
fn process_child_spawn_marker_fixture() {
    let marker = std::env::var("PROCESS_SPAWN_MARKER").expect("spawn marker");
    std::fs::write(marker, b"spawned").expect("write spawn marker");
}

fn test_spec(fixture: &str, timeout: Duration) -> NativeProcessExecutionSpec {
    NativeProcessExecutionSpec {
        capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
        operation_id: OPERATION_ID.to_owned(),
        scope: CapabilityScope {
            tenant_id: "tenant-test".to_owned(),
            session_id: "session-test".to_owned(),
            run_id: "run-test".to_owned(),
        },
        executable_path: std::env::current_exe().expect("test executable"),
        argv: vec![
            "--ignored".to_owned(),
            "--exact".to_owned(),
            fixture.to_owned(),
            "--nocapture".to_owned(),
        ],
        environment: Vec::new(),
        working_directory: None,
        timeout,
        output_limit_bytes: 16 * 1024,
        side_effect: SideEffectClass::ReadOnly,
        target: current_process_target().expect("supported test target"),
        resource_policy: test_resource_policy(),
    }
}

fn wait_for_terminal(engine: &mut NativeProcessExecutionEngine) -> NativeProcessExecutionSnapshot {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = engine.snapshot(OPERATION_ID).expect("execution snapshot");
        if snapshot.execution_state != ProcessExecutionState::Running {
            return snapshot;
        }
        assert!(Instant::now() < deadline, "execution did not terminate");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn native_engine_fails_before_spawn_when_sandbox_is_unavailable() {
    let marker = std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join(format!("sandbox-unavailable-marker-{}", std::process::id()));
    std::fs::create_dir_all(marker.parent().expect("marker parent")).expect("create marker parent");
    if marker.exists() {
        std::fs::remove_file(&marker).expect("remove stale marker");
    }
    let mut spec = test_spec(SPAWN_MARKER_FIXTURE, Duration::from_secs(1));
    spec.environment.push(MaterializedProcessEnvironment {
        name: "PROCESS_SPAWN_MARKER".to_owned(),
        value: Zeroizing::new(marker.to_string_lossy().into_owned()),
    });
    let mut engine = NativeProcessExecutionEngine::with_unavailable_sandbox();
    assert_eq!(
        engine.start(spec).map(|_| ()).map_err(|error| error.code),
        Err("LOCAL_PROCESS_SANDBOX_UNAVAILABLE")
    );
    assert!(!marker.exists(), "sandbox-unavailable path spawned a child");
}

#[test]
fn native_engine_captures_bounded_stdout_and_stderr() {
    let mut engine = NativeProcessExecutionEngine::new();
    engine
        .start(test_spec(OUTPUT_FIXTURE, Duration::from_secs(2)))
        .expect("start fixture");
    let snapshot = wait_for_terminal(&mut engine);
    assert_eq!(snapshot.execution_state, ProcessExecutionState::Completed);
    assert!(String::from_utf8_lossy(&snapshot.stdout).contains("fixture-stdout"));
    assert!(String::from_utf8_lossy(&snapshot.stderr).contains("fixture-stderr"));
    assert!(!snapshot.output_truncated);
}

#[test]
fn native_engine_fails_closed_when_combined_output_exceeds_the_budget() {
    let mut engine = NativeProcessExecutionEngine::new();
    let mut spec = test_spec(OUTPUT_FIXTURE, Duration::from_secs(2));
    spec.output_limit_bytes = 4;
    engine.start(spec).expect("start bounded fixture");
    let snapshot = wait_for_terminal(&mut engine);
    assert!(matches!(
        snapshot.execution_state,
        ProcessExecutionState::Failed | ProcessExecutionState::Unknown
    ));
    assert!(matches!(
        snapshot.reason_code,
        "LOCAL_PROCESS_OUTPUT_LIMIT_EXCEEDED" | "LOCAL_PROCESS_TERMINATION_UNKNOWN"
    ));
    assert!(snapshot.output_truncated);
    assert!(snapshot.stdout.len() + snapshot.stderr.len() <= 4);
}

#[test]
fn native_engine_enforces_timeout_and_cancel_on_the_process_group() {
    let mut timeout_engine = NativeProcessExecutionEngine::new();
    timeout_engine
        .start(test_spec(WAIT_FIXTURE, Duration::from_millis(50)))
        .expect("start timeout fixture");
    assert_eq!(
        wait_for_terminal(&mut timeout_engine).execution_state,
        ProcessExecutionState::TimedOut
    );

    let mut cancel_engine = NativeProcessExecutionEngine::new();
    cancel_engine
        .start(test_spec(WAIT_FIXTURE, Duration::from_secs(2)))
        .expect("start cancel fixture");
    assert_eq!(
        cancel_engine.cancel(OPERATION_ID, CancelReason::UserRequested),
        ProcessCancelOutcome::Requested
    );
    assert_eq!(
        wait_for_terminal(&mut cancel_engine).execution_state,
        ProcessExecutionState::Cancelled
    );
}

#[test]
fn native_engine_cancel_terminates_a_real_descendant_process() {
    let marker = std::env::current_dir()
        .expect("current directory")
        .join("target")
        .join(format!("process-tree-{}", std::process::id()));
    let ready = marker.with_extension("ready");
    let survived = marker.with_extension("survived");
    let _ = std::fs::remove_file(&ready);
    let _ = std::fs::remove_file(&survived);
    let mut spec = test_spec(TREE_FIXTURE, Duration::from_secs(10));
    spec.environment = vec![MaterializedProcessEnvironment {
        name: "PROCESS_TREE_MARKER".to_owned(),
        value: Zeroizing::new(marker.to_string_lossy().into_owned()),
    }];
    let mut engine = NativeProcessExecutionEngine::new();
    engine.start(spec).expect("start process tree fixture");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.is_file() {
        assert!(Instant::now() < deadline, "descendant was not started");
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        engine.cancel(OPERATION_ID, CancelReason::UserRequested),
        ProcessCancelOutcome::Requested
    );
    assert_ne!(
        wait_for_terminal(&mut engine).execution_state,
        ProcessExecutionState::Running
    );
    thread::sleep(Duration::from_millis(1_200));
    assert!(!survived.exists(), "descendant survived process-group kill");
    let _ = std::fs::remove_file(ready);
}
