use super::journal::{WindowsAclLeaseJournalStore, WindowsLeasePayloadProtector};
use super::*;
use crate::local_capability::contracts::CapabilityScope;
use crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::Zeroizing;

const OPERATION_ID: &str = "55555555-5555-4555-8555-555555555555";
static NEXT_ROOT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct OpaqueFixtureProtector;

impl WindowsLeasePayloadProtector for OpaqueFixtureProtector {
    fn protect(&self, plaintext: &[u8]) -> io::Result<Vec<u8>> {
        // Test-only opacity fixture. Production is compiled only with current-user DPAPI.
        Ok(plaintext.iter().map(|byte| byte ^ 0xa5).collect())
    }

    fn unprotect(&self, ciphertext: &[u8]) -> io::Result<Zeroizing<Vec<u8>>> {
        Ok(Zeroizing::new(
            ciphertext.iter().map(|byte| byte ^ 0xa5).collect(),
        ))
    }
}

struct JournalFixture {
    root: PathBuf,
    store: WindowsAclLeaseJournalStore<OpaqueFixtureProtector>,
}

impl JournalFixture {
    fn new(label: &str) -> Self {
        let sequence = NEXT_ROOT_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "aistaff-windows-acl-lease-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&root).expect("create exact ACL lease fixture root");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .expect("restrict ACL lease fixture root");
        }
        let root = root.canonicalize().expect("canonical fixture root");
        let store = WindowsAclLeaseJournalStore::new(&root, OpaqueFixtureProtector)
            .expect("admit fixture journal root");
        Self { root, store }
    }
}

impl Drop for JournalFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn journal_is_opaque_strict_and_recovers_from_bound_only_cleanup_stage() {
    let fixture = JournalFixture::new("round-trip");
    let intent = sample_intent();
    let sid = sample_sid();
    let binding =
        WindowsAclLeaseBinding::new(intent.clone(), &sid, sha256_hex(&sid).expect("SID digest"))
            .expect("binding");

    fixture.store.create_intent(&intent).expect("intent");
    fixture.store.create_binding(&binding).expect("binding");
    for bound in [false, true] {
        let text = fs::read_to_string(
            fixture
                .store
                .record_path_for_test(OPERATION_ID, bound)
                .expect("valid journal path"),
        )
        .expect("journal text");
        assert!(!text.contains("tenant-sensitive"));
        assert!(!text.contains("worker.exe"));
        assert!(!text.contains("session-sensitive"));
        assert!(!text.contains(&intent.scope_sha256));
    }

    let loaded = fixture.store.load_all().expect("load complete lease");
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].intent, intent);
    assert_eq!(loaded[0].binding, Some(binding.clone()));

    fs::remove_file(
        fixture
            .store
            .record_path_for_test(OPERATION_ID, false)
            .expect("valid intent path"),
    )
    .expect("simulate crash after intent removal");
    let loaded = fixture.store.load_all().expect("bound is self-contained");
    assert_eq!(loaded[0].binding, Some(binding));
    fixture
        .store
        .remove_after_cleanup(OPERATION_ID)
        .expect("finish cleanup");
    assert!(
        fixture
            .store
            .load_all()
            .expect("empty inventory")
            .is_empty()
    );
}

#[test]
fn journal_create_new_rejects_operation_reuse_without_overwrite() {
    let fixture = JournalFixture::new("create-new");
    let intent = sample_intent();
    fixture.store.create_intent(&intent).expect("first intent");
    let before = fs::read(
        fixture
            .store
            .record_path_for_test(OPERATION_ID, false)
            .expect("valid intent path"),
    )
    .expect("original intent");
    assert!(fixture.store.create_intent(&intent).is_err());
    let after = fs::read(
        fixture
            .store
            .record_path_for_test(OPERATION_ID, false)
            .expect("valid intent path"),
    )
    .expect("preserved intent");
    assert_eq!(after, before);
}

