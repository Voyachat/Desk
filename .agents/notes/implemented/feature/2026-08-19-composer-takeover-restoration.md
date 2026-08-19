# Agent Note: Composer takeovers replace the input bar

Status: implemented

English | [中文](2026-08-19-composer-takeover-restoration.zh.md)

## Problem

The composer chain kept its fallback InputBar mounted during approval and question takeovers by switching a wrapper from `display: contents` to `display: none`. Settling the interaction switched the same wrapper back inside a sticky flex child of the conversation scrollport. Electron could leave that subtree without a visible layout until the session was reopened, so the persisted transcript remained intact while the selected conversation appeared blank.

## Decision

ConversationRoot uses ordinary chain replacement for `conversation.composer`. A pending interaction unmounts the InputBar and mounts the elected takeover in the same sticky composer seat; settling the interaction unmounts the takeover and mounts the InputBar. `InputHub`, rather than the textarea DOM node, owns the draft and attachment ids, so replacement preserves user input without relying on a hidden fallback subtree.

The generic slot renderer retains overlay-chain support for owners that require resident component identity. ConversationRoot does not use that mode because its durable input state already has an external owner and the sticky scrollport makes display-state restoration a user-visible failure mode.

## Alternatives considered

Forcing a browser repaint after every approval was rejected because it treats one observed engine symptom and leaves the hidden fallback as the state transition authority. Keeping both the takeover and InputBar in flow while hiding one with visibility was rejected because their different heights would distort the sticky seat and move transcript scroll anchoring. Moving draft state into another local component was rejected because `InputHub` already owns it.

## Consequences

Approval and question panels remain reachable in the existing sticky seat. The InputBar receives a new DOM identity after a takeover, while its draft and attachments remain in the existing machine state. Browser acceptance waits for the restored textarea to be visible and laid out, rather than accepting an enabled but unpainted control.
