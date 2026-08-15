use aistaff_desktop_supervisor::local_capability::run_local_mcp_time_server_stdio;
use aistaff_desktop_supervisor::message_cache_worker::{
    MESSAGE_CACHE_WORKER_PROTOCOL_VERSION, run_message_cache_worker_stdio,
};
use aistaff_desktop_supervisor::{MAX_LINE_BYTES, PROTOCOL_VERSION, Response, SupervisorRuntime};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use std::io::{self, BufRead, Read, Write};
use zeroize::Zeroizing;

const MIN_BOOTSTRAP_TOKEN_BYTES: usize = 32;
const MAX_BOOTSTRAP_TOKEN_BYTES: usize = 512;
#[cfg(feature = "supervisor-control-test-support")]
const TEST_STATE_DIRECTORY_ENVIRONMENT_VARIABLE: &str = "AISTAFF_SUPERVISOR_STATE_DIR";
#[cfg(feature = "supervisor-control-test-support")]
const TEST_DATA_KEY_FILE_ENVIRONMENT_VARIABLE: &str = "AISTAFF_SUPERVISOR_TEST_DATA_KEY_FILE";

fn write_response(output: &mut impl Write, response: &Response) -> io::Result<()> {
    serde_json::to_writer(&mut *output, response)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn run_supervisor(
    create_runtime: impl FnOnce() -> Result<SupervisorRuntime, Box<dyn std::error::Error>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let auth_token = read_bootstrap_token(&mut input)?;
    let mut runtime = create_runtime()?;
    let stdout = io::stdout();
    let mut output = stdout.lock();

    loop {
        let mut line = Vec::new();
        let bytes_read = input
            .by_ref()
            .take((MAX_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if bytes_read == 0 {
            break;
        }
        if line.last() == Some(&b'\n') {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
        }

        let processed = runtime.process_request_line(&line, &auth_token);
        write_response(&mut output, &processed.response)?;
        if processed.should_shutdown || line.len() > MAX_LINE_BYTES {
            break;
        }
    }
    Ok(())
}

fn read_bootstrap_token(
    input: &mut impl BufRead,
) -> Result<Zeroizing<String>, Box<dyn std::error::Error>> {
    let mut encoded = Zeroizing::new(Vec::with_capacity(MAX_BOOTSTRAP_TOKEN_BYTES + 1));
    let bytes_read = input
        .by_ref()
        .take((MAX_BOOTSTRAP_TOKEN_BYTES + 2) as u64)
        .read_until(b'\n', encoded.as_mut())
        .map_err(|_| "SUPERVISOR_BOOTSTRAP_IO_FAILURE")?;
    if bytes_read == 0 || encoded.last() != Some(&b'\n') {
        return Err("SUPERVISOR_BOOTSTRAP_TOKEN_INVALID".into());
    }
    encoded.pop();
    if encoded.len() < MIN_BOOTSTRAP_TOKEN_BYTES
        || encoded.len() > MAX_BOOTSTRAP_TOKEN_BYTES
        || !encoded
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("SUPERVISOR_BOOTSTRAP_TOKEN_INVALID".into());
    }
    let decoded = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(encoded.as_slice())
            .map_err(|_| "SUPERVISOR_BOOTSTRAP_TOKEN_INVALID")?,
    );
    drop(decoded);
    let token = String::from_utf8(std::mem::take(encoded.as_mut()))
        .map_err(|_| "SUPERVISOR_BOOTSTRAP_TOKEN_INVALID")?;
    Ok(Zeroizing::new(token))
}

#[cfg(feature = "supervisor-control-test-support")]
fn test_supervisor_runtime() -> Result<SupervisorRuntime, Box<dyn std::error::Error>> {
    use std::fs::{File, symlink_metadata};
    use std::path::PathBuf;

    let state_directory = PathBuf::from(
        std::env::var_os(TEST_STATE_DIRECTORY_ENVIRONMENT_VARIABLE)
            .ok_or("AISTAFF_SUPERVISOR_STATE_DIR is required")?,
    );
    let key_path = PathBuf::from(
        std::env::var_os(TEST_DATA_KEY_FILE_ENVIRONMENT_VARIABLE)
            .ok_or("AISTAFF_SUPERVISOR_TEST_DATA_KEY_FILE is required")?,
    );
    let metadata = symlink_metadata(&key_path).map_err(|_| "test data key is unavailable")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() != 32 {
        return Err("test data key file is unsafe".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("test data key file is unsafe".into());
        }
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(32));
    File::open(&key_path)?
        .take(33)
        .read_to_end(bytes.as_mut())?;
    let key = Zeroizing::new(
        bytes
            .as_slice()
            .try_into()
            .map_err(|_| "test data key length is invalid")?,
    );
    SupervisorRuntime::with_supervisor_control_state(&state_directory, *key)
        .map_err(|error| error.into())
}

fn main() {
    let mut arguments = std::env::args_os().skip(1);
    match (arguments.next(), arguments.next()) {
        (None, None) => {
            if let Err(error) = run_supervisor(|| Ok(SupervisorRuntime::new())) {
                eprintln!("{} startup failure: {}", PROTOCOL_VERSION, error);
                std::process::exit(78);
            }
        }
        #[cfg(feature = "supervisor-control-test-support")]
        (Some(mode), None) if mode == "--supervisor-control-test" => {
            if let Err(error) = run_supervisor(test_supervisor_runtime) {
                eprintln!("{} startup failure: {}", PROTOCOL_VERSION, error);
                std::process::exit(78);
            }
        }
        (Some(mode), None) if mode == "--message-cache-worker" => {
            if run_message_cache_worker_stdio().is_err() {
                eprintln!(
                    "{} startup failure: WORKER_IO_FAILURE",
                    MESSAGE_CACHE_WORKER_PROTOCOL_VERSION
                );
                std::process::exit(78);
            }
        }
        (Some(mode), None) if mode == "--local-mcp-time-server" => {
            if run_local_mcp_time_server_stdio().is_err() {
                eprintln!(
                    "{} startup failure: LOCAL_MCP_TIME_IO_FAILURE",
                    PROTOCOL_VERSION
                );
                std::process::exit(78);
            }
        }
        _ => {
            eprintln!("{} startup failure: INVALID_ARGUMENTS", PROTOCOL_VERSION);
            std::process::exit(78);
        }
    }
}
