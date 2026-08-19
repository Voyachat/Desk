# @voyaseek-ai/dsh-mobile-view

English | [中文](README.zh.md)

A responsive, read-only session viewer at `/mobile-view`. The page keeps its bearer token only in page memory. JSON routes accept the token only through `Authorization: Bearer`; query-string tokens, cookies, writes, commands, file access, uploads, downloads, and remote process control do not exist.

The Host registers the live `mobile-view` settings namespace (`enabled`, `port`) and a loopback-only `/mobile-view/api/status` route. The local Remote View Settings page writes the token through the credentials service, then enables or disables a separate listener bound to `0.0.0.0`. That listener exposes only the page, session list, and one-session message routes; it refuses to start without the bearer credential and never exposes the status route, main Web server, or control API. The status response reports detected external IPv4 addresses without returning the credential.

`remoteHost` and `remotePort` remain deployment composition inputs; a configured `remoteHost` supplies the initial enabled state for existing deployments. A private mesh or allowlisted reverse proxy remains preferable to a public port. The plugin does not provision TLS, NAT traversal, or a tunnel.

## Model Experience

None. The plugin reads already committed session events and never changes model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The page polls bounded snapshots; push delivery and offline caching are intentionally absent.
- Transport encryption belongs to a trusted private mesh or reverse proxy; the dedicated listener does not terminate TLS.
- The viewer renders text from user and assistant messages only.
