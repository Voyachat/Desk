use serde::{Deserialize, Serialize};
use std::path::{Component as PathComponent, Path};

pub(super) const PACKAGE_MANIFEST_FILENAME: &str = "aistaff-message-cache-package.json";
pub(super) const LICENSE_FILENAME: &str = "LICENSE.wcdb.txt";
pub(super) const VERSION_CONTRACT_FILENAME: &str = "version-contract.json";
pub(super) const PROBE_SYMBOL: &[u8] = b"aistaff_message_cache_v1_probe\0";
const PROBE_SYMBOL_TEXT: &str = "aistaff_message_cache_v1_probe";
const WCDB_COMMIT: &str = "df808591b9f9a9ab42156006819c3550d5af13a3";
const SQLCIPHER_COMMIT: &str = "f049bed66ca26741f09a6e4f0603ed3af195ac96";
const CLIENT_REPOSITORY: &str = "https://github.com/Voyachat/AiStaff-Client";
const SERVER_REPOSITORY: &str = "https://github.com/Voyachat/AiStaff";

#[derive(Debug, Clone, Copy)]
pub(super) struct NativeTarget {
    pub target: &'static str,
    pub platform: &'static str,
    pub architecture: &'static str,
    pub artifact_filename: &'static str,
    pub build_evidence: &'static str,
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub(super) const NATIVE_TARGET: Option<NativeTarget> = Some(NativeTarget {
    target: "x86_64-apple-darwin",
    platform: "macos",
    architecture: "x86_64",
    artifact_filename: "libaistaff_message_cache_v1.dylib",
    build_evidence: "services/desktop-supervisor/target/wcdb-native/darwin-x64/aistaff-wcdb-native-evidence.json",
});

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub(super) const NATIVE_TARGET: Option<NativeTarget> = Some(NativeTarget {
    target: "aarch64-apple-darwin",
    platform: "macos",
    architecture: "arm64",
    artifact_filename: "libaistaff_message_cache_v1.dylib",
    build_evidence: "services/desktop-supervisor/target/wcdb-native/darwin-arm64/aistaff-wcdb-native-evidence.json",
});

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
pub(super) const NATIVE_TARGET: Option<NativeTarget> = Some(NativeTarget {
    target: "x86_64-pc-windows-msvc",
    platform: "windows",
    architecture: "x86_64",
    artifact_filename: "aistaff_message_cache_v1.dll",
    build_evidence: "services/desktop-supervisor/target/wcdb-native/win32-x64/aistaff-wcdb-native-evidence.json",
});

#[cfg(not(any(
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "windows", target_arch = "x86_64")
)))]
pub(super) const NATIVE_TARGET: Option<NativeTarget> = None;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NativePackageManifest {
    schema_version: String,
    target: String,
    platform: String,
    architecture: String,
    component: NativeComponent,
    owned_abi: OwnedAbi,
    upstream: NativeUpstream,
    artifact: NativeArtifact,
    license_notice: LicenseNotice,
    provenance: NativeProvenance,
    production_ready: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeComponent {
    id: String,
    adapter_id: String,
    name: String,
    version: String,
    license_spdx: String,
    release_approval: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OwnedAbi {
    name: String,
    version: u32,
    probe_symbol: String,
    third_party_types_allowed: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeUpstream {
    repository: String,
    tag: String,
    commit: String,
    sqlcipher_commit: String,
    build_profile_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeArtifact {
    filename: String,
    sha256: String,
    exported_symbols: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LicenseNotice {
    filename: String,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeProvenance {
    source: String,
    commit: String,
    source_state: String,
    source_manifest: String,
    source_manifest_sha256: String,
    build_evidence: String,
    build_evidence_sha256: String,
    build_command: String,
    staging_command: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ReleaseManifest {
    schema_version: String,
    product_name: String,
    client_version: String,
    client_commit: String,
    source_state: String,
    target: String,
    generated_at: String,
    signing_status: String,
    production_ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    staged_update: Option<ReleaseStagedUpdate>,
    server_compatibility: ServerCompatibility,
    native_components: NativeComponents,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ServerCompatibility {
    repository: String,
    commit: String,
    contract_manifest_sha256: String,
    minimum_server_contract_version: String,
    required_api_families: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NativeComponents {
    message_cache: ReleaseNativeComponent,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseNativeComponent {
    package_manifest_path: String,
    package_manifest_sha256: String,
    artifact_filename: String,
    artifact_sha256: String,
    license_notice_sha256: String,
    owned_abi: OwnedAbi,
    upstream_commit: String,
    production_ready: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseStagedUpdate {
    schema_version: String,
    target: String,
    release_channel: String,
    signing_status: String,
    current_version: String,
    candidate_version: String,
    minimum_secure_version: String,
    target_artifact_hash: String,
    manifest_signature: String,
    binary_hash: String,
    platform_signature: String,
    version_monotonicity: String,
    rollback_authorization: String,
    rollback_requested: bool,
    evidence_refs: ReleaseStagedUpdateEvidenceRefs,
    update_install_enabled: bool,
    rollback_enabled: bool,
    customer_evidence: bool,
    production_update: bool,
    reason_code: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseStagedUpdateEvidenceRefs {
    manifest_signature_ref: Option<String>,
    binary_hash_ref: Option<String>,
    platform_signature_ref: Option<String>,
    version_policy_ref: Option<String>,
    rollback_authorization_ref: Option<String>,
}

impl NativePackageManifest {
    pub(super) fn parse_canonical(
        contents: &[u8],
        target: NativeTarget,
    ) -> Result<Self, &'static str> {
        let manifest: Self = parse_canonical(contents, "WCDB_NATIVE_PACKAGE_MANIFEST_INVALID")?;
        if manifest.valid_for(target) {
            Ok(manifest)
        } else {
            Err("WCDB_NATIVE_PACKAGE_CONTRACT_MISMATCH")
        }
    }

    pub(super) fn artifact_sha256(&self) -> &str {
        &self.artifact.sha256
    }

    pub(super) fn license_sha256(&self) -> &str {
        &self.license_notice.sha256
    }

    pub(super) fn wcdb_version(&self) -> &str {
        &self.component.version
    }

    pub(super) fn wcdb_commit(&self) -> &str {
        &self.upstream.commit
    }

    pub(super) fn client_commit(&self) -> &str {
        &self.provenance.commit
    }

    fn valid_for(&self, target: NativeTarget) -> bool {
        self.schema_version == "aistaff.wcdb-native-package.v1"
            && self.target == target.target
            && self.platform == target.platform
            && self.architecture == target.architecture
            && self.component.id == "message_cache"
            && self.component.adapter_id == "wcdb"
            && self.component.name == "WCDB"
            && self.component.version == "2.1.16"
            && self.component.license_spdx == "BSD-3-Clause"
            && self.component.release_approval == "EXT-015"
            && self.owned_abi.valid()
            && self.upstream.valid()
            && self.artifact.filename == target.artifact_filename
            && valid_hash(&self.artifact.sha256)
            && self.artifact.exported_symbols == [PROBE_SYMBOL_TEXT]
            && self.license_notice.filename == LICENSE_FILENAME
            && valid_hash(&self.license_notice.sha256)
            && self.provenance.valid(target)
            && !self.production_ready
    }
}

impl ReleaseManifest {
    pub(super) fn parse_canonical(
        contents: &[u8],
        target: NativeTarget,
    ) -> Result<Self, &'static str> {
        let manifest: Self = parse_canonical(contents, "WCDB_NATIVE_RELEASE_MANIFEST_INVALID")?;
        if manifest.valid_for(target) {
            Ok(manifest)
        } else {
            Err("WCDB_NATIVE_RELEASE_CONTRACT_MISMATCH")
        }
    }

    pub(super) fn validates_binding(
        &self,
        package: &NativePackageManifest,
        package_manifest_sha256: &str,
    ) -> bool {
        let native = &self.native_components.message_cache;
        self.client_commit == package.client_commit()
            && native.package_manifest_sha256 == package_manifest_sha256
            && native.artifact_sha256 == package.artifact_sha256()
            && native.license_notice_sha256 == package.license_sha256()
            && native.upstream_commit == package.wcdb_commit()
    }

    fn valid_for(&self, target: NativeTarget) -> bool {
        let native = &self.native_components.message_cache;
        self.schema_version == "aistaff.desktop-release-manifest.v1"
            && self.product_name == "AiStaff Client"
            && self.client_version == env!("CARGO_PKG_VERSION")
            && valid_commit(&self.client_commit)
            && self.source_state == "clean"
            && self.target == target.target
            && valid_generated_at(&self.generated_at)
            && self.signing_status == "unsigned_test_only"
            && !self.production_ready
            && self
                .staged_update
                .as_ref()
                .is_none_or(|staged| staged.valid_for(target, &self.signing_status, native))
            && self.server_compatibility.valid()
            && native.package_manifest_path
                == "native/message-cache/aistaff-message-cache-package.json"
            && valid_hash(&native.package_manifest_sha256)
            && native.artifact_filename == target.artifact_filename
            && valid_hash(&native.artifact_sha256)
            && valid_hash(&native.license_notice_sha256)
            && native.owned_abi.valid()
            && native.upstream_commit == WCDB_COMMIT
            && !native.production_ready
    }
}

impl ReleaseStagedUpdate {
    fn valid_for(
        &self,
        target: NativeTarget,
        release_signing_status: &str,
        native: &ReleaseNativeComponent,
    ) -> bool {
        self.schema_version == "aistaff.desktop-release-trust.v1"
            && self.target == target.target
            && self.release_channel == "internal"
            && self.signing_status == release_signing_status
            && self.signing_status == "unsigned_test_only"
            && self.current_version == env!("CARGO_PKG_VERSION")
            && self.candidate_version == env!("CARGO_PKG_VERSION")
            && self.minimum_secure_version == env!("CARGO_PKG_VERSION")
            && self.target_artifact_hash == native.artifact_sha256
            && self.manifest_signature == "missing"
            && self.binary_hash == "missing"
            && self.platform_signature == "missing"
            && self.version_monotonicity == "missing"
            && self.rollback_authorization == "missing"
            && !self.rollback_requested
            && self.evidence_refs.valid_for(target)
            && !self.update_install_enabled
            && !self.rollback_enabled
            && !self.customer_evidence
            && !self.production_update
            && self.reason_code == "SIGNED_RELEASE_INFRASTRUCTURE_EXTERNAL_BLOCKED"
    }
}

impl ReleaseStagedUpdateEvidenceRefs {
    fn valid_for(&self, target: NativeTarget) -> bool {
        let binary_hash_ref = format!("release:target-artifact:{}", target.target);
        let version_policy_ref = format!("release:minimum-secure-version:{}", target.target);
        self.manifest_signature_ref.is_none()
            && self.platform_signature_ref.is_none()
            && self.rollback_authorization_ref.is_none()
            && self.binary_hash_ref.as_deref() == Some(binary_hash_ref.as_str())
            && self.version_policy_ref.as_deref() == Some(version_policy_ref.as_str())
    }
}

impl OwnedAbi {
    fn valid(&self) -> bool {
        self.name == "aistaff_message_cache_v1"
            && self.version == 1
            && self.probe_symbol == PROBE_SYMBOL_TEXT
            && !self.third_party_types_allowed
    }
}

impl NativeUpstream {
    fn valid(&self) -> bool {
        self.repository == "https://github.com/Tencent/wcdb"
            && self.tag == "v2.1.16"
            && self.commit == WCDB_COMMIT
            && self.sqlcipher_commit == SQLCIPHER_COMMIT
            && self.build_profile_id == "aistaff-wcdb-v2.1.16-minimal-v1"
    }
}

impl NativeProvenance {
    fn valid(&self, target: NativeTarget) -> bool {
        self.source == CLIENT_REPOSITORY
            && valid_commit(&self.commit)
            && self.source_state == "clean"
            && self.source_manifest == "third_party/wcdb/source-build-manifest.json"
            && valid_hash(&self.source_manifest_sha256)
            && self.build_evidence == target.build_evidence
            && valid_hash(&self.build_evidence_sha256)
            && self.build_command == "node tools/oss/wcdb-native-build.mjs build"
            && self.staging_command
                == format!(
                    "node tools/release/stage-wcdb-native.mjs --target {}",
                    target.target
                )
            && valid_relative_reference(&self.source_manifest)
            && valid_relative_reference(&self.build_evidence)
    }
}

impl ServerCompatibility {
    fn valid(&self) -> bool {
        const API_FAMILIES: [&str; 8] = [
            "health",
            "employees",
            "sessions",
            "session_messages",
            "session_timeline",
            "runs",
            "human_workbench",
            "deliverables",
        ];
        self.repository == SERVER_REPOSITORY
            && valid_commit(&self.commit)
            && valid_hash(&self.contract_manifest_sha256)
            && valid_identifier(&self.minimum_server_contract_version)
            && self.required_api_families == API_FAMILIES
    }
}

fn parse_canonical<T>(contents: &[u8], code: &'static str) -> Result<T, &'static str>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let value: T = serde_json::from_slice(contents).map_err(|_| code)?;
    let mut canonical = serde_json::to_vec_pretty(&value).map_err(|_| code)?;
    canonical.push(b'\n');
    if canonical == contents {
        Ok(value)
    } else {
        Err(code)
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_commit(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_generated_at(value: &str) -> bool {
    (20..=64).contains(&value.len())
        && value.is_ascii()
        && value.ends_with('Z')
        && value.as_bytes().first().is_some_and(u8::is_ascii_digit)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn valid_relative_reference(value: &str) -> bool {
    !value.contains('\\')
        && Path::new(value)
            .components()
            .all(|component| matches!(component, PathComponent::Normal(_)))
}
