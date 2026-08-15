//! Windows-only target-native containment and durable-reconciliation evidence.
//!
//! This partition intentionally remains test-only and cannot enable the
//! production Process constructor or six-control admission.

#[path = "runtime_tests/evidence.rs"]
mod evidence;
#[path = "runtime_tests/support.rs"]
mod support;
#[path = "runtime_tests/token.rs"]
mod token;

use self::evidence::write_runtime_evidence_if_requested;
use self::support::*;
use self::token::current_token_sandbox_state;
use super::dpapi::CurrentUserDpapiProtector;
use super::{WindowsNativeSandboxLeaseProvider, acl};
use crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use crate::local_capability::process_spawn_spec::MaterializedProcessEnvironment;
use crate::local_capability::process_windows_acl_lease::journal::WindowsAclLeaseJournalStore;
use crate::local_capability::process_windows_sandbox::{
    WindowsAppContainerSid, WindowsProcessSandboxPort, WindowsSandboxLeaseProvider,
    WindowsSandboxLeaseRequest,
};
use std::fs;
use std::io::{self, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Stdio;
use std::thread;
use std::time::Duration;
use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;
use zeroize::Zeroizing;

#[test]
fn windows_native_lpac_owner_loss_and_reconciliation_evidence() {
    run_lpac_denial_scenario();
    run_owner_loss_reconciliation_scenario();
    write_runtime_evidence_if_requested();
}

#[test]
#[ignore]
fn windows_lpac_denial_fixture() {
    assert_current_process_is_zero_capability_lpac("denial fixture");
    let denied_file = required_path_env(DENIED_FILE_ENV);
    let file_error = fs::read(&denied_file).expect_err("ungranted file must be denied");
    assert_eq!(file_error.raw_os_error(), Some(ERROR_ACCESS_DENIED as i32));

    let endpoint = std::env::var(DENIED_ENDPOINT_ENV).expect("denied endpoint");
    let endpoint = endpoint.parse().expect("valid denied endpoint");
    let network_error = TcpStream::connect_timeout(&endpoint, Duration::from_secs(1))
        .expect_err("zero-capability LPAC must not connect");
    assert_eq!(network_error.kind(), io::ErrorKind::PermissionDenied);
    println!(
        "{DENIAL_RESULT_PREFIX}app_container=true lpac=true capability_count=0 filesystem_denied=true network_denied=true"
    );
}

#[test]
#[ignore]
fn windows_owner_loss_supervisor_fixture() {
    let journal_root = required_path_env(JOURNAL_ROOT_ENV);
    let operation_id = std::env::var(OPERATION_ID_ENV).expect("operation id");
    let provider = WindowsNativeSandboxLeaseProvider::new(&journal_root)
        .expect("create native lease provider");
    let mut port = WindowsProcessSandboxPort::new(Box::new(provider));
    let scope = test_scope();
    let policy = test_policy();
    let executable = current_executable();
    let environment = Vec::new();
    let mut child = spawn_fixture(
        &mut port,
        &operation_id,
        &scope,
        &policy,
        &executable,
        TREE_FIXTURE,
        &environment,
    );
    child.resume().expect("resume owner-loss fixture");
    let stdout = child.take_stdout().expect("owner-loss stdout");
    let _stderr = child.take_stderr().expect("owner-loss stderr");
    let ready = read_marker_with_timeout(stdout, TREE_READY_PREFIX, CHILD_READY_TIMEOUT);
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "{OWNER_LOSS_READY_PREFIX}{}",
        ready.trim_start_matches(TREE_READY_PREFIX)
    )
    .expect("forward owner-loss readiness");
    output.flush().expect("flush owner-loss readiness");

    // No Rust destructors may run here: the OS closing the last Job handle is
    // the behavior under test, and the durable lease must remain for restart.
    std::process::abort();
}

#[test]
#[ignore]
fn windows_owner_loss_tree_fixture() {
    assert_current_process_is_zero_capability_lpac("owner-loss tree fixture");
    assert!(
        breakaway_spawn_is_denied(),
        "explicit Job breakaway unexpectedly succeeded"
    );

    let mut descendant = fixture_command(DESCENDANT_FIXTURE);
    descendant.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut descendant = descendant.spawn().expect("spawn ordinary descendant");
    let descendant_pid = descendant.id();
    let descendant_stdout = descendant.stdout.take().expect("descendant stdout");
    read_marker_with_timeout(
        descendant_stdout,
        DESCENDANT_READY_PREFIX,
        CHILD_READY_TIMEOUT,
    );
    println!(
        "{TREE_READY_PREFIX}parent={} descendant={descendant_pid} breakaway_denied=true",
        std::process::id()
    );
    io::stdout().flush().expect("flush tree readiness");
    thread::sleep(Duration::from_secs(30));
    let _ = descendant.wait();
}

#[test]
#[ignore]
fn windows_owner_loss_descendant_fixture() {
    assert_current_process_is_zero_capability_lpac("owner-loss descendant fixture");
    println!("{DESCENDANT_READY_PREFIX}");
    io::stdout().flush().expect("flush descendant readiness");
    thread::sleep(Duration::from_secs(30));
}

#[test]
#[ignore]
fn windows_breakaway_escape_fixture() {
    panic!("a breakaway process escaped the owned Job");
}

