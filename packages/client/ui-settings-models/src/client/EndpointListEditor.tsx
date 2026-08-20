/** Editor for the primary and alternative protocol endpoints sharing one API key. */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import type { ProviderEndpointDraft } from './providerAutomation.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link EndpointListEditor}. */
export interface EndpointListEditorProps {
  /** Primary endpoint first, followed by alternative protocol endpoints. */
  endpoints: readonly ProviderEndpointDraft[]
  /** Replace the endpoint list. */
  onChange: (endpoints: ProviderEndpointDraft[]) => void
  /** Protocol choices from the adapter's own schema. */
  protocols: readonly string[]
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable editing. */
  disabled: boolean
}

/** Render one shared-key endpoint list. */
export function EndpointListEditor(props: EndpointListEditorProps): ReactNode {
  const { endpoints, protocols, t, disabled } = props
  const patch = (index: number, next: Partial<ProviderEndpointDraft>): void => {
    props.onChange(endpoints.map((endpoint, at) => at === index ? { ...endpoint, ...next } : endpoint))
  }
  return (
    <section className={styles['endpointList']} aria-label={t('requestConfigurations')}>
      <div className={styles['endpointHeading']}>
        <div>
          <span className={styles['fieldLabel']}>{t('requestConfigurations')}</span>
          <p className={styles['advancedHint']}>{t('requestConfigurationsHint')}</p>
        </div>
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || endpoints.length >= protocols.length}
          onClick={() => {
            const used = new Set(endpoints.map(endpoint => endpoint.api))
            const api = protocols.find(protocol => !used.has(protocol)) ?? protocols[0] ?? ''
            props.onChange([...endpoints, { api, baseURL: '' }])
          }}
        >
          {t('addRequestConfiguration')}
        </button>
      </div>
      {endpoints.map((endpoint, index) => (
        <div className={styles['endpointEntry']} key={index}>
          <div className={styles['endpointEntryHeading']}>
            <span className={styles['endpointRole']}>
              {index === 0 ? t('primaryRequestConfiguration') : t('alternateRequestConfiguration')}
            </span>
            {index === 0
              ? null
              : (
                <button
                  type="button"
                  className={styles['linkButton']}
                  disabled={disabled}
                  aria-label={`${t('removeRequestConfiguration')} ${String(index + 1)}`}
                  onClick={() => { props.onChange(endpoints.filter((_endpoint, at) => at !== index)) }}
                >
                  {t('remove')}
                </button>
              )}
          </div>
          <div className={styles['endpointFields']}>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
              <input
                className={styles['input']}
                type="text"
                value={endpoint.baseURL}
                placeholder="https://gateway.example/v1"
                aria-label={index === 0 ? t('baseUrl') : `${t('baseUrl')} ${String(index + 1)}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { baseURL: event.target.value }) }}
              />
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('customApi')}</span>
              <select
                className={`${styles['input']} ${styles['selectInput']}`}
                value={endpoint.api}
                aria-label={index === 0 ? t('customApi') : `${t('customApi')} ${String(index + 1)}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { api: event.target.value }) }}
              >
                {protocols.map(protocol => <option value={protocol} key={protocol}>{protocol}</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
    </section>
  )
}
