use serde::{Deserialize, Serialize};

pub const MESSAGE_CACHE_PROTOCOL_VERSION: &str = "aistaff.message-cache.v1";
pub const MESSAGE_CACHE_CAPABILITY: &str = "message_cache.v1";
#[cfg_attr(not(test), allow(dead_code))]
pub const LOCAL_HISTORY_PROTOCOL_VERSION: &str = "aistaff.message-cache.client-local-history.v1";
pub const MESSAGE_CACHE_COMMANDS: [&str; 9] = [
    "cache.capabilities",
    "cache.open_scope",
    "cache.put_confirmed",
    "cache.page",
    "cache.purge_scope",
    "cache.reconcile",
    "cache.local_history.put",
    "cache.local_history.snapshot",
    "cache.local_history.release",
];

const MAX_SCOPE_HANDLE_BYTES: usize = 64;
const MAX_RESOURCE_ID_BYTES: usize = 160;
const MAX_EVENT_TYPE_BYTES: usize = 96;
const MAX_TIMESTAMP_BYTES: usize = 64;
const MAX_SUMMARY_BYTES: usize = 512;
const MAX_CURSOR_BYTES: usize = 256;
const MAX_PAGE_SIZE: u16 = 50;
const LOCAL_HISTORY_LIMIT: usize = 8;
const LOCAL_HISTORY_MESSAGE_LIMIT: usize = 8;
const MAX_LOCAL_HISTORY_MESSAGE_BYTES: usize = 512;
const MAX_LOCAL_HISTORY_TITLE_BYTES: usize = 160;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(test), allow(dead_code))]
pub enum CacheAvailability {
    Available,
    AdapterUnavailable,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(test), allow(dead_code))]
pub enum CacheScopeStatus {
    Ready,
    Corrupt,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(test), allow(dead_code))]
