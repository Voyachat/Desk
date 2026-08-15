# Aistaff Local Capability Remote

This package exposes the authoritative Host `ctx.localCapability` service through generated Typert codecs under the `localCapability` namespace. `getSnapshot()` performs one atomic observe/read and disposes the temporary observation immediately. Every exposed input and result uses the public `@deepseek-ai/dsh-aistaff-local-capability/types` DTOs; a second wire guard rejects binary data, filesystem locations, transport fields, token fields, and `FsTarget`-derived values.

The Client entry fetches a complete Host baseline before registering `ctx.localCapability`. Successful selections, authorizations, revocations, and operation reconciliation retain the original `operation_id` and pull one complete replacement. Replacements cannot regress generation or reuse a generation with different content.

## Model Experience

### Local Capability Remote bridge

#### What the model sees

Nothing. The bridge carries explicit user authorization actions and display-safe projections and does not register prompts, tools, or Session events.

#### Token effect

None. No Remote payload enters model context.

#### KV Cache effect

None. The package does not alter model requests.

## Known Limitations and Deferred Work

- **No pushed replacement stream** — Typert Remote does not forward the process-local `observe()` callback. V2 refreshes after every successful mutation and `readOperation()` reconciliation; unrelated Host changes become visible on the next explicit refresh point.
