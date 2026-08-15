use super::contracts::LocalCapabilityError;
use super::file_contracts::FileTargetKind;
use super::file_execution::capability_snapshot;
use super::file_path::{FileSnapshot, reject_unsafe_absolute_components, safe_metadata, snapshot};
use super::process_contracts::ProcessTarget;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXECUTABLE_HEADER_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct AdmittedExecutable {
    canonical_path: PathBuf,
    parent_dir: Arc<Dir>,
    file_name: PathBuf,
    snapshot: FileSnapshot,
    target: ProcessTarget,
    sha256: String,
    fingerprint: String,
    #[cfg(test)]
    test_execution_path: Option<PathBuf>,
}

impl AdmittedExecutable {
    pub fn admit(
        executable_path: &str,
        expected_sha256: &str,
        target: ProcessTarget,
    ) -> Result<Self, LocalCapabilityError> {
        let path = PathBuf::from(executable_path);
        validate_absolute_shape(&path)?;
        reject_unsafe_absolute_components(&path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED"))?;
        let canonical_path = path
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
        reject_unsafe_absolute_components(&canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED"))?;
        let path_metadata = safe_metadata(&canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
        validate_executable_type(&canonical_path, &path_metadata)?;
        let snapshot = snapshot(&canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
        if snapshot.kind != FileTargetKind::File || snapshot.size_bytes > MAX_EXECUTABLE_BYTES {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_SIZE_REJECTED",
            ));
        }
        let parent = canonical_path
            .parent()
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED"))?;
        let file_name =
            PathBuf::from(canonical_path.file_name().ok_or_else(|| {
                LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED")
            })?);
        let parent_dir = Dir::open_ambient_dir(parent, ambient_authority()).map_err(|_| {
            LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_HANDLE_UNAVAILABLE")
        })?;
        let observed_sha256 = hash_opened_executable(&parent_dir, &file_name, &snapshot, target)?;
        if observed_sha256 != expected_sha256 {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_HASH_MISMATCH",
            ));
        }
        let fingerprint = executable_fingerprint(&snapshot, &observed_sha256)?;
        Ok(Self {
            canonical_path,
            parent_dir: Arc::new(parent_dir),
            file_name,
            snapshot,
            target,
            sha256: observed_sha256,
            fingerprint,
            #[cfg(test)]
            test_execution_path: None,
        })
    }

    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        reject_unsafe_absolute_components(&self.canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED"))?;
        if self
            .canonical_path
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?
            != self.canonical_path
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_IDENTITY_CHANGED",
            ));
        }
        let path_metadata = safe_metadata(&self.canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
        validate_executable_type(&self.canonical_path, &path_metadata)?;
        let path_snapshot = snapshot(&self.canonical_path)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_UNAVAILABLE"))?;
        if path_snapshot != self.snapshot {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_IDENTITY_CHANGED",
            ));
        }
        if hash_opened_executable(
            &self.parent_dir,
            &self.file_name,
            &self.snapshot,
            self.target,
        )? != self.sha256
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_HASH_CHANGED",
            ));
        }
        Ok(())
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub(super) fn execution_path(&self) -> PathBuf {
        #[cfg(test)]
        if let Some(path) = &self.test_execution_path {
            return path.clone();
        }
        self.canonical_path.clone()
    }

    #[cfg(test)]
    pub(super) fn set_test_execution_path(&mut self, path: PathBuf) {
        self.test_execution_path = Some(path);
    }
}

fn validate_absolute_shape(path: &Path) -> Result<(), LocalCapabilityError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_PATH_REJECTED",
        ));
    }
    Ok(())
}

fn hash_opened_executable(
    parent: &Dir,
    file_name: &Path,
    expected: &FileSnapshot,
    target: ProcessTarget,
) -> Result<String, LocalCapabilityError> {
    let mut file = parent
        .open(file_name)
        .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_OPEN_FAILED"))?;
    let before = capability_snapshot(
        &file
            .metadata()
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_METADATA_FAILED"))?,
    )?;
    if &before != expected || before.kind != FileTargetKind::File {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_IDENTITY_CHANGED",
        ));
    }
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut header = Vec::with_capacity(MAX_EXECUTABLE_HEADER_BYTES);
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_READ_FAILED"))?;
        if count == 0 {
            break;
        }
        total = total
            .checked_add(count as u64)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_SIZE_REJECTED"))?;
        if total > MAX_EXECUTABLE_BYTES {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTABLE_SIZE_REJECTED",
            ));
        }
        if header.len() < MAX_EXECUTABLE_HEADER_BYTES {
            let remaining = MAX_EXECUTABLE_HEADER_BYTES - header.len();
            header.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        hasher.update(&buffer[..count]);
    }
    let after = capability_snapshot(
        &file
            .metadata()
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_EXECUTABLE_METADATA_FAILED"))?,
    )?;
    if after != before || total != before.size_bytes {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_IDENTITY_CHANGED",
        ));
    }
    validate_binary_target(&header, target)?;
    digest_hex(hasher.finalize().as_slice())
}

