import { useEffect, useSyncExternalStore } from 'react'
import type { ClientPort } from '../client/client-port.ts'
import type { SessionSummary } from '../domain/client-state.ts'
import { AppFrame } from '../features/shell/AppFrame.tsx'
import { Sidebar } from '../features/sidebar/Sidebar.tsx'
import { Conversation } from '../features/conversation/Conversation.tsx'
import { DetailsPanel } from '../features/details/DetailsPanel.tsx'
import { SettingsDialog } from '../features/settings/SettingsDialog.tsx'
import css from './AiDesktopApp.module.css'

export function AiDesktopApp({ client }: { client: ClientPort }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  const dispatch = client.dispatch
  const session: SessionSummary | undefined = state.sessions.find(candidate => candidate.id === state.activeSessionId)

  useEffect(() => {
    if (state.toast === null) return
    const timer = window.setTimeout(() => { dispatch({ type: 'toast.clear' }) }, 2400)
    return () => { window.clearTimeout(timer) }
  }, [dispatch, state.toast])

  return (
    <div className={css.app} onClick={(event) => {
      if (state.menu !== null && !(event.target as Element).closest('[data-menu-root]')) dispatch({ type: 'menu.close' })
    }}>
      <AppFrame
        collapsed={state.sidebarCollapsed}
        detailsOpen={state.details !== null}
        sidebar={
          <Sidebar
            collapsed={state.sidebarCollapsed}
            workspaces={state.workspaces}
            sessions={state.sessions}
            activeSessionId={state.activeSessionId}
            openMenu={state.menu}
            onNewSession={() => { dispatch({ type: 'session.new' }) }}
            onOpenSession={(sessionId) => { dispatch({ type: 'session.open', sessionId }) }}
            onToggle={() => { dispatch({ type: 'sidebar.toggle' }) }}
            onToggleMenu={(menu) => { dispatch({ type: 'menu.toggle', menu }) }}
            onOpenSettings={() => { dispatch({ type: 'settings.open' }) }}
          />
        }
        center={
          <Conversation
            state={state}
            session={session}
            dispatch={dispatch}
          />
        }
        details={state.details === null ? null : (
          <DetailsPanel details={state.details} onClose={() => { dispatch({ type: 'details.close' }) }} />
        )}
      />
      {state.settingsOpen && (
        <SettingsDialog
          section={state.settingsSection}
          onSection={(section) => { dispatch({ type: 'settings.section', section }) }}
          onClose={() => { dispatch({ type: 'settings.close' }) }}
          onReset={() => { dispatch({ type: 'demo.reset' }) }}
        />
      )}
      {state.toast !== null && <div className={css.toast} role="status">{state.toast}</div>}
    </div>
  )
}
