use super::contracts::LocalCapabilityError;
use super::file_contracts::{FileCapabilityIntent, FilePathAdmitInput, FileTargetKind};
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use sha2::{Digest, Sha256};
use std::fmt::Write;
use std::fs::{Metadata, symlink_metadata};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileIdentity {
    #[cfg(unix)]
    pub(super) device: u64,
    #[cfg(unix)]
    pub(super) inode: u64,
    #[cfg(windows)]
    pub(super) volume: u32,
    #[cfg(windows)]
    pub(super) index: u64,
    #[cfg(not(any(unix, windows)))]
    pub(super) created_nanos: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FileSnapshot {
    pub(super) identity: FileIdentity,
    pub(super) kind: FileTargetKind,
    pub(super) size_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct AdmittedFileRoot {
    pub(super) canonical_root: PathBuf,
    pub(super) identity: FileIdentity,
    pub(super) fingerprint: String,
    pub(super) capability_dir: Arc<Dir>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilePathAdmission {
    pub target_kind: FileTargetKind,
    pub size_bytes: Option<u64>,
    pub target_fingerprint: String,
    pub(super) canonical_path: PathBuf,
    pub(super) snapshot: FileSnapshot,
}

impl AdmittedFileRoot {
    pub fn admit(root_path: &str) -> Result<Self, LocalCapabilityError> {
        let root = Path::new(root_path);
        if !root.is_absolute()
            || root.parent().is_none()
            || root
                .components()
                .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        {
            return Err(LocalCapabilityError::new("LOCAL_FILE_ROOT_NOT_ADMISSIBLE"));
        }
        // A system picker may return a stable OS alias such as macOS `/var`,
        // whose ancestor resolves to `/private/var`. Reject a symlink/reparse
        // at the selected root itself, then bind and validate the fully
        // canonical root rather than rejecting legitimate ancestor aliases.
        let metadata = safe_metadata(root)?;
        if !metadata.is_dir() {
            return Err(LocalCapabilityError::new("LOCAL_FILE_ROOT_NOT_DIRECTORY"));
        }
        let canonical_root = root
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_UNAVAILABLE"))?;
        if canonical_root.parent().is_none() {
            return Err(LocalCapabilityError::new("LOCAL_FILE_ROOT_TOO_BROAD"));
        }
        reject_unsafe_absolute_components(&canonical_root)?;
        let canonical_metadata = safe_metadata(&canonical_root)?;
        if !canonical_metadata.is_dir() {
            return Err(LocalCapabilityError::new("LOCAL_FILE_ROOT_NOT_DIRECTORY"));
        }
        let identity = file_identity(&canonical_root, &canonical_metadata)?;
        let capability_dir = Dir::open_ambient_dir(&canonical_root, ambient_authority())
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_HANDLE_UNAVAILABLE"))?;
        let handle_metadata = capability_dir
            .dir_metadata()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_HANDLE_UNAVAILABLE"))?;
        if !handle_metadata.is_dir() || capability_identity(&handle_metadata)? != identity {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_ROOT_HANDLE_IDENTITY_MISMATCH",
            ));
        }
        let fingerprint = root_fingerprint(&canonical_root, &identity)?;
        Ok(Self {
            canonical_root,
            identity,
            fingerprint,
            capability_dir: Arc::new(capability_dir),
        })
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    pub(crate) fn canonical_root(&self) -> &Path {
        &self.canonical_root
    }

    pub fn validate(&self) -> Result<(), LocalCapabilityError> {
        reject_unsafe_absolute_components(&self.canonical_root)?;
        let metadata = safe_metadata(&self.canonical_root)?;
        let handle_metadata = self
            .capability_dir
            .dir_metadata()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_HANDLE_UNAVAILABLE"))?;
        if !metadata.is_dir()
            || file_identity(&self.canonical_root, &metadata)? != self.identity
            || !handle_metadata.is_dir()
            || capability_identity(&handle_metadata)? != self.identity
            || self
                .canonical_root
                .canonicalize()
                .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_UNAVAILABLE"))?
                != self.canonical_root
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_ROOT_IDENTITY_CHANGED",
            ));
        }
        Ok(())
    }

    pub fn admit_path(
        &self,
        input: &FilePathAdmitInput,
    ) -> Result<FilePathAdmission, LocalCapabilityError> {
        self.admit_path_with_hook(input, || {})
    }

    pub(crate) fn admit_path_with_hook<F>(
        &self,
        input: &FilePathAdmitInput,
        after_first_snapshot: F,
    ) -> Result<FilePathAdmission, LocalCapabilityError>
    where
        F: FnOnce(),
    {
        self.validate()?;
        let target = self.walk_target(&input.relative_segments)?;
        let first_canonical = target
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_TARGET_UNAVAILABLE"))?;
        if !first_canonical.starts_with(&self.canonical_root) {
            return Err(LocalCapabilityError::new("LOCAL_FILE_TARGET_ESCAPES_GRANT"));
        }
        let first = snapshot(&target)?;
        validate_intent(&first, input)?;

        after_first_snapshot();

        self.validate()?;
        let second_target = self.walk_target(&input.relative_segments)?;
        let second_canonical = second_target
            .canonicalize()
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_TARGET_UNAVAILABLE"))?;
        let second = snapshot(&second_target)?;
        if second_canonical != first_canonical || second != first {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_TARGET_IDENTITY_CHANGED",
            ));
        }
        validate_intent(&second, input)?;
        let target_fingerprint =
            target_fingerprint(&self.fingerprint, &input.relative_segments, &second)?;
        Ok(FilePathAdmission {
            target_kind: second.kind,
            size_bytes: match second.kind {
                FileTargetKind::File => Some(second.size_bytes),
                FileTargetKind::Directory => None,
            },
            target_fingerprint,
            canonical_path: second_canonical,
            snapshot: second,
        })
    }

    fn walk_target(&self, segments: &[String]) -> Result<PathBuf, LocalCapabilityError> {
        let mut target = self.canonical_root.clone();
        for segment in segments {
            target.push(segment);
            let metadata = safe_metadata(&target)?;
            let identity = file_identity(&target, &metadata)?;
            if !identity.same_volume(&self.identity) {
                return Err(LocalCapabilityError::new(
                    "LOCAL_FILE_TARGET_VOLUME_CHANGED",
                ));
            }
        }
        Ok(target)
    }
}

