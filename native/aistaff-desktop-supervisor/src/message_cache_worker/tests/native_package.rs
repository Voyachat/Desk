use super::native_package_admission::AdmittedNativePackage;
use super::native_package_contract::{
    NATIVE_TARGET, NativePackageManifest, PACKAGE_MANIFEST_FILENAME, ReleaseManifest,
    VERSION_CONTRACT_FILENAME,
};
use super::packaged_scope_driver::PackagedEncryptedScopeDriver;
use super::scope_driver::EncryptedScopeDriver;
use crate::message_cache::{
    ActorType, ConfirmedTimelineProjection, DeliveryState, PageInput, PurgeScopeInput,
    PutConfirmedInput, RedactionProfile,
};
use crate::message_cache_worker::{
    CacheRetentionPolicy, EncryptedScopeOpenContext, WorkerAdapterAvailability,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct NativePackageFixture {
    root: PathBuf,
    executable: PathBuf,
    library: PathBuf,
    package_manifest: PathBuf,
    release_manifest: PathBuf,
}

impl NativePackageFixture {
    fn new() -> Option<Self> {
        let target = NATIVE_TARGET?;
        let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::current_dir()
            .expect("cwd")
            .join("target")
            .join("native-package-tests")
            .join(format!("{}-{nonce}-{sequence}", std::process::id()));
        let bin = root.join("bin");
        let native = root.join("native").join("message-cache");
        let manifest = root.join("manifest");
        fs::create_dir_all(&bin).expect("bin");
        fs::create_dir_all(&native).expect("native");
        fs::create_dir_all(&manifest).expect("manifest");

        let executable = bin.join(if cfg!(windows) {
            "aistaff-desktop-supervisor.exe"
        } else {
            "aistaff-desktop-supervisor"
        });
        fs::write(&executable, b"owned-supervisor-fixture").expect("executable");
        let library = native.join(target.artifact_filename);
        fs::write(
            &library,
            fixture_native_binary(target.platform, target.architecture),
        )
        .expect("library");
        let license = native.join("LICENSE.wcdb.txt");
        fs::write(&license, b"WCDB fixture license\n").expect("license");

        let package_manifest = native.join(PACKAGE_MANIFEST_FILENAME);
        let release_manifest = manifest.join(VERSION_CONTRACT_FILENAME);
        let mut fixture = Self {
            root,
            executable,
            library,
            package_manifest,
            release_manifest,
        };
        fixture.rewrite_manifests(|_| {}, |_| {});
        Some(fixture)
    }

    fn rewrite_manifests(
        &mut self,
        mutate_package: impl FnOnce(&mut Value),
        mutate_release: impl FnOnce(&mut Value),
    ) {
        let target = NATIVE_TARGET.expect("supported target");
        let artifact_sha = sha256_file(&self.library);
        let license_sha = sha256_file(&self.root.join("native/message-cache/LICENSE.wcdb.txt"));
        let mut package = package_json(target, &artifact_sha, &license_sha);
        mutate_package(&mut package);
        let package_bytes = canonical_package_json(&package);
        fs::write(&self.package_manifest, &package_bytes).expect("package manifest");
        let mut release = release_json(target, &sha256_bytes(&package_bytes), &package);
        mutate_release(&mut release);
        fs::write(&self.release_manifest, canonical_release_json(&release))
            .expect("release manifest");
    }
}

impl Drop for NativePackageFixture {
    fn drop(&mut self) {
        if self.root.exists() {
            fs::remove_dir_all(&self.root).expect("remove fixture root");
        }
    }
}

#[test]
fn fixed_resource_package_admits_and_revalidates_one_target_bound_binary() {
    let Some(fixture) = NativePackageFixture::new() else {
        return;
    };
    let admitted = AdmittedNativePackage::from_executable(&fixture.executable).expect("admitted");
    assert_eq!(admitted.library_path(), fixture.library);
    assert_eq!(admitted.wcdb_version(), "2.1.16");
    assert_eq!(
        admitted.wcdb_commit(),
        "df808591b9f9a9ab42156006819c3550d5af13a3"
    );
    admitted.revalidate_library().expect("stable identity");
}

#[test]
fn package_contract_rejects_noncanonical_unknown_and_dirty_input() {
    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    let target = NATIVE_TARGET.expect("target");
    let mut bytes = fs::read(&fixture.package_manifest).expect("package");
    bytes.push(b' ');
    assert_eq!(
        NativePackageManifest::parse_canonical(&bytes, target).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_MANIFEST_INVALID"
    );

    fixture.rewrite_manifests(|package| package["unexpected"] = json!(true), |_| {});
    let unknown = fs::read(&fixture.package_manifest).expect("package");
    assert_eq!(
        NativePackageManifest::parse_canonical(&unknown, target).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_MANIFEST_INVALID"
    );

    fixture.rewrite_manifests(
        |package| package["provenance"]["source_state"] = json!("dirty"),
        |_| {},
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH"
    );
}

#[test]
fn release_contract_and_package_binding_fail_closed_on_drift() {
    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    let target = NATIVE_TARGET.expect("target");
    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["native_components"]["message_cache"]["artifact_sha256"] =
                json!("b".repeat(64));
            release["staged_update"]["target_artifact_hash"] = json!("b".repeat(64));
        },
    );
    let release = fs::read(&fixture.release_manifest).expect("release");
    ReleaseManifest::parse_canonical(&release, target).expect("shape remains valid");
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_BINDING_MISMATCH"
    );
}

