use sha2::{Digest, Sha256};
use std::fs::{create_dir, create_dir_all, symlink_metadata};
use std::path::{Component, Path, PathBuf};

const MAXIMUM_CACHE_ROOT_BYTES: usize = 4096;
const MAXIMUM_DATABASE_PATH_BYTES: usize = 4096;
const SCOPE_HANDLE_BYTES: usize = 36;
const SCOPES_DIRECTORY: &str = "scopes";
const RECOVERY_DIRECTORY: &str = "recovery";
const RECOVERY_ACTIVE_DIRECTORY: &str = "active";
const RECOVERY_COMPLETED_DIRECTORY: &str = "completed";
const RECOVERY_PREPARING_DIRECTORY: &str = "preparing";
const QUARANTINE_DIRECTORY: &str = "quarantine";
const SCOPE_DATABASE_FILENAME: &str = "cache.db";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CachePathError {
    pub code: &'static str,
}

impl CachePathError {
    pub(crate) const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub struct AdmittedCacheRoot {
    canonical_root: PathBuf,
    scopes_root: PathBuf,
    recovery_root: PathBuf,
    recovery_active_root: PathBuf,
    recovery_completed_root: PathBuf,
    recovery_preparing_root: PathBuf,
    quarantine_root: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct ScopeCachePaths {
    pub scope_digest: String,
    pub scope_directory: PathBuf,
    pub database_path: PathBuf,
    pub active_recovery_directory: PathBuf,
    pub preparing_recovery_directory: PathBuf,
}

impl AdmittedCacheRoot {
    pub fn admit(root: &Path) -> Result<Self, CachePathError> {
        let root_text = root
            .to_str()
            .ok_or_else(|| CachePathError::new("CACHE_ROOT_INVALID"))?;
        if !root.is_absolute()
            || root_text.is_empty()
            || root_text.len() > MAXIMUM_CACHE_ROOT_BYTES
            || root_text.contains('\0')
            || root
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        {
            return Err(CachePathError::new("CACHE_ROOT_INVALID"));
        }
        reject_symlink_components(root)?;
        create_dir_all(root).map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))?;
        reject_symlink_components(root)?;
        let metadata =
            symlink_metadata(root).map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CachePathError::new("CACHE_ROOT_UNSAFE"));
        }
        restrict_root_permissions(root)?;
        let canonical_root = root
            .canonicalize()
            .map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))?;
        let scopes_root = admit_owned_directory(&canonical_root, SCOPES_DIRECTORY)?;
        let recovery_root = admit_owned_directory(&canonical_root, RECOVERY_DIRECTORY)?;
        let recovery_active_root =
            admit_owned_directory(&recovery_root, RECOVERY_ACTIVE_DIRECTORY)?;
        let recovery_completed_root =
            admit_owned_directory(&recovery_root, RECOVERY_COMPLETED_DIRECTORY)?;
        let recovery_preparing_root =
            admit_owned_directory(&recovery_root, RECOVERY_PREPARING_DIRECTORY)?;
        let quarantine_root = admit_owned_directory(&canonical_root, QUARANTINE_DIRECTORY)?;
        Ok(Self {
            canonical_root,
            scopes_root,
            recovery_root,
            recovery_active_root,
            recovery_completed_root,
            recovery_preparing_root,
            quarantine_root,
        })
    }

    pub fn scope_database_path(&self, scope_handle: &str) -> Result<PathBuf, CachePathError> {
        let paths = self.scope_paths(scope_handle)?;
        if path_exists(&paths.active_recovery_directory)?
            || path_exists(&paths.preparing_recovery_directory)?
        {
            return Err(CachePathError::new("CACHE_RECOVERY_IN_PROGRESS"));
        }
        if self.legacy_scope_family_exists(&paths.scope_digest)? {
            return Err(CachePathError::new(
                "CACHE_LEGACY_LAYOUT_RECONCILE_REQUIRED",
            ));
        }
        self.ensure_scope_directory(&paths.scope_directory)?;
        let database_path = paths.database_path;
        match symlink_metadata(&database_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                Err(CachePathError::new("CACHE_DATABASE_PATH_UNSAFE"))
            }
            Ok(_) => Ok(database_path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(database_path),
            Err(_) => Err(CachePathError::new("CACHE_DATABASE_PATH_UNAVAILABLE")),
        }
    }

    pub(crate) fn scope_paths(
        &self,
        scope_handle: &str,
    ) -> Result<ScopeCachePaths, CachePathError> {
        self.validate_owned_roots()?;
        let scope_digest = scope_digest(scope_handle)?;
        let scope_directory = self.scopes_root.join(&scope_digest);
        let database_path = scope_directory.join(SCOPE_DATABASE_FILENAME);
        let path_text = database_path
            .to_str()
            .ok_or_else(|| CachePathError::new("CACHE_DATABASE_PATH_UNAVAILABLE"))?;
        if path_text.len() > MAXIMUM_DATABASE_PATH_BYTES {
            return Err(CachePathError::new("CACHE_DATABASE_PATH_UNAVAILABLE"));
        }
        Ok(ScopeCachePaths {
            active_recovery_directory: self.recovery_active_root.join(&scope_digest),
            preparing_recovery_directory: self.recovery_preparing_root.join(&scope_digest),
            scope_digest,
            scope_directory,
            database_path,
        })
    }

    pub(crate) fn ensure_scope_directory(
        &self,
        scope_directory: &Path,
    ) -> Result<(), CachePathError> {
        if scope_directory.parent() != Some(self.scopes_root.as_path()) {
            return Err(CachePathError::new("CACHE_DATABASE_PATH_UNSAFE"));
        }
        admit_exact_directory(scope_directory)
    }

    pub(crate) fn recovery_completed_root(&self) -> &Path {
        &self.recovery_completed_root
    }

    pub(crate) fn quarantine_root(&self) -> &Path {
        &self.quarantine_root
    }

    fn legacy_scope_family_exists(&self, scope_digest: &str) -> Result<bool, CachePathError> {
        const SUFFIXES: [&str; 8] = [
            ".db",
            ".db-wal",
            ".db-incremental.material",
            ".db-first.material",
            ".db-last.material",
            ".db.factory",
            ".db-journal",
            ".db-shm",
        ];
        for suffix in SUFFIXES {
            let path = self.canonical_root.join(format!("{scope_digest}{suffix}"));
            match symlink_metadata(path) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(CachePathError::new("CACHE_DATABASE_PATH_UNSAFE"));
                }
                Ok(_) => return Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(CachePathError::new("CACHE_DATABASE_PATH_UNAVAILABLE")),
            }
        }
        Ok(false)
    }

    fn validate_owned_roots(&self) -> Result<(), CachePathError> {
        reject_symlink_components(&self.canonical_root)?;
        for directory in [
            &self.canonical_root,
            &self.scopes_root,
            &self.recovery_root,
            &self.recovery_active_root,
            &self.recovery_completed_root,
            &self.recovery_preparing_root,
            &self.quarantine_root,
        ] {
            let metadata = symlink_metadata(directory)
                .map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(CachePathError::new("CACHE_ROOT_UNSAFE"));
            }
        }
        Ok(())
    }
}

