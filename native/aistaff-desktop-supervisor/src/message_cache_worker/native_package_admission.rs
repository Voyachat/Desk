use super::native_package_contract::{
    LICENSE_FILENAME, NATIVE_TARGET, NativePackageManifest, NativeTarget,
    PACKAGE_MANIFEST_FILENAME, ReleaseManifest, VERSION_CONTRACT_FILENAME,
};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

const MAX_PACKAGE_MANIFEST_BYTES: u64 = 32 * 1024;
const MAX_RELEASE_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_LICENSE_BYTES: u64 = 256 * 1024;
const MAX_NATIVE_LIBRARY_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub(super) struct AdmittedNativePackage {
    library_path: PathBuf,
    library_identity: FileIdentity,
    library_sha256: String,
    wcdb_version: String,
    wcdb_commit: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    volume: u64,
    file: u64,
    length: u64,
}

struct PackagePaths {
    resources: PathBuf,
    executable: PathBuf,
    package_manifest: PathBuf,
    release_manifest: PathBuf,
    library: PathBuf,
    license: PathBuf,
}

struct InspectedFile {
    identity: FileIdentity,
    sha256: String,
}

impl AdmittedNativePackage {
    pub(super) fn from_current_executable() -> Result<Self, &'static str> {
        let executable =
            std::env::current_exe().map_err(|_| "WCDB_NATIVE_PACKAGE_LAYOUT_INVALID")?;
        Self::from_executable(&executable)
    }

    pub(super) fn from_executable(executable: &Path) -> Result<Self, &'static str> {
        let target = NATIVE_TARGET.ok_or("WCDB_NATIVE_PLATFORM_UNSUPPORTED")?;
        let paths = PackagePaths::derive(executable, target)?;
        paths.validate_no_symlinks()?;

        let package_bytes = read_regular_file(&paths.package_manifest, MAX_PACKAGE_MANIFEST_BYTES)?;
        let package_sha256 = sha256_hex(&package_bytes);
        let package = NativePackageManifest::parse_canonical(&package_bytes, target)?;

        let release_bytes = read_regular_file(&paths.release_manifest, MAX_RELEASE_MANIFEST_BYTES)?;
        let release = ReleaseManifest::parse_canonical(&release_bytes, target)?;
        if !release.validates_binding(&package, &package_sha256) {
            return Err("WCDB_NATIVE_PACKAGE_BINDING_MISMATCH");
        }

        let license = inspect_regular_file(&paths.license, MAX_LICENSE_BYTES)?;
        if license.sha256 != package.license_sha256() {
            return Err("WCDB_NATIVE_PACKAGE_HASH_MISMATCH");
        }
        let library = inspect_regular_file(&paths.library, MAX_NATIVE_LIBRARY_BYTES)?;
        if library.sha256 != package.artifact_sha256() {
            return Err("WCDB_NATIVE_PACKAGE_HASH_MISMATCH");
        }
        inspect_binary_target(&paths.library, target)?;

        Ok(Self {
            library_path: paths.library,
            library_identity: library.identity,
            library_sha256: library.sha256,
            wcdb_version: package.wcdb_version().to_owned(),
            wcdb_commit: package.wcdb_commit().to_owned(),
        })
    }

    pub(super) fn library_path(&self) -> &Path {
        &self.library_path
    }

    pub(super) fn wcdb_version(&self) -> &str {
        &self.wcdb_version
    }

    pub(super) fn wcdb_commit(&self) -> &str {
        &self.wcdb_commit
    }

    pub(super) fn revalidate_library(&self) -> Result<(), &'static str> {
        reject_symlink(&self.library_path)?;
        let inspected = inspect_regular_file(&self.library_path, MAX_NATIVE_LIBRARY_BYTES)?;
        if inspected.identity != self.library_identity {
            return Err("WCDB_NATIVE_PACKAGE_IDENTITY_CHANGED");
        }
        if inspected.sha256 != self.library_sha256 {
            return Err("WCDB_NATIVE_PACKAGE_HASH_MISMATCH");
        }
        Ok(())
    }
}

impl PackagePaths {
    fn derive(executable: &Path, target: NativeTarget) -> Result<Self, &'static str> {
        if !normal_absolute(executable) || executable.file_name() != Some(expected_executable()) {
            return Err("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID");
        }
        let bin = executable
            .parent()
            .filter(|path| path.file_name().is_some_and(|name| name == "bin"))
            .ok_or("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID")?;
        let resources = bin
            .parent()
            .ok_or("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID")?
            .to_path_buf();
        let executable = executable.to_path_buf();
        if executable != resources.join("bin").join(expected_executable()) {
            return Err("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID");
        }
        let native = resources.join("native").join("message-cache");
        Ok(Self {
            package_manifest: native.join(PACKAGE_MANIFEST_FILENAME),
            release_manifest: resources.join("manifest").join(VERSION_CONTRACT_FILENAME),
            library: native.join(target.artifact_filename),
            license: native.join(LICENSE_FILENAME),
            resources,
            executable,
        })
    }

    fn validate_no_symlinks(&self) -> Result<(), &'static str> {
        ensure_directory(&self.resources)?;
        ensure_directory(&self.resources.join("bin"))?;
        reject_symlink(&self.executable)?;
        for path in [
            &self.package_manifest,
            &self.release_manifest,
            &self.library,
            &self.license,
        ] {
            reject_symlink_chain(&self.resources, path)?;
        }
        Ok(())
    }
}

fn expected_executable() -> &'static std::ffi::OsStr {
    #[cfg(windows)]
    {
        std::ffi::OsStr::new("aistaff-desktop-supervisor.exe")
    }
    #[cfg(not(windows))]
    {
        std::ffi::OsStr::new("aistaff-desktop-supervisor")
    }
}

