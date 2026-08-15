use aistaff_desktop_supervisor::PROTOCOL_VERSION;
use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const ENABLE_ENVIRONMENT_VARIABLE: &str = "AISTAFF_WCDB_PRODUCTION_HISTORY_E2E_REQUIRED";
const EXECUTABLE_ENVIRONMENT_VARIABLE: &str = "AISTAFF_WCDB_PRODUCTION_HISTORY_E2E_EXECUTABLE";
const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PROVIDER_IDENTITY_DIGEST: &str =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct SupervisorProcess {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
    next_request: u64,
    stopped: bool,
}

impl SupervisorProcess {
    fn spawn(executable: &Path, runtime_root: &Path) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command
            .current_dir(runtime_root)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for key in [
            "SystemRoot",
            "WINDIR",
            "USERPROFILE",
            "TEMP",
            "TMP",
            "TMPDIR",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        let mut child = command
            .spawn()
            .map_err(|_| "PRODUCTION_SUPERVISOR_SPAWN_FAILED".to_owned())?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| "PRODUCTION_SUPERVISOR_STDIN_UNAVAILABLE".to_owned())?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| "PRODUCTION_SUPERVISOR_STDOUT_UNAVAILABLE".to_owned())?;
        let mut input = BufWriter::new(input);
        input
            .write_all(TOKEN.as_bytes())
            .and_then(|()| input.write_all(b"\n"))
            .and_then(|()| input.flush())
            .map_err(|_| "PRODUCTION_SUPERVISOR_BOOTSTRAP_FAILED".to_owned())?;
        Ok(Self {
            child,
            input,
            output: BufReader::new(output),
            next_request: 0,
            stopped: false,
        })
    }

    fn request(&mut self, command: &str, payload: Option<Value>) -> Result<Value, String> {
        let request_id = format!("production-history-{}", self.next_request);
        self.next_request += 1;
        let mut request = json!({
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "auth_token": TOKEN,
            "command": command
        });
        if let Some(payload) = payload {
            request["payload"] = payload;
        }
        serde_json::to_writer(&mut self.input, &request)
            .map_err(|_| "PRODUCTION_SUPERVISOR_REQUEST_INVALID".to_owned())?;
        self.input
            .write_all(b"\n")
            .and_then(|_| self.input.flush())
            .map_err(|_| "PRODUCTION_SUPERVISOR_WRITE_FAILED".to_owned())?;

        let mut line = String::new();
        if self
            .output
            .read_line(&mut line)
            .map_err(|_| "PRODUCTION_SUPERVISOR_READ_FAILED".to_owned())?
            == 0
        {
            return Err("PRODUCTION_SUPERVISOR_EXITED_EARLY".to_owned());
        }
        let response: Value = serde_json::from_str(&line)
            .map_err(|_| "PRODUCTION_SUPERVISOR_RESPONSE_INVALID".to_owned())?;
        if response.get("protocol_version").and_then(Value::as_str) != Some(PROTOCOL_VERSION)
            || response.get("request_id").and_then(Value::as_str) != Some(request_id.as_str())
        {
            return Err("PRODUCTION_SUPERVISOR_RESPONSE_INVALID".to_owned());
        }
        if response.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(response
                .pointer("/error/code")
                .and_then(Value::as_str)
                .filter(|code| {
                    !code.is_empty()
                        && code.len() <= 128
                        && code.bytes().all(|byte| {
                            byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                        })
                })
                .unwrap_or("PRODUCTION_SUPERVISOR_OPERATION_FAILED")
                .to_owned());
        }
        response
            .get("result")
            .cloned()
            .ok_or_else(|| "PRODUCTION_SUPERVISOR_RESPONSE_INVALID".to_owned())
    }

    fn shutdown(mut self) -> Result<(), String> {
        let result = self.request("shutdown", None)?;
        if result.get("status").and_then(Value::as_str) != Some("shutting_down") {
            return Err("PRODUCTION_SUPERVISOR_SHUTDOWN_INVALID".to_owned());
        }
        let status = self
            .child
            .wait()
            .map_err(|_| "PRODUCTION_SUPERVISOR_WAIT_FAILED".to_owned())?;
        self.stopped = true;
        if !status.success() {
            return Err("PRODUCTION_SUPERVISOR_EXIT_FAILED".to_owned());
        }
        Ok(())
    }
}

impl Drop for SupervisorProcess {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn unique_uuid(seed: u128) -> String {
    let value = format!("{seed:032x}");
    format!(
        "{}-{}-4{}-8{}-{}",
        &value[0..8],
        &value[8..12],
        &value[13..16],
        &value[17..20],
        &value[20..32]
    )
}

fn create_runtime_root() -> Result<(PathBuf, u128), String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "PRODUCTION_HISTORY_CLOCK_INVALID".to_owned())?
        .as_nanos()
        ^ u128::from(std::process::id());
    let root = std::env::temp_dir().join(format!("aistaff-production-history-{nonce:032x}"));
    fs::create_dir(&root).map_err(|_| "PRODUCTION_HISTORY_ROOT_CREATE_FAILED".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .map_err(|_| "PRODUCTION_HISTORY_ROOT_PERMISSION_FAILED".to_owned())?;
    }
    Ok((root, nonce))
}

fn require(condition: bool, code: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(code.to_owned())
    }
}

