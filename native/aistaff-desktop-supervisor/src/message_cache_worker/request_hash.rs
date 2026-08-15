use super::recovery_contracts::MessageCacheWorkerRebuildInput;
use crate::message_cache::{
    ActorType, DeliveryState, PurgeScopeInput, PutConfirmedInput, PutLocalHistoryInput,
    RedactionProfile, ReleaseLocalHistoryInput,
};
use sha2::{Digest, Sha256};

const HASH_DOMAIN: &[u8] = b"aistaff.message-cache-operation-hash.v1";

pub(crate) fn put_request_hash(input: &PutConfirmedInput) -> [u8; 32] {
    let mut hash = CanonicalHash::new("put_confirmed.v1");
    hash.field("scope_handle", input.scope_handle.as_bytes());
    hash.field("operation_id", input.operation_id.as_bytes());
    hash.field("thread_id", input.projection.thread_id.as_bytes());
    hash.u64("sequence", input.projection.sequence);
    hash.field("event_type", input.projection.event_type.as_bytes());
    hash.field(
        "actor_type",
        match input.projection.actor_type {
            ActorType::User => b"user",
            ActorType::Service => b"service",
        },
    );
    hash.field("occurred_at", input.projection.occurred_at.as_bytes());
    hash.field("masked_summary", input.projection.masked_summary.as_bytes());
    hash.field("payload_hash", input.projection.payload_hash.as_bytes());
    hash.optional("run_id", input.projection.run_id.as_deref());
    hash.optional("server_cursor", input.projection.server_cursor.as_deref());
    hash.field(
        "delivery_state",
        match input.projection.delivery_state {
            DeliveryState::Confirmed => b"confirmed",
            DeliveryState::Pending => b"pending",
            DeliveryState::Unknown => b"unknown",
        },
    );
    hash.field(
        "redaction_profile",
        match input.projection.redaction_profile {
            RedactionProfile::SummaryOnlyV1 => b"summary_only.v1",
        },
    );
    hash.finish()
}

pub(crate) fn purge_request_hash(input: &PurgeScopeInput) -> [u8; 32] {
    let mut hash = CanonicalHash::new("purge_scope.v1");
    hash.field("scope_handle", input.scope_handle.as_bytes());
    hash.field("operation_id", input.operation_id.as_bytes());
    hash.field(
        "confirmed",
        if input.confirmed { b"true" } else { b"false" },
    );
    hash.finish()
}

pub(crate) fn put_local_history_request_hash(input: &PutLocalHistoryInput) -> [u8; 32] {
    let mut hash = CanonicalHash::new("put_local_history.v1");
    hash.field("scope_handle", input.scope_handle.as_bytes());
    hash.field("operation_id", input.operation_id.as_bytes());
    let projection = serde_json::to_vec(&input.projection)
        .expect("validated local history projection is serializable");
    hash.field("projection", &projection);
    hash.finish()
}

pub(crate) fn release_local_history_request_hash(input: &ReleaseLocalHistoryInput) -> [u8; 32] {
    let mut hash = CanonicalHash::new("release_local_history.v1");
    hash.field("scope_handle", input.scope_handle.as_bytes());
    hash.field("operation_id", input.operation_id.as_bytes());
    hash.field("conversation_id", input.conversation_id.as_bytes());
    hash.field(
        "confirmed",
        if input.confirmed { b"true" } else { b"false" },
    );
    hash.finish()
}

pub(crate) fn rebuild_request_hash(input: &MessageCacheWorkerRebuildInput) -> [u8; 32] {
    let mut hash = CanonicalHash::new("rebuild_scope.v1");
    hash.field("scope_handle", input.scope_handle.as_bytes());
    hash.field("operation_id", input.operation_id.as_bytes());
    hash.field("expected_reason", input.expected_reason.as_str().as_bytes());
    hash.field(
        "server_snapshot_hash",
        input.server_snapshot_hash.as_bytes(),
    );
    hash.field(
        "confirmed",
        if input.confirmed { b"true" } else { b"false" },
    );
    hash.finish()
}

