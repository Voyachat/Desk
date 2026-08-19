// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@voyaseek-ai/dsh-client-web-react'
import type { SettingsNamespaceView } from '@voyaseek-ai/dsh-api-remotes/client'
import { PermissionRow, type PermissionRowProps } from '../src/client/PermissionRow.tsx'
import { en, zh } from '../src/client/locales.ts'
import { PermissionPresetSettingsController } from '../src/client/settings-store.ts'

afterEach(cleanup)

const SCHEMA = {
  uid: 5,
  refs: {
    1: { type: 'const', value: 'read-only' },
    2: { type: 'const', value: 'workspace-write' },
    3: { type: 'const', value: 'danger-full-access' },
    4: { type: 'union', list: [1, 2, 3] },
    5: { type: 'object', dict: { defaultPreset: 4 } },
  },
}

function view(defaultPreset: string, revision = 0, workspacePresets: Record<string, string> = {}): SettingsNamespaceView {
  return {
    ns: 'permission',
    schema: SCHEMA,
    value: { defaultPreset, workspacePresets },
    base: { defaultPreset: 'read-only', workspacePresets: {} },
    applies: 'live',
    secrets: [],
    revision,
  }
}

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

const dictionary: Record<string, string> = en
const t: PermissionRowProps['t'] = (key, params) => {
  let value = dictionary[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
}
const runtime = {
  useSessions: ((select: (state: unknown) => unknown) => select({ current: undefined })) as never,
  useWorkspaces: ((select: (state: unknown) => unknown) => select({ items: [], recentWorkspaceId: undefined })) as never,
}

function mount(controller: PermissionPresetSettingsController, runtimeProps = runtime, translate = t) {
  return render(
    <PermissionRow
      {...runtimeProps}
      load={() => controller.load()}
      select={preset => controller.select(preset)}
      selectWorkspace={(path, preset) => controller.selectWorkspace(path, preset)}
      usePermission={bindSnapshotSelector(controller.store)}
      t={translate}
    />,
  )
}

describe('PermissionRow', () => {
  it('renders built-in presets from the active locale instead of Host English', async () => {
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('workspace-write')] })),
        mutate: vi.fn(),
      } as never,
    })
    const zhDictionary: Record<string, string> = zh
    const zhT = ((key: string) => zhDictionary[key] ?? key) as PermissionRowProps['t']
    mount(controller, runtime, zhT)
    expect(await screen.findByRole('button', { name: '帮我批准' })).toBeTruthy()
  })

  it('loads the descriptor, opens the menu, and selects a new default', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('workspace-write', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    mount(controller)
    const button = await screen.findByRole('button', { name: 'Ask for approval' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(button.getAttribute('aria-expanded')).toBe('false') })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: /Ask for approval/ }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent approval/ }))
    await screen.findByRole('button', { name: 'Agent approval' })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('sets and clears the current project override without changing the global default', async () => {
    const projectPath = '/workspace/project'
    const mutate = vi.fn((request: { ops: Array<{ op: string; path: string[]; value?: unknown }> }) => {
      const setting = request.ops[0]
      const workspacePresets = setting?.op === 'set' ? { [projectPath]: String(setting.value) } : {}
      return Promise.resolve(ok(view('read-only', mutate.mock.calls.length, workspacePresets)))
    })
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    const projectRuntime = {
      useSessions: ((select: (state: unknown) => unknown) => select({ current: 'session-1' })) as never,
      useWorkspaces: ((select: (state: unknown) => unknown) => select({
        recentWorkspaceId: 'workspace-1',
        items: [{ workspaceId: 'workspace-1', path: projectPath, title: 'Project', sessionIds: ['session-1'] }],
      })) as never,
    }
    mount(controller, projectRuntime)
    fireEvent.click(await screen.findByRole('button', { name: 'Use global default (Ask for approval)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent approval/ }))
    await screen.findByRole('button', { name: 'Agent approval' })
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ops: [{ op: 'set', path: ['workspacePresets', projectPath], value: 'workspace-write' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agent approval' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use global default (Ask for approval)' }))
    await screen.findByRole('button', { name: 'Use global default (Ask for approval)' })
    expect(mutate.mock.calls[1]?.[0]).toMatchObject({
      ops: [{ op: 'unset', path: ['workspacePresets', projectPath] }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Use global default (Ask for approval)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Full access/ }))
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog', { name: 'Make Full access this project’s default?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Full access' }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(3) })
    expect(mutate.mock.calls[2]?.[0]).toMatchObject({
      ops: [{ op: 'set', path: ['workspacePresets', projectPath], value: 'danger-full-access' }],
    })
  })

  it('requires explicit acknowledgement before saving Full access', async () => {
    const mutate = vi.fn(() => Promise.resolve(ok(view('danger-full-access', 1))))
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] })),
        mutate,
      } as never,
    })
    mount(controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for approval' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Full access/ }))
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Make Full access the global default?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask for approval' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Full access/ }))
    const dialog = screen.getByRole('dialog', { name: 'Make Full access the global default?' })
    const enable = screen.getByRole('button', { name: 'Enable Full access' })
    expect((enable as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enable)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(dialog.isConnected).toBe(false)
  })

  it('hides an unavailable namespace and disables a read-only provider', async () => {
    const absent = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] })),
        mutate: vi.fn(),
      } as never,
    })
    const rendered = mount(absent)
    await waitFor(() => { expect(rendered.container.textContent).toBe('') })
    rendered.unmount()

    const readonly = new PermissionPresetSettingsController({
      settings: {
        describe: () => Promise.resolve(ok({ writable: false, hasDocument: false, namespaces: [view('read-only')] })),
        mutate: vi.fn(),
      } as never,
    })
    mount(readonly)
    expect((await screen.findByRole('button', { name: 'Ask for approval' })).hasAttribute('disabled')).toBe(true)
  })

  it('shows loading and a contained write error', async () => {
    const describe = Promise.withResolvers<ReturnType<typeof ok<{
      writable: boolean
      namespaces: SettingsNamespaceView[]
    }>>>()
    const controller = new PermissionPresetSettingsController({
      settings: {
        describe: () => describe.promise,
        mutate: () => Promise.resolve({
          rpcId: 'test',
          result: {
            ok: false as const,
            error: { code: 'settings-conflict', message: 'changed elsewhere', details: {} },
          },
        }),
      } as never,
    })
    mount(controller)
    expect((await screen.findByRole('button', { name: 'Loading' })).hasAttribute('disabled')).toBe(true)
    describe.resolve(ok({ writable: true, hasDocument: false, namespaces: [view('read-only')] }))
    const button = await screen.findByRole('button', { name: 'Ask for approval' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: /Agent approval/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('changed elsewhere')
  })
})
