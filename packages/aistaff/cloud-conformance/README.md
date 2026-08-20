# Aistaff Cloud Conformance

English | [中文](README.zh.md)

Test-only deterministic Client Gateway artifact and in-memory transport. Its immutable provenance declares `test_only: true`, a fixed artifact version, and a fixed root hash. The package never reads a production URL, credential, token, Store, Aistaff workspace, or external service.

Mount this plugin before `@voyaseek-ai/dsh-aistaff-cloud-provider` in tests. It supplies `AistaffClientGatewayInputs` and `aistaffCloudConformance` controls. The default `approval` scenario preserves the V1 flow with one ready Cloud employee, a snapshot-bound empty-or-single engagement projection, open, `202` text activity, text material, approval interaction, receipt, material access, retained operation outcome, SSE replay, duplicate delivery, reconnect, and a one-shot cursor-expired response.

The explicit `local_read` scenario replaces the submitted approval with a Cloud-owned `directory/list` interaction. Its Host-only control resolves the current request and idempotently admits a bounded path-free local result into the same authoritative Material, Receipt, Activity, baseline, and SSE projection. `@voyaseek-ai/dsh-aistaff-cloud-local-conformance` provides the separate test-only native selector, Supervisor, and Local Capability composition for that flow.

Production bundles must not depend on or mount this package. A green fixture run proves consumer orchestration against this fixed local contract only; it does not prove compatibility with a released Aistaff artifact or service.

## Model Experience

None, as this test-only Cloud fixture publishes Renderer-safe state and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the fixture does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Test-only transport** — the in-memory transport does not contact or validate a production Aistaff deployment and must not be used as production readiness evidence.
