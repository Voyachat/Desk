use super::path::valid_scope_handle;
use serde::{Deserialize, Serialize};

pub(crate) const RECOVERY_SCHEMA: &str = "aistaff.message-cache-recovery";
pub(crate) const RECOVERY_SCHEMA_VERSION: u32 = 1;
pub(crate) const RECOVERY_RECORD_LIMIT: u16 = 32;
pub(crate) const RECOVERY_FILE_BYTES_LIMIT: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CacheRecoveryReason {
    IntegrityConfirmedCorrupt,
    DecryptedSchemaMismatch,
}

impl CacheRecoveryReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::IntegrityConfirmedCorrupt => "integrity_confirmed_corrupt",
            Self::DecryptedSchemaMismatch => "decrypted_schema_mismatch",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MessageCacheWorkerRebuildInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub expected_reason: CacheRecoveryReason,
    pub server_snapshot_hash: String,
    pub confirmed: bool,
}

impl MessageCacheWorkerRebuildInput {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if !valid_scope_handle(&self.scope_handle) {
            return Err("INVALID_CACHE_SCOPE_HANDLE");
        }
        if !valid_scope_handle(&self.operation_id) {
            return Err("CACHE_RECOVERY_OPERATION_ID_INVALID");
        }
        if !valid_sha256(&self.server_snapshot_hash) {
            return Err("CACHE_RECOVERY_SNAPSHOT_HASH_INVALID");
        }
        if !self.confirmed {
            return Err("CACHE_RECOVERY_CONFIRMATION_REQUIRED");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MessageCacheWorkerCompleteRebuildInput {
    pub scope_handle: String,
    pub operation_id: String,
    pub server_snapshot_hash: String,
    pub restored_projection_count: u64,
    pub confirmed: bool,
}

impl MessageCacheWorkerCompleteRebuildInput {
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        if !valid_scope_handle(&self.scope_handle) {
            return Err("INVALID_CACHE_SCOPE_HANDLE");
        }
        if !valid_scope_handle(&self.operation_id) {
            return Err("CACHE_RECOVERY_OPERATION_ID_INVALID");
        }
        if !valid_sha256(&self.server_snapshot_hash) {
            return Err("CACHE_RECOVERY_SNAPSHOT_HASH_INVALID");
        }
        if !self.confirmed {
            return Err("CACHE_RECOVERY_CONFIRMATION_REQUIRED");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RecoveryJournalState {
    Prepared,
    Quarantined,
    Restoring,
    Completed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryJournalRecord {
    pub schema: String,
    pub version: u32,
    pub sequence: u16,
    pub scope_digest: String,
    pub operation_id: String,
    pub request_hash: String,
    pub incident_id: String,
    pub reason: CacheRecoveryReason,
    pub state: RecoveryJournalState,
    pub created_at_epoch_s: i64,
    pub updated_at_epoch_s: i64,
    pub server_snapshot_hash: String,
    pub restored_projection_count: u64,
    pub restart_count: u16,
    pub evidence_hash: String,
}

impl RecoveryJournalRecord {
    pub(crate) fn validate_shape(&self) -> Result<(), &'static str> {
        if self.schema != RECOVERY_SCHEMA
            || self.version != RECOVERY_SCHEMA_VERSION
            || self.sequence >= RECOVERY_RECORD_LIMIT
            || !valid_sha256(&self.scope_digest)
            || !valid_scope_handle(&self.operation_id)
            || !valid_sha256(&self.request_hash)
            || !valid_incident_id(&self.incident_id)
            || self.created_at_epoch_s <= 0
            || self.updated_at_epoch_s < self.created_at_epoch_s
            || !valid_sha256(&self.server_snapshot_hash)
            || self.restart_count >= RECOVERY_RECORD_LIMIT
            || !valid_sha256(&self.evidence_hash)
        {
            return Err("CACHE_RECOVERY_JOURNAL_INVALID");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum QuarantineKind {
    CorruptProjection,
    PartialRestore,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct QuarantineManifest {
    pub schema: String,
    pub version: u32,
    pub scope_digest: String,
    pub operation_id: String,
    pub request_hash: String,
    pub incident_id: String,
    pub quarantine_id: String,
    pub reason: CacheRecoveryReason,
    pub kind: QuarantineKind,
    pub quarantined_at_epoch_s: i64,
    pub evidence_hash: String,
}

impl QuarantineManifest {
    pub(crate) fn validate_shape(&self) -> Result<(), &'static str> {
        if self.schema != RECOVERY_SCHEMA
            || self.version != RECOVERY_SCHEMA_VERSION
            || !valid_sha256(&self.scope_digest)
            || !valid_scope_handle(&self.operation_id)
            || !valid_sha256(&self.request_hash)
            || !valid_incident_id(&self.incident_id)
            || !valid_quarantine_id(&self.quarantine_id)
            || self.quarantined_at_epoch_s <= 0
            || !valid_sha256(&self.evidence_hash)
        {
            return Err("CACHE_QUARANTINE_MANIFEST_INVALID");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecoveryAdmission {
    pub scope_handle: String,
    pub reason: CacheRecoveryReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ActiveRestore {
    pub scope_handle: String,
    pub operation_id: String,
    pub request_hash: [u8; 32],
    pub server_snapshot_hash: String,
    pub incident_id: String,
    pub evidence_hash: String,
    pub restored_projection_count: u64,
}

pub(crate) fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_incident_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_quarantine_id(value: &str) -> bool {
    valid_incident_id(value)
        || value.strip_prefix("partial-").is_some_and(|suffix| {
            suffix.len() == 4 && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
}