pub enum ReconcileDecision {
    UseCache,
    RefreshRequired,
    RebuildRequired,
    ReconcileRequired,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    User,
    Service,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Confirmed,
    Pending,
    Unknown,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectState {
    Known,
    Unknown,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum RedactionProfile {
    #[serde(rename = "summary_only.v1")]
    SummaryOnlyV1,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CacheCapabilitiesResult {
    pub protocol_version: &'static str,
    pub adapter_id: &'static str,
    pub availability: CacheAvailability,
    pub persistent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<&'static str>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OpenScopeInput {
    pub scope_handle: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OpenScopeResult {
    pub protocol_version: &'static str,
    pub scope_status: CacheScopeStatus,
    pub adapter_id: &'static str,
    pub persistent: bool,
    pub reopened: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConfirmedTimelineProjection {
    pub thread_id: String,
    pub sequence: u64,
    pub event_type: String,
    pub actor_type: ActorType,
    pub occurred_at: String,
    pub masked_summary: String,
    pub payload_hash: String,
    pub run_id: Option<String>,
    pub server_cursor: Option<String>,
    pub delivery_state: DeliveryState,
    pub redaction_profile: RedactionProfile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PutConfirmedInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub projection: ConfirmedTimelineProjection,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PutConfirmedResult {
    pub protocol_version: &'static str,
    pub projection: ConfirmedTimelineProjection,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PageInput {
    pub scope_handle: String,
    pub thread_id: String,
    pub after_sequence: Option<u64>,
    pub limit: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PageResult {
    pub protocol_version: &'static str,
    pub projections: Vec<ConfirmedTimelineProjection>,
    pub next_after_sequence: Option<u64>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PurgeScopeInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PurgeScopeResult {
    pub protocol_version: &'static str,
    pub purged: bool,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReconcileInput {
    pub scope_handle: String,
    pub thread_id: String,
    pub server_last_sequence: u64,
    pub server_cursor: Option<String>,
    pub side_effect_state: SideEffectState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReconcileResult {
    pub protocol_version: &'static str,
    pub decision: ReconcileDecision,
    pub cache_last_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalHistoryMode {
    Ask,
    Craft,
    Plan,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalHistoryStatus {
    Processing,
    AwaitingConfirmation,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalHistoryMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalHistoryMessage {
    pub sequence: u8,
    pub role: LocalHistoryMessageRole,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalHistoryResultProjection {
    pub turn_count: u8,
    pub reasoning_observed: bool,
    pub tool_call_count: u8,
    pub tool_execution: bool,
    pub filesystem_execution: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LocalHistoryTaskProjection {
    pub schema_revision: u8,
    pub origin: String,
    pub server_scope_consumed: bool,
    pub task_id: String,
    pub conversation_id: String,
    pub operation_id: String,
    pub mode: LocalHistoryMode,
    pub status: LocalHistoryStatus,
    pub reason_code: Option<String>,
    pub title: String,
    pub updated_at_epoch_ms: u64,
    pub provider_identity_digest: String,
    pub context_restore_required: bool,
    pub messages: Vec<LocalHistoryMessage>,
    pub result: Option<LocalHistoryResultProjection>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PutLocalHistoryInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub projection: LocalHistoryTaskProjection,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PutLocalHistoryResult {
    pub protocol_version: &'static str,
    pub projection: LocalHistoryTaskProjection,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SnapshotLocalHistoryInput {
    pub scope_handle: String,
    pub provider_identity_digest: String,
    pub limit: u8,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SnapshotLocalHistoryResult {
    pub protocol_version: &'static str,
    pub projections: Vec<LocalHistoryTaskProjection>,
    pub interrupted_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReleaseLocalHistoryInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub conversation_id: String,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReleaseLocalHistoryResult {
    pub protocol_version: &'static str,
    pub conversation_id: String,
    pub released: bool,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageCacheError {
    pub code: &'static str,
}

impl MessageCacheError {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub fn is_message_cache_command(command: &str) -> bool {
    MESSAGE_CACHE_COMMANDS.contains(&command)
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn is_safe_identifier(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn is_bounded_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.contains('\0')
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_scope_handle(scope_handle: &str) -> Result<(), MessageCacheError> {
    if !is_uuid(scope_handle) || scope_handle.len() > MAX_SCOPE_HANDLE_BYTES {
        return Err(MessageCacheError::new("INVALID_CACHE_SCOPE_HANDLE"));
    }
    Ok(())
}

fn validate_operation_id(operation_id: &str) -> Result<(), MessageCacheError> {
    if !is_uuid(operation_id) {
        return Err(MessageCacheError::new("INVALID_CACHE_OPERATION_ID"));
    }
    Ok(())
}

fn validate_cursor(cursor: Option<&str>) -> Result<(), MessageCacheError> {
    if cursor.is_some_and(|value| !is_bounded_text(value, MAX_CURSOR_BYTES)) {
        return Err(MessageCacheError::new("INVALID_CACHE_CURSOR"));
    }
    Ok(())
}

impl OpenScopeInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)
    }
}

impl PutConfirmedInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        validate_operation_id(&self.operation_id)?;
        self.projection.validate()
    }
}

impl ConfirmedTimelineProjection {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        if !is_safe_identifier(&self.thread_id, MAX_RESOURCE_ID_BYTES) {
            return Err(MessageCacheError::new("INVALID_CACHE_THREAD_ID"));
        }
        if self.sequence == 0 {
            return Err(MessageCacheError::new("INVALID_CACHE_SEQUENCE"));
        }
        if !is_bounded_text(&self.event_type, MAX_EVENT_TYPE_BYTES) {
            return Err(MessageCacheError::new("INVALID_CACHE_EVENT_TYPE"));
        }
        if !is_bounded_text(&self.occurred_at, MAX_TIMESTAMP_BYTES) {
            return Err(MessageCacheError::new("INVALID_CACHE_TIMESTAMP"));
        }
        if self.masked_summary.len() > MAX_SUMMARY_BYTES || self.masked_summary.contains('\0') {
            return Err(MessageCacheError::new("INVALID_CACHE_SUMMARY"));
        }
        if !is_sha256(&self.payload_hash) {
            return Err(MessageCacheError::new("INVALID_CACHE_PAYLOAD_HASH"));
        }
        if self
            .run_id
            .as_deref()
            .is_some_and(|value| !is_safe_identifier(value, MAX_RESOURCE_ID_BYTES))
        {
            return Err(MessageCacheError::new("INVALID_CACHE_RUN_ID"));
        }
        validate_cursor(self.server_cursor.as_deref())?;
        if self.delivery_state != DeliveryState::Confirmed {
            return Err(MessageCacheError::new("CACHE_PROJECTION_NOT_CONFIRMED"));
        }
        Ok(())
    }
}

impl PageInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        if !is_safe_identifier(&self.thread_id, MAX_RESOURCE_ID_BYTES) {
            return Err(MessageCacheError::new("INVALID_CACHE_THREAD_ID"));
        }
        if self.limit == 0 || self.limit > MAX_PAGE_SIZE {
            return Err(MessageCacheError::new("INVALID_CACHE_PAGE_LIMIT"));
        }
        Ok(())
    }
}

impl PurgeScopeInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        validate_operation_id(&self.operation_id)?;
        if !self.confirmed {
            return Err(MessageCacheError::new("CACHE_PURGE_CONFIRMATION_REQUIRED"));
        }
        Ok(())
    }
}

impl ReconcileInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        if !is_safe_identifier(&self.thread_id, MAX_RESOURCE_ID_BYTES) {
            return Err(MessageCacheError::new("INVALID_CACHE_THREAD_ID"));
        }
        validate_cursor(self.server_cursor.as_deref())
    }
}

fn valid_reason_code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_uppercase() || byte.is_ascii_digit() || (index > 0 && byte == b'_')
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

impl LocalHistoryTaskProjection {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        if self.schema_revision != 1
            || self.origin != "client_local"
            || self.server_scope_consumed
            || !is_uuid(&self.task_id)
            || !is_uuid(&self.conversation_id)
            || !is_uuid(&self.operation_id)
            || self.updated_at_epoch_ms == 0
            || !valid_sha256(&self.provider_identity_digest)
            || self.title.trim().is_empty()
            || self.title.len() > MAX_LOCAL_HISTORY_TITLE_BYTES
            || self.title.contains('\0')
            || self.messages.len() > LOCAL_HISTORY_MESSAGE_LIMIT
        {
            return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_PROJECTION"));
        }
        for (index, message) in self.messages.iter().enumerate() {
            if usize::from(message.sequence) != index + 1
                || message.text.trim().is_empty()
                || message.text.len() > MAX_LOCAL_HISTORY_MESSAGE_BYTES
                || message.text.contains('\0')
            {
                return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_MESSAGE"));
            }
        }
        let requires_reason = matches!(
            self.status,
            LocalHistoryStatus::Failed
                | LocalHistoryStatus::Cancelled
                | LocalHistoryStatus::Interrupted
        );
        if requires_reason != self.reason_code.is_some()
            || self
                .reason_code
                .as_deref()
                .is_some_and(|reason| !valid_reason_code(reason))
            || (self.status == LocalHistoryStatus::Interrupted
                && self.reason_code.as_deref() != Some("CLIENT_RESTART_INTERRUPTED"))
        {
            return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_REASON_CODE"));
        }
        let requires_result = matches!(
            self.status,
            LocalHistoryStatus::Completed | LocalHistoryStatus::AwaitingConfirmation
        );
        if requires_result != self.result.is_some()
            || self.result.as_ref().is_some_and(|result| {
                result.turn_count == 0
                    || result.turn_count > 12
                    || result.tool_call_count != 0
                    || result.tool_execution
                    || result.filesystem_execution
            })
        {
            return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_RESULT"));
        }
        Ok(())
    }
}

impl PutLocalHistoryInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        validate_operation_id(&self.operation_id)?;
        self.projection.validate()
    }
}

impl SnapshotLocalHistoryInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        if usize::from(self.limit) != LOCAL_HISTORY_LIMIT
            || !valid_sha256(&self.provider_identity_digest)
        {
            return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_SNAPSHOT"));
        }
        Ok(())
    }
}

impl ReleaseLocalHistoryInput {
    pub fn validate(&self) -> Result<(), MessageCacheError> {
        validate_scope_handle(&self.scope_handle)?;
        validate_operation_id(&self.operation_id)?;
        if !is_uuid(&self.conversation_id) || !self.confirmed {
            return Err(MessageCacheError::new("INVALID_LOCAL_HISTORY_RELEASE"));
        }
        Ok(())
    }
}
