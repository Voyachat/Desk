# Agent Note: Package-mode Typert generation is package-local

Status: implemented

## Problem

The tsdown plugin has two generation modes. Workspace mode intentionally discovers and emits every opted-in contributor once, while package mode runs as part of one package bundle. Asking the workspace generator for every package from package mode made an isolated package build inspect unrelated workspace packages and could fail because of another package's unfinished types.

## Decision

Package mode reads the manifest nearest the bundle output and calls `WorkspaceTypertGenerator.generate()` with that manifest's package name and the requested faces. It does not call workspace discovery. Workspace mode remains the only path that discovers all opted-in contributors.

## Alternatives considered

Keeping workspace discovery in package mode was rejected because isolated builds would continue to depend on unrelated package readiness. Adding package-specific ignore lists was rejected because every new contributor would require central maintenance and the build would still inspect more than its requested package.

## Consequences

An isolated package bundle only analyzes and writes Typert artifacts for that package. Generating the complete workspace still requires the explicit workspace-mode prepass. The tsdown plugin regression test includes another opted-in package and verifies that package mode requests only the package being bundled.