pub(crate) fn hex_hash(value: &[u8; 32]) -> String {
    let mut output = String::with_capacity(64);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in value.iter().copied() {
        output.push(char::from(HEX[usize::from(byte >> 4)]));
        output.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    output
}

struct CanonicalHash {
    hasher: Sha256,
}

impl CanonicalHash {
    fn new(operation_kind: &str) -> Self {
        let mut output = Self {
            hasher: Sha256::new(),
        };
        output.field("domain", HASH_DOMAIN);
        output.field("operation_kind", operation_kind.as_bytes());
        output
    }

    fn field(&mut self, tag: &str, value: &[u8]) {
        self.hasher.update((tag.len() as u32).to_be_bytes());
        self.hasher.update(tag.as_bytes());
        self.hasher.update((value.len() as u64).to_be_bytes());
        self.hasher.update(value);
    }

    fn optional(&mut self, tag: &str, value: Option<&str>) {
        match value {
            Some(value) => {
                self.field(&format!("{tag}.present"), b"1");
                self.field(tag, value.as_bytes());
            }
            None => self.field(&format!("{tag}.present"), b"0"),
        }
    }

    fn u64(&mut self, tag: &str, value: u64) {
        self.field(tag, &value.to_be_bytes());
    }

    fn finish(self) -> [u8; 32] {
        self.hasher.finalize().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message_cache::{ConfirmedTimelineProjection, DeliveryState, RedactionProfile};
    use crate::message_cache_worker::{CacheRecoveryReason, MessageCacheWorkerRebuildInput};

    fn put(sequence: u64) -> PutConfirmedInput {
        PutConfirmedInput {
            scope_handle: "11111111-1111-4111-8111-111111111111".to_owned(),
            operation_id: "22222222-2222-4222-8222-222222222222".to_owned(),
            projection: ConfirmedTimelineProjection {
                thread_id: "thread:fixture".to_owned(),
                sequence,
                event_type: "message.confirmed".to_owned(),
                actor_type: ActorType::User,
                occurred_at: "2026-07-29T00:00:00Z".to_owned(),
                masked_summary: "summary".to_owned(),
                payload_hash: "a".repeat(64),
                run_id: None,
                server_cursor: Some("cursor:fixture".to_owned()),
                delivery_state: DeliveryState::Confirmed,
                redaction_profile: RedactionProfile::SummaryOnlyV1,
            },
        }
    }

    #[test]
    fn logical_retry_hash_is_stable_and_field_sensitive() {
        let first = put(1);
        let same = put(1);
        let different = put(2);
        assert_eq!(put_request_hash(&first), put_request_hash(&same));
        assert_ne!(put_request_hash(&first), put_request_hash(&different));
    }

    #[test]
    fn put_and_purge_domains_cannot_collide() {
        let input = put(1);
        let purge = PurgeScopeInput {
            scope_handle: input.scope_handle.clone(),
            operation_id: input.operation_id.clone(),
            confirmed: true,
        };
        assert_ne!(put_request_hash(&input), purge_request_hash(&purge));
    }

    #[test]
    fn rebuild_hash_is_stable_and_binds_snapshot_and_reason() {
        let input = MessageCacheWorkerRebuildInput {
            scope_handle: "11111111-1111-4111-8111-111111111111".to_owned(),
            operation_id: "44444444-4444-4444-8444-444444444444".to_owned(),
            expected_reason: CacheRecoveryReason::IntegrityConfirmedCorrupt,
            server_snapshot_hash: "b".repeat(64),
            confirmed: true,
        };
        let mut different_snapshot = input.clone();
        different_snapshot.server_snapshot_hash = "c".repeat(64);
        let mut different_reason = input.clone();
        different_reason.expected_reason = CacheRecoveryReason::DecryptedSchemaMismatch;
        assert_eq!(rebuild_request_hash(&input), rebuild_request_hash(&input));
        assert_ne!(
            rebuild_request_hash(&input),
            rebuild_request_hash(&different_snapshot)
        );
        assert_ne!(
            rebuild_request_hash(&input),
            rebuild_request_hash(&different_reason)
        );
    }
}