#[test]
fn release_contract_requires_the_exact_server_api_families() {
    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["server_compatibility"]["required_api_families"] = json!([
                "health",
                "employees",
                "sessions",
                "session_messages",
                "session_timeline",
                "runs",
                "human_workbench"
            ]);
        },
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH"
    );
}

#[test]
fn staged_update_metadata_is_metadata_only_and_bound_to_native_artifact() {
    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["staged_update"]["update_install_enabled"] = json!(true);
        },
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH"
    );

    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["staged_update"]["rollback_enabled"] = json!(true);
        },
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH"
    );

    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["staged_update"]["target_artifact_hash"] = json!("b".repeat(64));
        },
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH"
    );

    fixture.rewrite_manifests(
        |_| {},
        |release| {
            release["staged_update"]["evidence_refs"]["binary_hash_ref"] =
                json!("/Users/baron/release/hash.json");
        },
    );
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH"
    );
}

#[test]
fn fixed_layout_and_binary_target_are_not_caller_selectable() {
    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    let wrong_layout = fixture.root.join("debug/aistaff-desktop-supervisor");
    fs::create_dir_all(wrong_layout.parent().expect("parent")).expect("debug");
    fs::write(&wrong_layout, b"binary").expect("binary");
    assert_eq!(
        AdmittedNativePackage::from_executable(&wrong_layout).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_LAYOUT_INVALID"
    );

    fs::write(&fixture.library, b"not-a-target-native-binary").expect("wrong library");
    fixture.rewrite_manifests(|_| {}, |_| {});
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_BINARY_TARGET_MISMATCH"
    );
}

#[test]
fn admitted_library_identity_change_is_detected_even_for_equal_bytes() {
    let Some(fixture) = NativePackageFixture::new() else {
        return;
    };
    let admitted = AdmittedNativePackage::from_executable(&fixture.executable).expect("admitted");
    let replacement = fixture.library.with_extension("replacement");
    fs::copy(&fixture.library, &replacement).expect("replacement");
    fs::remove_file(&fixture.library).expect("remove original");
    fs::rename(&replacement, &fixture.library).expect("install replacement");
    assert_eq!(
        admitted.revalidate_library().unwrap_err(),
        "WCDB_NATIVE_PACKAGE_IDENTITY_CHANGED"
    );
}

#[cfg(unix)]
#[test]
fn symlinked_native_artifact_is_rejected_before_hash_or_loader_use() {
    use std::os::unix::fs::symlink;

    let Some(mut fixture) = NativePackageFixture::new() else {
        return;
    };
    let real = fixture.library.with_extension("real");
    fs::rename(&fixture.library, &real).expect("move real library");
    symlink(&real, &fixture.library).expect("symlink");
    fixture.rewrite_manifests(|_| {}, |_| {});
    assert_eq!(
        AdmittedNativePackage::from_executable(&fixture.executable).unwrap_err(),
        "WCDB_NATIVE_PACKAGE_SYMLINK_REJECTED"
    );
}

