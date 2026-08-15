use super::capability_hash::hash_value;
use super::contracts::{LocalCapabilityError, SideEffectClass};
use super::process_execution::{NativeProcessExecutionSpec, ProcessCancelOutcome};
use super::process_execution_context::validate_prepared_process_context;
use super::process_execution_contracts::{
    ProcessExecutionCancelInput, ProcessExecutionCancelResult, ProcessExecutionReconcileInput,
    ProcessExecutionReconcileResult, ProcessExecutionStartInput, ProcessExecutionStartResult,
    ProcessExecutionState,
};
use super::process_execution_results::{
    ProcessExecutionRecord, cancel_result, reconcile_result, start_result, unknown_reconcile,
    unknown_snapshot,
};
use super::process_policy::{
    RegisteredProcessPolicy, process_descriptor_hash, validate_descriptor_against_policy,
};
use super::process_service::{EXECUTION_IDENTITY_CAPACITY, LocalProcessCapabilityService};
use super::service::{AuthorizationEvaluation, evaluate_authorization};
use std::time::Duration;

const EXECUTION_RECORD_CAPACITY: usize = 128;

impl LocalProcessCapabilityService {
    pub(super) fn start_process_execution(
        &mut self,
        input: ProcessExecutionStartInput,
    ) -> Result<ProcessExecutionStartResult, LocalCapabilityError> {
        input.validate()?;
        let now_ms = (self.now_ms)();
        ensure_authorized(&input.capability_request, now_ms)?;
        self.prune_expired(now_ms);
        if self.execution_engine.is_none()
            || !self.native_sandbox_admission.permits_execution_kernel()
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_PRODUCTION_EXECUTION_DISABLED",
            ));
        }
        let request_hash = hash_value(&input)?;
        if let Some(replay) = self.execution_replay(&input, &request_hash)? {
            return Ok(replay);
        }
        self.prepare_execution_slot(&input)?;
        self.prepare_execution_binding(&input)?;
        let context = self
            .execution_context_provider
            .prepare(&input.descriptor_request)?;
        validate_prepared_process_context(&input.descriptor_request, &context)?;
        let launch_now_ms = (self.now_ms)();
        ensure_authorized(&input.capability_request, launch_now_ms)?;
        self.prune_expired(launch_now_ms);
        let prepared = self.prepare_execution_binding(&input)?;
        let effective_timeout_ms = bounded_timeout_ms(&input, &prepared, launch_now_ms);
        if effective_timeout_ms == 0 {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_AUTHORIZATION_EXPIRED",
            ));
        }
        let engine = self.execution_engine.as_mut().ok_or_else(|| {
            LocalCapabilityError::new("LOCAL_PROCESS_PRODUCTION_EXECUTION_DISABLED")
        })?;
        let snapshot = engine.start(NativeProcessExecutionSpec {
            capability_id:
                super::process_execution_contracts::LOCAL_PROCESS_EXECUTION_CAPABILITY_ID,
            operation_id: input.capability_request.operation.operation_id.clone(),
            scope: input.capability_request.scope.clone(),
            executable_path: prepared.executable_path,
            argv: input.descriptor_request.argv.clone(),
            environment: context.environment,
            working_directory: context.working_directory,
            timeout: Duration::from_millis(effective_timeout_ms),
            output_limit_bytes: input.descriptor_request.output_limit_bytes as usize,
            side_effect: prepared.side_effect,
            target: prepared.target,
            resource_policy: prepared.resource_policy,
        })?;
        let record = ProcessExecutionRecord {
            operation_id: input.capability_request.operation.operation_id.clone(),
            request_hash: request_hash.clone(),
            policy_handle: input.descriptor_request.policy_handle.clone(),
            process_descriptor_hash: prepared.process_descriptor_hash.clone(),
            executable_fingerprint: prepared.executable_fingerprint.clone(),
            cloud_audit_ref: input.capability_request.authorization.audit_ref.clone(),
        };
        let idempotency_key = input.capability_request.operation.idempotency_key.clone();
        self.used_execution_keys.insert(idempotency_key.clone());
        self.used_execution_operations
            .insert(record.operation_id.clone());
        self.execution_order.push_back(idempotency_key.clone());
        self.execution_records.insert(idempotency_key, record);
        Ok(start_result(
            &input,
            request_hash,
            prepared.process_descriptor_hash,
            prepared.executable_fingerprint,
            snapshot,
            false,
        ))
    }

    pub(super) fn cancel_process_execution(
        &mut self,
        input: ProcessExecutionCancelInput,
    ) -> Result<ProcessExecutionCancelResult, LocalCapabilityError> {
        input.validate()?;
        let Some(record) = self.execution_record_by_operation(&input.operation_id) else {
            return Ok(cancel_result(
                input,
                ProcessCancelOutcome::NotFound,
                unknown_snapshot("LOCAL_PROCESS_EXECUTION_NOT_FOUND"),
            ));
        };
        if record.request_hash != input.request_hash {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_REFERENCE_MISMATCH",
            ));
        }
        let Some(engine) = self.execution_engine.as_mut() else {
            return Ok(cancel_result(
                input,
                ProcessCancelOutcome::NotFound,
                unknown_snapshot("LOCAL_PROCESS_EXECUTION_NOT_FOUND"),
            ));
        };
        let outcome = engine.cancel(&input.operation_id, input.reason);
        let snapshot = engine
            .snapshot(&input.operation_id)
            .unwrap_or_else(|| unknown_snapshot("LOCAL_PROCESS_EXECUTION_NOT_FOUND"));
        Ok(cancel_result(input, outcome, snapshot))
    }

    pub(super) fn reconcile_process_execution(
        &mut self,
        input: ProcessExecutionReconcileInput,
    ) -> Result<ProcessExecutionReconcileResult, LocalCapabilityError> {
        input.validate()?;
        let Some(record) = self
            .execution_record_by_operation(&input.operation_id)
            .cloned()
        else {
            return Ok(unknown_reconcile(
                input,
                "LOCAL_PROCESS_EXECUTION_NOT_FOUND",
            ));
        };
        if record.request_hash != input.request_hash {
            return Ok(unknown_reconcile(
                input,
                "LOCAL_PROCESS_EXECUTION_RECONCILE_HASH_MISMATCH",
            ));
        }
        let Some(snapshot) = self
            .execution_engine
            .as_mut()
            .and_then(|engine| engine.snapshot(&input.operation_id))
        else {
            return Ok(unknown_reconcile(
                input,
                "LOCAL_PROCESS_EXECUTION_RECONCILE_RECORD_LOST",
            ));
        };
        reconcile_result(input, record, snapshot)
    }

    pub(super) fn cancel_policy_executions(&mut self, policy_handle: &str) {
        let operation_ids = self
            .execution_records
            .values()
            .filter(|record| record.policy_handle == policy_handle)
            .map(|record| record.operation_id.clone())
            .collect::<Vec<_>>();
        if let Some(engine) = self.execution_engine.as_mut() {
            for operation_id in operation_ids {
                let _ = engine.cancel(&operation_id, super::contracts::CancelReason::PolicyRevoked);
            }
        }
    }

    fn execution_replay(
        &mut self,
        input: &ProcessExecutionStartInput,
        request_hash: &str,
    ) -> Result<Option<ProcessExecutionStartResult>, LocalCapabilityError> {
        let key = &input.capability_request.operation.idempotency_key;
        let Some(record) = self.execution_records.get(key).cloned() else {
            return Ok(None);
        };
        if record.request_hash != request_hash
            || record.operation_id != input.capability_request.operation.operation_id
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_IDEMPOTENCY_CONFLICT",
            ));
        }
        let snapshot = self
            .execution_engine
            .as_mut()
            .and_then(|engine| engine.snapshot(&record.operation_id))
            .ok_or_else(|| {
                LocalCapabilityError::new("LOCAL_PROCESS_EXECUTION_REPLAY_REQUIRES_HANDOFF")
            })?;
        Ok(Some(start_result(
            input,
            record.request_hash,
            record.process_descriptor_hash,
            record.executable_fingerprint,
            snapshot,
            true,
        )))
    }

    fn prepare_execution_slot(
        &mut self,
        input: &ProcessExecutionStartInput,
    ) -> Result<(), LocalCapabilityError> {
        let operation = &input.capability_request.operation;
        if self
            .used_execution_keys
            .contains(&operation.idempotency_key)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_REPLAY_EXPIRED",
            ));
        }
        if self
            .used_execution_operations
            .contains(&operation.operation_id)
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_OPERATION_REUSED",
            ));
        }
        if self.used_execution_keys.len() >= EXECUTION_IDENTITY_CAPACITY
            || self.used_execution_operations.len() >= EXECUTION_IDENTITY_CAPACITY
        {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_IDENTITY_CAPACITY_REACHED",
            ));
        }
        if self.execution_records.len() >= EXECUTION_RECORD_CAPACITY {
            self.evict_oldest_terminal_execution()?;
        }
        Ok(())
    }

    fn evict_oldest_terminal_execution(&mut self) -> Result<(), LocalCapabilityError> {
        let candidate_count = self.execution_order.len();
        for _ in 0..candidate_count {
            let Some(key) = self.execution_order.pop_front() else {
                break;
            };
            let Some(record) = self.execution_records.get(&key) else {
                continue;
            };
            let operation_id = record.operation_id.clone();
            let is_terminal = self
                .execution_engine
                .as_mut()
                .and_then(|engine| engine.snapshot(&operation_id))
                .is_some_and(|snapshot| snapshot.execution_state != ProcessExecutionState::Running);
            if !is_terminal {
                self.execution_order.push_back(key);
                continue;
            }
            let discarded = self
                .execution_engine
                .as_mut()
                .is_some_and(|engine| engine.discard_terminal(&operation_id));
            if discarded {
                self.execution_records.remove(&key);
                return Ok(());
            }
            self.execution_order.push_back(key);
        }
        Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTION_RECORD_CAPACITY_REACHED",
        ))
    }

    fn prepare_execution_binding(
        &self,
        input: &ProcessExecutionStartInput,
    ) -> Result<PreparedExecutionBinding, LocalCapabilityError> {
        let policy = self
            .policies
            .get(&input.descriptor_request.policy_handle)
            .ok_or_else(|| LocalCapabilityError::new("LOCAL_PROCESS_POLICY_NOT_ACTIVE"))?;
        validate_descriptor_against_policy(&input.descriptor_request, policy)?;
        validate_cloud_binding(input, policy)?;
        policy.executable.validate()?;
        let descriptor_hash = process_descriptor_hash(&input.descriptor_request, policy)?;
        if descriptor_hash != input.expected_process_descriptor_hash {
            return Err(LocalCapabilityError::new(
                "LOCAL_PROCESS_EXECUTION_DESCRIPTOR_CHANGED",
            ));
        }
        Ok(PreparedExecutionBinding {
            executable_path: policy.executable.execution_path(),
            executable_fingerprint: policy.executable.fingerprint().to_owned(),
            process_descriptor_hash: descriptor_hash,
            side_effect: policy.side_effect,
            target: policy.target,
            resource_policy: policy.resource_policy.clone(),
            expires_at_ms: policy.expires_at_ms,
        })
    }

    fn execution_record_by_operation(&self, operation_id: &str) -> Option<&ProcessExecutionRecord> {
        self.execution_records
            .values()
            .find(|record| record.operation_id == operation_id)
    }
}

