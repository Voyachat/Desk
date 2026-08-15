use keyring_core::{CredentialStore, Error as KeyringError};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use zeroize::Zeroizing;

pub const CACHE_CIPHER_KEY_BYTES: usize = 32;
const CACHE_KEY_SERVICE: &str = "com.voyachat.aistaff.message-cache.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheKeyProviderError {
    pub code: &'static str,
}

impl CacheKeyProviderError {
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub struct CacheScopeKey {
    bytes: Zeroizing<Vec<u8>>,
}

impl CacheScopeKey {
    pub fn new(bytes: Vec<u8>) -> Result<Self, CacheKeyProviderError> {
        if bytes.len() != CACHE_CIPHER_KEY_BYTES {
            return Err(CacheKeyProviderError::new("CACHE_KEY_LENGTH_INVALID"));
        }
        Ok(Self {
            bytes: Zeroizing::new(bytes),
        })
    }

    pub fn expose(&self) -> &[u8] {
        self.bytes.as_slice()
    }
}

pub trait CacheKeyProviderPort {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError>;

    fn revoke_scope(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError>;

    fn delete_scope_key(&mut self, _scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        Ok(())
    }
}

impl<T: CacheKeyProviderPort + ?Sized> CacheKeyProviderPort for Box<T> {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        (**self).load_scope_key(scope_handle)
    }

    fn revoke_scope(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        (**self).revoke_scope(scope_handle)
    }

    fn delete_scope_key(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        (**self).delete_scope_key(scope_handle)
    }
}

pub struct UnavailableCacheKeyProvider;

impl CacheKeyProviderPort for UnavailableCacheKeyProvider {
    fn load_scope_key(
        &mut self,
        _scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        Err(CacheKeyProviderError::new("CACHE_KEY_PROVIDER_UNAVAILABLE"))
    }

    fn revoke_scope(&mut self, _scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        Ok(())
    }
}

trait CacheKeyStorePort {
    fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, CacheKeyProviderError>;
    fn store(&self, account: &str, key: &[u8]) -> Result<(), CacheKeyProviderError>;
    fn delete(&self, account: &str) -> Result<(), CacheKeyProviderError>;
}

struct PlatformCacheKeyStore {
    store: Arc<CredentialStore>,
}

impl PlatformCacheKeyStore {
    fn production() -> Result<Self, CacheKeyProviderError> {
        Ok(Self {
            store: platform_credential_store()?,
        })
    }

    fn entry(&self, account: &str) -> Result<keyring_core::Entry, CacheKeyProviderError> {
        self.store
            .build(CACHE_KEY_SERVICE, account, None)
            .map_err(map_keyring_error)
    }
}

impl CacheKeyStorePort for PlatformCacheKeyStore {
    fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, CacheKeyProviderError> {
        match self.entry(account)?.get_secret() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(map_keyring_error(error)),
        }
    }

    fn store(&self, account: &str, key: &[u8]) -> Result<(), CacheKeyProviderError> {
        self.entry(account)?
            .set_secret(key)
            .map_err(map_keyring_error)
    }

    fn delete(&self, account: &str) -> Result<(), CacheKeyProviderError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

pub struct OsVaultCacheKeyProvider {
    store: Box<dyn CacheKeyStorePort>,
}

impl OsVaultCacheKeyProvider {
    pub fn production() -> Result<Self, CacheKeyProviderError> {
        Ok(Self {
            store: Box::new(PlatformCacheKeyStore::production()?),
        })
    }

    #[cfg(test)]
    fn with_store(store: Box<dyn CacheKeyStorePort>) -> Self {
        Self { store }
    }
}

impl CacheKeyProviderPort for OsVaultCacheKeyProvider {
    fn load_scope_key(
        &mut self,
        scope_handle: &str,
    ) -> Result<CacheScopeKey, CacheKeyProviderError> {
        let account = scope_key_account(scope_handle)?;
        if let Some(key) = self.store.load(&account)? {
            return CacheScopeKey::new(key.to_vec());
        }

        let mut generated = Zeroizing::new(vec![0_u8; CACHE_CIPHER_KEY_BYTES]);
        getrandom::fill(generated.as_mut_slice())
            .map_err(|_| CacheKeyProviderError::new("CACHE_KEY_RANDOM_UNAVAILABLE"))?;
        self.store.store(&account, &generated)?;

        // Read back the committed value. This keeps the database key bound to the
        // OS-vault winner if another admitted process created the same entry.
        let committed = self
            .store
            .load(&account)?
            .ok_or_else(|| CacheKeyProviderError::new("CACHE_KEY_STORE_WRITE_UNCONFIRMED"))?;
        CacheScopeKey::new(committed.to_vec())
    }