fn scope_digest(scope_handle: &str) -> Result<String, CachePathError> {
    if !valid_scope_handle(scope_handle) {
        return Err(CachePathError::new("INVALID_CACHE_SCOPE_HANDLE"));
    }
    let digest = Sha256::digest(scope_handle.as_bytes());
    let mut output = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in digest {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}

fn admit_owned_directory(parent: &Path, name: &str) -> Result<PathBuf, CachePathError> {
    let directory = parent.join(name);
    admit_exact_directory(&directory)?;
    directory
        .canonicalize()
        .map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))
}

fn admit_exact_directory(directory: &Path) -> Result<(), CachePathError> {
    match symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(CachePathError::new("CACHE_ROOT_UNSAFE"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_dir(directory).map_err(|_| CachePathError::new("CACHE_ROOT_UNAVAILABLE"))?;
        }
        Err(_) => return Err(CachePathError::new("CACHE_ROOT_UNAVAILABLE")),
    }
    restrict_root_permissions(directory)
}

fn path_exists(path: &Path) -> Result<bool, CachePathError> {
    match symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(CachePathError::new("CACHE_ROOT_UNSAFE"))
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(CachePathError::new("CACHE_ROOT_UNAVAILABLE")),
    }
}

pub fn valid_scope_handle(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == SCOPE_HANDLE_BYTES
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && matches!(bytes[14], b'1'..=b'8')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn reject_symlink_components(path: &Path) -> Result<(), CachePathError> {
    let mut candidate = PathBuf::new();
    for component in path.components() {
        candidate.push(component.as_os_str());
        if matches!(component, Component::Prefix(_) | Component::RootDir) {
            continue;
        }
        match symlink_metadata(&candidate) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CachePathError::new("CACHE_ROOT_UNSAFE"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(CachePathError::new("CACHE_ROOT_UNAVAILABLE")),
        }
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn restrict_root_permissions(root: &Path) -> Result<(), CachePathError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
        .map_err(|_| CachePathError::new("CACHE_ROOT_PERMISSION_FAILED"))
}

#[cfg(not(unix))]
pub(crate) fn restrict_root_permissions(_root: &Path) -> Result<(), CachePathError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    const SCOPE: &str = "11111111-1111-4111-8111-111111111111";

    fn test_root(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::current_dir()
            .expect("current directory")
            .join("target")
            .join("worker-tests")
            .join(format!("{label}-{}-{sequence}", std::process::id()))
    }

    fn remove_test_root(root: &Path) {
        if root.exists() {
            std::fs::remove_dir_all(root).expect("remove exact test root");
        }
    }

    #[test]
    fn scope_path_is_a_digest_below_an_admitted_root() {
        let root = test_root("path");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        let database = admitted.scope_database_path(SCOPE).expect("path");
        let canonical_root = root.canonicalize().expect("canonical root");
        let scope_directory = database.parent().expect("scope directory");
        assert_eq!(
            scope_directory.parent(),
            Some(canonical_root.join(SCOPES_DIRECTORY).as_path())
        );
        assert!(!database.to_string_lossy().contains(SCOPE));
        assert_eq!(
            database.file_name().and_then(|value| value.to_str()),
            Some(SCOPE_DATABASE_FILENAME)
        );
        assert_eq!(
            scope_directory
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::len),
            Some(64)
        );
        drop(admitted);
        remove_test_root(&root);
    }

    #[test]
    fn scope_path_rejects_invalid_scope_and_non_file_collision() {
        let root = test_root("collision");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        assert_eq!(
            admitted
                .scope_database_path("../tenant")
                .expect_err("scope"),
            CachePathError::new("INVALID_CACHE_SCOPE_HANDLE")
        );
        let database = admitted.scope_database_path(SCOPE).expect("path");
        std::fs::create_dir(&database).expect("collision directory");
        assert_eq!(
            admitted.scope_database_path(SCOPE).expect_err("collision"),
            CachePathError::new("CACHE_DATABASE_PATH_UNSAFE")
        );
        drop(admitted);
        remove_test_root(&root);
    }

    #[test]
    fn legacy_flat_scope_family_requires_explicit_reconciliation() {
        let root = test_root("legacy");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        let paths = admitted.scope_paths(SCOPE).expect("paths");
        std::fs::write(
            root.join(format!("{}.db-wal", paths.scope_digest)),
            b"legacy",
        )
        .expect("legacy sidecar");
        assert_eq!(
            admitted.scope_database_path(SCOPE).expect_err("legacy"),
            CachePathError::new("CACHE_LEGACY_LAYOUT_RECONCILE_REQUIRED")
        );
        assert!(!paths.scope_directory.exists());
        drop(admitted);
        remove_test_root(&root);
    }

    #[test]
    fn normal_open_is_blocked_by_preparing_or_active_recovery() {
        let root = test_root("recovery-block");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        let paths = admitted.scope_paths(SCOPE).expect("paths");
        std::fs::create_dir(&paths.preparing_recovery_directory).expect("preparing");
        assert_eq!(
            admitted.scope_database_path(SCOPE).expect_err("preparing"),
            CachePathError::new("CACHE_RECOVERY_IN_PROGRESS")
        );
        std::fs::remove_dir(&paths.preparing_recovery_directory).expect("remove preparing");
        std::fs::create_dir(&paths.active_recovery_directory).expect("active");
        assert_eq!(
            admitted.scope_database_path(SCOPE).expect_err("active"),
            CachePathError::new("CACHE_RECOVERY_IN_PROGRESS")
        );
        drop(admitted);
        remove_test_root(&root);
    }

    #[cfg(unix)]
    #[test]
    fn scope_path_rejects_a_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = test_root("symlink");
        let outside = test_root("outside");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        std::fs::create_dir_all(&outside).expect("outside root");
        let outside_file = outside.join("outside.db");
        std::fs::write(&outside_file, b"outside").expect("outside file");
        let database = admitted.scope_database_path(SCOPE).expect("path");
        symlink(&outside_file, &database).expect("symlink");
        assert_eq!(
            admitted.scope_database_path(SCOPE).expect_err("symlink"),
            CachePathError::new("CACHE_DATABASE_PATH_UNSAFE")
        );
        drop(admitted);
        remove_test_root(&outside);
        remove_test_root(&root);
    }

    #[cfg(unix)]
    #[test]
    fn admitted_fixed_root_rejects_a_post_bootstrap_symlink_swap() {
        use std::os::unix::fs::symlink;

        let root = test_root("fixed-root-swap");
        let outside = test_root("fixed-root-outside");
        let admitted = AdmittedCacheRoot::admit(&root).expect("root");
        std::fs::remove_dir(root.join("recovery").join("active")).expect("active");
        std::fs::remove_dir(root.join("recovery").join("completed")).expect("completed");
        std::fs::remove_dir(root.join("recovery").join("preparing")).expect("preparing");
        std::fs::remove_dir(root.join("recovery")).expect("recovery");
        std::fs::create_dir_all(&outside).expect("outside");
        symlink(&outside, root.join("recovery")).expect("recovery symlink");
        assert_eq!(
            admitted.scope_paths(SCOPE).expect_err("unsafe root"),
            CachePathError::new("CACHE_ROOT_UNSAFE")
        );
        drop(admitted);
        std::fs::remove_file(root.join("recovery")).expect("remove recovery symlink");
        remove_test_root(&outside);
        remove_test_root(&root);
    }
}
