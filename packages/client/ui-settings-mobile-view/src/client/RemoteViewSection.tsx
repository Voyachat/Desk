/** Remote-view settings section. */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@voyaseek-ai/dsh-client-ui-slots'
import type { MobileViewKey } from './locales.ts'
import type { MobileViewSettingsState } from './store.ts'
import css from './RemoteViewSection.module.css'

/** Registration-side state and actions for the remote-view page. */
export interface RemoteViewSectionInjected {
  hooks: {
    /** Host settings, credential metadata, and listener state. */
    mobileView: SnapshotStore<MobileViewSettingsState>
  }
  load: () => Promise<void>
  enable: () => Promise<void>
  disable: () => Promise<void>
  setPort: (port: number) => Promise<void>
  regenerateToken: () => Promise<void>
}

/** Props bound by the Settings slot renderer. */
export type RemoteViewSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mobile-view'>
  & InjectFace<RemoteViewSectionInjected>

function listenerError(state: MobileViewSettingsState, t: (key: MobileViewKey) => string): string | null {
  if (state.listener.error === 'token-missing') return t('errorToken')
  if (state.listener.error === 'port-unavailable') return t('errorPort')
  if (state.listener.error === 'listener-failed') return t('errorListener')
  return null
}

/** Render the loopback-only remote-view controls and live listener result. */
export function RemoteViewSection(props: RemoteViewSectionProps) {
  const { load, enable, disable, setPort: savePort, regenerateToken, t } = props
  const state = props.useMobileView(snapshot => snapshot)
  const [port, setPort] = useState(String(state.port))
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPort(String(state.port)) }, [state.port])

  const copy = async (kind: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setCopyFailed(false)
    } catch {
      setCopied(null)
      setCopyFailed(true)
    }
  }

  if (state.status === 'idle' || (state.status === 'loading' && state.listener.urls.length === 0)) {
    return <div className={css.state}>{t('starting')}</div>
  }
  if (state.status === 'unavailable') {
    return <div className={css.state}>{t('unavailable')}</div>
  }

  const runtimeError = listenerError(state, t)
  const listening = state.enabled && state.listener.listening
  return (
    <section className={css.section}>
      <header>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      <div className={css.card}>
        <div>
          <strong>{listening ? t('enabled') : state.enabled ? t('starting') : t('disabled')}</strong>
          {state.busy && <span className={css.muted}>{t('starting')}</span>}
        </div>
        <button
          type="button"
          className={state.enabled ? css.secondary : css.primary}
          disabled={!state.writable || state.busy}
          onClick={() => { void (state.enabled ? disable() : enable()) }}
        >
          {state.enabled ? t('disable') : t('enable')}
        </button>
      </div>

      {(state.error !== null || runtimeError !== null) && (
        <div className={css.error} role="alert">
          {runtimeError ?? state.error}
          <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
        </div>
      )}

      {copyFailed && <div className={css.error} role="alert">{t('copyFailed')}</div>}

      <div className={css.group}>
        <label htmlFor="mobile-view-port">{t('port')}</label>
        <div className={css.inline}>
          <input
            id="mobile-view-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            disabled={!state.writable || state.busy}
            onChange={(event) => { setPort(event.target.value) }}
          />
          <button
            type="button"
            className={css.secondary}
            disabled={!state.writable || state.busy || Number(port) === state.port}
            onClick={() => { void savePort(Number(port)) }}
          >
            {t('savePort')}
          </button>
        </div>
      </div>

      <div className={css.group}>
        <h3>{t('addresses')}</h3>
        {state.listener.urls.length === 0
          ? <p className={css.muted}>{t('noAddress')}</p>
          : state.listener.urls.map((url, index) => (
              <div className={css.copyRow} key={url}>
                <code>{url}</code>
                <button type="button" onClick={() => { void copy(`url-${String(index)}`, url) }}>
                  {copied === `url-${String(index)}` ? t('copied') : t('copyAddress')}
                </button>
              </div>
            ))}
      </div>

      <div className={css.group}>
        <h3>{t('token')}</h3>
        {state.visibleToken !== null ? (
          <>
            <p className={css.warning}>{t('tokenNew')}</p>
            <div className={css.copyRow}>
              <code className={css.token}>{state.visibleToken}</code>
              <button type="button" onClick={() => { void copy('token', state.visibleToken ?? '') }}>
                {copied === 'token' ? t('copied') : t('copyToken')}
              </button>
            </div>
          </>
        ) : (
          <p className={css.muted}>{state.credential?.configured === true ? t('tokenStored') : t('tokenMissing')}</p>
        )}
        <button
          type="button"
          className={css.secondary}
          disabled={state.credential?.writable !== true || state.busy}
          onClick={() => { void regenerateToken() }}
        >
          {t('regenerate')}
        </button>
      </div>

      <p className={css.security}>{t('security')}</p>
    </section>
  )
}