fn executable_fingerprint(
    snapshot: &FileSnapshot,
    sha256: &str,
) -> Result<String, LocalCapabilityError> {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.local-process-executable.v1\0");
    snapshot.identity.update_hasher(&mut hasher);
    hasher.update(snapshot.size_bytes.to_le_bytes());
    hasher.update(sha256.as_bytes());
    digest_hex(hasher.finalize().as_slice())
}

fn digest_hex(digest: &[u8]) -> Result<String, LocalCapabilityError> {
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut output, "{byte:02x}")
            .map_err(|_| LocalCapabilityError::new("LOCAL_PROCESS_HASH_FAILED"))?;
    }
    Ok(output)
}

fn validate_binary_target(
    header: &[u8],
    target: ProcessTarget,
) -> Result<(), LocalCapabilityError> {
    let matches = match target {
        ProcessTarget::MacosX64 | ProcessTarget::MacosArm64 => {
            if header.len() < 8 {
                false
            } else {
                let magic =
                    u32::from_le_bytes(header[0..4].try_into().expect("fixed Mach-O magic"));
                let cpu = u32::from_le_bytes(header[4..8].try_into().expect("fixed Mach-O cpu"));
                magic == 0xfeed_facf
                    && cpu
                        == match target {
                            ProcessTarget::MacosX64 => 0x0100_0007,
                            ProcessTarget::MacosArm64 => 0x0100_000c,
                            ProcessTarget::WindowsX64 => unreachable!(),
                        }
            }
        }
        ProcessTarget::WindowsX64 => {
            if header.len() < 64 || &header[..2] != b"MZ" {
                false
            } else {
                let pe_offset =
                    u32::from_le_bytes(header[0x3c..0x40].try_into().expect("fixed PE offset"))
                        as usize;
                pe_offset
                    .checked_add(6)
                    .is_some_and(|end| end <= header.len())
                    && &header[pe_offset..pe_offset + 4] == b"PE\0\0"
                    && u16::from_le_bytes(
                        header[pe_offset + 4..pe_offset + 6]
                            .try_into()
                            .expect("fixed PE machine"),
                    ) == 0x8664
            }
        }
    };
    if !matches {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_BINARY_TARGET_MISMATCH",
        ));
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn validate_executable_type(
    _path: &Path,
    metadata: &std::fs::Metadata,
) -> Result<(), LocalCapabilityError> {
    use std::os::unix::fs::MetadataExt;
    if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_TYPE_REJECTED",
        ));
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn validate_executable_type(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> Result<(), LocalCapabilityError> {
    if !metadata.is_file()
        || !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTABLE_TYPE_REJECTED",
        ));
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
pub(super) fn validate_executable_type(
    _path: &Path,
    _metadata: &std::fs::Metadata,
) -> Result<(), LocalCapabilityError> {
    Err(LocalCapabilityError::new(
        "LOCAL_PROCESS_TARGET_UNSUPPORTED",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn macho(cpu: u32) -> Vec<u8> {
        let mut bytes = vec![0_u8; 64];
        bytes[0..4].copy_from_slice(&0xfeed_facf_u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&cpu.to_le_bytes());
        bytes
    }

    fn pe_x64() -> Vec<u8> {
        let mut bytes = vec![0_u8; 128];
        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&64_u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        bytes[68..70].copy_from_slice(&0x8664_u16.to_le_bytes());
        bytes
    }

    #[test]
    fn target_parser_accepts_only_the_exact_supported_native_architecture() {
        assert!(validate_binary_target(&macho(0x0100_0007), ProcessTarget::MacosX64).is_ok());
        assert!(validate_binary_target(&macho(0x0100_000c), ProcessTarget::MacosArm64).is_ok());
        assert!(validate_binary_target(&pe_x64(), ProcessTarget::WindowsX64).is_ok());
        assert!(validate_binary_target(&macho(0x0100_000c), ProcessTarget::MacosX64).is_err());
        assert!(validate_binary_target(&pe_x64(), ProcessTarget::MacosArm64).is_err());
    }

    #[test]
    fn malformed_or_out_of_bounds_binary_headers_fail_closed() {
        let mut pe = pe_x64();
        pe[0x3c..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(validate_binary_target(&pe, ProcessTarget::WindowsX64).is_err());
        assert!(validate_binary_target(b"MZ", ProcessTarget::WindowsX64).is_err());
        assert!(validate_binary_target(b"script", ProcessTarget::MacosX64).is_err());
    }
}
