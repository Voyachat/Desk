use super::contracts::{
    CapabilityScope, LocalCapabilityError, is_lower_uuid, is_safe_identifier, validate_protocol,
};
use serde::{Deserialize, Serialize};

pub const LOCAL_BROWSER_CAPABILITY_COMMANDS: [&str; 3] = [
    "capability.browser.policy.register",
    "capability.browser.policy.revoke",
    "capability.browser.descriptor.admit",
];
pub const LOCAL_BROWSER_DESCRIPTOR_ADMISSION_CAPABILITY_ID: &str =
    "local_browser_descriptor_admission.v1";

const MAX_ORIGINS: usize = 16;
const MAX_URL_BYTES: usize = 2_048;
const LOCAL_BROWSER_MAX_TIMEOUT_MS: u64 = 60_000;
const MAX_POLICY_LIFETIME_MS: u64 = 24 * 60 * 60 * 1_000;
const JAVASCRIPT_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserPermissionOverride {
    pub permission: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserPermissionPolicy {
    pub schema_version: String,
    pub default_mode: String,
    pub overrides: Vec<BrowserPermissionOverride>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserDownloadPolicy {
    pub schema_version: String,
    pub mode: String,
    pub max_bytes: Option<u64>,
    pub allowed_mime_types: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserEvidencePolicy {
    pub schema_version: String,
    pub dom_capture: String,
    pub screenshot_capture: String,
    pub network_capture: String,
    pub console_capture: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserPolicyRegisterInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub policy_revision: String,
    pub scope: CapabilityScope,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub allowed_origins: Vec<String>,
    pub download_policy: BrowserDownloadPolicy,
    pub permission_policy: BrowserPermissionPolicy,
    pub evidence_policy: BrowserEvidencePolicy,
    pub max_timeout_ms: u64,
    pub source: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserPolicyRegisterResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub policy_revision: String,
    pub policy_id: String,
    pub action_id: String,
    pub capability_id: String,
    pub allowed_origins: Vec<String>,
    pub policy_status: &'static str,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserPolicyRevokeInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_policy_revision: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserPolicyRevokeResult {
    pub protocol_version: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub revoke_status: &'static str,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BrowserDescriptorAdmitInput {
    pub protocol_version: String,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_policy_revision: String,
    pub scope: CapabilityScope,
    pub start_url: String,
    pub expected_origin: String,
    pub timeout_ms: u64,
    pub download_policy: BrowserDownloadPolicy,
    pub permission_policy: BrowserPermissionPolicy,
    pub evidence_policy: BrowserEvidencePolicy,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserDescriptorEvidence {
    pub schema_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_origin: String,
    pub browser_descriptor_hash: String,
    pub side_effect_state: &'static str,
    pub redaction_profile: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserDescriptorAdmitResult {
    pub protocol_version: &'static str,
    pub capability_id: &'static str,
    pub operation_id: String,
    pub policy_handle: String,
    pub expected_origin: String,
    pub admission_status: &'static str,
    pub browser_descriptor_hash: String,
    pub execution_enabled: bool,
    pub idempotency_replayed: bool,
    pub reason_code: &'static str,
    pub evidence: BrowserDescriptorEvidence,
}

pub fn is_local_browser_capability_command(command: &str) -> bool {
    LOCAL_BROWSER_CAPABILITY_COMMANDS.contains(&command)
}

impl BrowserPolicyRegisterInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.policy_revision)
            || !is_safe_identifier(&self.policy_id)
            || !is_safe_identifier(&self.action_id)
            || !is_safe_identifier(&self.capability_id)
            || self.source != "trusted_browser_policy_port"
            || self.max_timeout_ms == 0
            || self.max_timeout_ms > LOCAL_BROWSER_MAX_TIMEOUT_MS
            || self.expires_at_ms == 0
            || self.expires_at_ms > JAVASCRIPT_MAX_SAFE_INTEGER
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_POLICY_REGISTER",
            ));
        }
        validate_allowed_origins(&self.allowed_origins)?;
        self.download_policy.validate()?;
        self.permission_policy.validate()?;
        self.evidence_policy.validate()
    }
}

impl BrowserPolicyRevokeInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.expected_policy_revision)
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_POLICY_REVOKE",
            ));
        }
        Ok(())
    }
}

