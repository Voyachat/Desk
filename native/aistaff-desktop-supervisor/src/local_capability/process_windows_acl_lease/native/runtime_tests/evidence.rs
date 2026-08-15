//! Sanitized, commit-bound machine evidence for the Windows runtime test.

use super::support::{
    EVIDENCE_ENV, TEST_CPU_TIME_LIMIT_MS, TEST_MEMORY_LIMIT_BYTES, TEST_PROCESS_COUNT_LIMIT,
    current_executable,
};
use crate::local_capability::process_resource_policy::PROCESS_RESOURCE_POLICY_SCHEMA_VERSION;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(super) fn write_runtime_evidence_if_requested() {
    let Some(path) = std::env::var_os(EVIDENCE_ENV) else {
        return;
    };
    let source_commit = std::env::var("GITHUB_SHA").expect("GITHUB_SHA for CI evidence");
    assert!(
        source_commit.len() == 40
            && source_commit
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "invalid CI source commit"
    );
    let executable = current_executable();
    let evidence = json!({
        "schema_version": "aistaff.windows-process-sandbox-runtime-evidence.v1",
        "evidence_class": "target_native_internal_unsigned_test",
        "target": "windows-x64",
        "source_commit": source_commit,
        "test_binary_sha256": sha256_file(&executable),
        "test_id": "windows_native_lpac_owner_loss_and_reconciliation_evidence",
        "resource_policy": {
            "schema_version": PROCESS_RESOURCE_POLICY_SCHEMA_VERSION,
            "cpu_time_limit_ms": TEST_CPU_TIME_LIMIT_MS,
            "memory_limit_bytes": TEST_MEMORY_LIMIT_BYTES,
            "process_count_limit": TEST_PROCESS_COUNT_LIMIT,
            "network_access": "denied",
            "sandbox_profile": "aistaff.restricted-process.v1"
        },
        "scenarios": [
            {"id": "lpac_token_is_appcontainer_less_privileged_zero_capability", "status": "pass"},
            {"id": "filesystem_ungranted_read_denied", "status": "pass"},
            {"id": "network_zero_capability_loopback_denied", "status": "pass"},
            {"id": "breakaway_creation_denied", "status": "pass"},
            {"id": "job_owner_loss_kills_process_tree", "status": "pass"},
            {"id": "acl_lease_restart_reconciles", "status": "pass"}
        ],
        "controls": {
            "aggregate_cpu": "unverified",
            "aggregate_memory": "unverified",
            "active_process_count": "unverified",
            "network_loopback_deny": "target_native_pass",
            "filesystem_ungranted_read_deny": "target_native_pass",
            "no_breakaway_tree_owner_loss": "target_native_pass"
        },
        "six_control_admission": "unverified",
        "production_ready": false
    });
    let path = PathBuf::from(path);
    assert!(path.is_absolute(), "evidence path must be absolute");
    let bytes = serde_json::to_vec_pretty(&evidence).expect("serialize runtime evidence");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .expect("create runtime evidence once");
    file.write_all(&bytes).expect("write runtime evidence");
    file.write_all(b"\n").expect("terminate runtime evidence");
    file.sync_all().expect("flush runtime evidence");
}

fn sha256_file(path: &Path) -> String {
    let mut file = File::open(path).expect("open test binary for hash");
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).expect("hash test binary");
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let mut encoded = String::with_capacity(64);
    for byte in digest.finalize() {
        write!(&mut encoded, "{byte:02x}").expect("format test binary hash");
    }
    encoded
}
