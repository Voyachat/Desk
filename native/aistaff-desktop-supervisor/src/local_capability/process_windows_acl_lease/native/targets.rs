use crate::local_capability::process_windows_acl_lease::{
    WINDOWS_ACL_LEASE_MAX_TARGETS, WindowsAclGrantClass, WindowsAclLeaseTarget,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{self, Error, ErrorKind};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Component, Path, PathBuf};

const WINDOWS_PATH_MAX_UNITS: usize = 32_767;

pub(super) struct CandidateAclTarget {
    pub path: PathBuf,
    pub grant_class: WindowsAclGrantClass,
}

pub(super) fn candidate_targets(
    executable: &Path,
    working_directory: Option<&Path>,
) -> io::Result<Vec<CandidateAclTarget>> {
    let executable = validate_canonical_path(executable)?;
    let working_directory = working_directory.map(validate_canonical_path).transpose()?;
    let mut candidates = Vec::new();
    let mut seen = HashSet::<PathBuf>::new();
    push_ancestors(&mut candidates, &mut seen, &executable)?;
    push_unique(
        &mut candidates,
        &mut seen,
        executable,
        WindowsAclGrantClass::ExecutableReadExecute,
    )?;
    if let Some(directory) = working_directory {
        push_ancestors(&mut candidates, &mut seen, &directory)?;
        push_unique(
            &mut candidates,
            &mut seen,
            directory,
            WindowsAclGrantClass::DirectoryTraverseMetadata,
        )?;
    }
    if candidates.is_empty() || candidates.len() > WINDOWS_ACL_LEASE_MAX_TARGETS {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "invalid ACL target count",
        ));
    }
    Ok(candidates)
}

pub(super) fn encode_target_path(path: &Path) -> io::Result<String> {
    let units = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if units.is_empty() || units.len() > WINDOWS_PATH_MAX_UNITS || units.contains(&0) {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "invalid Windows ACL path",
        ));
    }
    let bytes = units
        .iter()
        .flat_map(|unit| unit.to_le_bytes())
        .collect::<Vec<_>>();
    Ok(STANDARD.encode(bytes))
}

pub(super) fn decode_target_path(target: &WindowsAclLeaseTarget) -> io::Result<PathBuf> {
    let bytes = STANDARD
        .decode(&target.path_utf16le_base64)
        .map_err(|_| Error::new(ErrorKind::InvalidData, "invalid encoded ACL path"))?;
    if bytes.is_empty() || bytes.len() % 2 != 0 || bytes.len() > WINDOWS_PATH_MAX_UNITS * 2 {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "invalid encoded ACL path",
        ));
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    if units.contains(&0) {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "invalid encoded ACL path",
        ));
    }
    let path = PathBuf::from(OsString::from_wide(&units));
    validate_absolute_shape(&path)?;
    Ok(path)
}

fn push_ancestors(
    candidates: &mut Vec<CandidateAclTarget>,
    seen: &mut HashSet<PathBuf>,
    path: &Path,
) -> io::Result<()> {
    let mut ancestors = path.ancestors().skip(1).collect::<Vec<_>>();
    ancestors.reverse();
    for ancestor in ancestors {
        push_unique(
            candidates,
            seen,
            ancestor.to_path_buf(),
            WindowsAclGrantClass::DirectoryTraverseMetadata,
        )?;
    }
    Ok(())
}

fn push_unique(
    candidates: &mut Vec<CandidateAclTarget>,
    seen: &mut HashSet<PathBuf>,
    path: PathBuf,
    grant_class: WindowsAclGrantClass,
) -> io::Result<()> {
    if seen.insert(path.clone()) {
        if candidates.len() >= WINDOWS_ACL_LEASE_MAX_TARGETS {
            return Err(Error::new(ErrorKind::InvalidInput, "too many ACL targets"));
        }
        candidates.push(CandidateAclTarget { path, grant_class });
    }
    Ok(())
}

fn validate_canonical_path(path: &Path) -> io::Result<PathBuf> {
    validate_absolute_shape(path)?;
    let canonical = path.canonicalize()?;
    validate_absolute_shape(&canonical)?;
    if canonical != path {
        return Err(Error::new(ErrorKind::InvalidData, "non-canonical ACL path"));
    }
    encode_target_path(&canonical)?;
    Ok(canonical)
}

fn validate_absolute_shape(path: &Path) -> io::Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "invalid Windows ACL path",
        ));
    }
    Ok(())
}
