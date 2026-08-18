# Aistaff product Remote

This package exposes the authoritative `ctx.aistaffProduct` operations through strict generated Typert codecs under the `aistaffProduct` Remote namespace. Its Client entry registers `ctx.aistaffProductPort`, unwraps the carrier envelope, and preserves product business results without maintaining a second projection.

Host composition loads the default export after the product projection. Client composition loads `@voyaseek-ai/dsh-aistaff-product-remote/client` after API Remotes has mounted this package's generated `./remote` contribution.

## Model Experience

### Product Remote bridge

#### What the model sees

Nothing. The bridge carries Renderer product reads and user actions and does not register prompt text, tools, or Session events.

#### Token effect

None. No request or response enters model context.

#### KV Cache effect

None. The package does not alter model requests.

## Known Limitations and Deferred Work

- **No Fixture event forwarding** — `subscribe()` intentionally delivers nothing; the acceptance Client refreshes with `getSnapshot()` after each mutation. Production Cloud reconnect/event replay belongs to the Client Gateway adapter and must not reuse this silent behavior.
