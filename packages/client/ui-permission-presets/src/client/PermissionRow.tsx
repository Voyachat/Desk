/**
 * Permission defaults for future sessions: one global value plus an optional
 * override for the currently selected project. Current-session switches stay
 * on the composer `/permission` control.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu, RiskConfirmation } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { PermissionDefaultOption, PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { FULL_ACCESS_PRESET, permissionPresetPresentation } from './presentation.ts'
import css from './PermissionRow.module.css'

const INHERIT_GLOBAL = '__inherit-global__'

interface PendingFullAccess {
  scope: 'global' | 'project'
  path?: string
}

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: { permission: SnapshotStore<PermissionSettingsState> }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist the global default. */
  select: (preset: string) => Promise<void>
  /** Persist or clear one project override. */
  selectWorkspace: (path: string, preset: string | undefined) => Promise<void>
}

/** Full component props. */
export type PermissionRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/** Render one two-line permission option. */
function optionNode(option: PermissionDefaultOption, t: PermissionRowProps['t']): ReactNode {
  const display = permissionPresetPresentation(
    option.id, option.name, option.description, key => t(key as PermissionSettingsKey),
  )
  return (
    <span className={option.id === FULL_ACCESS_PRESET ? css.optionWarning : css.option}>
      <span className={css.optionTitle}>{display.label}</span>
      {display.description !== undefined && <span className={css.optionDescription}>{display.description}</span>}
    </span>
  )
}

/** Resolve a localized option label for a trigger or inherited-mode sentence. */
function optionLabel(option: PermissionDefaultOption | undefined, t: PermissionRowProps['t']): string | undefined {
  if (option === undefined) return undefined
  return permissionPresetPresentation(
    option.id, option.name, option.description, key => t(key as PermissionSettingsKey),
  ).label
}

/**
 * Render global and current-project defaults for sessions created later.
 * @param props - composed slot props.
 * @returns the settings block, or null when the host does not expose permission settings.
 */
export function PermissionRow({
  load, select, selectWorkspace, usePermission, useSessions, useWorkspaces, t,
}: PermissionRowProps) {
  const state = usePermission(snapshot => snapshot)
  const sessions = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const [open, setOpen] = useState<'global' | 'project' | null>(null)
  const [pendingFullAccess, setPendingFullAccess] = useState<PendingFullAccess | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(null)
    setAcknowledged(false)
    setPendingFullAccess(null)
  }, [state.status, state.writable])

  if (state.status === 'unavailable') return null
  const currentSession = sessions.current
  const currentWorkspaceId = currentSession === undefined
    ? workspaces.recentWorkspaceId
    : workspaces.items.find(item => item.sessionIds.includes(currentSession))?.workspaceId
  const project = workspaces.items.find(item => item.workspaceId === currentWorkspaceId)
  const globalOption = state.options.find(option => option.id === state.currentValue)
  const projectValue = project === undefined ? undefined : state.workspaceValues[project.path]
  const projectOption = state.options.find(option => option.id === projectValue)
  const busy = state.status === 'loading' || state.status === 'saving' || pendingFullAccess !== null
  const globalLabel = optionLabel(globalOption, t) ?? (busy ? t('loading') : t('unavailable'))
  const inheritedLabel = t('project.inherit', { mode: globalLabel })
  const projectLabel = optionLabel(projectOption, t) ?? inheritedLabel
  const description: string = state.error ?? t('description')
  const items = state.options.map(option => ({ id: option.id, label: optionNode(option, t) }))

  const chooseGlobal = (id: string): void => {
    setOpen(null)
    if (id === state.currentValue) return
    if (id === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setPendingFullAccess({ scope: 'global' })
      return
    }
    void select(id)
  }

  const chooseProject = (id: string): void => {
    setOpen(null)
    if (project === undefined) return
    if (id === INHERIT_GLOBAL) {
      if (projectValue !== undefined) void selectWorkspace(project.path, undefined)
      return
    }
    if (id === projectValue) return
    if (id === FULL_ACCESS_PRESET) {
      setAcknowledged(false)
      setPendingFullAccess({ scope: 'project', path: project.path })
      return
    }
    void selectWorkspace(project.path, id)
  }

  const closeConfirmation = (): void => {
    setAcknowledged(false)
    setPendingFullAccess(null)
  }

  return (
    <>
      <div className={css.row}>
        <div className={css.header}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
        </div>
        <div className={css.preference}>
          <div className={css.rowText}>
            <div className={css.preferenceTitle}>{t('global.title')}</div>
            <div className={css.desc}>{t('global.description')}</div>
          </div>
          <Menu
            open={open === 'global'}
            onClose={() => { setOpen(null) }}
            items={items}
            selectedId={state.currentValue}
            onSelect={chooseGlobal}
            align="end"
            portal
            anchor={(
              <button
                type="button"
                className={css.selector}
                aria-haspopup="menu"
                aria-expanded={open === 'global'}
                disabled={busy || !state.writable || state.options.length === 0}
                onClick={() => { setOpen(value => value === 'global' ? null : 'global') }}
              >
                {globalLabel}<IconChevronDownOutline14 className={css.chevron} />
              </button>
            )}
          />
        </div>
        {project !== undefined && (
          <div className={css.preference}>
            <div className={css.rowText}>
              <div className={css.preferenceTitle}>{t('project.title')}</div>
              <div className={css.desc}>{t('project.description', { name: project.title })}</div>
              <div className={css.path} title={project.path}>{project.path}</div>
            </div>
            <Menu
              open={open === 'project'}
              onClose={() => { setOpen(null) }}
              items={[
                { id: INHERIT_GLOBAL, label: inheritedLabel },
                { type: 'separator', id: 'project-default-separator' },
                ...items,
              ]}
              selectedId={projectValue ?? INHERIT_GLOBAL}
              onSelect={chooseProject}
              align="end"
              portal
              anchor={(
                <button
                  type="button"
                  className={css.selector}
                  aria-haspopup="menu"
                  aria-expanded={open === 'project'}
                  disabled={busy || !state.writable || state.options.length === 0}
                  onClick={() => { setOpen(value => value === 'project' ? null : 'project') }}
                >
                  {projectLabel}<IconChevronDownOutline14 className={css.chevron} />
                </button>
              )}
            />
          </div>
        )}
      </div>
      <RiskConfirmation
        open={pendingFullAccess !== null}
        title={t(pendingFullAccess?.scope === 'project' ? 'confirm.project.title' : 'confirm.global.title')}
        description={t(pendingFullAccess?.scope === 'project' ? 'confirm.project.description' : 'confirm.global.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!state.writable || state.status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={() => {
          const target = pendingFullAccess
          closeConfirmation()
          if (target?.scope === 'project' && target.path !== undefined) {
            void selectWorkspace(target.path, FULL_ACCESS_PRESET)
          } else if (target?.scope === 'global') {
            void select(FULL_ACCESS_PRESET)
          }
        }}
      />
    </>
  )
}

declare module '@voyaseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
