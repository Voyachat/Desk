use super::native_package_admission::AdmittedNativePackage;
use super::native_package_contract::PROBE_SYMBOL;
use super::scope_driver::{
    EncryptedScopeDriver, EncryptedScopeDriverError, EncryptedScopeIntegrity,
    EncryptedScopeLocalHistoryRelease, EncryptedScopeLocalHistorySnapshot,
    EncryptedScopeMutationResult, EncryptedScopeOpenContext, EncryptedScopeOpenResult,
    EncryptedScopePage, NativeEncryptedScopeDriver, WorkerAdapterAvailability,
};
use crate::message_cache::{
    PageInput, PurgeScopeInput, PutConfirmedInput, PutLocalHistoryInput, ReleaseLocalHistoryInput,
    SnapshotLocalHistoryInput,
};
use crate::message_cache_abi::{MessageCacheNativeAbi, MessageCacheNativeProbeFunction};
use std::path::Path;

#[cfg(unix)]
type PlatformLibrary = libloading::os::unix::Library;
#[cfg(windows)]
type PlatformLibrary = libloading::os::windows::Library;

pub(super) enum PackagedEncryptedScopeDriver {
    Loaded(Box<LoadedScopeDriver>),
    Unavailable(&'static str),
}

pub(super) struct LoadedScopeDriver {
    driver: Option<NativeEncryptedScopeDriver>,
    library: PlatformLibrary,
}

impl PackagedEncryptedScopeDriver {
    pub(super) fn from_current_executable() -> Self {
        match AdmittedNativePackage::from_current_executable().and_then(Self::load_admitted) {
            Ok(driver) => driver,
            Err(reason) => Self::Unavailable(reason),
        }
    }

    #[cfg(test)]
    pub(super) fn from_executable(executable: &Path) -> Self {
        match AdmittedNativePackage::from_executable(executable).and_then(Self::load_admitted) {
            Ok(driver) => driver,
            Err(reason) => Self::Unavailable(reason),
        }
    }

    fn load_admitted(package: AdmittedNativePackage) -> Result<Self, &'static str> {
        package.revalidate_library()?;
        let library = load_platform_library(package.library_path())?;
        package.revalidate_library()?;
        let probe = load_probe_symbol(&library)?;
        let api = MessageCacheNativeAbi::new(probe)
            .probe()
            .map_err(|_| "WCDB_NATIVE_ABI_REJECTED")?;
        let metadata = api.metadata();
        if metadata.wcdb_version != package.wcdb_version()
            || metadata.wcdb_commit != package.wcdb_commit()
            || !metadata.wcdb_cpp_enabled
            || metadata.wcdb_zstd_enabled
            || metadata.upstream_bridge_enabled
        {
            return Err("WCDB_NATIVE_PROBE_MISMATCH");
        }
        Ok(Self::Loaded(Box::new(LoadedScopeDriver {
            driver: Some(NativeEncryptedScopeDriver::new(api)),
            library,
        })))
    }

    fn loaded(&mut self) -> Result<&mut NativeEncryptedScopeDriver, EncryptedScopeDriverError> {
        match self {
            Self::Loaded(loaded) => loaded
                .driver
                .as_mut()
                .ok_or_else(|| EncryptedScopeDriverError::new("WCDB_NATIVE_DRIVER_INVALID")),
            Self::Unavailable(reason) => Err(EncryptedScopeDriverError::new(reason)),
        }
    }
}

impl Drop for LoadedScopeDriver {
    fn drop(&mut self) {
        self.driver.take();
        let _ = &self.library;
    }
}

impl EncryptedScopeDriver for PackagedEncryptedScopeDriver {
    fn availability(&self) -> WorkerAdapterAvailability {
        match self {
            Self::Loaded(_) => WorkerAdapterAvailability::Available,
            Self::Unavailable(_) => WorkerAdapterAvailability::AdapterUnavailable,
        }
    }

