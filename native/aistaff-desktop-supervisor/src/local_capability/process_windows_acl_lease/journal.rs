use super::{WindowsAclLeaseBinding, WindowsAclLeaseIntent, lease_error, profile_name, sha256_hex};
use crate::local_capability::contracts::{LocalCapabilityError, is_lower_sha256, is_lower_uuid};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

const ENVELOPE_SCHEMA_VERSION: &str = "aistaff.windows-process-acl-lease-envelope.v1";
const MAX_JOURNAL_FILES: usize = 256;
const MAX_JOURNAL_BYTES: u64 = 512 * 1024;
const MAX_PROTECTED_PAYLOAD_BYTES: usize = 384 * 1024;

pub(super) trait WindowsLeasePayloadProtector: Clone + Send + Sync + 'static {
    fn protect(&self, plaintext: &[u8]) -> io::Result<Vec<u8>>;
    fn unprotect(&self, ciphertext: &[u8]) -> io::Result<Zeroizing<Vec<u8>>>;
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum JournalRecordKind {
    Intent,
    Bound,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct JournalEnvelope {
    schema_version: String,
    record_kind: JournalRecordKind,
    capability_id: String,
    operation_id: String,
    profile_name: String,
    protected_payload_base64: String,
    protected_payload_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RecoverableWindowsAclLease {
    pub intent: WindowsAclLeaseIntent,
    pub binding: Option<WindowsAclLeaseBinding>,
}

#[derive(Clone)]
pub(super) struct WindowsAclLeaseJournalStore<P> {
    root: PathBuf,
    protector: P,
}

impl<P: WindowsLeasePayloadProtector> WindowsAclLeaseJournalStore<P> {
    pub(super) fn new(root: &Path, protector: P) -> Result<Self, LocalCapabilityError> {
        let metadata = fs::symlink_metadata(root).map_err(|_| reconciliation_error())?;
        let canonical = root.canonicalize().map_err(|_| reconciliation_error())?;
        if !root.is_absolute()
            || root.parent().is_none()
            || !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || canonical != root
        {
            return Err(reconciliation_error());
        }
        Ok(Self {
            root: canonical,
            protector,
        })
    }

    pub(super) fn create_intent(
        &self,
        intent: &WindowsAclLeaseIntent,
    ) -> Result<(), LocalCapabilityError> {
        intent.validate()?;
        self.create_record(
            JournalRecordKind::Intent,
            &intent.operation_id,
            &intent.profile_name,
            intent,
        )
    }

    pub(super) fn create_binding(
        &self,
        binding: &WindowsAclLeaseBinding,
    ) -> Result<(), LocalCapabilityError> {
        binding.validate()?;
        self.create_record(
            JournalRecordKind::Bound,
            &binding.intent.operation_id,
            &binding.intent.profile_name,
            binding,
        )
    }

    pub(super) fn load_all(&self) -> Result<Vec<RecoverableWindowsAclLease>, LocalCapabilityError> {
        let mut entries = fs::read_dir(&self.root)
            .map_err(|_| reconciliation_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| reconciliation_error())?;
        if entries.len() > MAX_JOURNAL_FILES {
            return Err(reconciliation_error());
        }
        entries.sort_by_key(|entry| entry.file_name());
        let mut partial = BTreeMap::<String, PartialLease>::new();
        for entry in entries {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|_| reconciliation_error())?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() == 0
                || metadata.len() > MAX_JOURNAL_BYTES
            {
                return Err(reconciliation_error());
            }
            match self.load_record(&path)? {
                LoadedRecord::Intent(intent) => {
                    let slot = partial.entry(intent.operation_id.clone()).or_default();
                    if slot.intent.replace(intent).is_some() {
                        return Err(reconciliation_error());
                    }
                }
                LoadedRecord::Bound(binding) => {
                    let slot = partial
                        .entry(binding.intent.operation_id.clone())
                        .or_default();
                    if slot.binding.replace(binding).is_some() {
                        return Err(reconciliation_error());
                    }
                }
            }
        }
        partial.into_values().map(PartialLease::finish).collect()
    }

    pub(super) fn remove_after_cleanup(
        &self,
        operation_id: &str,
    ) -> Result<(), LocalCapabilityError> {
        let intent_path = self
            .record_path(operation_id, JournalRecordKind::Intent)
            .map_err(|_| reconciliation_error())?;
        let binding_path = self
            .record_path(operation_id, JournalRecordKind::Bound)
            .map_err(|_| reconciliation_error())?;
        remove_exact_file(&intent_path)?;
        sync_root(&self.root).map_err(|_| reconciliation_error())?;
        remove_exact_file(&binding_path)?;
        sync_root(&self.root).map_err(|_| reconciliation_error())
    }

    #[cfg(test)]
    pub(super) fn record_path_for_test(
        &self,
        operation_id: &str,
        bound: bool,
    ) -> Result<PathBuf, LocalCapabilityError> {
        self.record_path(
            operation_id,
            if bound {
                JournalRecordKind::Bound
            } else {
                JournalRecordKind::Intent
            },
        )
    }

    fn create_record<T: Serialize>(
        &self,
        kind: JournalRecordKind,
        operation_id: &str,
        expected_profile_name: &str,
        payload: &T,
    ) -> Result<(), LocalCapabilityError> {
        let plaintext = Zeroizing::new(serde_json::to_vec(payload).map_err(|_| lease_error())?);
        let ciphertext = self
            .protector
            .protect(&plaintext)
            .map_err(|_| journal_write_error())?;
        if ciphertext.is_empty() || ciphertext.len() > MAX_PROTECTED_PAYLOAD_BYTES {
            return Err(journal_write_error());
        }
        let envelope = JournalEnvelope {
            schema_version: ENVELOPE_SCHEMA_VERSION.to_owned(),
            record_kind: kind,
            capability_id: crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID.to_owned(),
            operation_id: operation_id.to_owned(),
            profile_name: expected_profile_name.to_owned(),
            protected_payload_base64: STANDARD.encode(&ciphertext),
            protected_payload_sha256: sha256_hex(&ciphertext)?,
        };
        validate_envelope(&envelope)?;
        let encoded = serde_json::to_vec(&envelope).map_err(|_| journal_write_error())?;
        if encoded.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(journal_write_error());
        }
        let path = self.record_path(operation_id, kind)?;
        let mut file = open_create_new(&path).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                lease_error()
            } else {
                journal_write_error()
            }
        })?;
        if let Err(error) = file.write_all(&encoded).and_then(|_| file.sync_all()) {
            let _ = fs::remove_file(&path);
            let _ = error;
            return Err(journal_write_error());
        }
        sync_root(&self.root).map_err(|_| journal_write_error())
    }

    fn load_record(&self, path: &Path) -> Result<LoadedRecord, LocalCapabilityError> {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(reconciliation_error)?;
        let mut file = open_read_no_reparse(path).map_err(|_| reconciliation_error())?;
        let mut encoded = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_JOURNAL_BYTES + 1)
            .read_to_end(&mut encoded)
            .map_err(|_| reconciliation_error())?;
        if encoded.is_empty() || encoded.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(reconciliation_error());
        }
        let envelope: JournalEnvelope =
            serde_json::from_slice(&encoded).map_err(|_| reconciliation_error())?;
        validate_envelope(&envelope).map_err(|_| reconciliation_error())?;
        if file_name != record_file_name(&envelope.operation_id, envelope.record_kind)? {
            return Err(reconciliation_error());
        }
        let ciphertext = STANDARD
            .decode(&envelope.protected_payload_base64)
            .map_err(|_| reconciliation_error())?;
        if ciphertext.is_empty()
            || ciphertext.len() > MAX_PROTECTED_PAYLOAD_BYTES
            || sha256_hex(&ciphertext).map_err(|_| reconciliation_error())?
                != envelope.protected_payload_sha256
        {
            return Err(reconciliation_error());
        }
        let plaintext = self
            .protector
            .unprotect(&ciphertext)
            .map_err(|_| reconciliation_error())?;
        match envelope.record_kind {
            JournalRecordKind::Intent => {
                let intent: WindowsAclLeaseIntent = parse_payload(&plaintext)?;
                validate_loaded_intent(&envelope, &intent)?;
                Ok(LoadedRecord::Intent(intent))
            }
            JournalRecordKind::Bound => {
                let binding: WindowsAclLeaseBinding = parse_payload(&plaintext)?;
                binding.validate().map_err(|_| reconciliation_error())?;
                validate_loaded_intent(&envelope, &binding.intent)?;
                Ok(LoadedRecord::Bound(binding))
            }
        }
    }

    fn record_path(
        &self,
        operation_id: &str,
        kind: JournalRecordKind,
    ) -> Result<PathBuf, LocalCapabilityError> {
        Ok(self.root.join(record_file_name(operation_id, kind)?))
    }
}

