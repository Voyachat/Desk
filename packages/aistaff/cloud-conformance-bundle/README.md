# Aistaff Cloud Conformance Bundle

English | [中文](README.zh.md)

This package is a `test_only` deterministic composition for keyless Cloud Employee Experience acceptance. It installs the conformance input provider before the normal production provider, Remote, and Cloud client wrapper.

The bundle uses the same provider, Remote, and visible client path as production. Only the first row differs. Do not add this package to a production profile or to the production Cloud bundle.

## Model Experience

None, as this test-only bundle composes conformance fixtures and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the bundle does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Test-only composition** — this bundle uses deterministic conformance inputs and must not be mounted by a production profile.
