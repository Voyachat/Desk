# Agent Note: Regional low-cost desktop model defaults

Status: implemented

English | [中文](2026-08-18-regional-low-cost-model-defaults.zh.md)

## Problem

The packaged desktop needs an economical default that works through a domestic endpoint in mainland China and an economical Gemini route elsewhere. A bundled shared credential would transfer billing and tenant authority into the application, while IP geolocation would add network dependency and disclose location data before the local runtime starts.

## Decision

The generated desktop profile registers `dashscope/qwen3.7-flash` and `google/gemini-3.1-flash-lite`. Electron's operating-system ISO country code selects DashScope only for `CN`; every other or unavailable code selects Gemini. This choice only writes a new profile or an exact previously generated template. Any user-edited profile remains authoritative.

Credentials stay in the existing repository-external owner-only files and enter only the Runtime child environment. The DMG contains provider names and environment-variable references, never API keys. The model selector remains the explicit way to override the generated default.

## Alternatives considered

IP geolocation was rejected because a default model does not justify a location request, third-party lookup, startup delay, or network-derived ambiguity. Shipping or scraping a shared low-price key was rejected because API keys are credentials rather than price tiers and would create uncontrolled billing, rotation, and tenant-isolation risk. A new regional routing plugin was rejected because the desktop profile generator already owns the initial model choice.

## Consequences

Mainland China installations can use DashScope without first changing the model, and other installations use Gemini Flash-Lite. Availability and billing still depend on the user's own provider account. Changing the operating-system country does not override a profile the user has edited.
