use crate::message_cache_abi::MessageCacheNativeRetentionPolicy;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_CACHE_RETENTION_SECONDS: u64 = 30 * 24 * 60 * 60;
pub const DEFAULT_CACHE_RETENTION_SWEEP_LIMIT: u32 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheRetentionPolicy {
    pub retention_seconds: u64,
    pub sweep_limit: u32,
}

impl Default for CacheRetentionPolicy {
    fn default() -> Self {
        Self {
            retention_seconds: DEFAULT_CACHE_RETENTION_SECONDS,
            sweep_limit: DEFAULT_CACHE_RETENTION_SWEEP_LIMIT,
        }
    }
}

impl CacheRetentionPolicy {
    pub fn expires_at(self, now_epoch_s: i64) -> Result<i64, CacheClockError> {
        let retention =
            i64::try_from(self.retention_seconds).map_err(|_| CacheClockError::invalid())?;
        if now_epoch_s <= 0 || self.sweep_limit == 0 || self.sweep_limit > 200 {
            return Err(CacheClockError::invalid());
        }
        now_epoch_s
            .checked_add(retention)
            .filter(|expires_at| *expires_at > now_epoch_s)
            .ok_or_else(CacheClockError::invalid)
    }

    pub const fn native(self) -> MessageCacheNativeRetentionPolicy {
        MessageCacheNativeRetentionPolicy {
            retention_seconds: self.retention_seconds,
            sweep_limit: self.sweep_limit,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheClockError {
    pub code: &'static str,
}

impl CacheClockError {
    const fn invalid() -> Self {
        Self {
            code: "CACHE_CLOCK_UNAVAILABLE",
        }
    }
}

pub trait CacheClockPort {
    fn now_epoch_seconds(&self) -> Result<i64, CacheClockError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemCacheClock;

impl CacheClockPort for SystemCacheClock {
    fn now_epoch_seconds(&self) -> Result<i64, CacheClockError> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| CacheClockError::invalid())?
            .as_secs();
        i64::try_from(seconds).map_err(|_| CacheClockError::invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_retention_is_fixed_to_thirty_days() {
        let policy = CacheRetentionPolicy::default();
        assert_eq!(policy.retention_seconds, 2_592_000);
        assert_eq!(policy.sweep_limit, 200);
        assert_eq!(policy.expires_at(1_000), Ok(2_593_000));
    }

    #[test]
    fn invalid_time_or_overflow_fails_closed() {
        let policy = CacheRetentionPolicy::default();
        assert_eq!(
            policy.expires_at(0).expect_err("zero time").code,
            "CACHE_CLOCK_UNAVAILABLE"
        );
        assert_eq!(
            policy.expires_at(i64::MAX).expect_err("overflow").code,
            "CACHE_CLOCK_UNAVAILABLE"
        );
    }
}
