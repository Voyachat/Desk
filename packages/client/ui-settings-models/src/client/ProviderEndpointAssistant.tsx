/** Local reviewed-endpoint suggestions without credential or network access. */

import type { ReactNode } from 'react'
import { adoptEndpoint, protocolLabel, recipeCandidates } from './providerAutomation.ts'
import type { ProviderEndpointDraft, ProviderRecipe } from './providerAutomation.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ProviderEndpointAssistant}. */
export interface ProviderEndpointAssistantProps {
  /** Reviewed provider whose endpoints may be tried. */
  recipe: ProviderRecipe
  /** Current protocol endpoints, including deployment-specific hosts. */
  endpoints: readonly ProviderEndpointDraft[]
  /** Replace the endpoint list after a candidate succeeds. */
  onChange: (endpoints: ProviderEndpointDraft[]) => void
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable network actions. */
  disabled: boolean
}

/** Render local reviewed endpoint suggestions for one known provider. */
export function ProviderEndpointAssistant(props: ProviderEndpointAssistantProps): ReactNode {
  const protocols = [...new Set(props.recipe.candidates.map(candidate => candidate.api))]
  return (
    <div className={styles['automationAdvice']}>
      <div>
        {protocols.map(protocol => (
          <button
            type="button"
            className={styles['linkButton']}
            key={protocol}
            disabled={props.disabled}
            onClick={() => {
              const candidate = recipeCandidates(props.recipe, protocol, props.endpoints)[0]
              if (candidate !== undefined) props.onChange(adoptEndpoint(props.endpoints, candidate))
            }}
          >
            {props.t('repairConfiguration')} · {protocolLabel(protocol)}
          </button>
        ))}
      </div>
    </div>
  )
}
