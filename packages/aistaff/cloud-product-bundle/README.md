# Aistaff Cloud Product Bundle

English | [中文](README.zh.md)

This is the production-only Cloud AI employee composition layer for a DSH web profile. It installs, in order, the deployment-backed Cloud provider, the Renderer-safe Employee Experience Remote, and the explicit Cloud client wrapper.

The bundle does not provide Client Gateway inputs. A production deployment must register those inputs before `cloud-provider`; missing inputs fail at the provider instead of selecting an in-memory fallback.

The composition excludes `cloud-conformance`, the legacy `product-projection` and `product-remote` packages, and the Fixture `aistaff-client-product` entry.
