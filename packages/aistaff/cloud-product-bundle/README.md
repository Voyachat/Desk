# Aistaff Cloud Product Bundle

English | [中文](README.zh.md)

This is the production-only Cloud AI employee composition layer for a DSH web profile. It installs, in order, the deployment-backed Cloud provider, the Renderer-safe Employee Experience Remote, and the explicit Cloud client wrapper.

The bundle does not provide Client Gateway inputs. A production deployment must register those inputs before `cloud-provider`; missing inputs fail at the provider instead of selecting an in-memory fallback.

The composition excludes `cloud-conformance`, the legacy `product-projection` and `product-remote` packages, and the Fixture `aistaff-client-product` entry.

## Model Experience

None, as this bundle only composes packages whose owners declare their model-visible behavior.

#### KV Cache effect

None directly; the composed runtime owners determine any model-request cache effect.

## Known Limitations and Deferred Work

- **Deployment inputs required** — the bundle provides no Client Gateway artifact, authenticated transport, or credentials; production composition must register them before `cloud-provider`.
