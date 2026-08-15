use super::targets::{CandidateAclTarget, decode_target_path, encode_target_path};
use crate::local_capability::process_windows_acl_lease::{
    WindowsAclGrantClass, WindowsAclLeaseTarget, WindowsAclTargetIdentity,
};
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{self, Error, ErrorKind};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{ERROR_SUCCESS, HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, GetExplicitEntriesFromAclW, GetSecurityInfo, REVOKE_ACCESS,
    SE_FILE_OBJECT, SET_ACCESS, SetEntriesInAclW, SetSecurityInfo, TRUSTEE_IS_SID,
    TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, EqualSid, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_EXECUTE,
    FILE_GENERIC_READ, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_TRAVERSE, READ_CONTROL, SYNCHRONIZE, WRITE_DAC,
};

const MAX_EXPLICIT_ACL_ENTRIES: usize = 4_096;

pub(super) fn admit_target(candidate: CandidateAclTarget) -> io::Result<WindowsAclLeaseTarget> {
    let file = open_acl_target(&candidate.path)?;
    let identity = crate::windows_file_identity::object_identity_from_file(&file)?;
    let expected_directory = matches!(
        candidate.grant_class,
        WindowsAclGrantClass::DirectoryTraverseMetadata
    );
    if identity.directory != expected_directory {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "ACL target type mismatch",
        ));
    }
    read_non_null_dacl(&file)?;
    Ok(WindowsAclLeaseTarget {
        path_utf16le_base64: encode_target_path(&candidate.path)?,
        identity: WindowsAclTargetIdentity {
            volume_serial_number: identity.volume_serial_number,
            file_index: identity.file_index,
            directory: identity.directory,
        },
        grant_class: candidate.grant_class,
    })
}

pub(super) fn grant_target(target: &WindowsAclLeaseTarget, sid: PSID) -> io::Result<()> {
    mutate_target(
        target,
        sid,
        GRANT_ACCESS,
        permissions(target.grant_class),
        true,
    )
}

pub(super) fn revoke_target(target: &WindowsAclLeaseTarget, sid: PSID) -> io::Result<()> {
    mutate_target(target, sid, REVOKE_ACCESS, 0, false)
}

#[cfg(test)]
pub(super) fn verify_target_sid_for_test(
    target: &WindowsAclLeaseTarget,
    sid: PSID,
    expect_present: bool,
) -> io::Result<()> {
    if sid.is_null() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "missing AppContainer SID",
        ));
    }
    let path = decode_target_path(target)?;
    let file = open_acl_target(&path)?;
    validate_identity(&file, target)?;
    verify_sid_entry(&file, sid, permissions(target.grant_class), expect_present)
}