fn run_lpac_denial_scenario() {
    let root = TestRoot::new("lpac-denial");
    let journal_root = root.create_directory("journal");
    let denied_file = root.path().join("private-input.txt");
    let denied_contents = b"must remain unavailable";
    fs::write(&denied_file, denied_contents).expect("write denied file");
    assert_eq!(
        fs::read(&denied_file).expect("positive-control private file read"),
        denied_contents,
        "private file positive control changed contents"
    );
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .expect("bind denied loopback endpoint");
    let endpoint = listener.local_addr().expect("listener address");
    let positive_client = TcpStream::connect_timeout(&endpoint, Duration::from_secs(1))
        .expect("positive-control loopback connect");
    let (positive_server, _) = listener.accept().expect("positive-control loopback accept");
    drop(positive_server);
    drop(positive_client);
    listener
        .set_nonblocking(true)
        .expect("set listener nonblocking");
    let operation_id = unique_operation_id();
    let scope = test_scope();
    let policy = test_policy();
    let executable = current_executable();
    let environment = vec![
        materialized_path(DENIED_FILE_ENV, &denied_file),
        MaterializedProcessEnvironment {
            name: DENIED_ENDPOINT_ENV.to_owned(),
            value: Zeroizing::new(endpoint.to_string()),
        },
    ];
    let provider = WindowsNativeSandboxLeaseProvider::new(&journal_root)
        .expect("create denial lease provider");
    let mut port = WindowsProcessSandboxPort::new(Box::new(provider));
    let mut child = spawn_fixture(
        &mut port,
        &operation_id,
        &scope,
        &policy,
        &executable,
        DENIAL_FIXTURE,
        &environment,
    );
    child.resume().expect("resume denial fixture");
    let mut stdout = child.take_stdout().expect("denial stdout");
    let mut stderr = child.take_stderr().expect("denial stderr");
    let status = wait_for_sandbox_child(child.as_mut(), CHILD_READY_TIMEOUT);
    let stdout = read_text(&mut stdout, "denial stdout");
    let stderr = read_text(&mut stderr, "denial stderr");
    assert!(
        status.success(),
        "LPAC denial fixture failed: {stdout}\n{stderr}"
    );
    let result = find_marker(&stdout, DENIAL_RESULT_PREFIX);
    assert!(result.contains("app_container=true"));
    assert!(result.contains("lpac=true"));
    assert!(result.contains("capability_count=0"));
    assert!(result.contains("filesystem_denied=true"));
    assert!(result.contains("network_denied=true"));
    match listener.accept() {
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
        Ok(_) => panic!("loopback listener accepted a sandbox connection"),
        Err(error) => panic!("inspect loopback listener: {error}"),
    }
    drop(child);
    drop(port);
    assert_journal_empty(&journal_root);
}

fn assert_current_process_is_zero_capability_lpac(context: &str) {
    let state = current_token_sandbox_state().unwrap_or_else(|error| {
        panic!("query {context} token sandbox state: {error}");
    });
    assert!(
        state.app_container,
        "{context} token is not an AppContainer"
    );
    assert!(
        state.less_privileged_app_container,
        "{context} token is not a less-privileged AppContainer"
    );
    assert_eq!(
        state.capability_count, 0,
        "{context} token unexpectedly has capabilities"
    );
}

fn run_owner_loss_reconciliation_scenario() {
    let root = TestRoot::new("owner-loss");
    let journal_root = root.create_directory("journal");
    let operation_id = unique_operation_id();
    let executable = current_executable();
    let mut command = fixture_command(SUPERVISOR_ABORT_FIXTURE);
    command
        .env(JOURNAL_ROOT_ENV, &journal_root)
        .env(OPERATION_ID_ENV, &operation_id)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let (status, stdout, stderr) = run_helper_with_timeout(command, HELPER_TIMEOUT);
    assert!(
        !status.success(),
        "owner-loss fixture returned normally: {stdout}\n{stderr}"
    );
    let ready = parse_owner_loss_ready(find_marker(&stdout, OWNER_LOSS_READY_PREFIX));
    assert!(ready.breakaway_denied);
    wait_for_process_exit(ready.parent_pid);
    wait_for_process_exit(ready.descendant_pid);

    assert_eq!(
        fs::read_dir(&journal_root)
            .expect("read crashed lease journal")
            .collect::<Result<Vec<_>, _>>()
            .expect("enumerate crashed lease journal")
            .len(),
        2,
        "owner-loss fixture must leave intent and bound records"
    );
    let store = WindowsAclLeaseJournalStore::new(&journal_root, CurrentUserDpapiProtector)
        .expect("open crashed lease journal");
    let recoverable = store.load_all().expect("load crashed lease binding");
    assert_eq!(recoverable.len(), 1, "expected one crashed lease");
    let binding = recoverable[0]
        .binding
        .as_ref()
        .expect("owner-loss fixture must leave a bound SID");
    assert_eq!(binding.intent.operation_id, operation_id);
    let sid =
        WindowsAppContainerSid::from_bytes(&binding.sid_bytes().expect("decode crashed lease SID"))
            .expect("validate crashed lease SID");
    for target in &binding.intent.targets {
        acl::verify_target_sid_for_test(target, sid.as_psid(), true)
            .expect("crashed lease target must retain its exact SID ACE");
    }

    let mut provider = WindowsNativeSandboxLeaseProvider::new(&journal_root)
        .expect("restart provider must reconcile stale lease");
    assert_journal_empty(&journal_root);
    for target in &binding.intent.targets {
        acl::verify_target_sid_for_test(target, sid.as_psid(), false)
            .expect("restart reconciliation must revoke the exact SID ACE");
    }
    let scope = test_scope();
    let lease = provider
        .acquire(WindowsSandboxLeaseRequest {
            capability_id: LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            operation_id: &operation_id,
            scope: &scope,
            executable_path: &executable,
            working_directory: None,
        })
        .expect("reconciled profile and journal must be reusable in fixture");
    lease.release().expect("release reacquired fixture lease");
    drop(provider);
    assert_journal_empty(&journal_root);
}