#[test]
fn admitted_but_invalid_dynamic_library_maps_to_one_stable_reason() {
    let Some(fixture) = NativePackageFixture::new() else {
        return;
    };
    let driver = PackagedEncryptedScopeDriver::from_executable(&fixture.executable);
    assert_eq!(
        driver.unavailable_reason(),
        Some("WCDB_NATIVE_LIBRARY_LOAD_FAILED")
    );
    assert_eq!(driver.adapter_id(), "unavailable");
}

#[test]
fn packaged_native_driver_executes_real_encrypted_lifecycle_when_required() {
    let required = std::env::var("AISTAFF_WCDB_NATIVE_E2E_REQUIRED").as_deref() == Ok("1");
    let executable = match std::env::var_os("AISTAFF_WCDB_NATIVE_E2E_EXECUTABLE") {
        Some(path) => PathBuf::from(path),
        None if required => panic!("required packaged native E2E executable is missing"),
        None => return,
    };
    assert!(executable.is_absolute());
    let mut driver = PackagedEncryptedScopeDriver::from_executable(&executable);
    assert_eq!(driver.availability(), WorkerAdapterAvailability::Available);
    assert_eq!(driver.unavailable_reason(), None);
    assert_eq!(driver.adapter_id(), "wcdb.v2.1.16");

    let root = native_e2e_root();
    fs::create_dir_all(&root).expect("native E2E root");
    let database = root.join("cache.db");
    let retention = CacheRetentionPolicy {
        retention_seconds: 30 * 24 * 60 * 60,
        sweep_limit: 20,
    };
    let context = EncryptedScopeOpenContext {
        now_epoch_s: 1_000,
        retention,
    };
    let cipher_key = [0x42; 32];
    verify_confirmed_projection_lifecycle(&mut driver, &database, context, &cipher_key);
    let tamper_outcome = verify_tampered_ciphertext_fails_closed(
        &mut driver,
        &root.join("tamper.db"),
        context,
        &cipher_key,
    );
    eprintln!("wcdb_native_tamper_outcome={tamper_outcome}");
    drop(driver);
    fs::remove_dir_all(&root).expect("remove native E2E root");
}

fn verify_confirmed_projection_lifecycle(
    driver: &mut PackagedEncryptedScopeDriver,
    database: &Path,
    context: EncryptedScopeOpenContext,
    cipher_key: &[u8; 32],
) {
    assert!(
        !driver
            .open_scope(database, cipher_key, context)
            .expect("create encrypted scope")
            .reopened
    );
    assert_eq!(
        driver.check_integrity().expect("healthy"),
        super::scope_driver::EncryptedScopeIntegrity::Healthy
    );
    let put = verify_projection_write_and_replay(driver, context);
    driver.close_scope().expect("close");
    verify_wrong_key_reopen_and_purge(driver, database, context, cipher_key, put);
}

fn verify_projection_write_and_replay(
    driver: &mut PackagedEncryptedScopeDriver,
    context: EncryptedScopeOpenContext,
) -> PutConfirmedInput {
    let put = native_e2e_put();
    let request_hash = [0x31; 32];
    let first = driver
        .put_confirmed(
            &put,
            &request_hash,
            1_000,
            1_000 + context.retention.retention_seconds as i64,
        )
        .expect("put");
    assert!(!first.idempotency_replayed);
    let replay = driver
        .put_confirmed(
            &put,
            &request_hash,
            1_000,
            1_000 + context.retention.retention_seconds as i64,
        )
        .expect("replay");
    assert!(replay.idempotency_replayed);
    let page = driver
        .page(
            &PageInput {
                scope_handle: native_e2e_scope().to_owned(),
                thread_id: put.projection.thread_id.clone(),
                after_sequence: None,
                limit: 10,
            },
            1_001,
        )
        .expect("page");
    assert_eq!(
        page.projections.as_slice(),
        std::slice::from_ref(&put.projection)
    );
    assert!(!page.has_more);
    put
}