#[test]
fn journal_tamper_unknown_file_and_mismatched_pair_fail_closed() {
    let tampered = JournalFixture::new("tamper");
    let intent = sample_intent();
    tampered.store.create_intent(&intent).expect("intent");
    let path = tampered
        .store
        .record_path_for_test(OPERATION_ID, false)
        .expect("valid intent path");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).expect("intent bytes")).expect("envelope");
    value["protected_payload_sha256"] = serde_json::Value::String("0".repeat(64));
    fs::write(
        &path,
        serde_json::to_vec(&value).expect("tampered envelope"),
    )
    .expect("write tampered envelope");
    assert!(tampered.store.load_all().is_err());

    let unexpected = JournalFixture::new("unexpected");
    fs::write(unexpected.root.join("unexpected.txt"), b"not a lease")
        .expect("write unexpected file");
    assert!(unexpected.store.load_all().is_err());

    let mismatch = JournalFixture::new("mismatch");
    mismatch.store.create_intent(&intent).expect("intent");
    let mut other = intent.clone();
    other.scope_sha256 = "1".repeat(64);
    let sid = sample_sid();
    let binding = WindowsAclLeaseBinding::new(other, &sid, sha256_hex(&sid).expect("SID digest"))
        .expect("binding");
    mismatch
        .store
        .create_binding(&binding)
        .expect("mismatched binding record");
    assert!(mismatch.store.load_all().is_err());
}

#[test]
fn lease_contract_rejects_duplicate_paths_nul_and_sid_digest_drift() {
    let mut duplicate = sample_intent();
    duplicate.targets.push(duplicate.targets[0].clone());
    assert!(duplicate.validate().is_err());

    let mut nul = sample_intent();
    nul.targets[0].path_utf16le_base64 = encode_units(&[b'C' as u16, 0, b'x' as u16]);
    assert!(nul.validate().is_err());

    let sid = sample_sid();
    let mut binding =
        WindowsAclLeaseBinding::new(sample_intent(), &sid, sha256_hex(&sid).expect("SID digest"))
            .expect("binding");
    binding.app_container_sid_sha256 = "0".repeat(64);
    assert!(binding.validate().is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_journal_entry_is_never_followed() {
    use std::os::unix::fs::symlink;
    let fixture = JournalFixture::new("symlink");
    let outside = fixture.root.with_extension("outside");
    fs::write(&outside, b"outside").expect("outside file");
    symlink(
        &outside,
        fixture
            .store
            .record_path_for_test(OPERATION_ID, false)
            .expect("valid intent path"),
    )
    .expect("journal symlink");
    assert!(fixture.store.load_all().is_err());
    fs::remove_file(outside).expect("remove exact outside fixture");
}

fn sample_intent() -> WindowsAclLeaseIntent {
    let intent = WindowsAclLeaseIntent::new(
        OPERATION_ID,
        &CapabilityScope {
            tenant_id: "tenant-sensitive".to_owned(),
            session_id: "session-sensitive".to_owned(),
            run_id: "run-sensitive".to_owned(),
        },
        vec![WindowsAclLeaseTarget {
            path_utf16le_base64: encode_path(r"C:\Sensitive\worker.exe"),
            identity: WindowsAclTargetIdentity {
                volume_serial_number: 17,
                file_index: 23,
                directory: false,
            },
            grant_class: WindowsAclGrantClass::ExecutableReadExecute,
        }],
    )
    .expect("sample intent");
    assert_eq!(intent.capability_id, LOCAL_PROCESS_EXECUTION_CAPABILITY_ID);
    intent
}

fn sample_sid() -> Vec<u8> {
    let mut bytes = vec![1, 8, 0, 0, 0, 0, 0, 15];
    for value in [2_u32, 11, 12, 13, 14, 15, 16, 17] {
        bytes.extend(value.to_le_bytes());
    }
    bytes
}

fn encode_path(path: &str) -> String {
    encode_units(&path.encode_utf16().collect::<Vec<_>>())
}

fn encode_units(units: &[u16]) -> String {
    let bytes = units
        .iter()
        .flat_map(|unit| unit.to_le_bytes())
        .collect::<Vec<_>>();
    STANDARD.encode(bytes)
}
