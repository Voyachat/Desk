// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@voyaseek-ai/dsh-client-test-runtime'
import { ConversationDisplayPolicy, DEFAULT_SHOW_REASONING } from '../src/client/chat/display-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

describe('ConversationDisplayPolicy', () => {
  it('defaults to the folded view and publishes explicit changes', () => {
    const policy = new ConversationDisplayPolicy()
    expect(policy.showReasoning.getSnapshot()).toBe(DEFAULT_SHOW_REASONING)

    const changed = vi.fn()
    policy.showReasoning.subscribe(changed)
    policy.setShowReasoning(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.showReasoning.getSnapshot()).toBe(true)
    policy.setShowReasoning(true)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const observed: string[] = []
    let livePreference = (): boolean => DEFAULT_SHOW_REASONING
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${String(livePreference())}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new ConversationDisplayPolicy(scope)
    livePreference = () => policy.showReasoning.getSnapshot()
    policy.setShowReasoning(true)
    expect(observed).toEqual(['showReasoning=true:true'])
    expect(host.set).toHaveBeenCalledWith('showReasoning', true)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ConversationDisplayPolicy(host.scope)
    host.publish({ status: 'ready', value: { busyEnter: 'queue', showReasoning: true }, revision: 1, writable: true })
    expect(policy.showReasoning.getSnapshot()).toBe(true)
    policy.setShowReasoning(true)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { busyEnter: 'queue', showReasoning: true }, revision: 2 })
    expect(policy.showReasoning.getSnapshot()).toBe(true)
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'queue', showReasoning: true }, revision: 1, writable: true })
    const policy = new ConversationDisplayPolicy(host.scope)
    expect(policy.showReasoning.getSnapshot()).toBe(true)
  })
})
