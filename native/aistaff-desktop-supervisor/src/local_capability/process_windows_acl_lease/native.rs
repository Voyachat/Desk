mod acl;
mod dpapi;
mod targets;

use self::dpapi::CurrentUserDpapiProtector;
use super::journal::{RecoverableWindowsAclLease, WindowsAclLeaseJournalStore};
use super::{WindowsAclLeaseBinding, WindowsAclLeaseIntent, profile_name, sha256_hex};
use crate::local_capability::contracts::{LocalCapabilityError, is_lower_uuid};
use crate::local_capability::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID;
use crate::local_capability::process_windows_sandbox::{
    WindowsAppContainerSid, WindowsSandboxLease, WindowsSandboxLeaseProvider,
    WindowsSandboxLeaseRequest,
};
use std::collections::HashSet;
use std::io::{self, Error};
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::{Arc, Mutex, MutexGuard};
use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, ERROR_NOT_FOUND};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{FreeSid, GetLengthSid, PSID};

const PROFILE_DISPLAY_NAME: &[u16] = &[
    b'A' as u16,
    b'i' as u16,
    b'S' as u16,
    b't' as u16,
    b'a' as u16,
    b'f' as u16,
    b'f' as u16,
    0,
];
const PROFILE_DESCRIPTION: &[u16] = &[
    b'A' as u16,
    b'i' as u16,
    b'S' as u16,
    b't' as u16,
    b'a' as u16,
    b'f' as u16,
    b'f' as u16,
    b' ' as u16,
    b'w' as u16,
    b'o' as u16,
    b'r' as u16,
    b'k' as u16,
    b'e' as u16,
    b'r' as u16,
    0,
];

pub(super) struct WindowsNativeSandboxLeaseProvider {
    coordinator: Arc<LeaseCoordinator>,
}

impl WindowsNativeSandboxLeaseProvider {
    pub(super) fn new(journal_root: &Path) -> Result<Self, LocalCapabilityError> {
        let store = WindowsAclLeaseJournalStore::new(journal_root, CurrentUserDpapiProtector)?;
        let coordinator = Arc::new(LeaseCoordinator {
            store,
            acl_gate: Mutex::new(()),
            active_operations: Mutex::new(HashSet::new()),
        });
        coordinator
            .reconcile_stale()
            .map_err(|_| reconciliation_error())?;
        Ok(Self { coordinator })
    }
}

impl WindowsSandboxLeaseProvider for WindowsNativeSandboxLeaseProvider {
    fn acquire(
        &mut self,
        request: WindowsSandboxLeaseRequest<'_>,
    ) -> Result<Box<dyn WindowsSandboxLease>, LocalCapabilityError> {
        if request.capability_id != LOCAL_PROCESS_EXECUTION_CAPABILITY_ID
            || !is_lower_uuid(request.operation_id)
        {
            return Err(lease_unavailable());
        }
        request.scope.validate().map_err(|_| lease_unavailable())?;
        self.coordinator
            .reconcile_stale()
            .map_err(|_| reconciliation_error())?;
        let candidates =
            targets::candidate_targets(request.executable_path, request.working_directory)
                .map_err(|_| lease_unavailable())?;
        let targets = candidates
            .into_iter()
            .map(acl::admit_target)
            .collect::<io::Result<Vec<_>>>()
            .map_err(|_| lease_unavailable())?;
        let intent = WindowsAclLeaseIntent::new(request.operation_id, request.scope, targets)?;
        self.coordinator.mark_active(request.operation_id)?;
        if let Err(error) = self.coordinator.store.create_intent(&intent) {
            self.coordinator.clear_active(request.operation_id);
            return Err(error);
        }
        match acquire_bound_lease(self.coordinator.clone(), intent) {
            Ok(lease) => Ok(Box::new(lease)),
            Err(error) => {
                self.coordinator.clear_active(request.operation_id);
                Err(error)
            }
        }
    }
}

struct WindowsNativeSandboxLease {
    coordinator: Arc<LeaseCoordinator>,
    intent: WindowsAclLeaseIntent,
    sid: WindowsAppContainerSid,
    finalized: bool,
}

impl WindowsSandboxLease for WindowsNativeSandboxLease {
    fn app_container_sid(&self) -> &WindowsAppContainerSid {
        &self.sid
    }

    fn release(mut self: Box<Self>) -> io::Result<()> {
        let result = self.coordinator.cleanup_bound(&self.intent, &self.sid);
        self.coordinator.clear_active(&self.intent.operation_id);
        self.finalized = true;
        result
    }

    fn preserve_for_reconciliation(mut self: Box<Self>) {
        self.coordinator.clear_active(&self.intent.operation_id);
        self.finalized = true;
    }
}