impl FileIdentity {
    fn same_volume(&self, other: &Self) -> bool {
        #[cfg(unix)]
        {
            self.device == other.device
        }
        #[cfg(windows)]
        {
            self.volume == other.volume
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = other;
            true
        }
    }

    pub(super) fn update_hasher(&self, hasher: &mut Sha256) {
        #[cfg(unix)]
        {
            hasher.update(self.device.to_le_bytes());
            hasher.update(self.inode.to_le_bytes());
        }
        #[cfg(windows)]
        {
            hasher.update(self.volume.to_le_bytes());
            hasher.update(self.index.to_le_bytes());
        }
        #[cfg(not(any(unix, windows)))]
        {
            hasher.update(self.created_nanos.to_le_bytes());
        }
    }
}

pub(super) fn safe_metadata(path: &Path) -> Result<Metadata, LocalCapabilityError> {
    let metadata = symlink_metadata(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_TARGET_UNAVAILABLE"))?;
    if unsafe_file_type(&metadata) {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED",
        ));
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(LocalCapabilityError::new(
            "LOCAL_FILE_TARGET_TYPE_UNSUPPORTED",
        ));
    }
    Ok(metadata)
}

pub(super) fn reject_unsafe_absolute_components(path: &Path) -> Result<(), LocalCapabilityError> {
    let mut candidate = PathBuf::new();
    for component in path.components() {
        candidate.push(component.as_os_str());
        if matches!(component, Component::Prefix(_) | Component::RootDir) {
            continue;
        }
        let metadata = symlink_metadata(&candidate)
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_ROOT_UNAVAILABLE"))?;
        if unsafe_file_type(&metadata) {
            return Err(LocalCapabilityError::new(
                "LOCAL_FILE_SYMLINK_OR_REPARSE_REJECTED",
            ));
        }
    }
    Ok(())
}

fn unsafe_file_type(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(unix)]
pub(super) fn capability_identity(
    metadata: &cap_std::fs::Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    use cap_std::fs::MetadataExt;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(windows)]
pub(super) fn capability_identity(
    metadata: &cap_std::fs::Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    use cap_fs_ext::MetadataExt;
    let volume = u32::try_from(metadata.dev())
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_IDENTITY_UNAVAILABLE"))?;
    Ok(FileIdentity {
        volume,
        index: metadata.ino(),
    })
}

#[cfg(not(any(unix, windows)))]
pub(super) fn capability_identity(
    metadata: &cap_std::fs::Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    let created_nanos = metadata
        .created()
        .or_else(|_| metadata.modified())
        .and_then(|timestamp| timestamp.duration_since(std::time::UNIX_EPOCH))
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_IDENTITY_UNAVAILABLE"))?
        .as_nanos();
    Ok(FileIdentity { created_nanos })
}