fn verify_wrong_key_reopen_and_purge(
    driver: &mut PackagedEncryptedScopeDriver,
    database: &Path,
    context: EncryptedScopeOpenContext,
    cipher_key: &[u8; 32],
    put: PutConfirmedInput,
) {
    let wrong_key = [0x24; 32];
    assert_eq!(
        driver
            .open_scope(database, &wrong_key, context)
            .expect_err("wrong key")
            .code,
        "WCDB_NATIVE_SCOPE_OPEN_REJECTED"
    );
    assert!(
        driver
            .open_scope(database, cipher_key, context)
            .expect("reopen")
            .reopened
    );
    assert_eq!(
        driver
            .page(
                &PageInput {
                    scope_handle: native_e2e_scope().to_owned(),
                    thread_id: put.projection.thread_id.clone(),
                    after_sequence: None,
                    limit: 10,
                },
                1_002,
            )
            .expect("persistent page")
            .projections,
        [put.projection]
    );
    let purge = driver
        .purge_scope(
            &PurgeScopeInput {
                scope_handle: native_e2e_scope().to_owned(),
                operation_id: "33333333-3333-4333-8333-333333333333".to_owned(),
                confirmed: true,
            },
            &[0x32; 32],
            1_003,
            1_003 + context.retention.retention_seconds as i64,
        )
        .expect("purge");
    assert!(!purge.idempotency_replayed);
    driver.close_scope().expect("close after purge");
}

fn package_json(
    target: super::native_package_contract::NativeTarget,
    artifact_sha: &str,
    license_sha: &str,
) -> Value {
    json!({
        "schema_version": "aistaff.wcdb-native-package.v1",
        "target": target.target,
        "platform": target.platform,
        "architecture": target.architecture,
        "component": {
            "id": "message_cache",
            "adapter_id": "wcdb",
            "name": "WCDB",
            "version": "2.1.16",
            "license_spdx": "BSD-3-Clause",
            "release_approval": "EXT-015"
        },
        "owned_abi": {
            "name": "aistaff_message_cache_v1",
            "version": 1,
            "probe_symbol": "aistaff_message_cache_v1_probe",
            "third_party_types_allowed": false
        },
        "upstream": {
            "repository": "https://github.com/Tencent/wcdb",
            "tag": "v2.1.16",
            "commit": "df808591b9f9a9ab42156006819c3550d5af13a3",
            "sqlcipher_commit": "f049bed66ca26741f09a6e4f0603ed3af195ac96",
            "build_profile_id": "aistaff-wcdb-v2.1.16-minimal-v1"
        },
        "artifact": {
            "filename": target.artifact_filename,
            "sha256": artifact_sha,
            "exported_symbols": ["aistaff_message_cache_v1_probe"]
        },
        "license_notice": {
            "filename": "LICENSE.wcdb.txt",
            "sha256": license_sha
        },
        "provenance": {
            "source": "https://github.com/Voyachat/AiStaff-Client",
            "commit": "1111111111111111111111111111111111111111",
            "source_state": "clean",
            "source_manifest": "third_party/wcdb/source-build-manifest.json",
            "source_manifest_sha256": "2".repeat(64),
            "build_evidence": target.build_evidence,
            "build_evidence_sha256": "3".repeat(64),
            "build_command": "node tools/oss/wcdb-native-build.mjs build",
            "staging_command":
                format!("node tools/release/stage-wcdb-native.mjs --target {}", target.target)
        },
        "production_ready": false
    })
}

