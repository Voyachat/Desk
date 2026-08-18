// @vitest-environment jsdom
/**
 * RuntimeSelector: the composer chip labels the current session runtime,
 * offers both drivers in a menu, calls select only for a different pick,
 * disables while a switch is in flight, and shows the failure line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@voyaseek-ai/dsh-client-web-react'
import { makeTranslate } from '@voyaseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@voyaseek-ai/dsh-client-locale/src/locales/zh.ts'
import { RuntimeSelector, type RuntimeSelectorProps } from '../src/client/RuntimeSelector.tsx'
import type { RuntimeSelectorState } from '../src/client/runtime-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: RuntimeSelectorProps['t'] = makeTranslate(zh, commonZh)

function setup(
  patch: Partial<RuntimeSelectorState> = {},
  select = vi.fn(),
) {
  const store = createSnapshotStore<RuntimeSelectorState>({
    current: '', sessionId: null, busy: false, error: null, ...patch,
  })
  const useRuntimeSelector = bindSnapshotSelector(store)
  const props = { useRuntimeSelector, select, t } as unknown as RuntimeSelectorProps
  const view = render(<RuntimeSelector {...props} />)
  return { store, select, view }
}

const chip = () => screen.getByRole('button', { name: '运行模式' })

describe('RuntimeSelector', () => {
  it('labels the default loop driver as native mode', () => {
    setup()
    expect(chip().textContent).toContain('本机模式')
  })

  it('labels a claude-runtime session as Claude mode', () => {
    setup({ current: 'claude' })
    expect(chip().textContent).toContain('Claude 模式')
  })

  it('selects a different runtime from the menu and not the current one', () => {
    const { select } = setup({ current: '' })
    fireEvent.click(chip())
    const claudeItem = screen.getByText('由 Claude Agent SDK 调度')
    fireEvent.click(claudeItem)
    expect(select).toHaveBeenCalledWith('claude')
    // The native row is the current pick: choosing it again selects nothing.
    fireEvent.click(chip())
    const nativeItem = screen.getByText('由 Voyaseek Harness 本机调度')
    fireEvent.click(nativeItem)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('disables the chip and shows the busy copy while switching', () => {
    setup({ busy: true })
    expect((chip() as HTMLButtonElement).disabled).toBe(true)
    expect(chip().textContent).toContain('正在切换运行模式…')
  })

  it('surfaces the failure line beside the chip', () => {
    setup({ error: 'host unreachable' })
    expect(screen.getByRole('status').textContent).toBe('host unreachable')
  })
})