fn open_scope(process: &mut SupervisorProcess, scope_handle: &str) -> Result<(), String> {
    let result = process.request(
        "cache.open_scope",
        Some(json!({ "scope_handle": scope_handle })),
    )?;
    require(
        result.get("scope_status").and_then(Value::as_str) == Some("ready")
            && result.get("persistent").and_then(Value::as_bool) == Some(true),
        "PRODUCTION_HISTORY_SCOPE_NOT_READY",
    )
}

fn purge_scope(process: &mut SupervisorProcess, scope_handle: &str, seed: u128) {
    let _ = open_scope(process, scope_handle);
    let _ = process.request(
        "cache.purge_scope",
        Some(json!({
            "scope_handle": scope_handle,
            "operation_id": unique_uuid(seed ^ 0x5555),
            "confirmed": true
        })),
    );
}

fn run_restart_readback(
    executable: &Path,
    runtime_root: &Path,
    scope_handle: &str,
    seed: u128,
) -> Result<(), String> {
    let task_id = unique_uuid(seed ^ 0x1111);
    let conversation_id = unique_uuid(seed ^ 0x2222);
    let operation_id = unique_uuid(seed ^ 0x3333);
    let mut writer = SupervisorProcess::spawn(executable, runtime_root)?;
    let capabilities = writer.request("cache.capabilities", None)?;
    if capabilities.get("availability").and_then(Value::as_str) != Some("available") {
        return Err(capabilities
            .get("reason_code")
            .and_then(Value::as_str)
            .unwrap_or("PRODUCTION_HISTORY_CACHE_UNAVAILABLE")
            .to_owned());
    }
    require(
        capabilities.get("persistent").and_then(Value::as_bool) == Some(true),
        "PRODUCTION_HISTORY_CACHE_UNAVAILABLE",
    )?;
    open_scope(&mut writer, scope_handle)?;
    let put = writer.request(
        "cache.local_history.put",
        Some(json!({
            "scope_handle": scope_handle,
            "operation_id": operation_id,
            "projection": {
                "schema_revision": 1,
                "origin": "client_local",
                "server_scope_consumed": false,
                "task_id": task_id,
                "conversation_id": conversation_id,
                "operation_id": operation_id,
                "mode": "ask",
                "status": "processing",
                "reason_code": null,
                "title": "restart fixture",
                "updated_at_epoch_ms": 1,
                "provider_identity_digest": PROVIDER_IDENTITY_DIGEST,
                "context_restore_required": false,
                "messages": [{
                    "sequence": 1,
                    "role": "user",
                    "text": "restart fixture"
                }],
                "result": null
            }
        })),
    )?;
    require(
        put.get("idempotency_replayed").and_then(Value::as_bool) == Some(false),
        "PRODUCTION_HISTORY_PUT_INVALID",
    )?;
    writer.shutdown()?;

    let mut reader = SupervisorProcess::spawn(executable, runtime_root)?;
    open_scope(&mut reader, scope_handle)?;
    let snapshot = reader.request(
        "cache.local_history.snapshot",
        Some(json!({
            "scope_handle": scope_handle,
            "provider_identity_digest": PROVIDER_IDENTITY_DIGEST,
            "limit": 8
        })),
    )?;
    let projection = snapshot
        .get("projections")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| "PRODUCTION_HISTORY_READBACK_MISSING".to_owned())?;
    require(
        snapshot.get("interrupted_count").and_then(Value::as_u64) == Some(1)
            && snapshot
                .get("projections")
                .and_then(Value::as_array)
                .is_some_and(|items| items.len() == 1)
            && projection.get("conversation_id").and_then(Value::as_str)
                == Some(conversation_id.as_str())
            && projection.get("status").and_then(Value::as_str) == Some("interrupted")
            && projection.get("reason_code").and_then(Value::as_str)
                == Some("CLIENT_RESTART_INTERRUPTED")
            && projection.get("result") == Some(&Value::Null),
        "PRODUCTION_HISTORY_READBACK_INVALID",
    )?;
    let purged = reader.request(
        "cache.purge_scope",
        Some(json!({
            "scope_handle": scope_handle,
            "operation_id": unique_uuid(seed ^ 0x4444),
            "confirmed": true
        })),
    )?;
    require(
        purged.get("purged").and_then(Value::as_bool) == Some(true),
        "PRODUCTION_HISTORY_PURGE_INVALID",
    )?;
    reader.shutdown()
}

#[test]
fn packaged_supervisor_reads_interrupted_local_history_after_worker_restart() {
    if std::env::var(ENABLE_ENVIRONMENT_VARIABLE).as_deref() != Ok("1") {
        return;
    }
    let executable = PathBuf::from(
        std::env::var_os(EXECUTABLE_ENVIRONMENT_VARIABLE)
            .expect("production history executable must be explicit"),
    );
    let executable = fs::canonicalize(executable).expect("canonical packaged Supervisor path");
    let (runtime_root, seed) = create_runtime_root().expect("isolated production history root");
    let scope_handle = unique_uuid(seed);
    let result = run_restart_readback(&executable, &runtime_root, &scope_handle, seed);
    if result.is_err()
        && let Ok(mut cleanup) = SupervisorProcess::spawn(&executable, &runtime_root)
    {
        purge_scope(&mut cleanup, &scope_handle, seed);
        let _ = cleanup.shutdown();
    }
    let _ = fs::remove_dir_all(&runtime_root);
    if let Err(code) = result {
        panic!("{code}");
    }
}
