/**
 * The card that declares a provider pi-ai does not ship — an OpenAI-compatible
 * gateway, a self-hosted server, or a provider newer than the installed
 * catalog.
 *
 * This is a create, not an edit, which is why it is its own card rather than
 * the provider editor with extra fields. The card generates a unique internal
 * route id from the display name or a known-provider recipe; the user never
 * has to manage that settings address. One `settings.mutate`
 * sets the whole profile at `providers.<route>`; the key travels separately
 * through `credentials.set` under the reference the profile records, exactly as
 * an existing provider's key does.
 *
 * A route may carry multiple protocol endpoints authenticated by one key. The
 * endpoint list and at least one model are required here rather than at load,
 * so a failure names the field while the user is still looking at it.
 *
 * There is deliberately no reasoning-effort control, here or on the editor
 * card: effort is a per-MODEL capability, and the models under one provider
 * disagree about it, so a provider-scoped control can only be set to a value
 * some of them reject. The composer's model picker offers each model its own
 * levels instead.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@voyaseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { EndpointListEditor } from './EndpointListEditor.tsx'
import { validateDeepSeekModels } from './DeepSeekModelsEditor.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf } from './store.ts'
import {
  deriveProviderId, endpointFailure, followsRecipe, providerAdvice, recipeEndpoints,
} from './providerAutomation.ts'
import type { ProviderEndpointDraft, ProviderRecipe } from './providerAutomation.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace a hand-declared provider is written into. */
const NS = 'llm-pi-ai'

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /**
   * Revision of the `llm-pi-ai` user section this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card.
 */