fn normal_absolute(path: &Path) -> bool {
    path.is_absolute()
        && path.components().all(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::Normal(_)
            )
        })
}

fn reject_symlink_chain(root: &Path, path: &Path) -> Result<(), &'static str> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "WCDB_NATIVE_PACKAGE_LAYOUT_INVALID")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("WCDB_NATIVE_PACKAGE_LAYOUT_INVALID");
        };
        current.push(segment);
        reject_symlink(&current)?;
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    if metadata.file_type().is_symlink() {
        Err("WCDB_NATIVE_PACKAGE_SYMLINK_REJECTED")
    } else {
        Ok(())
    }
}

fn ensure_directory(path: &Path) -> Result<(), &'static str> {
    reject_symlink(path)?;
    if fs::metadata(path)
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?
        .is_dir()
    {
        Ok(())
    } else {
        Err("WCDB_NATIVE_PACKAGE_FILE_INVALID")
    }
}

fn read_regular_file(path: &Path, maximum_bytes: u64) -> Result<Vec<u8>, &'static str> {
    let mut file = open_regular_file(path, maximum_bytes)?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    if contents.is_empty() || contents.len() as u64 > maximum_bytes {
        return Err("WCDB_NATIVE_PACKAGE_FILE_INVALID");
    }
    Ok(contents)
}

fn inspect_regular_file(path: &Path, maximum_bytes: u64) -> Result<InspectedFile, &'static str> {
    let mut file = open_regular_file(path, maximum_bytes)?;
    let identity = file_identity(&file)?;
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or("WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
        if copied > maximum_bytes {
            return Err("WCDB_NATIVE_PACKAGE_FILE_INVALID");
        }
        hasher.update(&buffer[..read]);
    }
    if copied == 0 {
        return Err("WCDB_NATIVE_PACKAGE_FILE_INVALID");
    }
    reject_symlink(path)?;
    let path_file = open_regular_file(path, maximum_bytes)?;
    let path_identity = file_identity(&path_file)?;
    if identity != path_identity {
        return Err("WCDB_NATIVE_PACKAGE_IDENTITY_CHANGED");
    }
    Ok(InspectedFile {
        identity,
        sha256: hex_digest(hasher.finalize().as_slice()),
    })
}

fn open_regular_file(path: &Path, maximum_bytes: u64) -> Result<File, &'static str> {
    reject_symlink(path)?;
    let file = File::open(path).map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    let metadata = file
        .metadata()
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum_bytes {
        return Err("WCDB_NATIVE_PACKAGE_FILE_INVALID");
    }
    Ok(file)
}

#[cfg(unix)]
fn file_identity(file: &File) -> Result<FileIdentity, &'static str> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file
        .metadata()
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    Ok(FileIdentity {
        volume: metadata.dev(),
        file: metadata.ino(),
        length: metadata.len(),
    })
}

#[cfg(windows)]
fn file_identity(file: &File) -> Result<FileIdentity, &'static str> {
    let metadata = file
        .metadata()
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    let (volume, index) = crate::windows_file_identity::identity_from_file(file)
        .map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    Ok(FileIdentity {
        volume: u64::from(volume),
        file: index,
        length: metadata.len(),
    })
}

#[cfg(not(any(unix, windows)))]
fn file_identity(_file: &File) -> Result<FileIdentity, &'static str> {
    Err("WCDB_NATIVE_PLATFORM_UNSUPPORTED")
}

fn inspect_binary_target(path: &Path, target: NativeTarget) -> Result<(), &'static str> {
    let mut file = File::open(path).map_err(|_| "WCDB_NATIVE_PACKAGE_FILE_INVALID")?;
    if target.platform == "macos" {
        let mut header = [0_u8; 8];
        file.read_exact(&mut header)
            .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?;
        let expected_cpu = if target.architecture == "x86_64" {
            [0x07, 0x00, 0x00, 0x01]
        } else {
            [0x0c, 0x00, 0x00, 0x01]
        };
        if header[..4] != [0xcf, 0xfa, 0xed, 0xfe] || header[4..] != expected_cpu {
            return Err("WCDB_NATIVE_BINARY_TARGET_MISMATCH");
        }
        return Ok(());
    }
    inspect_pe_x64(&mut file)
}

fn inspect_pe_x64(file: &mut File) -> Result<(), &'static str> {
    let mut dos = [0_u8; 64];
    file.read_exact(&mut dos)
        .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?;
    if &dos[..2] != b"MZ" {
        return Err("WCDB_NATIVE_BINARY_TARGET_MISMATCH");
    }
    let offset = u64::from(u32::from_le_bytes(
        dos[60..64]
            .try_into()
            .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?,
    ));
    if !(64..=1024 * 1024).contains(&offset) {
        return Err("WCDB_NATIVE_BINARY_TARGET_MISMATCH");
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?;
    let mut header = [0_u8; 26];
    file.read_exact(&mut header)
        .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?;
    let optional_header_size = u16::from_le_bytes(
        header[20..22]
            .try_into()
            .map_err(|_| "WCDB_NATIVE_BINARY_TARGET_MISMATCH")?,
    );
    if &header[..4] == b"PE\0\0"
        && header[4..6] == [0x64, 0x86]
        && optional_header_size >= 2
        && header[24..26] == [0x0b, 0x02]
    {
        Ok(())
    } else {
        Err("WCDB_NATIVE_BINARY_TARGET_MISMATCH")
    }
}

fn sha256_hex(contents: &[u8]) -> String {
    hex_digest(Sha256::digest(contents).as_slice())
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}