impl Drop for WindowsNativeSandboxLease {
    fn drop(&mut self) {
        if !self.finalized {
            let _ = self.coordinator.cleanup_bound(&self.intent, &self.sid);
            self.coordinator.clear_active(&self.intent.operation_id);
            self.finalized = true;
        }
    }
}

struct LeaseCoordinator {
    store: WindowsAclLeaseJournalStore<CurrentUserDpapiProtector>,
    acl_gate: Mutex<()>,
    active_operations: Mutex<HashSet<String>>,
}

impl LeaseCoordinator {
    fn mark_active(&self, operation_id: &str) -> Result<(), LocalCapabilityError> {
        let mut active = self
            .active_operations
            .lock()
            .map_err(|_| reconciliation_error())?;
        if !active.insert(operation_id.to_owned()) {
            return Err(lease_unavailable());
        }
        Ok(())
    }

    fn clear_active(&self, operation_id: &str) {
        if let Ok(mut active) = self.active_operations.lock() {
            active.remove(operation_id);
        }
    }

    fn reconcile_stale(&self) -> io::Result<()> {
        let _gate = self.lock_acl()?;
        let active = self
            .active_operations
            .lock()
            .map_err(|_| Error::other("ACL lease active-set unavailable"))?
            .clone();
        for lease in self
            .store
            .load_all()
            .map_err(|error| Error::other(error.code))?
        {
            if !active.contains(&lease.intent.operation_id) {
                self.cleanup_recoverable_locked(&lease)?;
            }
        }
        Ok(())
    }

    fn cleanup_bound(
        &self,
        intent: &WindowsAclLeaseIntent,
        sid: &WindowsAppContainerSid,
    ) -> io::Result<()> {
        let _gate = self.lock_acl()?;
        revoke_targets(intent, sid)?;
        delete_profile(&intent.profile_name)?;
        self.store
            .remove_after_cleanup(&intent.operation_id)
            .map_err(|error| Error::other(error.code))
    }

    fn cleanup_recoverable_locked(&self, lease: &RecoverableWindowsAclLease) -> io::Result<()> {
        if let Some(binding) = &lease.binding {
            let sid = WindowsAppContainerSid::from_bytes(
                &binding
                    .sid_bytes()
                    .map_err(|error| Error::other(error.code))?,
            )?;
            revoke_targets(&binding.intent, &sid)?;
        } else {
            let sid = derive_profile_sid(&lease.intent.profile_name)?;
            revoke_targets(&lease.intent, &sid)?;
        }
        delete_profile(&lease.intent.profile_name)?;
        self.store
            .remove_after_cleanup(&lease.intent.operation_id)
            .map_err(|error| Error::other(error.code))
    }

    fn lock_acl(&self) -> io::Result<MutexGuard<'_, ()>> {
        self.acl_gate
            .lock()
            .map_err(|_| Error::other("ACL lease coordinator unavailable"))
    }
}

fn acquire_bound_lease(
    coordinator: Arc<LeaseCoordinator>,
    intent: WindowsAclLeaseIntent,
) -> Result<WindowsNativeSandboxLease, LocalCapabilityError> {
    let acquisition = (|| -> io::Result<WindowsAppContainerSid> {
        let _gate = coordinator.lock_acl()?;
        let sid = create_profile(&intent.profile_name)?;
        let binding = WindowsAclLeaseBinding::new(
            intent.clone(),
            sid.as_bytes(),
            sha256_hex(sid.as_bytes()).map_err(|error| Error::other(error.code))?,
        )
        .map_err(|error| Error::other(error.code))?;
        coordinator
            .store
            .create_binding(&binding)
            .map_err(|error| Error::other(error.code))?;
        for target in &intent.targets {
            acl::grant_target(target, sid.as_psid())?;
        }
        Ok(sid)
    })();
    match acquisition {
        Ok(sid) => Ok(WindowsNativeSandboxLease {
            coordinator,
            intent,
            sid,
            finalized: false,
        }),
        Err(_) => {
            coordinator.clear_active(&intent.operation_id);
            if coordinator
                .reconcile_stale()
                .and_then(|_| ensure_lease_removed(&coordinator, &intent.operation_id))
                .is_err()
            {
                return Err(reconciliation_error());
            }
            Err(lease_unavailable())
        }
    }
}

fn ensure_lease_removed(coordinator: &LeaseCoordinator, operation_id: &str) -> io::Result<()> {
    let still_present = coordinator
        .store
        .load_all()
        .map_err(|error| Error::other(error.code))?
        .into_iter()
        .any(|lease| lease.intent.operation_id == operation_id);
    if still_present {
        Err(Error::other("ACL lease cleanup incomplete"))
    } else {
        Ok(())
    }
}

fn revoke_targets(intent: &WindowsAclLeaseIntent, sid: &WindowsAppContainerSid) -> io::Result<()> {
    for target in intent.targets.iter().rev() {
        acl::revoke_target(target, sid.as_psid())?;
    }
    Ok(())
}

