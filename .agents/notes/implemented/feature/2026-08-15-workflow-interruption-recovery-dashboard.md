# Agent Note: Workflow recovery records interruption before explicit restart

Status: implemented

## Problem

Workflow runs are durably described by Session events, but a process exit can leave the last member and run events open. Replaying that history as `running` implies that an absent worker still owns active work. Automatically resubmitting the workflow after restart can repeat model calls or tool side effects. The existing per-message card also did not provide a current-session view of multiple runs and their recovery state.

## Decision

The parent Session `tool-workflow/*` event stream remains the only workflow recovery owner. `tool-workflow/run-start` records the originating tool `callId`. When a Session starts with source `resume`, the workflow plugin scans the durable history and appends `interrupted` terminal events for every open member and run. Repeated resume is idempotent and never invokes the workflow engine.

An interrupted or failed run can be retried only through an explicit command. The command resolves the recorded `callId`, reads the original durable `tool/call` arguments, and creates a new run from the beginning after user confirmation. It does not claim checkpoint or mid-step continuation.

The Client keeps the existing conversation card and adds a `conversation.session.header.actions` dashboard for the currently loaded Session. Both views fold the same durable events into run and step status. The dashboard does not create a second Host state store and does not promise cross-session aggregation.

## Alternatives considered

Leaving open runs as `running` after restart was rejected because no worker remains to settle them. Automatically replaying open runs was rejected because tool calls may not be idempotent. Persisting a separate dashboard database was rejected because it could diverge from the Session event stream. Advertising checkpoint resume was rejected because the workflow engine does not persist executable step checkpoints.

## Consequences

After a crash or restart, open work becomes visibly interrupted and resumable without being re-executed. Explicit retry produces a new auditable run while preserving the interrupted history. The current-session dashboard survives page reload through Session replay and shows multiple runs and steps, but a future cross-session dashboard requires a separate Host query capability.