#[derive(Default)]
struct PartialLease {
    intent: Option<WindowsAclLeaseIntent>,
    binding: Option<WindowsAclLeaseBinding>,
}

impl PartialLease {
    fn finish(self) -> Result<RecoverableWindowsAclLease, LocalCapabilityError> {
        match (self.intent, self.binding) {
            (Some(intent), Some(binding)) if binding.intent == intent => {
                Ok(RecoverableWindowsAclLease {
                    intent,
                    binding: Some(binding),
                })
            }
            (Some(intent), None) => Ok(RecoverableWindowsAclLease {
                intent,
                binding: None,
            }),
            (None, Some(binding)) => Ok(RecoverableWindowsAclLease {
                intent: binding.intent.clone(),
                binding: Some(binding),
            }),
            _ => Err(reconciliation_error()),
        }
    }
}

enum LoadedRecord {
    Intent(WindowsAclLeaseIntent),
    Bound(WindowsAclLeaseBinding),
}

fn validate_envelope(envelope: &JournalEnvelope) -> Result<(), LocalCapabilityError> {
    if envelope.schema_version != ENVELOPE_SCHEMA_VERSION
        || envelope.capability_id
            != crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
        || !is_lower_uuid(&envelope.operation_id)
        || envelope.profile_name != profile_name(&envelope.operation_id)?
        || !is_lower_sha256(&envelope.protected_payload_sha256)
        || envelope.protected_payload_base64.is_empty()
    {
        return Err(lease_error());
    }
    Ok(())
}