export function CustomProviderCard(props: CustomProviderCardProps): ReactNode {
  const { taken, protocols, api, t } = props
  // Captured at mount, like the editor's: the write must be judged against the
  // section this card was drafted over, not whatever it grew into meanwhile.
  const [openedAt] = useState(() => props.revision)
  const [displayName, setDisplayName] = useState('')
  const [endpoints, setEndpoints] = useState<readonly ProviderEndpointDraft[]>([
    { api: protocols[0] ?? '', baseURL: '' },
  ])
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState<readonly ModelDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * The profile write landed. Only the key write can still be outstanding, so
   * the fields that describe the provider are settled and the retry path is
   * the credential alone.
   */
  const [committed, setCommitted] = useState(false)
  const disabled = props.readOnly || busy
  /** Everything but the key stops being editable once the provider exists. */
  const profileDisabled = disabled || committed

  const advice = providerAdvice(keyDraft, displayName, endpoints)
  const route = deriveProviderId(
    displayName,
    taken,
    advice.kind === 'recipe' ? advice.recipe : undefined,
  )
  // Rows are checked by the same per-row validator the editor cards use, so a
  // bad row is named by its position here too. Capacities have route-level
  // fallbacks; what a route cannot default is at least one model.
  const modelFailure = validateDeepSeekModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  const endpointsFailure = endpointFailure(endpoints)
  // The typed key with paste whitespace removed. A blank field yields an empty
  // string, which the create path reads as "no key supplied" — a route may
  // legitimately authenticate through the provider's own ambient discovery.
  const keyValue = keyDraft.trim()
  const ready = displayName.trim().length > 0
    && endpointsFailure === undefined && models.length > 0 && modelFailure === undefined
    && keyFailure === undefined
  // The one blocked gate worth a line under the form. A satisfied card says
  // nothing at all rather than printing an empty paragraph.
  const hint = failure !== undefined || ready
    // The key field prints its own failure directly beneath itself, so a card
    // blocked only by the key stays silent here rather than answering with the
    // next unmet gate — which is satisfied, and reads as a second, false fault.
    || keyFailure !== undefined
    ? undefined
    : displayName.trim().length === 0
      ? t('customNeedsDisplayName')
      : endpointsFailure === 'missing'
        ? t('customNeedsBaseUrl')
        : endpointsFailure === 'duplicate'
          ? t('requestConfigurationDuplicate')
          : modelFailure !== undefined
            ? `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
            : t('customNeedsModels')

  /** Perform the create, returning a failure message or undefined. */
  const createOnce = async (): Promise<string | undefined> => {
    const keyRef = deriveKeyRef(route)
    const storesKey = keyValue.length > 0
    if (!committed) {
      const primaryEndpoint = endpoints[0]
      if (primaryEndpoint === undefined) return t('customNeedsBaseUrl')
      const profile = {
        displayName: displayName.trim(),
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: primaryEndpoint.api,
        baseURL: primaryEndpoint.baseURL.trim(),
        ...endpoints.length <= 1
          ? {}
          : { alternateEndpoints: endpoints.slice(1).map(endpoint => ({ ...endpoint, baseURL: endpoint.baseURL.trim() })) },
        models: models.map(model => ({ ...model })),
      }
      const response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        // `taken` is a snapshot too, so the id check alone cannot see a route
        // declared after this card opened; the revision makes that race a
        // `settings-conflict` instead of a write over the other profile.
        expectedRevision: openedAt,
      })
      if (!response.result.ok) return response.result.error.message
      // The provider now exists. A retry after the key write below fails must
      // not re-run this mutate: the revision it holds is the one this write
      // just superseded, so the Host would answer `settings-conflict` and the
      // key could never be stored from this card at all.
      setCommitted(true)
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  const applyRecipe = (recipe: ProviderRecipe): void => {
    setDisplayName(current => current.trim().length === 0 ? recipe.displayName : current)
    setEndpoints(recipeEndpoints(recipe))
  }

  const adviceMessage = advice.kind === 'recipe'
    ? (followsRecipe(endpoints, advice.recipe)
      ? t('providerAdviceReady')
      : advice.source === 'key' ? t('providerAdviceKey') : t('providerAdviceName'))
      .replace('{provider}', advice.recipe.displayName)
    : t(advice.kind === 'ambiguous-key' ? 'providerAdviceAmbiguous' : 'providerAdviceUnknown')

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // card would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t('customTitle')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder={t('customDisplayName')}
          aria-label={t('customDisplayName')}
          disabled={profileDisabled}
          onChange={(event) => {
            const next = event.target.value
            setDisplayName(next)
            const nextAdvice = providerAdvice(keyDraft, next, endpoints)
            if (nextAdvice.kind === 'recipe' && endpoints.every(endpoint => endpoint.baseURL.trim().length === 0)) {
              setEndpoints(recipeEndpoints(nextAdvice.recipe))
            }
          }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('keyInput')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={t('keyPlaceholder')}
          aria-label={t('keyInput')}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            setKeyDraft(next)
            const nextAdvice = providerAdvice(next, displayName, endpoints)
            if (nextAdvice.kind === 'recipe' && nextAdvice.source === 'key'
              && endpoints.every(endpoint => endpoint.baseURL.trim().length === 0)) {
              applyRecipe(nextAdvice.recipe)
            }
          }}
        />
        {/* A create card has no stored key to keep, so the blank case says
            what a blank field means here instead: this route may authenticate
            through the provider's own ambient discovery or OAuth. */}
        {keyFailure === undefined
          ? null
          : <p className={styles['error']}>{t(keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure)}</p>}
      </div>
      <div className={styles['automationAdvice']}>
        <p className={styles['advancedHint']}>{adviceMessage}</p>
      </div>
      <EndpointListEditor
        endpoints={endpoints}
        onChange={setEndpoints}
        protocols={protocols}
        t={t}
        disabled={profileDisabled}
      />
      <ModelListEditor
        models={models}
        onChange={setModels}
        probe={{
          settingsNs: NS,
          ...endpoints[0] === undefined
            ? {}
            : { baseURL: endpoints[0].baseURL, api: endpoints[0].api },
          compatibleApis: endpoints.map(endpoint => endpoint.api),
          ...keyValue.length === 0 ? {} : { apiKey: keyValue },
        }}
        probeBlocked={keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}
        api={api}
        t={t}
        disabled={profileDisabled}
      />
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabel="create"
        submitBusyLabel="creating"
        onCancel={() => { props.onClose(committed) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}
