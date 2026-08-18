/**
 * Browser-safe durable workflow-record events written by the model-facing
 * workflow tool into its calling parent Session.
 *
 * @module @voyaseek-ai/dsh-tool-workflow/types
 */

import type { SessionId } from '@voyaseek-ai/dsh-session/types'
import type { CallId } from '@voyaseek-ai/dsh-llm'
import type {
  WorkflowAgentOutcome, WorkflowRunId, WorkflowStopReason,
} from '@voyaseek-ai/dsh-workflow/types'

/** Durable member outcome, including process-loss recovery. */
export type ToolWorkflowAgentOutcome = WorkflowAgentOutcome | 'interrupted'

/** Durable run outcome, including process-loss recovery. */
export type ToolWorkflowRunStopReason = WorkflowStopReason | 'interrupted'

/** Opens one durable top-level workflow run record. */
export interface ToolWorkflowRunStartData {
  readonly runId: WorkflowRunId
  /** Original tool call whose logged arguments are the inspect/retry source. */
  readonly callId: CallId
  readonly name: string
}

/** Records one workflow member after its child Session is published. */
export interface ToolWorkflowAgentStartData {
  readonly runId: WorkflowRunId
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly childId: SessionId
}

/** Settles one previously started workflow member. */
export interface ToolWorkflowAgentEndData {
  readonly runId: WorkflowRunId
  readonly seq: number
  readonly outcome: ToolWorkflowAgentOutcome
}

/** Settles one workflow run after its live resources reach quiescence. */
export interface ToolWorkflowRunEndData {
  readonly runId: WorkflowRunId
  readonly stopReason: ToolWorkflowRunStopReason
}

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one top-level workflow record.
     * @param data - stable run identity, source call, and display name.
     */
    'tool-workflow/run-start': ToolWorkflowRunStartData
    /**
     * Records one published workflow member.
     * @param data - run identity, member sequence, display identity, and child Session.
     */
    'tool-workflow/agent-start': ToolWorkflowAgentStartData
    /**
     * Records one member settlement.
     * @param data - run identity, paired member sequence, and outcome.
     */
    'tool-workflow/agent-end': ToolWorkflowAgentEndData
    /**
     * Closes one workflow record after cleanup.
     * @param data - stable run identity and runtime or recovered terminal reason.
     */
    'tool-workflow/run-end': ToolWorkflowRunEndData
  }
}