fn validate_loaded_intent(
    envelope: &JournalEnvelope,
    intent: &WindowsAclLeaseIntent,
) -> Result<(), LocalCapabilityError> {
    intent.validate().map_err(|_| reconciliation_error())?;
    if envelope.operation_id != intent.operation_id || envelope.profile_name != intent.profile_name
    {
        return Err(reconciliation_error());
    }
    Ok(())
}

fn parse_payload<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, LocalCapabilityError> {
    serde_json::from_slice(bytes).map_err(|_| reconciliation_error())
}

fn record_file_name(
    operation_id: &str,
    kind: JournalRecordKind,
) -> Result<String, LocalCapabilityError> {
    if !is_lower_uuid(operation_id) {
        return Err(lease_error());
    }
    let suffix = match kind {
        JournalRecordKind::Intent => "intent",
        JournalRecordKind::Bound => "bound",
    };
    Ok(format!("{operation_id}.{suffix}.json"))
}

fn remove_exact_file(path: &Path) -> Result<(), LocalCapabilityError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::remove_file(path).map_err(|_| reconciliation_error())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        _ => Err(reconciliation_error()),
    }
}

#[cfg(windows)]
fn open_create_new(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_WRITE_THROUGH;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(FILE_FLAG_WRITE_THROUGH)
        .open(path)
}

#[cfg(not(windows))]
fn open_create_new(path: &Path) -> io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

#[cfg(windows)]
fn open_read_no_reparse(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    crate::windows_file_identity::identity_from_file(&file)?;
    Ok(file)
}

#[cfg(not(windows))]
fn open_read_no_reparse(path: &Path) -> io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

#[cfg(unix)]
fn sync_root(root: &Path) -> io::Result<()> {
    File::open(root)?.sync_all()
}

#[cfg(not(unix))]
fn sync_root(_root: &Path) -> io::Result<()> {
    Ok(())
}

fn journal_write_error() -> LocalCapabilityError {
    LocalCapabilityError::new("LOCAL_PROCESS_SANDBOX_ACL_JOURNAL_WRITE_FAILED")
}

fn reconciliation_error() -> LocalCapabilityError {
    LocalCapabilityError::new("LOCAL_PROCESS_SANDBOX_ACL_RECONCILIATION_REQUIRED")
}
