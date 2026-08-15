use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

pub(super) struct OutputBudget {
    maximum_bytes: usize,
    consumed_bytes: AtomicUsize,
    truncated: AtomicBool,
    read_failed: AtomicBool,
}

impl OutputBudget {
    pub fn new(maximum_bytes: usize) -> Self {
        Self {
            maximum_bytes,
            consumed_bytes: AtomicUsize::new(0),
            truncated: AtomicBool::new(false),
            read_failed: AtomicBool::new(false),
        }
    }

    pub fn truncated(&self) -> bool {
        self.truncated.load(Ordering::Acquire)
    }

    pub fn read_failed(&self) -> bool {
        self.read_failed.load(Ordering::Acquire)
    }

    fn reserve(&self, requested: usize) -> usize {
        let mut current = self.consumed_bytes.load(Ordering::Acquire);
        loop {
            let available = self.maximum_bytes.saturating_sub(current);
            let accepted = available.min(requested);
            match self.consumed_bytes.compare_exchange_weak(
                current,
                current.saturating_add(accepted),
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    if accepted < requested {
                        self.truncated.store(true, Ordering::Release);
                    }
                    return accepted;
                }
                Err(observed) => current = observed,
            }
        }
    }
}

pub(super) fn read_bounded_output(mut reader: impl Read, budget: Arc<OutputBudget>) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Err(_) => {
                budget.read_failed.store(true, Ordering::Release);
                break;
            }
            Ok(count) => count,
        };
        let accepted = budget.reserve(count);
        output.extend_from_slice(&buffer[..accepted]);
    }
    output
}

pub(super) fn redact_output<'a>(
    mut output: Vec<u8>,
    secrets: impl IntoIterator<Item = &'a str>,
) -> Vec<u8> {
    for secret in secrets {
        let pattern = secret.as_bytes();
        if pattern.is_empty() || pattern.len() > output.len() {
            continue;
        }
        let mut offset = 0;
        while offset + pattern.len() <= output.len() {
            let Some(relative) = output[offset..]
                .windows(pattern.len())
                .position(|window| window == pattern)
            else {
                break;
            };
            let start = offset + relative;
            output[start..start + pattern.len()].fill(b'*');
            offset = start + pattern.len();
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Error};

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            Err(Error::other("synthetic read failure"))
        }
    }

    #[test]
    fn shared_budget_bounds_both_streams_and_redaction_preserves_size() {
        let budget = Arc::new(OutputBudget::new(8));
        let first = read_bounded_output(Cursor::new(b"secret".to_vec()), budget.clone());
        let second = read_bounded_output(Cursor::new(b"tail".to_vec()), budget.clone());
        assert_eq!(first, b"secret");
        assert_eq!(second, b"ta");
        assert!(budget.truncated());
        let redacted = redact_output(first, ["secret"]);
        assert_eq!(redacted, b"******");
    }

    #[test]
    fn output_read_failure_is_recorded_for_fail_closed_reconciliation() {
        let budget = Arc::new(OutputBudget::new(8));
        assert!(read_bounded_output(FailingReader, budget.clone()).is_empty());
        assert!(budget.read_failed());
    }
}
