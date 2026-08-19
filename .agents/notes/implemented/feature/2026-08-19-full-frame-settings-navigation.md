# Agent Note: Settings use a full-frame sidebar view

Status: implemented

English | [中文](2026-08-19-full-frame-settings-navigation.zh.md)

## Problem

Settings opened as a centered card over a blurred mask. The card constrained long settings pages to a small nested scroll region, reduced the visible content width, and presented section navigation as part of a temporary prompt even though users move among several persistent configuration pages.

## Decision

The settings shell replaces the app workspace with a full-frame view while it is open. A fixed-width sidebar owns the return control, Settings title, and section navigation; the content column owns the local-document action and one independently scrolling active section. The shell keeps its existing component-local open and active-section state, slot registrations, Escape handling, focus entry, and dialog accessibility name.

The return control uses the existing `settings.close` seat because section registrants already receive the same close callback and no second navigation operation exists. Its visible copy names the destination as “Back to app” rather than describing the former card interaction.

## Alternatives considered

Keeping the centered card and only widening it was rejected because the blurred mask and detached card would still communicate a temporary modal interaction. Moving Settings into the application router was rejected because the Web shell currently composes its primary pages through slots and has no route owner for this local viewing state. A collapsible settings sidebar was rejected because the small section inventory does not need a second display mode.

## Consequences

Opening Settings preserves the app process and mounted feature stores but visually replaces the workspace until the user returns or presses Escape. Sections gain the full remaining viewport width and retain one stable scroll container. Feature-owned settings rows, nested confirmation dialogs, onboarding steps, and persistence behavior are unchanged.
