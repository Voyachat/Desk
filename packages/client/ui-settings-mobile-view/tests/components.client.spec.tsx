// @vitest-environment jsdom
/** User-visible remote-view Settings behavior. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteViewSectionProps } from '../src/client/RemoteViewSection.tsx'
import { RemoteViewSection } from '../src/client/RemoteViewSection.tsx'
import type { MobileViewSettingsState } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const ready: MobileViewSettingsState = {
  status: 'ready',
  error: null,
  writable: true,
  enabled: true,
  port: 3081,
  listener: {
    requested: true,
    listening: true,
    port: 3081,
    urls: ['http://192.168.1.8:3081/mobile-view'],
  },
  credential: { configured: true, writable: true },
  visibleToken: 'new-token',
  busy: false,
}

function props(state: MobileViewSettingsState, overrides: Partial<RemoteViewSectionProps> = {}): RemoteViewSectionProps {
  return {
    close: vi.fn(),
    useSessions: vi.fn() as never,
    useWorkspaces: vi.fn() as never,
    useMobileView: ((selector: (value: MobileViewSettingsState) => unknown) => selector(state)) as never,
    t: key => (zh as Record<string, string>)[key] ?? key,
    load: vi.fn(() => Promise.resolve()),
    enable: vi.fn(() => Promise.resolve()),
    disable: vi.fn(() => Promise.resolve()),
    setPort: vi.fn(() => Promise.resolve()),
    regenerateToken: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

describe('RemoteViewSection', () => {
  it('shows the phone address and new token and copies both values', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<RemoteViewSection {...props(ready)} />)

    expect(screen.getByText('http://192.168.1.8:3081/mobile-view')).toBeTruthy()
    expect(screen.getByText('new-token')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.copyAddress }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('http://192.168.1.8:3081/mobile-view') })
    fireEvent.click(screen.getByRole('button', { name: zh.copyToken }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('new-token') })
  })

  it('still offers Disable when a requested listener failed to start', () => {
    const disable = vi.fn(() => Promise.resolve())
    const failed: MobileViewSettingsState = {
      ...ready,
      listener: {
        requested: true,
        listening: false,
        port: 3081,
        urls: [],
        error: 'port-unavailable',
      },
      visibleToken: null,
    }
    render(<RemoteViewSection {...props(failed, { disable })} />)
    expect(screen.getByRole('alert').textContent).toContain(zh.errorPort)
    fireEvent.click(screen.getByRole('button', { name: zh.disable }))
    expect(disable).toHaveBeenCalledTimes(1)
  })
})
