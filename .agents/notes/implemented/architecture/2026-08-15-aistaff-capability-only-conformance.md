# Agent Note: Capability-only conformance does not enable production reads

Status: implemented

## Problem

The desktop needs to prove the complete local-consent user flow before Aistaff publishes the production artifact, device attestation, and Cloud dispatch needed for `capability_only`. The migrated Rust Supervisor has a real authenticated process transport and Grant admission, but its production file read and directory list return `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`. Treating an in-memory read as production evidence would hide the missing enforcement, identity, and recovery owners.

## Decision

AiDesktop keeps the production and conformance compositions separate. The desktop production profile does not load Local Capability. A separately named `test_only` Cloud local conformance bundle uses the production Cloud adapter, Employee Experience and Local Capability Remotes, and product UI with a fixed-provenance in-memory Supervisor. Its results prove the consumer and projection chain only.

Local Capability is a Host-owned coordinator over an authoritative Cloud `local_operation`, a trusted directory selector, `SupervisorControlPort`, and a canonical Material result sink. The Renderer imports only the browser-safe object layer and receives complete path-free replacements through the repository's single Typert Remote assembly. Paths, capability context, transport token, filesystem targets, Cloud cursors, and local result content stay outside the Renderer.

Cloud Approval, Local Consent, Supervisor Grant, and DSH Tool Approval remain independent decisions. Carrier failures retain the original operation identity and exact replay input; reconciliation reads that operation before the same request can be replayed. Supervisor Receipts own settlement: only `succeeded` changes active/revoked resource state or publishes a Material, while `failed`, `rejected`, and `unknown` retain sanitized evidence and matching operation states. The canonical Material owner commits an admitted result before Employee Experience refreshes the visible projection.

## Alternatives considered

Enabling the conformance Supervisor in the desktop profile was rejected because it would execute fixture data without the Rust production policy. Routing Cloud local operations through DSH filesystem services was rejected because it would move paths into the wrong process and bypass the Supervisor Grant. Returning an empty or successful production response was rejected because it would report an effect that no production executor performed.

## Consequences

The DSH shell and production UI can be exercised end to end without weakening the production boundary. The conformance result is not evidence of production read support, durable Receipt recovery, device identity, attestation, or Cloud acknowledgement. Production `capability_only` remains unavailable until the next task enables Rust read/list through a pinned artifact and formal Supervisor provider, then persists and reconciles signed Receipts. Current contracts and status are owned by [API](../../../../Doc/API.md#3-hostsupervisor), [architecture](../../../../Doc/架构.md#4-客户端执行形态), [data](../../../../Doc/数据.md#42-supervisorstatestore), and the [V2 task](../../../../Doc/tasks/V2-capability-only-read.md).