#[cfg(unix)]
pub(super) fn file_identity(
    _path: &Path,
    metadata: &Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    use std::os::unix::fs::MetadataExt;
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(windows)]
pub(super) fn file_identity(
    path: &Path,
    _metadata: &Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    let (volume, index) = crate::windows_file_identity::identity_from_path(path)
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_IDENTITY_UNAVAILABLE"))?;
    Ok(FileIdentity { volume, index })
}

#[cfg(not(any(unix, windows)))]
pub(super) fn file_identity(
    _path: &Path,
    metadata: &Metadata,
) -> Result<FileIdentity, LocalCapabilityError> {
    let created_nanos = metadata
        .created()
        .or_else(|_| metadata.modified())
        .and_then(|timestamp| timestamp.duration_since(std::time::UNIX_EPOCH))
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_IDENTITY_UNAVAILABLE"))?
        .as_nanos();
    Ok(FileIdentity { created_nanos })
}

pub(super) fn snapshot(path: &Path) -> Result<FileSnapshot, LocalCapabilityError> {
    let metadata = safe_metadata(path)?;
    let kind = if metadata.is_file() {
        FileTargetKind::File
    } else {
        FileTargetKind::Directory
    };
    Ok(FileSnapshot {
        identity: file_identity(path, &metadata)?,
        kind,
        size_bytes: metadata.len(),
    })
}

fn validate_intent(
    snapshot: &FileSnapshot,
    input: &FilePathAdmitInput,
) -> Result<(), LocalCapabilityError> {
    match (input.intent, snapshot.kind, input.max_bytes) {
        (FileCapabilityIntent::ReadFile, FileTargetKind::File, Some(maximum))
            if snapshot.size_bytes <= maximum =>
        {
            Ok(())
        }
        (
            FileCapabilityIntent::MetadataRead,
            FileTargetKind::File | FileTargetKind::Directory,
            None,
        )
        | (FileCapabilityIntent::ListDirectory, FileTargetKind::Directory, None) => Ok(()),
        (FileCapabilityIntent::ReadFile, FileTargetKind::File, Some(_)) => {
            Err(LocalCapabilityError::new("LOCAL_FILE_TARGET_TOO_LARGE"))
        }
        _ => Err(LocalCapabilityError::new(
            "LOCAL_FILE_TARGET_INTENT_MISMATCH",
        )),
    }
}

fn root_fingerprint(
    canonical_root: &Path,
    identity: &FileIdentity,
) -> Result<String, LocalCapabilityError> {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.local-file-root.v1\0");
    update_path_bytes(&mut hasher, canonical_root);
    identity.update_hasher(&mut hasher);
    digest_hex(hasher)
}

fn target_fingerprint(
    root_fingerprint: &str,
    segments: &[String],
    snapshot: &FileSnapshot,
) -> Result<String, LocalCapabilityError> {
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.local-file-target.v1\0");
    hasher.update(root_fingerprint.as_bytes());
    for segment in segments {
        hasher.update((segment.len() as u64).to_le_bytes());
        hasher.update(segment.as_bytes());
    }
    snapshot.identity.update_hasher(&mut hasher);
    hasher.update(match snapshot.kind {
        FileTargetKind::File => b"file".as_slice(),
        FileTargetKind::Directory => b"directory".as_slice(),
    });
    hasher.update(snapshot.size_bytes.to_le_bytes());
    digest_hex(hasher)
}

#[cfg(unix)]
fn update_path_bytes(hasher: &mut Sha256, path: &Path) {
    use std::os::unix::ffi::OsStrExt;
    hasher.update(path.as_os_str().as_bytes());
}

#[cfg(windows)]
fn update_path_bytes(hasher: &mut Sha256, path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    for unit in path.as_os_str().encode_wide() {
        hasher.update(unit.to_le_bytes());
    }
}

#[cfg(not(any(unix, windows)))]
fn update_path_bytes(hasher: &mut Sha256, path: &Path) {
    hasher.update(path.to_string_lossy().as_bytes());
}

fn digest_hex(hasher: Sha256) -> Result<String, LocalCapabilityError> {
    let mut output = String::with_capacity(64);
    for byte in hasher.finalize() {
        write!(&mut output, "{byte:02x}")
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_HASH_FAILED"))?;
    }
    Ok(output)
}