struct PreparedExecutionBinding {
    executable_path: std::path::PathBuf,
    executable_fingerprint: String,
    process_descriptor_hash: String,
    side_effect: SideEffectClass,
    target: super::process_contracts::ProcessTarget,
    resource_policy: super::process_resource_policy::ProcessResourcePolicy,
    expires_at_ms: u64,
}

fn bounded_timeout_ms(
    input: &ProcessExecutionStartInput,
    prepared: &PreparedExecutionBinding,
    launch_now_ms: u64,
) -> u64 {
    input
        .descriptor_request
        .timeout_ms
        .min(prepared.expires_at_ms.saturating_sub(launch_now_ms))
        .min(
            input
                .capability_request
                .authorization
                .expires_at_ms
                .saturating_sub(launch_now_ms),
        )
}

fn validate_cloud_binding(
    input: &ProcessExecutionStartInput,
    policy: &RegisteredProcessPolicy,
) -> Result<(), LocalCapabilityError> {
    let operation = &input.capability_request.operation;
    if operation.action_id != policy.action_id
        || operation.capability_id != policy.capability_id
        || operation.side_effect != policy.side_effect
    {
        return Err(LocalCapabilityError::new(
            "LOCAL_PROCESS_EXECUTION_CLOUD_POLICY_MISMATCH",
        ));
    }
    Ok(())
}

fn ensure_authorized(
    request: &super::contracts::CapabilityRequest,
    now_ms: u64,
) -> Result<(), LocalCapabilityError> {
    if let AuthorizationEvaluation::Rejected(_, reason_code) =
        evaluate_authorization(request, now_ms)
    {
        return Err(LocalCapabilityError::new(reason_code));
    }
    Ok(())
}