fn mutate_target(
    target: &WindowsAclLeaseTarget,
    sid: PSID,
    mode: i32,
    access: u32,
    expect_present: bool,
) -> io::Result<()> {
    if sid.is_null() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            "missing AppContainer SID",
        ));
    }
    let path = decode_target_path(target)?;
    let file = open_acl_target(&path)?;
    validate_identity(&file, target)?;
    let current = read_non_null_dacl(&file)?;
    let explicit = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access,
        grfAccessMode: mode,
        grfInheritance: NO_INHERITANCE,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: 0,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        },
    };
    let mut next_acl = null_mut::<ACL>();
    // SAFETY: current.dacl is owned by the live security descriptor guard,
    // explicit contains one SID trustee valid for this call, and next_acl is an
    // out pointer released with LocalFree after SetSecurityInfo.
    let status =
        unsafe { SetEntriesInAclW(1, &raw const explicit, current.dacl, &raw mut next_acl) };
    let next_acl_guard = LocalAllocation::new(next_acl.cast());
    if status != ERROR_SUCCESS || next_acl.is_null() {
        return Err(win32_status(status));
    }
    // SAFETY: file is a live kernel handle opened with WRITE_DAC; next_acl stays
    // allocated for the duration of the call and owner/group/SACL are unchanged.
    let status = unsafe {
        SetSecurityInfo(
            raw_handle(&file),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            next_acl,
            null(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(win32_status(status));
    }
    drop(next_acl_guard);
    drop(current);
    validate_identity(&file, target)?;
    verify_sid_entry(&file, sid, access, expect_present)
}

fn read_non_null_dacl(file: &File) -> io::Result<SecurityDescriptorDacl> {
    let mut dacl = null_mut::<ACL>();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: file is a live handle opened with READ_CONTROL; all unused output
    // pointers are null and descriptor is released with LocalFree.
    let status = unsafe {
        GetSecurityInfo(
            raw_handle(file),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &raw mut dacl,
            null_mut(),
            &raw mut descriptor,
        )
    };
    let descriptor = LocalAllocation::new(descriptor);
    if status != ERROR_SUCCESS || dacl.is_null() || descriptor.pointer.is_null() {
        return Err(if status == ERROR_SUCCESS {
            Error::new(ErrorKind::PermissionDenied, "null DACL rejected")
        } else {
            win32_status(status)
        });
    }
    Ok(SecurityDescriptorDacl { dacl, descriptor })
}

fn verify_sid_entry(
    file: &File,
    sid: PSID,
    expected_access: u32,
    expect_present: bool,
) -> io::Result<()> {
    let current = read_non_null_dacl(file)?;
    let mut count = 0_u32;
    let mut entries = null_mut::<EXPLICIT_ACCESS_W>();
    // SAFETY: current.dacl is valid while its descriptor guard lives; entries is
    // an out allocation released with LocalFree below.
    let status =
        unsafe { GetExplicitEntriesFromAclW(current.dacl, &raw mut count, &raw mut entries) };
    let entries_guard = LocalAllocation::new(entries.cast());
    if status != ERROR_SUCCESS || count as usize > MAX_EXPLICIT_ACL_ENTRIES {
        return Err(win32_status(status));
    }
    let slice = if count == 0 {
        &[][..]
    } else {
        if entries.is_null() {
            return Err(Error::new(ErrorKind::InvalidData, "invalid ACL entries"));
        }
        // SAFETY: Windows returned count initialized EXPLICIT_ACCESS_W entries.
        unsafe { std::slice::from_raw_parts(entries, count as usize) }
    };
    let matching = slice.iter().filter(|entry| {
        entry.Trustee.TrusteeForm == TRUSTEE_IS_SID
            && !entry.Trustee.ptstrName.is_null()
            // SAFETY: a TRUSTEE_IS_SID entry stores a valid SID pointer for the
            // lifetime of the ACL entry array.
            && unsafe { EqualSid(entry.Trustee.ptstrName.cast(), sid) } != 0
    });
    let valid = if expect_present {
        matching.into_iter().any(|entry| {
            matches!(entry.grfAccessMode, GRANT_ACCESS | SET_ACCESS)
                && entry.grfInheritance == NO_INHERITANCE
                && entry.grfAccessPermissions & expected_access == expected_access
        })
    } else {
        matching.into_iter().next().is_none()
    };
    drop(entries_guard);
    if valid {
        Ok(())
    } else {
        Err(Error::new(
            ErrorKind::PermissionDenied,
            "ACL verification failed",
        ))
    }
}

fn validate_identity(file: &File, target: &WindowsAclLeaseTarget) -> io::Result<()> {
    let observed = crate::windows_file_identity::object_identity_from_file(file)?;
    if observed.volume_serial_number != target.identity.volume_serial_number
        || observed.file_index != target.identity.file_index
        || observed.directory != target.identity.directory
    {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "ACL target identity changed",
        ));
    }
    Ok(())
}

fn open_acl_target(path: &std::path::Path) -> io::Result<File> {
    OpenOptions::new()
        .access_mode(READ_CONTROL | WRITE_DAC)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

fn permissions(grant_class: WindowsAclGrantClass) -> u32 {
    match grant_class {
        WindowsAclGrantClass::DirectoryTraverseMetadata => {
            FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE
        }
        WindowsAclGrantClass::ExecutableReadExecute => FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
    }
}

fn raw_handle(file: &File) -> HANDLE {
    file.as_raw_handle() as HANDLE
}

fn win32_status(status: u32) -> Error {
    if status == ERROR_SUCCESS {
        Error::other("Windows ACL operation failed")
    } else {
        Error::from_raw_os_error(status as i32)
    }
}

struct SecurityDescriptorDacl {
    dacl: *mut ACL,
    descriptor: LocalAllocation,
}

struct LocalAllocation {
    pointer: *mut c_void,
}

impl LocalAllocation {
    fn new(pointer: *mut c_void) -> Self {
        Self { pointer }
    }
}

impl Drop for LocalAllocation {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: both security APIs used here document LocalFree ownership.
            unsafe { LocalFree(self.pointer) };
        }
    }
}
