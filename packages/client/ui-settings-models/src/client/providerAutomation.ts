/** Provider configuration recipes used by the Models setup and repair flow. */

/** One protocol endpoint authenticated by a provider route's shared key. */
export interface ProviderEndpointDraft {
  /** Wire protocol identifier. */
  api: string
  /** Provider endpoint prefix. */
  baseURL: string
}

/** One reviewed provider recipe. */
export interface ProviderRecipe {
  /** Stable internal route id used when this recipe creates a provider. */
  id: string
  /** Human-readable provider name. */
  displayName: string
  /** Recommended primary endpoint followed by optional alternative-runtime endpoints. */
  endpoints: readonly ProviderEndpointDraft[]
  /** Reviewed endpoints to try for each exact request protocol. */
  candidates: readonly ProviderEndpointDraft[]
}

/** How confidently a recipe was selected. */
export type ProviderAdvice =
  | { kind: 'recipe'; source: 'key' | 'name' | 'endpoint'; recipe: ProviderRecipe }
  | { kind: 'ambiguous-key' }
  | { kind: 'unknown' }

const RECIPES = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    endpoints: [
      { api: 'openai-responses', baseURL: 'https://api.openai.com/v1' },
      { api: 'openai-completions', baseURL: 'https://api.openai.com/v1' },
    ],
    candidates: [
      { api: 'openai-responses', baseURL: 'https://api.openai.com/v1' },
      { api: 'openai-completions', baseURL: 'https://api.openai.com/v1' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    endpoints: [{ api: 'anthropic-messages', baseURL: 'https://api.anthropic.com' }],
    candidates: [{ api: 'anthropic-messages', baseURL: 'https://api.anthropic.com' }],
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    endpoints: [
      { api: 'openai-completions', baseURL: 'https://openrouter.ai/api/v1' },
      { api: 'openai-responses', baseURL: 'https://openrouter.ai/api/v1' },
      { api: 'anthropic-messages', baseURL: 'https://openrouter.ai/api' },
    ],
    candidates: [
      { api: 'openai-completions', baseURL: 'https://openrouter.ai/api/v1' },
      { api: 'openai-responses', baseURL: 'https://openrouter.ai/api/v1' },
      { api: 'anthropic-messages', baseURL: 'https://openrouter.ai/api' },
    ],
  },
  dashscope: {
    id: 'dashscope',
    displayName: 'DashScope',
    endpoints: [
      { api: 'openai-completions', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-responses', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { api: 'anthropic-messages', baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic' },
    ],
    candidates: [
      { api: 'openai-completions', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-completions', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-completions', baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-responses', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-responses', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
      { api: 'openai-responses', baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
      { api: 'anthropic-messages', baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic' },
      { api: 'anthropic-messages', baseURL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic' },
      { api: 'anthropic-messages', baseURL: 'https://dashscope-us.aliyuncs.com/apps/anthropic' },
    ],
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    endpoints: [{ api: 'openai-completions', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' }],
    candidates: [{ api: 'openai-completions', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai' }],
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    endpoints: [
      { api: 'openai-completions', baseURL: 'https://api.deepseek.com' },
      { api: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic' },
    ],
    candidates: [
      { api: 'openai-completions', baseURL: 'https://api.deepseek.com' },
      { api: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic' },
    ],
  },
  zhipu: {
    id: 'zhipu',
    displayName: 'Zhipu GLM',
    endpoints: [{ api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4' }],
    candidates: [{ api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4' }],
  },
} as const satisfies Record<string, ProviderRecipe>

/**
 * Copy recipe endpoint values before placing them in React state.
 * @param recipe - reviewed provider recipe.
 * @returns detached endpoint drafts.
 */
export function recipeEndpoints(recipe: ProviderRecipe): ProviderEndpointDraft[] {
  return recipe.endpoints.map(endpoint => ({ ...endpoint }))
}

/**
 * Select a reviewed recipe without sending or retaining the key.
 * @param apiKey - write-only key draft inspected locally.
 * @param displayName - user-entered provider label.
 * @param endpoints - current endpoint drafts.
 * @returns matching recipe advice or an unresolved classification.
 */
export function providerAdvice(
  apiKey: string,
  displayName: string,
  endpoints: readonly ProviderEndpointDraft[] = [],
): ProviderAdvice {
  const key = apiKey.trim()
  if (key.startsWith('sk-ant-')) return { kind: 'recipe', source: 'key', recipe: RECIPES.anthropic }
  if (key.startsWith('sk-proj-') || key.startsWith('sk-svcacct-')) {
    return { kind: 'recipe', source: 'key', recipe: RECIPES.openai }
  }
  if (key.startsWith('sk-or-v1-')) return { kind: 'recipe', source: 'key', recipe: RECIPES.openrouter }
  if (key.startsWith('AIza')) return { kind: 'recipe', source: 'key', recipe: RECIPES.gemini }

  const name = displayName.trim().toLocaleLowerCase()
  if (/dashscope|阿里|通义|百炼/u.test(name)) {
    return { kind: 'recipe', source: 'name', recipe: RECIPES.dashscope }
  }
  if (/openrouter/u.test(name)) return { kind: 'recipe', source: 'name', recipe: RECIPES.openrouter }
  if (/gemini|google ai|谷歌/u.test(name)) return { kind: 'recipe', source: 'name', recipe: RECIPES.gemini }
  if (/deepseek|深度求索/u.test(name)) return { kind: 'recipe', source: 'name', recipe: RECIPES.deepseek }
  if (/zhipu|bigmodel|智谱|glm/u.test(name)) return { kind: 'recipe', source: 'name', recipe: RECIPES.zhipu }
  if (/anthropic|claude|克劳德/u.test(name)) {
    return { kind: 'recipe', source: 'name', recipe: RECIPES.anthropic }
  }
  if (/openai/u.test(name)) return { kind: 'recipe', source: 'name', recipe: RECIPES.openai }
  const joined = endpoints.map(endpoint => endpoint.baseURL.toLocaleLowerCase()).join('\n')
  if (/dashscope|\.maas\.aliyuncs\.com/u.test(joined)) {
    return { kind: 'recipe', source: 'endpoint', recipe: RECIPES.dashscope }
  }
  if (/generativelanguage\.googleapis\.com/u.test(joined)) {
    return { kind: 'recipe', source: 'endpoint', recipe: RECIPES.gemini }
  }
  if (/api\.deepseek\.com/u.test(joined)) return { kind: 'recipe', source: 'endpoint', recipe: RECIPES.deepseek }
  if (/openrouter\.ai/u.test(joined)) return { kind: 'recipe', source: 'endpoint', recipe: RECIPES.openrouter }
  if (/open\.bigmodel\.cn/u.test(joined)) return { kind: 'recipe', source: 'endpoint', recipe: RECIPES.zhipu }
  if (key.startsWith('sk-')) return { kind: 'ambiguous-key' }
  return { kind: 'unknown' }
}

/**
 * Candidate endpoint labels shown by the protocol-specific automation controls.
 * @param api - provider wire protocol identifier.
 * @returns concise user-facing label.
 */
export function protocolLabel(api: string): string {
  if (api === 'openai-completions') return 'OpenAI Chat'
  if (api === 'openai-responses') return 'OpenAI Responses'
  if (api === 'anthropic-messages') return 'Anthropic'
  return api
}

/**
 * Candidate URLs for one exact protocol, preserving a user's deployment host
 * ahead of public regional endpoints when its sibling protocol reveals the
 * required path transformation.
 * @param recipe - reviewed provider recipe.
 * @param api - protocol whose endpoint is requested.
 * @param current - current endpoint drafts.
 * @returns ordered, deduplicated endpoint candidates.
 */
export function recipeCandidates(
  recipe: ProviderRecipe,
  api: string,
  current: readonly ProviderEndpointDraft[],
): ProviderEndpointDraft[] {
  const candidates: ProviderEndpointDraft[] = []
  const add = (baseURL: string): void => {
    const trimmed = baseURL.trim().replace(/\/+$/u, '')
    if (trimmed.length === 0 || candidates.some(candidate => candidate.baseURL === trimmed)) return
    candidates.push({ api, baseURL: trimmed })
  }
  for (const endpoint of current) {
    if (endpoint.api === api) add(endpoint.baseURL)
    const base = endpoint.baseURL.trim().replace(/\/+$/u, '')
    if (recipe.id === 'dashscope') {
      if (api === 'anthropic-messages' && base.endsWith('/compatible-mode/v1')) {
        add(base.slice(0, -'/compatible-mode/v1'.length) + '/apps/anthropic')
      } else if ((api === 'openai-completions' || api === 'openai-responses') && base.endsWith('/apps/anthropic')) {
        add(base.slice(0, -'/apps/anthropic'.length) + '/compatible-mode/v1')
      }
    }
    if (recipe.id === 'openrouter') {
      if (api === 'anthropic-messages' && base.endsWith('/api/v1')) add(base.slice(0, -3))
      if (api !== 'anthropic-messages' && base.endsWith('/api')) add(`${base}/v1`)
    }
    if (recipe.id === 'deepseek') {
      if (api === 'anthropic-messages' && !base.endsWith('/anthropic')) add(`${base}/anthropic`)
      if (api !== 'anthropic-messages' && base.endsWith('/anthropic')) add(base.slice(0, -'/anthropic'.length))
    }
  }
  for (const candidate of recipe.candidates) {
    if (candidate.api === api) add(candidate.baseURL)
  }
  return candidates
}

/**
 * Replace or add one verified protocol endpoint without disturbing siblings.
 * @param endpoints - current endpoint drafts.
 * @param adopted - endpoint selected by the user.
 * @returns detached endpoint drafts with the selection applied.
 */
export function adoptEndpoint(
  endpoints: readonly ProviderEndpointDraft[],
  adopted: ProviderEndpointDraft,
): ProviderEndpointDraft[] {
  const existing = endpoints.findIndex(endpoint => endpoint.api === adopted.api)
  if (existing >= 0) return endpoints.map((endpoint, index) => index === existing ? { ...adopted } : { ...endpoint })
  const empty = endpoints.findIndex(endpoint => endpoint.baseURL.trim().length === 0)
  if (empty >= 0) return endpoints.map((endpoint, index) => index === empty ? { ...adopted } : { ...endpoint })
  return [...endpoints.map(endpoint => ({ ...endpoint })), { ...adopted }]
}

/**
 * Whether the current endpoint list already equals a recipe.
 * @param endpoints - current endpoint drafts.
 * @param recipe - reviewed provider recipe.
 * @returns whether both ordered endpoint lists match.
 */
export function followsRecipe(
  endpoints: readonly ProviderEndpointDraft[],
  recipe: ProviderRecipe,
): boolean {
  return JSON.stringify(endpoints) === JSON.stringify(recipe.endpoints)
}

/**
 * Generate an internal route id and avoid every route already in use.
 * @param displayName - user-entered provider label.
 * @param taken - route ids already in use.
 * @param recipe - optional reviewed provider recipe.
 * @returns unused normalized route id.
 */
export function deriveProviderId(
  displayName: string,
  taken: readonly string[],
  recipe?: ProviderRecipe,
): string {
  const normalized = displayName.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase()
  const spelling = normalized.replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  const stem = recipe?.id ?? (spelling.length === 0 ? 'custom-provider' : /^[a-z]/u.test(spelling) ? spelling : `provider-${spelling}`)
  const occupied = new Set(taken)
  if (!occupied.has(stem)) return stem
  let suffix = 2
  while (occupied.has(`${stem}-${String(suffix)}`)) suffix += 1
  return `${stem}-${String(suffix)}`
}

/**
 * Validate the endpoint list before it reaches the settings schema.
 * @param endpoints - endpoint drafts to validate.
 * @returns stable failure reason, or undefined for a valid list.
 */
export function endpointFailure(endpoints: readonly ProviderEndpointDraft[]): 'missing' | 'duplicate' | undefined {
  const seen = new Set<string>()
  for (const endpoint of endpoints) {
    if (endpoint.api.length === 0 || endpoint.baseURL.trim().length === 0) return 'missing'
    if (seen.has(endpoint.api)) return 'duplicate'
    seen.add(endpoint.api)
  }
  return endpoints.length === 0 ? 'missing' : undefined
}
