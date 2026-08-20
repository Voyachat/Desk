# Aistaff Cloud Client Product

English | [中文](README.zh.md)

This package is the explicit production `dsh.client` entry for the Aistaff Cloud AI employee workbench. Its Host half is a no-op marker; `lib/client.js` registers the browser plugin under `@voyaseek-ai/dsh-aistaff-cloud-client-product`.

The browser source reuses only `@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts`. It does not import the Fixture `./client` entry and does not detect services to select a product mode. The containing bundle must load `employee-experience-remote` before this package.

The package-local browser build exists because the shared client preset intentionally rejects cross-plugin runtime imports. It inlines the selected Cloud source and CSS while preserving DSH platform modules as loader-table externals.
