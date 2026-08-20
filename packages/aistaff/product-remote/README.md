# Aistaff product Remote

English | [中文](README.zh.md)

This package exposes the authoritative `ctx.aistaffProduct` operations through strict generated Typert codecs under the `aistaffProduct` Remote namespace. Its Client entry registers `ctx.aistaffProductPort`, unwraps the carrier envelope, and preserves product business results without maintaining a second projection.

Host composition loads the default export after the product projection. Client composition loads `@voyaseek-ai/dsh-aistaff-product-remote/client` after API Remotes has mounted this package's generated `./remote` contribution.

## Model Experience

None, as this Renderer bridge carries product projections and operations without registering model input.

#### KV Cache effect

None; the bridge does not assemble or send model requests.

## Known Limitations and Deferred Work

- **No Fixture event forwarding** — `subscribe()` intentionally delivers nothing; the acceptance Client refreshes with `getSnapshot()` after each mutation. Production Cloud reconnect/event replay belongs to the Client Gateway adapter and must not reuse this silent behavior.
