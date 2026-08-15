use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, GetFileInformationByHandle,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowsFileObjectIdentity {
    pub volume_serial_number: u32,
    pub file_index: u64,
    pub directory: bool,
}

pub(crate) fn object_identity_from_file(file: &File) -> io::Result<WindowsFileObjectIdentity> {
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the borrowed File owns a valid handle for this call, and `information`
    // is a writable structure of the exact type required by Win32.
    let succeeded =
        unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut information) };
    if succeeded == 0 {
        return Err(io::Error::last_os_error());
    }
    if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "reparse point identity rejected",
        ));
    }
    let index =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
    Ok(WindowsFileObjectIdentity {
        volume_serial_number: information.dwVolumeSerialNumber,
        file_index: index,
        directory: information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    })
}

pub(crate) fn identity_from_file(file: &File) -> io::Result<(u32, u64)> {
    let identity = object_identity_from_file(file)?;
    Ok((identity.volume_serial_number, identity.file_index))
}

pub(crate) fn identity_from_path(path: &Path) -> io::Result<(u32, u64)> {
    let file = OpenOptions::new()
        .access_mode(0)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    identity_from_file(&file)
}
