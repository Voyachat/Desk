/** Browser plugin for durable workflow-run nodes and the current-session dashboard. */

import type { ClientContext, SessionId } from '@voyaseek-ai/dsh-client-runtime/client'
import type {} from '@voyaseek-ai/dsh-client-locale/client'
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
import { WorkflowDashboardAction } from './WorkflowDashboardAction.tsx'
import { WorkflowRunPanel, type WorkflowRunInjected } from './WorkflowRunPanel.tsx'
import { en, NS, type WorkflowRunKey, zh } from './locales.ts'
import { workflowRunDefinition } from './workflow-definition.ts'

declare module '@voyaseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Durable workflow-run node copy. */
    workflowRun: WorkflowRunKey
  }
}

/** Required services for projection, both additive renderers, navigation, and copy. */
export const inject = ['conversationEvents', 'slots', 'sessions', 'locale']

/** Register the workflow Definition, dictionary, keyed Chat renderer, and header dashboard. */
export function apply(ctx: ClientContext): void {
  const retryRun = async (sessionId: SessionId, runId: string): Promise<void> => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error('workflow retry requires an open Session')
    const result = await session.command(`/workflow-retry ${runId}`)
    if (!result.ok) {
      throw new Error(`workflow retry failed: ${result.error.code}: ${result.error.message}`)
    }
    if (!result.value.matched) throw new Error('workflow retry command is unavailable')
  }
  ctx.conversationEvents.register(workflowRunDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-run: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'workflow-run',
    locale: NS,
    inject: (sessionId: SessionId): WorkflowRunInjected => ({
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
      retryRun: runId => retryRun(sessionId, runId),
    }),
  }, WorkflowRunPanel))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'workflow-dashboard',
    order: 30,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      retryRun: (runId: string) => retryRun(sessionId, runId),
    }),
  }, WorkflowDashboardAction))
}