fn create_profile(profile: &str) -> io::Result<WindowsAppContainerSid> {
    if profile != profile_name_from_owned(profile)? {
        return Err(Error::new(
            io::ErrorKind::InvalidInput,
            "invalid profile name",
        ));
    }
    let wide = wide_string(profile)?;
    let mut sid = null_mut();
    // SAFETY: all strings are live NUL-terminated UTF-16; zero capabilities are
    // represented by null + count zero; returned SID is owned by OwnedRawSid.
    let result = unsafe {
        CreateAppContainerProfile(
            wide.as_ptr(),
            PROFILE_DISPLAY_NAME.as_ptr(),
            PROFILE_DESCRIPTION.as_ptr(),
            null(),
            0,
            &raw mut sid,
        )
    };
    if result < 0 {
        return Err(if hresult_win32(result) == Some(ERROR_ALREADY_EXISTS) {
            Error::new(io::ErrorKind::AlreadyExists, "AppContainer profile reused")
        } else {
            Error::from_raw_os_error(result)
        });
    }
    OwnedRawSid::new(sid)?.to_app_container_sid()
}

fn derive_profile_sid(profile: &str) -> io::Result<WindowsAppContainerSid> {
    let wide = wide_string(profile)?;
    let mut sid = null_mut();
    // SAFETY: the profile name is live NUL-terminated UTF-16 and the returned SID
    // follows FreeSid ownership when the call succeeds.
    let result = unsafe { DeriveAppContainerSidFromAppContainerName(wide.as_ptr(), &raw mut sid) };
    if result < 0 {
        return Err(Error::from_raw_os_error(result));
    }
    OwnedRawSid::new(sid).and_then(|owned| owned.to_app_container_sid())
}

fn delete_profile(profile: &str) -> io::Result<()> {
    let wide = wide_string(profile)?;
    // SAFETY: the profile name is a validated, live NUL-terminated UTF-16 string.
    let result = unsafe { DeleteAppContainerProfile(wide.as_ptr()) };
    if hresult_win32(result) == Some(ERROR_NOT_FOUND) {
        Ok(())
    } else if result < 0 {
        Err(Error::from_raw_os_error(result))
    } else {
        Ok(())
    }
}

fn profile_name_from_owned(profile: &str) -> io::Result<String> {
    let operation_id = profile
        .strip_prefix(super::WINDOWS_ACL_LEASE_PROFILE_PREFIX)
        .ok_or_else(|| Error::new(io::ErrorKind::InvalidInput, "invalid profile name"))?;
    profile_name(operation_id).map_err(|error| Error::other(error.code))
}

fn wide_string(value: &str) -> io::Result<Vec<u16>> {
    let mut units = value.encode_utf16().collect::<Vec<_>>();
    if units.is_empty() || units.len() > 64 || units.contains(&0) {
        return Err(Error::new(
            io::ErrorKind::InvalidInput,
            "invalid profile name",
        ));
    }
    units.push(0);
    Ok(units)
}

fn hresult_win32(result: i32) -> Option<u32> {
    let raw = result as u32;
    (raw & 0xffff_0000 == 0x8007_0000).then_some(raw & 0x0000_ffff)
}

struct OwnedRawSid(PSID);

impl OwnedRawSid {
    fn new(sid: PSID) -> io::Result<Self> {
        if sid.is_null() {
            Err(Error::new(
                io::ErrorKind::InvalidData,
                "missing AppContainer SID",
            ))
        } else {
            Ok(Self(sid))
        }
    }

    fn to_app_container_sid(&self) -> io::Result<WindowsAppContainerSid> {
        // SAFETY: self owns a valid SID returned by a Userenv API.
        let length = unsafe { GetLengthSid(self.0) } as usize;
        if length == 0 {
            return Err(Error::new(
                io::ErrorKind::InvalidData,
                "invalid AppContainer SID",
            ));
        }
        // SAFETY: GetLengthSid reported the initialized byte length of this SID.
        let bytes = unsafe { std::slice::from_raw_parts(self.0.cast::<u8>(), length) };
        WindowsAppContainerSid::from_bytes(bytes)
    }
}

impl Drop for OwnedRawSid {
    fn drop(&mut self) {
        // SAFETY: Userenv returned this SID and documents FreeSid as its release.
        unsafe { FreeSid(self.0) };
    }
}

fn lease_unavailable() -> LocalCapabilityError {
    LocalCapabilityError::new("LOCAL_PROCESS_SANDBOX_ACL_LEASE_UNAVAILABLE")
}

fn reconciliation_error() -> LocalCapabilityError {
    LocalCapabilityError::new("LOCAL_PROCESS_SANDBOX_ACL_RECONCILIATION_REQUIRED")
}

#[cfg(test)]
#[path = "native/native_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "native/runtime_tests.rs"]
mod runtime_tests;
