use crate::local_capability::process_windows_acl_lease::journal::WindowsLeasePayloadProtector;
use std::io::{self, Error, ErrorKind};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use zeroize::Zeroizing;

const MAX_DPAPI_BLOB_BYTES: usize = 512 * 1024;
const DPAPI_ENTROPY: &[u8] = b"aistaff.windows-process-acl-lease.v1";

#[derive(Clone, Copy, Default)]
pub(super) struct CurrentUserDpapiProtector;

impl WindowsLeasePayloadProtector for CurrentUserDpapiProtector {
    fn protect(&self, plaintext: &[u8]) -> io::Result<Vec<u8>> {
        let input = blob(plaintext)?;
        let entropy = blob(DPAPI_ENTROPY)?;
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: both input blobs borrow live slices for the duration of the call;
        // output is initialized by DPAPI and released with LocalFree below. No
        // machine-scope flag is supplied, so protection stays bound to this user.
        let succeeded = unsafe {
            CryptProtectData(
                &input,
                windows_sys::core::w!("AiStaff Windows ACL lease v1"),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &raw mut output,
            )
        };
        if succeeded == 0 {
            return Err(Error::last_os_error());
        }
        LocalDpapiBuffer::from_blob(output, false)?.copy()
    }

    fn unprotect(&self, ciphertext: &[u8]) -> io::Result<Zeroizing<Vec<u8>>> {
        let input = blob(ciphertext)?;
        let entropy = blob(DPAPI_ENTROPY)?;
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: DPAPI reads the two borrowed blobs, writes one LocalAlloc-owned
        // output blob, does not return a description because that pointer is null,
        // and cannot display UI under CRYPTPROTECT_UI_FORBIDDEN.
        let succeeded = unsafe {
            CryptUnprotectData(
                &input,
                null_mut(),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &raw mut output,
            )
        };
        if succeeded == 0 {
            return Err(Error::last_os_error());
        }
        let protected = LocalDpapiBuffer::from_blob(output, true)?;
        Ok(Zeroizing::new(protected.copy()?))
    }
}

fn blob(bytes: &[u8]) -> io::Result<CRYPT_INTEGER_BLOB> {
    if bytes.is_empty() || bytes.len() > MAX_DPAPI_BLOB_BYTES {
        return Err(Error::new(ErrorKind::InvalidInput, "invalid DPAPI blob"));
    }
    Ok(CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len())
            .map_err(|_| Error::new(ErrorKind::InvalidInput, "DPAPI blob too large"))?,
        pbData: bytes.as_ptr().cast_mut(),
    })
}

struct LocalDpapiBuffer {
    pointer: *mut u8,
    length: usize,
    sensitive: bool,
}

impl LocalDpapiBuffer {
    fn from_blob(blob: CRYPT_INTEGER_BLOB, sensitive: bool) -> io::Result<Self> {
        let length = blob.cbData as usize;
        if blob.pbData.is_null() || length == 0 || length > MAX_DPAPI_BLOB_BYTES {
            if !blob.pbData.is_null() {
                // SAFETY: DPAPI documents LocalFree as the matching allocator.
                unsafe { LocalFree(blob.pbData.cast()) };
            }
            return Err(Error::new(ErrorKind::InvalidData, "invalid DPAPI output"));
        }
        Ok(Self {
            pointer: blob.pbData,
            length,
            sensitive,
        })
    }

    fn copy(&self) -> io::Result<Vec<u8>> {
        if self.pointer.is_null() || self.length == 0 {
            return Err(Error::new(ErrorKind::InvalidData, "invalid DPAPI output"));
        }
        // SAFETY: the LocalAlloc buffer remains owned by self and has exactly
        // `length` initialized bytes according to the validated DPAPI blob.
        Ok(unsafe { std::slice::from_raw_parts(self.pointer, self.length) }.to_vec())
    }
}

impl Drop for LocalDpapiBuffer {
    fn drop(&mut self) {
        if self.sensitive {
            for index in 0..self.length {
                // SAFETY: every byte is within the live LocalAlloc buffer. Volatile
                // writes ensure plaintext is cleared before releasing the buffer.
                unsafe { self.pointer.add(index).write_volatile(0) };
            }
        }
        // SAFETY: the pointer came from DPAPI and LocalFree is the required release.
        unsafe { LocalFree(self.pointer.cast()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_user_dpapi_round_trip_is_opaque_and_tamper_evident() {
        let protector = CurrentUserDpapiProtector;
        let plaintext = b"tenant-sensitive ACL lease payload";
        let mut ciphertext = protector.protect(plaintext).expect("protect with DPAPI");
        assert_ne!(ciphertext, plaintext);
        assert_eq!(
            protector
                .unprotect(&ciphertext)
                .expect("unprotect with same user")
                .as_slice(),
            plaintext
        );

        let index = ciphertext.len() / 2;
        ciphertext[index] ^= 0x01;
        assert!(protector.unprotect(&ciphertext).is_err());
    }
}
