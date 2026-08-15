use crate::local_capability::{
    ControlReadPayload, LocalCapabilityError, admit_control_root, read_control_capability,
};
use crate::protocol::MAX_LINE_BYTES;
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, to_value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fmt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

mod store;

use store::SqliteStateStore;

pub(crate) const CONTROL_VERSION: &str = "aidesktop.supervisor-control.v1";
pub(crate) const CONTROL_MAX_RESULT_BYTES: u64 = 24 * 1024;
const CONTROL_CAPABILITIES: [&str; 2] = ["file/read_text", "directory/list"];
const MAX_OPERATIONS: usize = 256;
const MAX_ACTIVE_GRANTS: usize = 64;
const MAX_IDENTIFIER_BYTES: usize = 180;
const MAX_DISPLAY_NAME_BYTES: usize = 255;
const MAX_ROOT_PATH_BYTES: usize = 4_096;

const CONTROL_COMMANDS: [&str; 6] = [
    "control.hello",
    "control.grant.register",
    "control.grant.revoke",
    "control.capability.read",
    "control.receipt.get",
    "control.operation.read",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupervisorControlFailure {
    pub code: &'static str,
}

impl SupervisorControlFailure {
    const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl fmt::Display for SupervisorControlFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code)
    }
}

impl std::error::Error for SupervisorControlFailure {}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum SubjectBinding {
    Local {
        activity_ref: String,
        dsh_session_id: String,
    },
    Managed {
        tenant_id: String,
        device_session_id: String,
        run_id: String,
        step_id: String,
        attempt: u64,
        dsh_session_id: String,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum GrantAccess {
    ReadOnly,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct GrantRegisterInput {
    operation_id: String,
    subject: SubjectBinding,
    root_path: String,
    display_name: String,
    access: GrantAccess,
    allowed_intents: Vec<String>,
    expires_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct GrantRevokeInput {
    operation_id: String,
    grant_handle: String,
    expected_grant_revision: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ExecutionContext {
    CapabilityOnly { capability_context_handle: String },
    ManagedRuntime { runtime_handle: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ReadCapabilityInput {
    operation_id: String,
    execution_context: ExecutionContext,
    subject: SubjectBinding,
    grant_handle: String,
    expected_grant_revision: String,
    intent: String,
    relative_segments: Vec<String>,
    max_bytes: u64,
    deadline_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiptGetInput {
    receipt_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationReadInput {
    operation_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct GrantProjection {
    grant_handle: String,
    grant_revision: String,
    display_name: String,
    access: GrantAccess,
    allowed_intents: Vec<String>,
    expires_at: String,
    root_fingerprint: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ReceiptStatus {
    Succeeded,
    Failed,
    Rejected,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum EffectState {
    None,
    NotApplied,
    Applied,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Receipt {
    receipt_ref: String,
    operation_id: String,
    status: ReceiptStatus,
    effect_state: EffectState,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason_code: Option<String>,
    evidence_refs: Vec<String>,
    receipt_hash: String,
    recorded_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct GrantResult {
    grant: GrantProjection,
    receipt: Receipt,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DirectoryEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DirectoryEntry {
    name: String,
    kind: DirectoryEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ReadPayload {
    File {
        bytes_base64: String,
        media_type: String,
    },
    Directory {
        entries: Vec<DirectoryEntry>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ReadResult {
    payload: ReadPayload,
    receipt: Receipt,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OperationState {
    Succeeded,
    Failed,
    Rejected,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
struct OperationStatus {
    operation_id: String,
    state: OperationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt_ref: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct StoredGrant {
    projection: GrantProjection,
    subject: SubjectBinding,
    root_path: String,
    expires_at_epoch_ms: u64,
    active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OperationKind {
    GrantRegister,
    GrantRevoke,
    CapabilityRead,
}

#[derive(Debug, Clone)]
struct StoredOperation {
    operation_id: String,
    request_hash: String,
    kind: OperationKind,
    response: Value,
    receipt: Receipt,
}

enum StoreEffect {
    Register(Box<StoredGrant>),
    Revoke {
        grant_handle: String,
        expected_grant_revision: String,
    },
    Read,
}

struct StoreCommit {
    operation: StoredOperation,
    effect: StoreEffect,
}

trait SupervisorStateStore: Send {
    fn operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<StoredOperation>, SupervisorControlFailure>;

    fn receipt(&self, receipt_ref: &str) -> Result<Option<Receipt>, SupervisorControlFailure>;

    fn grant(&self, grant_handle: &str) -> Result<Option<StoredGrant>, SupervisorControlFailure>;

    fn commit(&mut self, commit: StoreCommit) -> Result<(), SupervisorControlFailure>;
}

struct UnavailableStateStore;

impl SupervisorStateStore for UnavailableStateStore {
    fn operation(
        &self,
        _operation_id: &str,
    ) -> Result<Option<StoredOperation>, SupervisorControlFailure> {
        Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }

    fn receipt(&self, _receipt_ref: &str) -> Result<Option<Receipt>, SupervisorControlFailure> {
        Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }

    fn grant(&self, _grant_handle: &str) -> Result<Option<StoredGrant>, SupervisorControlFailure> {
        Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }

    fn commit(&mut self, _commit: StoreCommit) -> Result<(), SupervisorControlFailure> {
        Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }
}

pub(crate) struct SupervisorControlRuntime {
    capability_context_handle: String,
    capabilities: &'static [&'static str],
    state: Box<dyn SupervisorStateStore>,
}

impl SupervisorControlRuntime {
    pub(crate) fn unavailable() -> Result<Self, SupervisorControlFailure> {
        Ok(Self {
            capability_context_handle: random_handle("capability-context")?,
            capabilities: &[],
            state: Box::new(UnavailableStateStore),
        })
    }

    pub(crate) fn with_sqlite_state(
        state_directory: &Path,
        data_key: [u8; 32],
    ) -> Result<Self, SupervisorControlFailure> {
        Ok(Self {
            capability_context_handle: random_handle("capability-context")?,
            capabilities: &CONTROL_CAPABILITIES,
            state: Box::new(SqliteStateStore::open(state_directory, data_key)?),
        })
    }

    pub(crate) fn handle(
        &mut self,
        command: &str,
        payload: Option<Value>,
    ) -> Result<Value, SupervisorControlFailure> {
        match command {
            "control.hello" => {
                require_no_payload(payload)?;
                Ok(serde_json::json!({
                    "control_version": CONTROL_VERSION,
                    "supervisor_version": env!("CARGO_PKG_VERSION"),
                    "supported_control_versions": [CONTROL_VERSION],
                    "platform": std::env::consts::OS,
                    "architecture": std::env::consts::ARCH,
                    "capabilities": self.capabilities,
                    "max_request_bytes": MAX_LINE_BYTES,
                    "max_result_bytes": CONTROL_MAX_RESULT_BYTES,
                    "capability_context_handle": self.capability_context_handle,
                }))
            }
            "control.grant.register" => {
                let input: GrantRegisterInput = parse_payload(payload)?;
                self.register_grant(input)
            }
            "control.grant.revoke" => {
                let input: GrantRevokeInput = parse_payload(payload)?;
                self.revoke_grant(input)
            }
            "control.capability.read" => {
                let input: ReadCapabilityInput = parse_payload(payload)?;
                self.read_capability(input)
            }
            "control.receipt.get" => {
                let input: ReceiptGetInput = parse_payload(payload)?;
                validate_identifier(&input.receipt_ref)?;
                let receipt = self
                    .state
                    .receipt(&input.receipt_ref)?
                    .ok_or_else(|| SupervisorControlFailure::new("NOT_FOUND"))?;
                serialize(receipt)
            }
            "control.operation.read" => {
                let input: OperationReadInput = parse_payload(payload)?;
                validate_identifier(&input.operation_id)?;
                let operation = self
                    .state
                    .operation(&input.operation_id)?
                    .ok_or_else(|| SupervisorControlFailure::new("NOT_FOUND"))?;
                serialize(operation_status(&operation))
            }
            _ => Err(SupervisorControlFailure::new("INVALID_REQUEST")),
        }
    }

    fn register_grant(
        &mut self,
        input: GrantRegisterInput,
    ) -> Result<Value, SupervisorControlFailure> {
        let request_hash = operation_hash("control.grant.register", &input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash)? {
            return Ok(response);
        }
        validate_operation_id(&input.operation_id)?;
        validate_local_subject(&input.subject)?;
        validate_display_name(&input.display_name)?;
        validate_intents(&input.allowed_intents)?;
        if input.root_path.is_empty()
            || input.root_path.len() > MAX_ROOT_PATH_BYTES
            || input.root_path.contains('\0')
        {
            return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
        }
        let expires_at_epoch_ms = parse_rfc3339_millis(&input.expires_at)
            .ok_or_else(|| SupervisorControlFailure::new("INVALID_REQUEST"))?;
        if expires_at_epoch_ms <= now_epoch_ms()? {
            return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
        }
        let admitted_root = admit_control_root(&input.root_path).map_err(map_file_error)?;
        let grant_handle = self.unique_handle("grant")?;
        let grant_revision = random_handle("grant-revision")?;
        let projection = GrantProjection {
            grant_handle: grant_handle.clone(),
            grant_revision,
            display_name: input.display_name,
            access: input.access,
            allowed_intents: input.allowed_intents,
            expires_at: input.expires_at,
            root_fingerprint: admitted_root.fingerprint,
        };
        let receipt = new_receipt(&input.operation_id, EffectState::None)?;
        let response = serialize(GrantResult {
            grant: projection.clone(),
            receipt: receipt.clone(),
        })?;
        self.state.commit(StoreCommit {
            operation: StoredOperation {
                operation_id: input.operation_id,
                request_hash,
                kind: OperationKind::GrantRegister,
                response: response.clone(),
                receipt,
            },
            effect: StoreEffect::Register(Box::new(StoredGrant {
                projection,
                subject: input.subject,
                root_path: admitted_root.canonical_path,
                expires_at_epoch_ms,
                active: true,
            })),
        })?;
        Ok(response)
    }

    fn revoke_grant(&mut self, input: GrantRevokeInput) -> Result<Value, SupervisorControlFailure> {
        let request_hash = operation_hash("control.grant.revoke", &input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash)? {
            return Ok(response);
        }
        validate_operation_id(&input.operation_id)?;
        validate_identifier(&input.grant_handle)?;
        validate_identifier(&input.expected_grant_revision)?;
        let grant = self
            .state
            .grant(&input.grant_handle)?
            .ok_or_else(|| SupervisorControlFailure::new("GRANT_NOT_ACTIVE"))?;
        if !grant.active {
            return Err(SupervisorControlFailure::new("GRANT_NOT_ACTIVE"));
        }
        if grant.projection.grant_revision != input.expected_grant_revision {
            return Err(SupervisorControlFailure::new("GRANT_REVISION_MISMATCH"));
        }
        let receipt = new_receipt(&input.operation_id, EffectState::NotApplied)?;
        let response = serialize(receipt.clone())?;
        self.state.commit(StoreCommit {
            operation: StoredOperation {
                operation_id: input.operation_id,
                request_hash,
                kind: OperationKind::GrantRevoke,
                response: response.clone(),
                receipt,
            },
            effect: StoreEffect::Revoke {
                grant_handle: input.grant_handle,
                expected_grant_revision: input.expected_grant_revision,
            },
        })?;
        Ok(response)
    }

    fn read_capability(
        &mut self,
        input: ReadCapabilityInput,
    ) -> Result<Value, SupervisorControlFailure> {
        let request_hash = operation_hash("control.capability.read", &input)?;
        if let Some(response) = self.replay(&input.operation_id, &request_hash)? {
            return Ok(response);
        }
        validate_operation_id(&input.operation_id)?;
        validate_local_subject(&input.subject)?;
        validate_identifier(&input.grant_handle)?;
        validate_identifier(&input.expected_grant_revision)?;
        if input.max_bytes == 0 || input.max_bytes > CONTROL_MAX_RESULT_BYTES {
            return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
        }
        let deadline = parse_rfc3339_millis(&input.deadline_at)
            .ok_or_else(|| SupervisorControlFailure::new("INVALID_REQUEST"))?;
        if deadline <= now_epoch_ms()? {
            return Err(SupervisorControlFailure::new("DEADLINE_EXPIRED"));
        }
        match &input.execution_context {
            ExecutionContext::CapabilityOnly {
                capability_context_handle,
            } if capability_context_handle == &self.capability_context_handle => {}
            ExecutionContext::CapabilityOnly { .. } | ExecutionContext::ManagedRuntime { .. } => {
                return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
            }
        }
        if !CONTROL_CAPABILITIES.contains(&input.intent.as_str()) {
            return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
        }
        let grant = self
            .state
            .grant(&input.grant_handle)?
            .ok_or_else(|| SupervisorControlFailure::new("GRANT_NOT_ACTIVE"))?;
        if !grant.active || grant.expires_at_epoch_ms <= now_epoch_ms()? {
            return Err(SupervisorControlFailure::new("GRANT_NOT_ACTIVE"));
        }
        if grant.projection.grant_revision != input.expected_grant_revision {
            return Err(SupervisorControlFailure::new("GRANT_REVISION_MISMATCH"));
        }
        if grant.subject != input.subject {
            return Err(SupervisorControlFailure::new("GRANT_SCOPE_MISMATCH"));
        }
        if !grant.projection.allowed_intents.contains(&input.intent) {
            return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
        }
        let payload = read_control_capability(
            &grant.root_path,
            &grant.projection.root_fingerprint,
            &input.intent,
            input.relative_segments,
            input.max_bytes,
        )
        .map_err(map_file_error)?;
        let payload = match payload {
            ControlReadPayload::File(bytes) => ReadPayload::File {
                bytes_base64: STANDARD.encode(bytes),
                media_type: "text/plain; charset=utf-8".to_owned(),
            },
            ControlReadPayload::Directory(entries) => ReadPayload::Directory {
                entries: entries
                    .into_iter()
                    .map(|entry| DirectoryEntry {
                        name: entry.name,
                        kind: match entry.kind {
                            "file" => DirectoryEntryKind::File,
                            "directory" => DirectoryEntryKind::Directory,
                            _ => unreachable!("control read adapter exposes a closed entry kind"),
                        },
                        size_bytes: entry.size_bytes,
                    })
                    .collect(),
            },
        };
        if matches!(payload, ReadPayload::Directory { .. })
            && serialized_len(&payload)? > input.max_bytes as usize
        {
            return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
        }
        let receipt = new_receipt(&input.operation_id, EffectState::None)?;
        let response = serialize(ReadResult {
            payload,
            receipt: receipt.clone(),
        })?;
        self.state.commit(StoreCommit {
            operation: StoredOperation {
                operation_id: input.operation_id,
                request_hash,
                kind: OperationKind::CapabilityRead,
                response: response.clone(),
                receipt,
            },
            effect: StoreEffect::Read,
        })?;
        Ok(response)
    }

    fn replay(
        &self,
        operation_id: &str,
        request_hash: &str,
    ) -> Result<Option<Value>, SupervisorControlFailure> {
        let Some(operation) = self.state.operation(operation_id)? else {
            return Ok(None);
        };
        if operation.request_hash != request_hash {
            return Err(SupervisorControlFailure::new("OPERATION_CONFLICT"));
        }
        Ok(Some(operation.response))
    }

    fn unique_handle(&self, prefix: &str) -> Result<String, SupervisorControlFailure> {
        for _ in 0..4 {
            let candidate = random_handle(prefix)?;
            if self.state.grant(&candidate)?.is_none() {
                return Ok(candidate);
            }
        }
        Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }
}

pub(crate) fn is_supervisor_control_command(command: &str) -> bool {
    CONTROL_COMMANDS.contains(&command)
}

fn operation_status(operation: &StoredOperation) -> OperationStatus {
    let state = match operation.receipt.status {
        ReceiptStatus::Succeeded => OperationState::Succeeded,
        ReceiptStatus::Failed => OperationState::Failed,
        ReceiptStatus::Rejected => OperationState::Rejected,
        ReceiptStatus::Unknown => OperationState::Unknown,
    };
    OperationStatus {
        operation_id: operation.operation_id.clone(),
        state,
        receipt_ref: Some(operation.receipt.receipt_ref.clone()),
        updated_at: operation.receipt.recorded_at.clone(),
    }
}

fn validate_operation_id(value: &str) -> Result<(), SupervisorControlFailure> {
    validate_identifier(value)
}

fn validate_identifier(value: &str) -> Result<(), SupervisorControlFailure> {
    let mut bytes = value.bytes();
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || !bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || !bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
    }
    Ok(())
}

fn validate_local_subject(subject: &SubjectBinding) -> Result<(), SupervisorControlFailure> {
    match subject {
        SubjectBinding::Local {
            activity_ref,
            dsh_session_id,
        } => {
            validate_identifier(activity_ref)?;
            validate_identifier(dsh_session_id)
        }
        SubjectBinding::Managed { .. } => Err(SupervisorControlFailure::new("CAPABILITY_DENIED")),
    }
}

fn validate_display_name(value: &str) -> Result<(), SupervisorControlFailure> {
    if value.trim().is_empty()
        || value.len() > MAX_DISPLAY_NAME_BYTES
        || value.contains(['/', '\\', '\0'])
        || value.chars().any(char::is_control)
    {
        return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
    }
    Ok(())
}

fn validate_intents(values: &[String]) -> Result<(), SupervisorControlFailure> {
    let mut seen = HashSet::new();
    if values.is_empty()
        || values.len() > CONTROL_CAPABILITIES.len()
        || values.iter().any(|value| {
            !CONTROL_CAPABILITIES.contains(&value.as_str()) || !seen.insert(value.as_str())
        })
    {
        return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
    }
    Ok(())
}

fn new_receipt(
    operation_id: &str,
    effect_state: EffectState,
) -> Result<Receipt, SupervisorControlFailure> {
    let receipt_ref = random_handle("receipt")?;
    let recorded_at = format_rfc3339_millis(now_epoch_ms()?)?;
    let mut receipt = Receipt {
        receipt_ref,
        operation_id: operation_id.to_owned(),
        status: ReceiptStatus::Succeeded,
        effect_state,
        reason_code: None,
        evidence_refs: Vec::new(),
        receipt_hash: String::new(),
        recorded_at,
    };
    receipt.receipt_hash = receipt_hash(&receipt)?;
    Ok(receipt)
}

fn receipt_hash(receipt: &Receipt) -> Result<String, SupervisorControlFailure> {
    let mut normalized = receipt.clone();
    normalized.receipt_hash.clear();
    let bytes = serde_json::to_vec(&normalized)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    let mut hasher = Sha256::new();
    hasher.update(b"aidesktop.supervisor-receipt.v1\0");
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
    Ok(URL_SAFE_NO_PAD.encode(hasher.finalize()))
}

fn operation_hash<T: Serialize>(
    command: &str,
    input: &T,
) -> Result<String, SupervisorControlFailure> {
    let bytes =
        serde_json::to_vec(input).map_err(|_| SupervisorControlFailure::new("INVALID_REQUEST"))?;
    let mut hasher = Sha256::new();
    hasher.update(b"aidesktop.supervisor-operation.v1\0");
    hasher.update((command.len() as u64).to_be_bytes());
    hasher.update(command.as_bytes());
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
    Ok(hex_digest(&hasher.finalize()))
}

fn random_handle(prefix: &str) -> Result<String, SupervisorControlFailure> {
    let mut random = [0_u8; 18];
    getrandom::fill(&mut random)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    Ok(format!("{prefix}-{}", URL_SAFE_NO_PAD.encode(random)))
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

fn map_file_error(error: LocalCapabilityError) -> SupervisorControlFailure {
    let code = match error.code {
        "INVALID_LOCAL_FILE_RELATIVE_SEGMENTS"
        | "INVALID_LOCAL_FILE_MAX_BYTES"
        | "LOCAL_FILE_READ_OUTPUT_BUDGET_EXCEEDED"
        | "LOCAL_FILE_ROOT_NOT_ADMISSIBLE"
        | "LOCAL_FILE_ROOT_NOT_DIRECTORY" => "INVALID_REQUEST",
        "LOCAL_FILE_TARGET_UNAVAILABLE" | "LOCAL_FILE_ROOT_UNAVAILABLE" => "NOT_FOUND",
        "LOCAL_FILE_ROOT_TOO_BROAD"
        | "LOCAL_FILE_TARGET_TOO_LARGE"
        | "LOCAL_FILE_TARGET_INTENT_MISMATCH"
        | "LOCAL_FILE_GRANT_INTENT_NOT_ALLOWED"
        | "LOCAL_FILE_TEXT_ENCODING_UNSUPPORTED"
        | "LOCAL_DIRECTORY_RESULT_LIMIT_EXCEEDED"
        | "LOCAL_DIRECTORY_ENTRY_TYPE_UNSUPPORTED"
        | "LOCAL_DIRECTORY_NAME_BUDGET_EXCEEDED"
        | "LOCAL_DIRECTORY_SCAN_LIMIT_EXCEEDED" => "CAPABILITY_DENIED",
        "LOCAL_FILE_ROOT_IDENTITY_CHANGED"
        | "LOCAL_FILE_ROOT_HANDLE_IDENTITY_MISMATCH"
        | "LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED"
        | "LOCAL_FILE_TARGET_ESCAPES_GRANT"
        | "LOCAL_FILE_TARGET_IDENTITY_CHANGED"
        | "LOCAL_FILE_OPENED_IDENTITY_MISMATCH"
        | "LOCAL_FILE_OPENED_IDENTITY_CHANGED"
        | "LOCAL_DIRECTORY_OPENED_IDENTITY_MISMATCH"
        | "LOCAL_DIRECTORY_OPENED_IDENTITY_CHANGED" => "TARGET_IDENTITY_CHANGED",
        _ => "SUPERVISOR_UNAVAILABLE",
    };
    SupervisorControlFailure::new(code)
}

fn parse_payload<T: DeserializeOwned>(
    payload: Option<Value>,
) -> Result<T, SupervisorControlFailure> {
    let value = payload.ok_or_else(|| SupervisorControlFailure::new("INVALID_REQUEST"))?;
    if serialized_len(&value)? > MAX_LINE_BYTES {
        return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
    }
    serde_json::from_value(value).map_err(|_| SupervisorControlFailure::new("INVALID_REQUEST"))
}

fn require_no_payload(payload: Option<Value>) -> Result<(), SupervisorControlFailure> {
    if payload.is_some() {
        return Err(SupervisorControlFailure::new("INVALID_REQUEST"));
    }
    Ok(())
}

fn serialize<T: Serialize>(value: T) -> Result<Value, SupervisorControlFailure> {
    to_value(value).map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

fn serialized_len<T: Serialize>(value: &T) -> Result<usize, SupervisorControlFailure> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

fn now_epoch_ms() -> Result<u64, SupervisorControlFailure> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

fn parse_rfc3339_millis(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return None;
    }
    let year = decimal(bytes.get(0..4)?)? as i64;
    let month = decimal(bytes.get(5..7)?)? as i64;
    let day = decimal(bytes.get(8..10)?)? as i64;
    let hour = decimal(bytes.get(11..13)?)? as i64;
    let minute = decimal(bytes.get(14..16)?)? as i64;
    let second = decimal(bytes.get(17..19)?)? as i64;
    if year < 1970
        || !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }

    let mut cursor = 19;
    let mut millisecond = 0_i64;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        let fraction = bytes.get(start..cursor)?;
        if fraction.is_empty() || fraction.len() > 9 {
            return None;
        }
        for (index, byte) in fraction.iter().take(3).enumerate() {
            millisecond += i64::from(byte - b'0') * 10_i64.pow(2_u32.saturating_sub(index as u32));
        }
    }
    let offset_seconds = match bytes.get(cursor) {
        Some(b'Z') => {
            cursor += 1;
            0_i64
        }
        Some(sign @ (b'+' | b'-')) => {
            let offset_hour = decimal(bytes.get(cursor + 1..cursor + 3)?)? as i64;
            let offset_minute = decimal(bytes.get(cursor + 4..cursor + 6)?)? as i64;
            if bytes.get(cursor + 3) != Some(&b':') || offset_hour > 23 || offset_minute > 59 {
                return None;
            }
            cursor += 6;
            let offset = offset_hour * 3_600 + offset_minute * 60;
            if *sign == b'-' { -offset } else { offset }
        }
        _ => return None,
    };
    if cursor != bytes.len() {
        return None;
    }
    let seconds = days_from_civil(year, month, day)
        .checked_mul(86_400)?
        .checked_add(hour * 3_600 + minute * 60 + second)?
        .checked_sub(offset_seconds)?;
    u64::try_from(seconds.checked_mul(1_000)?.checked_add(millisecond)?).ok()
}

fn decimal(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bytes.iter().try_fold(0_u32, |value, byte| {
        value.checked_mul(10)?.checked_add(u32::from(byte - b'0'))
    })
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let year_of_era = adjusted_year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn format_rfc3339_millis(epoch_ms: u64) -> Result<String, SupervisorControlFailure> {
    let epoch_seconds = i64::try_from(epoch_ms / 1_000)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    let days = epoch_seconds.div_euclid(86_400);
    let seconds_of_day = epoch_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    if !(0..=9_999).contains(&year) {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    let hour = seconds_of_day / 3_600;
    let minute = seconds_of_day % 3_600 / 60;
    let second = seconds_of_day % 60;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z",
        epoch_ms % 1_000
    ))
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_parser_handles_utc_fraction_and_offset() {
        assert_eq!(parse_rfc3339_millis("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_millis("2026-08-15T12:34:56.789Z"),
            parse_rfc3339_millis("2026-08-15T20:34:56.789+08:00")
        );
        assert_eq!(
            format_rfc3339_millis(1_787_920_496_789).expect("timestamp"),
            "2026-08-28T12:34:56.789Z"
        );
    }

    #[test]
    fn managed_subject_is_not_admitted_by_local_control() {
        assert_eq!(
            validate_local_subject(&SubjectBinding::Managed {
                tenant_id: "tenant".to_owned(),
                device_session_id: "device".to_owned(),
                run_id: "run".to_owned(),
                step_id: "step".to_owned(),
                attempt: 1,
                dsh_session_id: "session".to_owned(),
            }),
            Err(SupervisorControlFailure::new("CAPABILITY_DENIED"))
        );
    }
}
