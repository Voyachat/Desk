# @voyaseek-ai/dsh-client-ui-settings-mobile-view

English | [中文](README.zh.md)

The loopback-only **Remote View** Settings page for the authenticated read-only mobile listener. It joins the `mobile-view` user-settings namespace, write-only credential metadata for `VOYASEEK_MOBILE_VIEW_TOKEN`, and the Host listener status endpoint. A local user can enable or disable the listener, select its port, rotate the access token, and copy the detected LAN addresses. The generated token is shown only in the browser process that created it; stored credential values never ride a read response.

The page is not registered for a non-loopback connection. Enabling it starts only the dedicated mobile-view listener owned by [`dsh-mobile-view`](../../host/mobile-view/README.md); it does not expose the main Web server, add write operations, or create a public tunnel.

## Model Experience

None, as this package changes browser Settings and listener configuration without contributing model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends model requests.

## Known Limitations and Deferred Work

- Addresses include external IPv4 interfaces visible to the Host. The user must choose the address reachable from the phone and configure the local firewall when required.
- The package does not provision DNS, TLS, VPN/private-mesh membership, NAT traversal, or a public tunnel.
- A forgotten token cannot be read back; it must be rotated.
