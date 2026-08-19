# Agent Note: Local Settings for authenticated mobile remote view

Status: implemented

English | [中文](2026-08-19-mobile-remote-view-settings.zh.md)

## Problem

The read-only mobile page existed only as a Host plugin. A user could not find or safely enable it from the product because the listener depended on deployment environment configuration, the access token had no product-owned setup flow, and no local surface reported a reachable phone address or listener failure.

## Decision

`dsh-mobile-view` owns a live `mobile-view` user-settings namespace with `enabled` and `port`. It serializes listener transitions, resolves the write-only credential before binding, and publishes a loopback-only status projection with requested state, actual listening state, detected external IPv4 URLs, and a bounded failure code. The dedicated listener binds to all local interfaces only after an explicit enable action and exposes exactly the existing read-only page and message routes; its route table excludes the main Web API and the status projection.

`dsh-client-ui-settings-mobile-view` contributes a loopback-only Settings section. It joins settings, credential metadata, and listener status through existing APIs, generates a 256-bit token in the browser, writes it without reading stored values back, and provides enable, disable, port, rotate, and copy actions. A requested listener remains disableable when startup fails. The API proxy explicitly admits `mobile-view` to its local Web settings allowlist; registration alone still exposes no namespace. The Web app profile composes the Host and browser plugins; no vendored Cordis source changed.

## Alternatives considered

Exposing the main Web server on the LAN was rejected because it would also publish control APIs. A public tunnel was rejected because it adds external account, credential, and lifecycle responsibilities beyond read-only local viewing. Query-string tokens and persistent browser token storage were rejected because URLs and browser storage expand credential retention. Adding QR generation was deferred because copying one reported address and token completes the first usable path without a new rendering dependency.

## Consequences

Users now find the feature under Settings → Remote View and can operate it without editing environment files. A phone must reach one reported LAN or private-mesh address and enter the bearer token in the mobile page. Firewalls, private-mesh membership, TLS, DNS, NAT traversal, and public exposure remain deployment responsibilities. Future upstream refreshes preserve this change by retaining two standalone plugin packages plus their Web profile rows; there is no patch against `vendor/` to rebase.