fn release_json(
    target: super::native_package_contract::NativeTarget,
    package_sha: &str,
    package: &Value,
) -> Value {
    json!({
        "schema_version": "aistaff.desktop-release-manifest.v1",
        "product_name": "AiStaff Client",
        "client_version": env!("CARGO_PKG_VERSION"),
        "client_commit": package["provenance"]["commit"],
        "source_state": "clean",
        "target": target.target,
        "generated_at": "2026-07-29T00:00:00.000Z",
        "signing_status": "unsigned_test_only",
        "production_ready": false,
        "staged_update": {
            "schema_version": "aistaff.desktop-release-trust.v1",
            "target": target.target,
            "release_channel": "internal",
            "signing_status": "unsigned_test_only",
            "current_version": env!("CARGO_PKG_VERSION"),
            "candidate_version": env!("CARGO_PKG_VERSION"),
            "minimum_secure_version": env!("CARGO_PKG_VERSION"),
            "target_artifact_hash": package["artifact"]["sha256"],
            "manifest_signature": "missing",
            "binary_hash": "missing",
            "platform_signature": "missing",
            "version_monotonicity": "missing",
            "rollback_authorization": "missing",
            "rollback_requested": false,
            "evidence_refs": {
                "manifest_signature_ref": null,
                "binary_hash_ref": format!("release:target-artifact:{}", target.target),
                "platform_signature_ref": null,
                "version_policy_ref":
                    format!("release:minimum-secure-version:{}", target.target),
                "rollback_authorization_ref": null
            },
            "update_install_enabled": false,
            "rollback_enabled": false,
            "customer_evidence": false,
            "production_update": false,
            "reason_code": "SIGNED_RELEASE_INFRASTRUCTURE_EXTERNAL_BLOCKED"
        },
        "server_compatibility": {
            "repository": "https://github.com/Voyachat/AiStaff",
            "commit": "702db2d218f1defa30c9eaaaf2455b5f533b7296",
            "contract_manifest_sha256": "4".repeat(64),
            "minimum_server_contract_version": "local-baseline.v1",
            "required_api_families": [
                "health",
                "employees",
                "sessions",
                "session_messages",
                "session_timeline",
                "runs",
                "human_workbench",
                "deliverables"
            ]
        },
        "native_components": {
            "message_cache": {
                "package_manifest_path":
                    "native/message-cache/aistaff-message-cache-package.json",
                "package_manifest_sha256": package_sha,
                "artifact_filename": target.artifact_filename,
                "artifact_sha256": package["artifact"]["sha256"],
                "license_notice_sha256": package["license_notice"]["sha256"],
                "owned_abi": package["owned_abi"],
                "upstream_commit": package["upstream"]["commit"],
                "production_ready": false
            }
        }
    })
}

fn fixture_native_binary(platform: &str, architecture: &str) -> Vec<u8> {
    if platform == "macos" {
        let cpu = if architecture == "x86_64" {
            [0x07, 0x00, 0x00, 0x01]
        } else {
            [0x0c, 0x00, 0x00, 0x01]
        };
        return [vec![0xcf, 0xfa, 0xed, 0xfe], cpu.to_vec(), vec![0; 64]].concat();
    }
    let mut binary = vec![0_u8; 96];
    binary[..2].copy_from_slice(b"MZ");
    binary[60..64].copy_from_slice(&64_u32.to_le_bytes());
    binary[64..68].copy_from_slice(b"PE\0\0");
    binary[68..70].copy_from_slice(&[0x64, 0x86]);
    binary[84..86].copy_from_slice(&2_u16.to_le_bytes());
    binary[88..90].copy_from_slice(&[0x0b, 0x02]);
    binary
}

fn canonical_package_json(value: &Value) -> Vec<u8> {
    match serde_json::from_value::<NativePackageManifest>(value.clone()) {
        Ok(manifest) => canonical_json(&manifest),
        Err(_) => canonical_json(value),
    }
}

fn canonical_release_json(value: &Value) -> Vec<u8> {
    match serde_json::from_value::<ReleaseManifest>(value.clone()) {
        Ok(manifest) => canonical_json(&manifest),
        Err(_) => canonical_json(value),
    }
}

fn canonical_json(value: &impl serde::Serialize) -> Vec<u8> {
    let mut bytes = serde_json::to_vec_pretty(value).expect("canonical json");
    bytes.push(b'\n');
    bytes
}

fn sha256_file(path: &Path) -> String {
    sha256_bytes(&fs::read(path).expect("hash file"))
}

fn sha256_bytes(contents: &[u8]) -> String {
    Sha256::digest(contents)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn native_e2e_scope() -> &'static str {
    "11111111-1111-4111-8111-111111111111"
}

