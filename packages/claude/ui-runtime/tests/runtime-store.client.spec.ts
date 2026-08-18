/**
 * RuntimeSelectorController: display-state carrier for the composer runtime
 * chip — sync follows the current session, begin/fail/done settle the switch
 * progress without losing the last failure line.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@voyaseek-ai/dsh-client-runtime/client'
import { RuntimeSelectorController } from '../src/client/runtime-store.ts'

const sid = (id: string): SessionId => id as SessionId

describe('RuntimeSelectorController', () => {
  it('starts on the default loop driver with no session', () => {
    const controller = new RuntimeSelectorController()
    expect(controller.store.getSnapshot()).toEqual({
      current: '', sessionId: null, busy: false, error: null,
    })
  })

  it('syncs the displayed runtime with the current session', () => {
    const controller = new RuntimeSelectorController()
    controller.sync(sid('s1'), 'claude')
    expect(controller.store.getSnapshot()).toMatchObject({ sessionId: 's1', current: 'claude' })
    // A session without a recorded runtime labels as the default driver.
    controller.sync(sid('s2'), undefined)
    expect(controller.store.getSnapshot()).toMatchObject({ sessionId: 's2', current: '' })
    // Leaving the session view clears the follow.
    controller.sync(undefined, undefined)
    expect(controller.store.getSnapshot()).toMatchObject({ sessionId: null, current: '' })
  })

  it('tracks a switch: begin clears the failure, fail records it, done settles', () => {
    const controller = new RuntimeSelectorController()
    controller.sync(sid('s1'), '')
    controller.fail('first failure')
    expect(controller.store.getSnapshot().error).toBe('first failure')
    // The next attempt clears the stale line before it starts.
    controller.begin()
    expect(controller.store.getSnapshot()).toMatchObject({ busy: true, error: null })
    controller.fail('second failure')
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, error: 'second failure' })
    // A settled switch keeps the busy flag down and whatever line stands.
    controller.begin()
    controller.done()
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, error: null })
  })

  it('sync settles an in-flight switch and its failure line', () => {
    const controller = new RuntimeSelectorController()
    controller.begin()
    controller.fail('stale')
    controller.sync(sid('s3'), 'claude')
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, error: null, current: 'claude' })
  })
})
