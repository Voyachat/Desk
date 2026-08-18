// @vitest-environment jsdom
// ActivityFold presentation: collapsed summary figures, expand-to-members,
// and the running clock — driven with plain props, no session wiring.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@voyaseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@voyaseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { ActivityFold } from '../src/client/chat/ActivityFold.tsx'

const t = makeTranslate(zh, commonZh)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderMember(key: string) {
  return <div data-testid={`member-${key}`}>{key}</div>
}

describe('ActivityFold', () => {
  it('starts collapsed with the done label and summary figures', () => {
    const view = render(
      <ActivityFold
        members={['a1', 'c1']}
        running={false}
        toolCalls={1}
        startTime={1_000}
        endTime={46_000}
        renderMember={renderMember}
        t={t}
      />,
    )
    expect(view.getByText('已处理')).toBeTruthy()
    expect(view.getByText('45秒 · 1 步')).toBeTruthy()
    expect(view.queryByTestId('member-a1')).toBeNull()
    expect(view.queryByTestId('member-c1')).toBeNull()
  })

  it('renders member seats after expanding', () => {
    const view = render(
      <ActivityFold
        members={['a1', 'c1']}
        running={false}
        toolCalls={2}
        startTime={1_000}
        endTime={3_000}
        renderMember={renderMember}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('已处理'))
    expect(view.getByTestId('member-a1')).toBeTruthy()
    expect(view.getByTestId('member-c1')).toBeTruthy()
    // The summary line survives expansion (keepContentWhenOpen).
    expect(view.getByText('2秒 · 2 步')).toBeTruthy()
    fireEvent.click(view.getByText('已处理'))
    expect(view.queryByTestId('member-a1')).toBeNull()
  })

  it('shows the running label with a live clock and running marker', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(60_000))
    const view = render(
      <ActivityFold
        members={['c1']}
        running
        toolCalls={1}
        startTime={48_000}
        endTime={null}
        renderMember={renderMember}
        t={t}
      />,
    )
    expect(view.getByText('正在处理')).toBeTruthy()
    expect(view.getByText('12秒 · 1 步')).toBeTruthy()
    expect(view.getByText('运行中')).toBeTruthy()
    act(() => {
      // advanceTimersByTime also moves the mocked system clock, so the tick
      // samples 61s.
      vi.advanceTimersByTime(1_000)
    })
    expect(view.getByText('13秒 · 1 步')).toBeTruthy()
  })

  it('drops the duration figure without usable times and the steps without tool calls', () => {
    const view = render(
      <ActivityFold
        members={['a1']}
        running={false}
        toolCalls={0}
        startTime={null}
        endTime={null}
        renderMember={renderMember}
        t={t}
      />,
    )
    expect(view.getByText('已处理')).toBeTruthy()
    expect(view.container.textContent).toBe('已处理')
  })

  it('omits sub-second durations', () => {
    const view = render(
      <ActivityFold
        members={['c1']}
        running={false}
        toolCalls={1}
        startTime={1_000}
        endTime={1_400}
        renderMember={renderMember}
        t={t}
      />,
    )
    expect(view.getByText('1 步')).toBeTruthy()
  })
})