fn native_e2e_put() -> PutConfirmedInput {
    PutConfirmedInput {
        scope_handle: native_e2e_scope().to_owned(),
        operation_id: "22222222-2222-4222-8222-222222222222".to_owned(),
        projection: ConfirmedTimelineProjection {
            thread_id: "thread:native-e2e".to_owned(),
            sequence: 1,
            event_type: "message.confirmed".to_owned(),
            actor_type: ActorType::User,
            occurred_at: "2026-07-29T00:00:00Z".to_owned(),
            masked_summary: "native e2e summary".to_owned(),
            payload_hash: "a".repeat(64),
            run_id: Some("run:native-e2e".to_owned()),
            server_cursor: Some("cursor:native-e2e".to_owned()),
            delivery_state: DeliveryState::Confirmed,
            redaction_profile: RedactionProfile::SummaryOnlyV1,
        },
    }
}

fn native_e2e_root() -> PathBuf {
    let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::current_dir()
        .expect("cwd")
        .join("target")
        .join("packaged-native-e2e")
        .join(format!("{}-{nonce}-{sequence}", std::process::id()))
}

fn verify_tampered_ciphertext_fails_closed(
    driver: &mut PackagedEncryptedScopeDriver,
    database: &Path,
    context: EncryptedScopeOpenContext,
    cipher_key: &[u8; 32],
) -> &'static str {
    driver
        .open_scope(database, cipher_key, context)
        .expect("open tamper fixture");
    for sequence in 1..=64_u64 {
        let mut put = native_e2e_put();
        put.operation_id = format!("{sequence:08x}-4444-4444-8444-{sequence:012x}");
        put.projection.sequence = sequence;
        put.projection.masked_summary = "x".repeat(480);
        put.projection.payload_hash = format!("{sequence:064x}");
        driver
            .put_confirmed(
                &put,
                &[sequence as u8; 32],
                2_000 + sequence as i64,
                2_000 + sequence as i64 + context.retention.retention_seconds as i64,
            )
            .expect("grow encrypted tamper fixture");
    }
    driver.close_scope().expect("close tamper fixture");
    let mut wal_name = database.as_os_str().to_os_string();
    wal_name.push("-wal");
    let wal = PathBuf::from(wal_name);
    assert!(fs::metadata(database).expect("database metadata").len() >= 512);
    assert!(fs::metadata(&wal).expect("wal metadata").len() >= 1024);
    tamper_byte(database, 256);
    tamper_byte(&wal, 32 + 24 + 256);

    match driver.open_scope(database, cipher_key, context) {
        Err(error) => {
            assert!(matches!(
                error.code,
                "WCDB_NATIVE_SCOPE_OPEN_REJECTED"
                    | "WCDB_NATIVE_SCHEMA_MISMATCH"
                    | "WCDB_NATIVE_DATABASE_CORRUPT"
            ));
            error.code
        }
        Ok(_) => {
            let integrity = driver.check_integrity();
            assert!(
                !matches!(
                    integrity,
                    Ok(super::scope_driver::EncryptedScopeIntegrity::Healthy)
                ),
                "tampered ciphertext must never be reported healthy"
            );
            let _ = driver.close_scope();
            match integrity {
                Ok(super::scope_driver::EncryptedScopeIntegrity::ConfirmedCorrupt) => {
                    "WCDB_NATIVE_CONFIRMED_CORRUPT"
                }
                Err(error) => error.code,
                Ok(super::scope_driver::EncryptedScopeIntegrity::Healthy) => unreachable!(),
            }
        }
    }
}

fn tamper_byte(path: &Path, offset: u64) {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .expect("open ciphertext");
    file.seek(SeekFrom::Start(offset)).expect("seek ciphertext");
    let mut byte = [0_u8; 1];
    file.read_exact(&mut byte).expect("read ciphertext");
    file.seek(SeekFrom::Start(offset))
        .expect("rewind ciphertext");
    byte[0] ^= 0x5a;
    file.write_all(&byte).expect("tamper ciphertext");
    file.sync_all().expect("sync tampered ciphertext");
    drop(file);
}
