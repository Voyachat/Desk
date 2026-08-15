# Agent Note: Package durable Supervisor control without activating it

Status: implemented

## Problem

The `capability_only` consumer flow was already visible through a test-only in-memory Supervisor, while the migrated Rust sidecar deliberately rejected production file reads. Enabling that legacy path would have trusted caller-supplied admission, lost operation outcomes on restart, and returned no authoritative Receipt. The desktop also cannot activate Cloud local operations until Aistaff supplies the signed artifact, device attestation, and acknowledgement protocol.

## Decision

AiDesktop adds an independent `aidesktop.supervisor-control.v1` path to the Rust sidecar. The Host delivers a per-launch token once through inherited stdin before authenticated bounded JSONL begins. A strict `SupervisorControlPort` process Provider maps only the six frozen control methods and retains the original operation identity across uncertain transport outcomes; it never creates a Receipt or identity in TypeScript.

An explicitly constructed Rust control runtime accepts only `capability_only` context and bounded `file/read_text` or `directory/list`. It persists Grant, Receipt, operation fingerprint, and bounded replay result in a versioned SQLite Store before returning. Canonical paths and replay results are encrypted with an injected AES-256-GCM data key; unsafe state directories, foreign or unknown schemas, incorrect keys, modified ciphertext, stale context, changed targets, and request conflicts fail closed.

The release sidecar is packaged as a verified physical executable but remains dormant. The default constructor receives no Store data key and advertises no control capabilities, the existing production file service stays disabled, and the desktop `aistaff` profile does not load the process Provider. Production activation requires an OS Secure Store key, the official Aistaff artifact and device attestation, and Cloud Receipt acknowledgement/reconciliation.

## Alternatives considered

Flipping the legacy execution flag was rejected because its artifact admission and in-memory replay were not production evidence. A TypeScript Receipt journal was rejected because the Supervisor owns local effects and recovery. A hand-written append log was rejected in favor of the adopted SQLite transaction and schema facilities. Passing the launch token through argv or ordinary environment variables was rejected because those surfaces are observable outside the inherited process channel.

## Consequences

The repository now has a separately testable production-grade local execution prerequisite and can package it without exposing a customer-facing capability prematurely. Restart replay, request conflict, storage tamper, path containment, process lifecycle, binary closure, and Browser isolation remain independently verifiable. The next production slice is integration work, not another filesystem executor: inject the Store key from the OS Secure Store, bind the official artifact and attested device identity, add Cloud acknowledgement/reconciliation, and then explicitly enable the production bundle. Current obligations are owned by [API](../../../../Doc/API.md#3-hostsupervisor), [architecture](../../../../Doc/架构.md#4-客户端执行形态), [data](../../../../Doc/数据.md#42-supervisorstatestore), and the [V2 task](../../../../Doc/tasks/V2-capability-only-read.md).
