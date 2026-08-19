/** Durable complex-goal stream invariants. @module @voyaseek-ai/dsh-complex-goal/invariant */

import type { Context } from '@voyaseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@voyaseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@voyaseek-ai/dsh-session'
import { applyComplexGoalEvent, emptyComplexGoalFoldState } from './domain.ts'
import type { ComplexGoalFoldState } from './domain.ts'

const PACKAGE_NAME = '@voyaseek-ai/dsh-complex-goal'

export const name = 'complex-goal-invariant'
export const inject = ['invariants']

function applyChecked(state: ComplexGoalFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyComplexGoalEvent(state, event)
  } catch (error: unknown) {
    fail(`session event ${event.seq} violates the durable complex-goal stream: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, ComplexGoalFoldState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: ComplexGoalFoldState }>()
  const seed = (session: Session): ComplexGoalFoldState => {
    const state = emptyComplexGoalFoldState()
    for (const event of session.events) applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  const stateFor = (session: Session): ComplexGoalFoldState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = { snapshot: stateFor(session).snapshot }
    applyChecked(state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching complex-goal validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the complex-goal stream invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