impl BrowserDescriptorAdmitInput {
    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        validate_protocol(&self.protocol_version)?;
        self.scope.validate()?;
        if !is_lower_uuid(&self.operation_id)
            || !is_lower_uuid(&self.policy_handle)
            || !is_lower_uuid(&self.expected_policy_revision)
            || self.timeout_ms == 0
            || self.timeout_ms > LOCAL_BROWSER_MAX_TIMEOUT_MS
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_DESCRIPTOR_ADMIT",
            ));
        }
        let origin = validate_https_url(&self.start_url, "INVALID_LOCAL_BROWSER_START_URL")?;
        if self.start_url == origin {
            return Err(LocalCapabilityError::new("INVALID_LOCAL_BROWSER_START_URL"));
        }
        validate_https_origin(&self.expected_origin)?;
        if origin != self.expected_origin {
            return Err(LocalCapabilityError::new("LOCAL_BROWSER_ORIGIN_MISMATCH"));
        }
        self.download_policy.validate()?;
        self.permission_policy.validate()?;
        self.evidence_policy.validate()
    }
}

impl BrowserDownloadPolicy {
    fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != "aistaff.local-browser-download-policy.v1"
            || self.mode != "disabled"
            || self.max_bytes.is_some()
            || !self.allowed_mime_types.is_empty()
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_DOWNLOAD_POLICY",
            ));
        }
        Ok(())
    }
}

impl BrowserPermissionPolicy {
    fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != "aistaff.local-browser-permission-policy.v1"
            || self.default_mode != "deny"
            || self
                .overrides
                .windows(2)
                .any(|pair| pair[0].permission >= pair[1].permission)
            || self.overrides.iter().any(|entry| {
                !matches!(
                    entry.permission.as_str(),
                    "camera"
                        | "clipboard_read"
                        | "clipboard_write"
                        | "geolocation"
                        | "microphone"
                        | "notifications"
                ) || entry.mode != "deny"
            })
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_PERMISSION_POLICY",
            ));
        }
        Ok(())
    }
}

impl BrowserEvidencePolicy {
    fn validate(&self) -> Result<(), LocalCapabilityError> {
        if self.schema_version != "aistaff.local-browser-evidence-policy.v1"
            || self.dom_capture != "disabled"
            || self.screenshot_capture != "disabled"
            || self.network_capture != "origin_only"
            || self.console_capture != "disabled"
        {
            return Err(LocalCapabilityError::new(
                "INVALID_LOCAL_BROWSER_EVIDENCE_POLICY",
            ));
        }
        Ok(())
    }
}

pub(super) fn validate_expiry(expires_at_ms: u64, now_ms: u64) -> Result<(), LocalCapabilityError> {
    if expires_at_ms <= now_ms
        || expires_at_ms
            > now_ms
                .checked_add(MAX_POLICY_LIFETIME_MS)
                .ok_or_else(|| LocalCapabilityError::new("LOCAL_BROWSER_POLICY_EXPIRY_INVALID"))?
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_POLICY_EXPIRY_INVALID",
        ));
    }
    Ok(())
}

fn validate_allowed_origins(origins: &[String]) -> Result<(), LocalCapabilityError> {
    if origins.is_empty()
        || origins.len() > MAX_ORIGINS
        || origins.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(LocalCapabilityError::new(
            "INVALID_LOCAL_BROWSER_ALLOWED_ORIGINS",
        ));
    }
    for origin in origins {
        validate_https_origin(origin)?;
    }
    Ok(())
}

fn validate_https_origin(origin: &str) -> Result<(), LocalCapabilityError> {
    let computed = validate_https_url(origin, "INVALID_LOCAL_BROWSER_ORIGIN")?;
    if computed != origin || origin.ends_with('/') || origin.contains('?') {
        return Err(LocalCapabilityError::new("INVALID_LOCAL_BROWSER_ORIGIN"));
    }
    Ok(())
}

