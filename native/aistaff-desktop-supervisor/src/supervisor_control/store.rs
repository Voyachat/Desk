use super::*;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use std::fs::{self, DirBuilder};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use zeroize::Zeroize;

const DATABASE_FILENAME: &str = "supervisor-control.sqlite3";
const APPLICATION_ID: i64 = 0x4144_5343;
const SCHEMA_VERSION: i64 = 1;
const BUSY_TIMEOUT_MS: u64 = 2_000;
const MAX_ENCRYPTED_VALUE_BYTES: usize = 128 * 1024;
const MAX_DATABASE_PAGES: i64 = 16_384;
const EXPECTED_TABLES: [&str; 4] = [
    "encryption_nonce",
    "grant_ledger",
    "local_receipt",
    "operation_journal",
];

struct EncryptedValue {
    bytes: Vec<u8>,
    nonce: [u8; 12],
}

pub(super) struct SqliteStateStore {
    connection: Connection,
    cipher: Aes256Gcm,
    database_path: PathBuf,
}

impl SqliteStateStore {
    pub(super) fn open(
        state_directory: &Path,
        mut data_key: [u8; 32],
    ) -> Result<Self, SupervisorControlFailure> {
        let state_directory = admit_state_directory(state_directory)?;
        let database_path = state_directory.join(DATABASE_FILENAME);
        validate_sqlite_file_family(&database_path)?;
        let database_preexisting = database_path.exists();
        if database_preexisting {
            require_file_permissions(&database_path)?;
        }
        let cipher = Aes256Gcm::new_from_slice(&data_key)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        data_key.zeroize();
        let mut connection = Connection::open_with_flags(
            &database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(map_sqlite_error)?;
        if !database_preexisting {
            restrict_file_permissions(&database_path)?;
        }
        connection
            .busy_timeout(Duration::from_millis(BUSY_TIMEOUT_MS))
            .map_err(map_sqlite_error)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .and_then(|()| connection.pragma_update(None, "synchronous", "FULL"))
            .map_err(map_sqlite_error)?;
        initialize_or_validate_schema(&mut connection)?;
        let journal_mode: String = connection
            .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))
            .map_err(map_sqlite_error)?;
        if !journal_mode.eq_ignore_ascii_case("wal") {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        connection
            .pragma_update(None, "synchronous", "FULL")
            .and_then(|()| connection.pragma_update(None, "wal_autocheckpoint", 64_i64))
            .and_then(|()| connection.pragma_update(None, "journal_size_limit", 1_048_576_i64))
            .and_then(|()| connection.pragma_update(None, "max_page_count", MAX_DATABASE_PAGES))
            .map_err(map_sqlite_error)?;
        let foreign_keys: i64 = connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .map_err(map_sqlite_error)?;
        let synchronous: i64 = connection
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .map_err(map_sqlite_error)?;
        if foreign_keys != 1 || synchronous < 2 {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        validate_sqlite_file_family(&database_path)?;
        restrict_sqlite_file_family(&database_path)?;
        let store = Self {
            connection,
            cipher,
            database_path,
        };
        store.validate_all_records()?;
        Ok(store)
    }

    fn encrypt(
        &self,
        table: &str,
        primary_key: &str,
        field: &str,
        plaintext: &[u8],
    ) -> Result<EncryptedValue, SupervisorControlFailure> {
        if plaintext.len() > MAX_ENCRYPTED_VALUE_BYTES {
            return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
        }
        let mut nonce = [0_u8; 12];
        getrandom::fill(&mut nonce)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let nonce_value = Nonce::from(nonce);
        let aad = encryption_aad(table, primary_key, field);
        let ciphertext = self
            .cipher
            .encrypt(
                &nonce_value,
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let mut bytes = Vec::with_capacity(1 + nonce.len() + ciphertext.len());
        bytes.push(1);
        bytes.extend_from_slice(&nonce);
        bytes.extend_from_slice(&ciphertext);
        if bytes.len() > MAX_ENCRYPTED_VALUE_BYTES {
            return Err(SupervisorControlFailure::new("CAPABILITY_DENIED"));
        }
        Ok(EncryptedValue { bytes, nonce })
    }

    fn decrypt(
        &self,
        table: &str,
        primary_key: &str,
        field: &str,
        encrypted: &[u8],
    ) -> Result<Vec<u8>, SupervisorControlFailure> {
        if encrypted.len() < 1 + 12 + 16
            || encrypted.len() > MAX_ENCRYPTED_VALUE_BYTES
            || encrypted[0] != 1
        {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        let nonce: [u8; 12] = encrypted[1..13]
            .try_into()
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let nonce_value = Nonce::from(nonce);
        let aad = encryption_aad(table, primary_key, field);
        self.cipher
            .decrypt(
                &nonce_value,
                Payload {
                    msg: &encrypted[13..],
                    aad: &aad,
                },
            )
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
    }

    fn load_receipt(&self, receipt_ref: &str) -> Result<Option<Receipt>, SupervisorControlFailure> {
        let raw = self
            .connection
            .query_row(
                "SELECT operation_id, status, effect_state, reason_code, evidence_refs_json, \
                 receipt_hash, recorded_at FROM local_receipt WHERE receipt_ref = ?1",
                [receipt_ref],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            operation_id,
            status,
            effect_state,
            reason_code,
            evidence_refs_json,
            receipt_hash_value,
            recorded_at,
        )) = raw
        else {
            return Ok(None);
        };
        let receipt = Receipt {
            receipt_ref: receipt_ref.to_owned(),
            operation_id,
            status: parse_receipt_status(&status)?,
            effect_state: parse_effect_state(&effect_state)?,
            reason_code,
            evidence_refs: serde_json::from_str(&evidence_refs_json)
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?,
            receipt_hash: receipt_hash_value,
            recorded_at,
        };
        validate_loaded_receipt(&receipt)?;
        Ok(Some(receipt))
    }

    fn validate_all_records(&self) -> Result<(), SupervisorControlFailure> {
        let operation_ids = collect_text_column(
            &self.connection,
            "SELECT operation_id FROM operation_journal ORDER BY operation_id",
        )?;
        let grant_handles = collect_text_column(
            &self.connection,
            "SELECT grant_handle FROM grant_ledger ORDER BY grant_handle",
        )?;
        let receipt_count: i64 = self
            .connection
            .query_row("SELECT count(*) FROM local_receipt", [], |row| row.get(0))
            .map_err(map_sqlite_error)?;
        let nonce_count: i64 = self
            .connection
            .query_row("SELECT count(*) FROM encryption_nonce", [], |row| {
                row.get(0)
            })
            .map_err(map_sqlite_error)?;
        if operation_ids.len() > MAX_OPERATIONS
            || grant_handles.len() > MAX_OPERATIONS
            || receipt_count != operation_ids.len() as i64
            || nonce_count != (operation_ids.len() + grant_handles.len()) as i64
        {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        for operation_id in operation_ids {
            self.operation(&operation_id)?
                .ok_or_else(|| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        }
        for grant_handle in grant_handles {
            self.grant(&grant_handle)?
                .ok_or_else(|| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        }
        Ok(())
    }
}

impl SupervisorStateStore for SqliteStateStore {
    fn operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<StoredOperation>, SupervisorControlFailure> {
        let raw = self
            .connection
            .query_row(
                "SELECT request_hash, operation_kind, result_ciphertext, receipt_ref \
                 FROM operation_journal WHERE operation_id = ?1",
                [operation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((request_hash, operation_kind, ciphertext, receipt_ref)) = raw else {
            return Ok(None);
        };
        require_registered_nonce(&self.connection, encrypted_nonce(&ciphertext)?)?;
        let result_bytes = self.decrypt(
            "operation_journal",
            operation_id,
            "result_ciphertext",
            &ciphertext,
        )?;
        let response = serde_json::from_slice(&result_bytes)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let receipt = self
            .load_receipt(&receipt_ref)?
            .ok_or_else(|| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let operation = StoredOperation {
            operation_id: operation_id.to_owned(),
            request_hash,
            kind: parse_operation_kind(&operation_kind)?,
            response,
            receipt,
        };
        validate_loaded_operation(&operation)?;
        Ok(Some(operation))
    }

    fn receipt(&self, receipt_ref: &str) -> Result<Option<Receipt>, SupervisorControlFailure> {
        self.load_receipt(receipt_ref)
    }

    fn grant(&self, grant_handle: &str) -> Result<Option<StoredGrant>, SupervisorControlFailure> {
        let raw = self
            .connection
            .query_row(
                "SELECT revision, subject_json, root_path_ciphertext, root_fingerprint, \
                 display_name, allowed_intents_json, expires_at, expires_at_epoch_ms, status \
                 FROM grant_ledger WHERE grant_handle = ?1",
                [grant_handle],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
            .optional()
            .map_err(map_sqlite_error)?;
        let Some((
            revision,
            subject_json,
            root_path_ciphertext,
            root_fingerprint,
            display_name,
            allowed_intents_json,
            expires_at,
            expires_at_epoch_ms,
            status,
        )) = raw
        else {
            return Ok(None);
        };
        require_registered_nonce(&self.connection, encrypted_nonce(&root_path_ciphertext)?)?;
        let root_path = self.decrypt(
            "grant_ledger",
            grant_handle,
            "root_path_ciphertext",
            &root_path_ciphertext,
        )?;
        let root_path = String::from_utf8(root_path)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let subject = serde_json::from_str(&subject_json)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let allowed_intents = serde_json::from_str(&allowed_intents_json)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let expires_at_epoch_ms = u64::try_from(expires_at_epoch_ms)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let grant = StoredGrant {
            projection: GrantProjection {
                grant_handle: grant_handle.to_owned(),
                grant_revision: revision,
                display_name,
                access: GrantAccess::ReadOnly,
                allowed_intents,
                expires_at,
                root_fingerprint,
            },
            subject,
            root_path,
            expires_at_epoch_ms,
            active: match status.as_str() {
                "active" => true,
                "revoked" => false,
                _ => return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
            },
        };
        validate_loaded_grant(&grant)?;
        Ok(Some(grant))
    }

    fn commit(&mut self, commit: StoreCommit) -> Result<(), SupervisorControlFailure> {
        validate_loaded_operation(&commit.operation)?;
        validate_commit_effect(&commit)?;
        let response_bytes = serde_json::to_vec(&commit.operation.response)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let encrypted_response = self.encrypt(
            "operation_journal",
            &commit.operation.operation_id,
            "result_ciphertext",
            &response_bytes,
        )?;
        let encrypted_root = match &commit.effect {
            StoreEffect::Register(grant) => Some(self.encrypt(
                "grant_ledger",
                &grant.projection.grant_handle,
                "root_path_ciphertext",
                grant.root_path.as_bytes(),
            )?),
            StoreEffect::Revoke { .. } | StoreEffect::Read => None,
        };
        let evidence_refs_json = serde_json::to_string(&commit.operation.receipt.evidence_refs)
            .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_error)?;
        validate_store_identity(&transaction)?;
        let operation_count: i64 = transaction
            .query_row("SELECT count(*) FROM operation_journal", [], |row| {
                row.get(0)
            })
            .map_err(map_sqlite_error)?;
        if operation_count >= MAX_OPERATIONS as i64 {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        if transaction
            .query_row(
                "SELECT request_hash FROM operation_journal WHERE operation_id = ?1",
                [&commit.operation.operation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(map_sqlite_error)?
            .is_some()
        {
            return Err(SupervisorControlFailure::new("OPERATION_CONFLICT"));
        }
        reserve_nonce(&transaction, &encrypted_response.nonce)?;
        if let Some(encrypted) = &encrypted_root {
            reserve_nonce(&transaction, &encrypted.nonce)?;
        }
        match (&commit.effect, encrypted_root) {
            (StoreEffect::Register(grant), Some(encrypted)) => {
                let active_count: i64 = transaction
                    .query_row(
                        "SELECT count(*) FROM grant_ledger WHERE status = 'active'",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(map_sqlite_error)?;
                if active_count >= MAX_ACTIVE_GRANTS as i64 {
                    return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
                }
                let subject_json = serde_json::to_string(&grant.subject)
                    .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
                let intents_json = serde_json::to_string(&grant.projection.allowed_intents)
                    .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
                transaction
                    .execute(
                        "INSERT INTO grant_ledger (grant_handle, revision, subject_json, \
                         root_path_ciphertext, root_fingerprint, display_name, access, \
                         allowed_intents_json, expires_at, expires_at_epoch_ms, status, \
                         created_at, updated_at) VALUES \
                         (?1, ?2, ?3, ?4, ?5, ?6, 'read_only', ?7, ?8, ?9, 'active', ?10, ?10)",
                        params![
                            grant.projection.grant_handle,
                            grant.projection.grant_revision,
                            subject_json,
                            encrypted.bytes,
                            grant.projection.root_fingerprint,
                            grant.projection.display_name,
                            intents_json,
                            grant.projection.expires_at,
                            i64::try_from(grant.expires_at_epoch_ms).map_err(|_| {
                                SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")
                            })?,
                            commit.operation.receipt.recorded_at,
                        ],
                    )
                    .map_err(map_sqlite_error)?;
            }
            (
                StoreEffect::Revoke {
                    grant_handle,
                    expected_grant_revision,
                },
                None,
            ) => {
                let prior = transaction
                    .query_row(
                        "SELECT revision, status FROM grant_ledger WHERE grant_handle = ?1",
                        [grant_handle],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()
                    .map_err(map_sqlite_error)?
                    .ok_or_else(|| SupervisorControlFailure::new("GRANT_NOT_ACTIVE"))?;
                if prior.1 != "active" {
                    return Err(SupervisorControlFailure::new("GRANT_NOT_ACTIVE"));
                }
                if prior.0 != *expected_grant_revision {
                    return Err(SupervisorControlFailure::new("GRANT_REVISION_MISMATCH"));
                }
                transaction
                    .execute(
                        "UPDATE grant_ledger SET status = 'revoked', updated_at = ?2 \
                         WHERE grant_handle = ?1 AND revision = ?3 AND status = 'active'",
                        params![
                            grant_handle,
                            commit.operation.receipt.recorded_at,
                            expected_grant_revision
                        ],
                    )
                    .map_err(map_sqlite_error)?;
            }
            (StoreEffect::Read, None) => {}
            _ => return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
        }
        transaction
            .execute(
                "INSERT INTO local_receipt (receipt_ref, operation_id, status, effect_state, \
                 reason_code, evidence_refs_json, receipt_hash, recorded_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    commit.operation.receipt.receipt_ref,
                    commit.operation.receipt.operation_id,
                    receipt_status_text(&commit.operation.receipt.status),
                    effect_state_text(&commit.operation.receipt.effect_state),
                    commit.operation.receipt.reason_code,
                    evidence_refs_json,
                    commit.operation.receipt.receipt_hash,
                    commit.operation.receipt.recorded_at,
                ],
            )
            .map_err(map_sqlite_error)?;
        transaction
            .execute(
                "INSERT INTO operation_journal (operation_id, request_hash, operation_kind, \
                 result_ciphertext, receipt_ref, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    commit.operation.operation_id,
                    commit.operation.request_hash,
                    operation_kind_text(commit.operation.kind),
                    encrypted_response.bytes,
                    commit.operation.receipt.receipt_ref,
                    commit.operation.receipt.recorded_at,
                ],
            )
            .map_err(map_sqlite_error)?;
        transaction.commit().map_err(map_sqlite_error)?;
        restrict_sqlite_file_family(&self.database_path)?;
        Ok(())
    }
}

fn initialize_or_validate_schema(
    connection: &mut Connection,
) -> Result<(), SupervisorControlFailure> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(map_sqlite_error)?;
    let application_id: i64 = transaction
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(map_sqlite_error)?;
    let user_version: i64 = transaction
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(map_sqlite_error)?;
    let object_count: i64 = transaction
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    if application_id == 0 && user_version == 0 && object_count == 0 {
        transaction
            .execute_batch(
                "CREATE TABLE encryption_nonce (
                   nonce BLOB PRIMARY KEY NOT NULL CHECK(length(nonce) = 12)
                 ) WITHOUT ROWID;
                 CREATE TABLE grant_ledger (
                   grant_handle TEXT PRIMARY KEY NOT NULL,
                   revision TEXT NOT NULL,
                   subject_json TEXT NOT NULL,
                   root_path_ciphertext BLOB NOT NULL,
                   root_fingerprint TEXT NOT NULL,
                   display_name TEXT NOT NULL,
                   access TEXT NOT NULL CHECK(access = 'read_only'),
                   allowed_intents_json TEXT NOT NULL,
                   expires_at TEXT NOT NULL,
                   expires_at_epoch_ms INTEGER NOT NULL CHECK(expires_at_epoch_ms > 0),
                   status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 ) WITHOUT ROWID;
                 CREATE TABLE local_receipt (
                   receipt_ref TEXT PRIMARY KEY NOT NULL,
                   operation_id TEXT UNIQUE NOT NULL,
                   status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed', 'rejected', 'unknown')),
                   effect_state TEXT NOT NULL CHECK(effect_state IN ('none', 'not_applied', 'applied', 'unknown')),
                   reason_code TEXT,
                   evidence_refs_json TEXT NOT NULL,
                   receipt_hash TEXT NOT NULL,
                   recorded_at TEXT NOT NULL
                 ) WITHOUT ROWID;
                 CREATE TABLE operation_journal (
                   operation_id TEXT PRIMARY KEY NOT NULL,
                   request_hash TEXT NOT NULL,
                   operation_kind TEXT NOT NULL CHECK(operation_kind IN ('grant_register', 'grant_revoke', 'capability_read')),
                   result_ciphertext BLOB NOT NULL,
                   receipt_ref TEXT UNIQUE NOT NULL REFERENCES local_receipt(receipt_ref) ON DELETE RESTRICT,
                   updated_at TEXT NOT NULL
                 ) WITHOUT ROWID;",
            )
            .map_err(map_sqlite_error)?;
        transaction
            .pragma_update(None, "application_id", APPLICATION_ID)
            .and_then(|()| transaction.pragma_update(None, "user_version", SCHEMA_VERSION))
            .map_err(map_sqlite_error)?;
    } else if application_id != APPLICATION_ID
        || user_version != SCHEMA_VERSION
        || object_count == 0
    {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    validate_store_identity(&transaction)?;
    validate_table_set(&transaction)?;
    transaction.commit().map_err(map_sqlite_error)?;
    let integrity: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(map_sqlite_error)?;
    if integrity != "ok" {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn validate_store_identity(connection: &Connection) -> Result<(), SupervisorControlFailure> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(map_sqlite_error)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(map_sqlite_error)?;
    if application_id != APPLICATION_ID || user_version != SCHEMA_VERSION {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn validate_table_set(connection: &Connection) -> Result<(), SupervisorControlFailure> {
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .map_err(map_sqlite_error)?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;
    if tables != EXPECTED_TABLES {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn collect_text_column(
    connection: &Connection,
    query: &str,
) -> Result<Vec<String>, SupervisorControlFailure> {
    let mut statement = connection.prepare(query).map_err(map_sqlite_error)?;
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)
}

fn validate_loaded_receipt(receipt: &Receipt) -> Result<(), SupervisorControlFailure> {
    validate_identifier(&receipt.receipt_ref)?;
    validate_operation_id(&receipt.operation_id)?;
    if parse_rfc3339_millis(&receipt.recorded_at).is_none()
        || receipt.reason_code.as_ref().is_some_and(|value| {
            value.is_empty()
                || value.len() > MAX_IDENTIFIER_BYTES
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
        || receipt
            .evidence_refs
            .iter()
            .any(|value| validate_identifier(value).is_err())
        || receipt_hash(receipt)? != receipt.receipt_hash
    {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn validate_loaded_operation(operation: &StoredOperation) -> Result<(), SupervisorControlFailure> {
    validate_operation_id(&operation.operation_id)?;
    if operation.request_hash.len() != 64
        || !operation
            .request_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        || operation.receipt.operation_id != operation.operation_id
    {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    match operation.kind {
        OperationKind::GrantRegister => {
            let result: GrantResult = serde_json::from_value(operation.response.clone())
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if result.receipt != operation.receipt {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        OperationKind::GrantRevoke => {
            let result: Receipt = serde_json::from_value(operation.response.clone())
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if result != operation.receipt {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        OperationKind::CapabilityRead => {
            let result: ReadResult = serde_json::from_value(operation.response.clone())
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if result.receipt != operation.receipt {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
            validate_read_payload(&result.payload)?;
        }
    }
    validate_loaded_receipt(&operation.receipt)
}

fn validate_commit_effect(commit: &StoreCommit) -> Result<(), SupervisorControlFailure> {
    match (&commit.operation.kind, &commit.effect) {
        (OperationKind::GrantRegister, StoreEffect::Register(grant)) => {
            let result: GrantResult = serde_json::from_value(commit.operation.response.clone())
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if result.grant != grant.projection
                || commit.operation.receipt.effect_state != EffectState::None
            {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        (OperationKind::GrantRevoke, StoreEffect::Revoke { .. }) => {
            if commit.operation.receipt.effect_state != EffectState::NotApplied {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        (OperationKind::CapabilityRead, StoreEffect::Read) => {
            if commit.operation.receipt.effect_state != EffectState::None {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        _ => return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
    }
    Ok(())
}

fn validate_read_payload(payload: &ReadPayload) -> Result<(), SupervisorControlFailure> {
    match payload {
        ReadPayload::File {
            bytes_base64,
            media_type,
        } => {
            let bytes = STANDARD
                .decode(bytes_base64)
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if bytes.len() > CONTROL_MAX_RESULT_BYTES as usize
                || media_type != "text/plain; charset=utf-8"
                || std::str::from_utf8(&bytes).is_err()
            {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
        ReadPayload::Directory { entries } => {
            if serialized_len(payload)? > CONTROL_MAX_RESULT_BYTES as usize
                || entries.iter().any(|entry| {
                    entry.name.is_empty()
                        || entry.name.contains(['/', '\\', '\0'])
                        || entry.name.chars().any(char::is_control)
                })
            {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
        }
    }
    Ok(())
}

fn validate_loaded_grant(grant: &StoredGrant) -> Result<(), SupervisorControlFailure> {
    validate_identifier(&grant.projection.grant_handle)?;
    validate_identifier(&grant.projection.grant_revision)?;
    validate_local_subject(&grant.subject)?;
    validate_display_name(&grant.projection.display_name)?;
    validate_intents(&grant.projection.allowed_intents)?;
    if grant.root_path.is_empty()
        || grant.root_path.len() > MAX_ROOT_PATH_BYTES
        || grant.root_path.contains('\0')
        || grant.projection.root_fingerprint.len() != 64
        || parse_rfc3339_millis(&grant.projection.expires_at) != Some(grant.expires_at_epoch_ms)
    {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn reserve_nonce(
    connection: &Connection,
    nonce: &[u8; 12],
) -> Result<(), SupervisorControlFailure> {
    connection
        .execute(
            "INSERT INTO encryption_nonce (nonce) VALUES (?1)",
            [nonce.as_slice()],
        )
        .map(|_| ())
        .map_err(map_sqlite_error)
}

fn require_registered_nonce(
    connection: &Connection,
    nonce: &[u8],
) -> Result<(), SupervisorControlFailure> {
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM encryption_nonce WHERE nonce = ?1",
            [nonce],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    if count != 1 {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

fn encrypted_nonce(value: &[u8]) -> Result<&[u8], SupervisorControlFailure> {
    value
        .get(1..13)
        .filter(|_| value.first() == Some(&1) && value.len() >= 29)
        .ok_or_else(|| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

fn encryption_aad(table: &str, primary_key: &str, field: &str) -> Vec<u8> {
    let mut aad = b"aidesktop.supervisor-state-field.v1\0".to_vec();
    for value in [table, primary_key, field] {
        aad.extend_from_slice(&(value.len() as u64).to_be_bytes());
        aad.extend_from_slice(value.as_bytes());
    }
    aad
}

fn receipt_status_text(status: &ReceiptStatus) -> &'static str {
    match status {
        ReceiptStatus::Succeeded => "succeeded",
        ReceiptStatus::Failed => "failed",
        ReceiptStatus::Rejected => "rejected",
        ReceiptStatus::Unknown => "unknown",
    }
}

fn parse_receipt_status(value: &str) -> Result<ReceiptStatus, SupervisorControlFailure> {
    match value {
        "succeeded" => Ok(ReceiptStatus::Succeeded),
        "failed" => Ok(ReceiptStatus::Failed),
        "rejected" => Ok(ReceiptStatus::Rejected),
        "unknown" => Ok(ReceiptStatus::Unknown),
        _ => Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
    }
}

fn effect_state_text(state: &EffectState) -> &'static str {
    match state {
        EffectState::None => "none",
        EffectState::NotApplied => "not_applied",
        EffectState::Applied => "applied",
        EffectState::Unknown => "unknown",
    }
}

fn parse_effect_state(value: &str) -> Result<EffectState, SupervisorControlFailure> {
    match value {
        "none" => Ok(EffectState::None),
        "not_applied" => Ok(EffectState::NotApplied),
        "applied" => Ok(EffectState::Applied),
        "unknown" => Ok(EffectState::Unknown),
        _ => Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
    }
}

fn operation_kind_text(kind: OperationKind) -> &'static str {
    match kind {
        OperationKind::GrantRegister => "grant_register",
        OperationKind::GrantRevoke => "grant_revoke",
        OperationKind::CapabilityRead => "capability_read",
    }
}

fn parse_operation_kind(value: &str) -> Result<OperationKind, SupervisorControlFailure> {
    match value {
        "grant_register" => Ok(OperationKind::GrantRegister),
        "grant_revoke" => Ok(OperationKind::GrantRevoke),
        "capability_read" => Ok(OperationKind::CapabilityRead),
        _ => Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
    }
}

fn admit_state_directory(path: &Path) -> Result<PathBuf, SupervisorControlFailure> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path.file_name().is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            let parent_metadata = fs::symlink_metadata(parent)
                .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
            if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
            create_private_directory(path)?;
        }
        Err(_) => return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
    }
    restrict_directory_permissions(path)?;
    let canonical = path
        .canonicalize()
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    let metadata = fs::symlink_metadata(&canonical)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(canonical)
}

#[cfg(unix)]
fn create_private_directory(path: &Path) -> Result<(), SupervisorControlFailure> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    builder
        .create(path)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

#[cfg(not(unix))]
fn create_private_directory(path: &Path) -> Result<(), SupervisorControlFailure> {
    DirBuilder::new()
        .create(path)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))
}

fn validate_sqlite_file_family(database_path: &Path) -> Result<(), SupervisorControlFailure> {
    for path in sqlite_file_family(database_path) {
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")),
        }
    }
    Ok(())
}

fn restrict_sqlite_file_family(database_path: &Path) -> Result<(), SupervisorControlFailure> {
    for path in sqlite_file_family(database_path) {
        if path.exists() {
            restrict_file_permissions(&path)?;
        }
    }
    Ok(())
}

fn sqlite_file_family(database_path: &Path) -> [PathBuf; 3] {
    let database = database_path.as_os_str().to_string_lossy();
    [
        database_path.to_path_buf(),
        PathBuf::from(format!("{database}-wal")),
        PathBuf::from(format!("{database}-shm")),
    ]
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), SupervisorControlFailure> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    let mode = fs::symlink_metadata(path)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?
        .permissions()
        .mode();
    if mode & 0o077 != 0 {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<(), SupervisorControlFailure> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<(), SupervisorControlFailure> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?;
    let mode = fs::symlink_metadata(path)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?
        .permissions()
        .mode();
    if mode & 0o077 != 0 {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

#[cfg(unix)]
fn require_file_permissions(path: &Path) -> Result<(), SupervisorControlFailure> {
    use std::os::unix::fs::PermissionsExt;

    let mode = fs::symlink_metadata(path)
        .map_err(|_| SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"))?
        .permissions()
        .mode();
    if mode & 0o077 != 0 {
        return Err(SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<(), SupervisorControlFailure> {
    Ok(())
}

#[cfg(not(unix))]
fn require_file_permissions(_path: &Path) -> Result<(), SupervisorControlFailure> {
    Ok(())
}

fn map_sqlite_error(_error: rusqlite::Error) -> SupervisorControlFailure {
    SupervisorControlFailure::new("SUPERVISOR_UNAVAILABLE")
}