    fn revoke_scope(&mut self, _scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        // This provider never caches key material. The returned CacheScopeKey is the
        // only lease and zeroizes on drop, so closing a scope has nothing else to revoke.
        Ok(())
    }

    fn delete_scope_key(&mut self, scope_handle: &str) -> Result<(), CacheKeyProviderError> {
        self.store.delete(&scope_key_account(scope_handle)?)
    }
}

fn scope_key_account(scope_handle: &str) -> Result<String, CacheKeyProviderError> {
    if !super::path::valid_scope_handle(scope_handle) {
        return Err(CacheKeyProviderError::new("INVALID_CACHE_SCOPE_HANDLE"));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"aistaff.message-cache-scope-key.v1\0");
    hasher.update((scope_handle.len() as u64).to_be_bytes());
    hasher.update(scope_handle.as_bytes());
    let digest = hasher.finalize();
    let mut output = String::with_capacity(3 + digest.len() * 2);
    output.push_str("v1:");
    for byte in digest {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(output)
}

#[cfg(target_os = "macos")]
fn platform_credential_store() -> Result<Arc<CredentialStore>, CacheKeyProviderError> {
    let store: Arc<CredentialStore> =
        apple_native_keyring_store::keychain::Store::new().map_err(map_keyring_error)?;
    Ok(store)
}

#[cfg(target_os = "windows")]
fn platform_credential_store() -> Result<Arc<CredentialStore>, CacheKeyProviderError> {
    let store: Arc<CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(map_keyring_error)?;
    Ok(store)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_credential_store() -> Result<Arc<CredentialStore>, CacheKeyProviderError> {
    Err(CacheKeyProviderError::new("CACHE_KEY_PROVIDER_UNAVAILABLE"))
}

fn map_keyring_error(error: KeyringError) -> CacheKeyProviderError {
    let code = match error {
        KeyringError::NoEntry => "CACHE_KEY_NOT_FOUND",
        KeyringError::NoStorageAccess(_) => "CACHE_KEY_ACCESS_DENIED",
        KeyringError::BadEncoding(_)
        | KeyringError::BadDataFormat(_, _)
        | KeyringError::BadStoreFormat(_)
        | KeyringError::TooLong(_, _)
        | KeyringError::Invalid(_, _)
        | KeyringError::Ambiguous(_) => "CACHE_KEY_STORE_INVALID",
        _ => "CACHE_KEY_PROVIDER_UNAVAILABLE",
    };
    CacheKeyProviderError::new(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    const SCOPE: &str = "11111111-1111-4111-8111-111111111111";

    #[derive(Clone, Default)]
    struct TestStore {
        values: Rc<RefCell<HashMap<String, Vec<u8>>>>,
    }

    impl CacheKeyStorePort for TestStore {
        fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, CacheKeyProviderError> {
            Ok(self
                .values
                .borrow()
                .get(account)
                .cloned()
                .map(Zeroizing::new))
        }

        fn store(&self, account: &str, key: &[u8]) -> Result<(), CacheKeyProviderError> {
            self.values
                .borrow_mut()
                .insert(account.to_owned(), key.to_vec());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), CacheKeyProviderError> {
            self.values.borrow_mut().remove(account);
            Ok(())
        }
    }

    #[test]
    fn cache_key_accepts_only_the_owned_raw_key_size() {
        assert!(CacheScopeKey::new(vec![7; CACHE_CIPHER_KEY_BYTES]).is_ok());
        assert_eq!(
            CacheScopeKey::new(vec![7; CACHE_CIPHER_KEY_BYTES - 1])
                .err()
                .expect("invalid key"),
            CacheKeyProviderError::new("CACHE_KEY_LENGTH_INVALID")
        );
    }

    #[test]
    fn os_vault_provider_generates_reloads_and_deletes_one_scope_key() {
        let store = TestStore::default();
        let values = Rc::clone(&store.values);
        let mut provider = OsVaultCacheKeyProvider::with_store(Box::new(store));
        let first = provider.load_scope_key(SCOPE).expect("generate");
        let second = provider.load_scope_key(SCOPE).expect("reload");
        assert_eq!(first.expose(), second.expose());
        assert_eq!(first.expose().len(), CACHE_CIPHER_KEY_BYTES);
        assert_eq!(values.borrow().len(), 1);

        provider.delete_scope_key(SCOPE).expect("delete");
        assert!(values.borrow().is_empty());
    }

    #[test]
    fn scope_key_account_is_domain_separated_and_rejects_untrusted_scope() {
        assert_eq!(scope_key_account(SCOPE), scope_key_account(SCOPE));
        assert_ne!(
            scope_key_account(SCOPE),
            scope_key_account("22222222-2222-4222-8222-222222222222")
        );
        assert_eq!(
            scope_key_account("../unsafe"),
            Err(CacheKeyProviderError::new("INVALID_CACHE_SCOPE_HANDLE"))
        );
    }
}