    fn adapter_id(&self) -> &'static str {
        match self {
            Self::Loaded(_) => "wcdb.v2.1.16",
            Self::Unavailable(_) => "unavailable",
        }
    }

    fn unavailable_reason(&self) -> Option<&'static str> {
        match self {
            Self::Loaded(_) => None,
            Self::Unavailable(reason) => Some(reason),
        }
    }

    fn open_scope(
        &mut self,
        database_path: &Path,
        cipher_key: &[u8],
        context: EncryptedScopeOpenContext,
    ) -> Result<EncryptedScopeOpenResult, EncryptedScopeDriverError> {
        self.loaded()?
            .open_scope(database_path, cipher_key, context)
    }

    fn check_integrity(&mut self) -> Result<EncryptedScopeIntegrity, EncryptedScopeDriverError> {
        self.loaded()?.check_integrity()
    }

    fn put_confirmed(
        &mut self,
        input: &PutConfirmedInput,
        request_hash: &[u8; 32],
        confirmed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.loaded()?.put_confirmed(
            input,
            request_hash,
            confirmed_at_epoch_s,
            expires_at_epoch_s,
        )
    }

    fn page(
        &mut self,
        input: &PageInput,
        now_epoch_s: i64,
    ) -> Result<EncryptedScopePage, EncryptedScopeDriverError> {
        self.loaded()?.page(input, now_epoch_s)
    }

    fn purge_scope(
        &mut self,
        input: &PurgeScopeInput,
        request_hash: &[u8; 32],
        committed_at_epoch_s: i64,
        expires_at_epoch_s: i64,
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.loaded()?.purge_scope(
            input,
            request_hash,
            committed_at_epoch_s,
            expires_at_epoch_s,
        )
    }

    fn close_scope(&mut self) -> Result<(), EncryptedScopeDriverError> {
        match self {
            Self::Loaded(_) => self.loaded()?.close_scope(),
            Self::Unavailable(_) => Ok(()),
        }
    }

    fn put_local_history(
        &mut self,
        input: &PutLocalHistoryInput,
        request_hash: &[u8; 32],
    ) -> Result<EncryptedScopeMutationResult, EncryptedScopeDriverError> {
        self.loaded()?.put_local_history(input, request_hash)
    }

    fn snapshot_local_history(
        &mut self,
        input: &SnapshotLocalHistoryInput,
    ) -> Result<EncryptedScopeLocalHistorySnapshot, EncryptedScopeDriverError> {
        self.loaded()?.snapshot_local_history(input)
    }

    fn release_local_history(
        &mut self,
        input: &ReleaseLocalHistoryInput,
        request_hash: &[u8; 32],
        committed_at_epoch_ms: u64,
    ) -> Result<EncryptedScopeLocalHistoryRelease, EncryptedScopeDriverError> {
        self.loaded()?
            .release_local_history(input, request_hash, committed_at_epoch_ms)
    }
}

#[cfg(unix)]
fn load_platform_library(path: &Path) -> Result<PlatformLibrary, &'static str> {
    use libloading::os::unix::{RTLD_LOCAL, RTLD_NOW};
    // SAFETY: Admission supplies one absolute, fixed-resource path; no caller or environment path
    // participates. RTLD_NOW resolves eagerly and RTLD_LOCAL prevents global symbol publication.
    unsafe { PlatformLibrary::open(Some(path), RTLD_NOW | RTLD_LOCAL) }
        .map_err(|_| "WCDB_NATIVE_LIBRARY_LOAD_FAILED")
}

#[cfg(windows)]
fn load_platform_library(path: &Path) -> Result<PlatformLibrary, &'static str> {
    use libloading::os::windows::{LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32};
    // SAFETY: Admission supplies a full fixed-resource path. These flags restrict dependencies to
    // the admitted DLL directory and System32, excluding cwd, PATH and user-controlled directories.
    unsafe {
        PlatformLibrary::load_with_flags(
            path,
            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
        )
    }
    .map_err(|_| "WCDB_NATIVE_LIBRARY_LOAD_FAILED")
}

fn load_probe_symbol(
    library: &PlatformLibrary,
) -> Result<MessageCacheNativeProbeFunction, &'static str> {
    // SAFETY: The owned ABI fixes the symbol name and function signature. The library is retained
    // by LoadedScopeDriver until every API clone and active native scope has been dropped.
    unsafe {
        library
            .get::<MessageCacheNativeProbeFunction>(PROBE_SYMBOL)
            .map(|symbol| *symbol)
    }
    .map_err(|_| "WCDB_NATIVE_PROBE_SYMBOL_MISSING")
}
