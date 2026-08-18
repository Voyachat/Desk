# @voyaseek-ai/dsh-mobile-view

English | [中文](README.zh.md)

A responsive, read-only session viewer at `/mobile-view`. The page keeps its bearer token only in page memory. JSON routes accept the token only through `Authorization: Bearer`; query-string tokens, cookies, writes, commands, file access, uploads, downloads, and remote process control do not exist.

Set `VOYASEEK_MOBILE_VIEW_TOKEN` through the credentials service. Setting `VOYASEEK_MOBILE_VIEW_HOST=0.0.0.0` starts a separate read-only listener on port 3081; it exposes only the three `/mobile-view` routes and refuses to start without the bearer credential. This does not expose the main Web server or its control API. A private mesh or allowlisted reverse proxy remains preferable to a public port. `remoteHost` and `remotePort` can be overridden in the plugin row; the plugin never starts a tunnel.

## Model Experience

None. The plugin reads already committed session events and never changes model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The page polls bounded snapshots; push delivery and offline caching are intentionally absent.
- Transport encryption belongs to a trusted private mesh or reverse proxy; the dedicated listener does not terminate TLS.
- The viewer renders text from user and assistant messages only.
