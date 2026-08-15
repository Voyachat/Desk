use super::contracts::LocalCapabilityError;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fmt::Write;

pub(super) fn hash_value<T: Serialize>(value: &T) -> Result<String, LocalCapabilityError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_HASH_FAILED"))?;
    digest_hex(Sha256::digest(bytes).as_slice())
}

pub(super) fn digest_hex(digest: &[u8]) -> Result<String, LocalCapabilityError> {
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut output, "{byte:02x}")
            .map_err(|_| LocalCapabilityError::new("LOCAL_FILE_HASH_FAILED"))?;
    }
    Ok(output)
}
