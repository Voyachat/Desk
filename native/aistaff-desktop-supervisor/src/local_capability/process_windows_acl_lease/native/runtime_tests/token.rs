//! Exact Windows token observations for target-native LPAC evidence.

use std::io;
use std::mem::size_of;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::ptr::null_mut;
use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
use windows_sys::Win32::Security::{
    GetTokenInformation, TOKEN_INFORMATION_CLASS, TOKEN_QUERY, TokenCapabilities,
    TokenIsAppContainer, TokenIsLessPrivilegedAppContainer,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

#[derive(Debug)]
pub(super) struct CurrentTokenSandboxState {
    pub(super) app_container: bool,
    pub(super) less_privileged_app_container: bool,
    pub(super) capability_count: u32,
}

pub(super) fn current_token_sandbox_state() -> io::Result<CurrentTokenSandboxState> {
    let mut raw_token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut raw_token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: OpenProcessToken returned an owned, non-null kernel handle.
    let token = unsafe { OwnedHandle::from_raw_handle(raw_token as RawHandle) };
    Ok(CurrentTokenSandboxState {
        app_container: query_token_flag(&token, TokenIsAppContainer)?,
        less_privileged_app_container: query_token_flag(&token, TokenIsLessPrivilegedAppContainer)?,
        capability_count: query_token_capability_count(&token)?,
    })
}

fn query_token_flag(
    token: &OwnedHandle,
    information_class: TOKEN_INFORMATION_CLASS,
) -> io::Result<bool> {
    let mut value = 0_u32;
    let mut returned = 0_u32;
    let value_size = u32::try_from(size_of::<u32>())
        .map_err(|_| io::Error::other("token result size overflow"))?;
    let succeeded = unsafe {
        GetTokenInformation(
            token.as_raw_handle() as _,
            information_class,
            (&raw mut value).cast(),
            value_size,
            &raw mut returned,
        )
    };
    if succeeded == 0 {
        return Err(io::Error::last_os_error());
    }
    if returned != value_size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unexpected token flag size: {returned}"),
        ));
    }
    Ok(value != 0)
}

fn query_token_capability_count(token: &OwnedHandle) -> io::Result<u32> {
    let mut required = 0_u32;
    let succeeded = unsafe {
        GetTokenInformation(
            token.as_raw_handle() as _,
            TokenCapabilities,
            null_mut(),
            0,
            &raw mut required,
        )
    };
    if succeeded != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "token capabilities unexpectedly fit an empty buffer",
        ));
    }
    let sizing_error = io::Error::last_os_error();
    if sizing_error.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
        return Err(sizing_error);
    }
    let minimum_size = u32::try_from(size_of::<u32>())
        .map_err(|_| io::Error::other("token capabilities minimum size overflow"))?;
    if required < minimum_size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("token capabilities buffer is too small: {required}"),
        ));
    }
    let required_size = usize::try_from(required)
        .map_err(|_| io::Error::other("token capabilities size overflow"))?;
    let word_size = size_of::<usize>();
    let word_count = required_size
        .checked_add(word_size - 1)
        .ok_or_else(|| io::Error::other("token capabilities allocation overflow"))?
        / word_size;
    let mut buffer = vec![0_usize; word_count];
    let mut returned = 0_u32;
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle() as _,
            TokenCapabilities,
            buffer.as_mut_ptr().cast(),
            required,
            &raw mut returned,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    if returned != required {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unexpected token capabilities size: {returned}"),
        ));
    }
    // SAFETY: a successful TokenCapabilities query returned at least one u32
    // into storage aligned for usize; TOKEN_GROUPS begins with GroupCount.
    Ok(unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<u32>()) })
}