fn validate_https_url(
    value: &str,
    error_code: &'static str,
) -> Result<String, LocalCapabilityError> {
    if value.is_empty()
        || value.len() > MAX_URL_BYTES
        || value.contains('\0')
        || value.contains('#')
        || value.chars().any(|ch| ch.is_control())
        || !value.starts_with("https://")
    {
        return Err(LocalCapabilityError::new(error_code));
    }
    let rest = &value["https://".len()..];
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() || authority.contains('@') || authority.contains('*') {
        return Err(LocalCapabilityError::new(error_code));
    }
    let (host, port) = parse_authority(authority, error_code)?;
    assert_no_private_host(&host)?;
    let origin = format!("https://{}{}", host, port.unwrap_or_default());
    let tail = &rest[authority_end..];
    if !tail.is_empty() && !tail.starts_with('/') {
        return Err(LocalCapabilityError::new(error_code));
    }
    if value != format!("{origin}{tail}") {
        return Err(LocalCapabilityError::new(error_code));
    }
    Ok(origin)
}

fn parse_authority(
    authority: &str,
    error_code: &'static str,
) -> Result<(String, Option<String>), LocalCapabilityError> {
    if let Some(stripped) = authority.strip_prefix('[') {
        let end = stripped
            .find(']')
            .ok_or_else(|| LocalCapabilityError::new(error_code))?;
        let host = stripped[..end].to_ascii_lowercase();
        let tail = &stripped[end + 1..];
        let port = if tail.is_empty() {
            None
        } else {
            validate_port(tail, error_code)?
        };
        if host.is_empty() || host.contains('[') || host.contains(']') || !host.contains(':') {
            return Err(LocalCapabilityError::new(error_code));
        }
        return Ok((format!("[{host}]"), port));
    }
    if authority.contains('[') || authority.contains(']') {
        return Err(LocalCapabilityError::new(error_code));
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (
            host.to_ascii_lowercase(),
            validate_port(&format!(":{port}"), error_code)?,
        ),
        Some(_) => return Err(LocalCapabilityError::new(error_code)),
        None => (authority.to_ascii_lowercase(), None),
    };
    if host.is_empty()
        || host.starts_with('.')
        || host.ends_with('.')
        || host.split('.').any(str::is_empty)
        || !host.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'.'
        })
        || host
            .split('.')
            .any(|label| label.starts_with('-') || label.ends_with('-') || label.len() > 63)
        || is_suspicious_ipv4_literal(&host)
    {
        return Err(LocalCapabilityError::new(error_code));
    }
    Ok((host, port))
}

fn is_suspicious_ipv4_literal(host: &str) -> bool {
    let labels = host.split('.').collect::<Vec<_>>();
    if labels
        .iter()
        .all(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return labels.len() != 4
            || labels
                .iter()
                .any(|label| label.len() > 1 && label.starts_with('0'));
    }
    labels.len() <= 4
        && labels.iter().all(|label| {
            label.strip_prefix("0x").is_some_and(|hex| {
                !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
            }) || label.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn validate_port(
    tail: &str,
    error_code: &'static str,
) -> Result<Option<String>, LocalCapabilityError> {
    let port = tail
        .strip_prefix(':')
        .ok_or_else(|| LocalCapabilityError::new(error_code))?;
    if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(LocalCapabilityError::new(error_code));
    }
    let parsed = port
        .parse::<u16>()
        .map_err(|_| LocalCapabilityError::new(error_code))?;
    if parsed == 0 || parsed == 443 {
        return Err(LocalCapabilityError::new(error_code));
    }
    Ok(Some(format!(":{parsed}")))
}

fn assert_no_private_host(host: &str) -> Result<(), LocalCapabilityError> {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_PRIVATE_ORIGIN_DENIED",
        ));
    }
    if normalized.contains(':') {
        return Err(LocalCapabilityError::new(
            "LOCAL_BROWSER_PRIVATE_ORIGIN_DENIED",
        ));
    }
    let octets = normalized
        .split('.')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>();
    if let Ok(octets) = octets
        && octets.len() == 4
    {
        let first = octets[0];
        let second = octets[1];
        if first == 10
            || first == 127
            || first == 0
            || (first == 100 && (64..=127).contains(&second))
            || (first == 169 && second == 254)
            || (first == 172 && (16..=31).contains(&second))
            || (first == 192 && second == 0)
            || (first == 192 && second == 168)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_BROWSER_PRIVATE_ORIGIN_DENIED",
            ));
        }
    }
    Ok(())
}
