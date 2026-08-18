import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE_BUNDLES = [
  '@voyaseek-ai/dsh-base',
  '@voyaseek-ai/dsh-web-app',
  '@voyaseek-ai/dsh-aistaff-product-bundle',
] as const

const EMPTY_LEGACY_PROFILE_PATCH = '# User overrides for the bundled AI Staff profile.\n[]\n'
const MODEL_ONLY_PROFILE_PATCH = `# AI Staff model defaults. API keys are resolved from the named environment variables.\n- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GEMINI_API_KEY
        models:
          - id: gemini-3.6-flash
      dashscope:
        displayName: DashScope
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen-plus
            name: Qwen Plus

- id: agent-default-model
  config:
    provider: google
    model: gemini-3.6-flash
`
const PRE_IMAGE_FALLBACK_PROFILE_PATCH = `# AI Staff desktop defaults. Elevated operations always require interactive approval.\n- id: approval
  config:
    policy: ask

- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: ask

# API keys are resolved from the named environment variables.\n- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GEMINI_API_KEY
        models:
          - id: gemini-3.6-flash
      dashscope:
        displayName: DashScope
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen-plus
            name: Qwen Plus

- id: agent-default-model
  config:
    provider: google
    model: gemini-3.6-flash
`
const PRE_FULL_ACCESS_NEVER_PROFILE_PATCH = `# Voyaseek desktop defaults. Elevated operations always require interactive approval.\n- id: approval
  config:
    policy: ask

- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: ask

# API keys are resolved from the named environment variables.\n- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GEMINI_API_KEY
        models:
          - id: gemini-3.6-flash
            input: [text, image]
      dashscope:
        displayName: DashScope
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen-plus
            name: Qwen Plus
          - id: qwen3.7-flash
            name: Qwen 3.7 Flash
            input: [text, image]

- id: api-gateway
  config:
    imageFallback:
      provider: dashscope
      model: qwen3.7-flash
      maxTokens: 4096

- id: agent-default-model
  config:
    provider: google
    model: gemini-3.6-flash
`
const PRE_REGIONAL_PROFILE_PATCH = `# Voyaseek desktop defaults. Read-only and workspace-write require interactive approval; danger-full-access skips approval prompts.\n- id: approval
  config:
    policy: ask

- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never

# API keys are resolved from the named environment variables.\n- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GEMINI_API_KEY
        models:
          - id: gemini-3.6-flash
            input: [text, image]
      dashscope:
        displayName: DashScope
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen-plus
            name: Qwen Plus
          - id: qwen3.7-flash
            name: Qwen 3.7 Flash
            input: [text, image]

- id: api-gateway
  config:
    imageFallback:
      provider: dashscope
      model: qwen3.7-flash
      maxTokens: 4096

- id: agent-default-model
  config:
    provider: google
    model: gemini-3.6-flash
`
const PROFILE_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'

/**
 * Create the isolated Voyaseek profile without overwriting user changes.
 * @param dshHome - Root directory for the bundled DSH installation.
 * @param countryCode - Operating-system ISO 3166 country code; mainland China selects DashScope.
 * @returns The profile directory.
 */
export function ensureAistaffProfile(dshHome: string, countryCode = ''): string {
  const profileDir = join(dshHome, 'profiles', 'aistaff')
  mkdirSync(profileDir, { recursive: true })
  writeOnce(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-aistaff',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: PROFILE_BUNDLES } },
  }, undefined, 2)}\n`)
  writeProfilePatch(join(profileDir, 'cordis.patch.yml'), countryCode)
  writeOnce(join(profileDir, 'pnpm-workspace.yaml'), PROFILE_WORKSPACE)
  return profileDir
}

function writeOnce(file: string, content: string): void {
  if (!existsSync(file)) writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 })
}

function writeProfilePatch(file: string, countryCode: string): void {
  const profilePatch = buildProfilePatch(countryCode)
  if (!existsSync(file)) {
    writeFileSync(file, profilePatch, { encoding: 'utf8', mode: 0o600 })
    return
  }
  const existing = readFileSync(file, 'utf8')
  if (existing === EMPTY_LEGACY_PROFILE_PATCH
    || existing === MODEL_ONLY_PROFILE_PATCH
    || existing === PRE_IMAGE_FALLBACK_PROFILE_PATCH
    || existing === PRE_FULL_ACCESS_NEVER_PROFILE_PATCH
    || existing === PRE_REGIONAL_PROFILE_PATCH
    || existing === buildProfilePatch('CN')
    || existing === buildProfilePatch('US')) {
    writeFileSync(file, profilePatch, 'utf8')
  }
}

function buildProfilePatch(countryCode: string): string {
  const domestic = countryCode.trim().toUpperCase() === 'CN'
  const defaultProvider = domestic ? 'dashscope' : 'google'
  const defaultModel = domestic ? 'qwen3.7-flash' : 'gemini-3.1-flash-lite'
  return `# Voyaseek desktop defaults. Read-only and workspace-write require interactive approval; danger-full-access skips approval prompts.\n- id: approval
  config:
    policy: ask

- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never

# API keys are resolved from the named environment variables. The operating-system country code selects only the initial default.\n- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GEMINI_API_KEY
        models:
          - id: gemini-3.1-flash-lite
            input: [text, image]
      dashscope:
        displayName: DashScope
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen3.7-flash
            name: Qwen 3.7 Flash
            input: [text, image]

- id: api-gateway
  config:
    imageFallback:
      provider: dashscope
      model: qwen3.7-flash
      maxTokens: 4096

- id: agent-default-model
  config:
    provider: ${defaultProvider}
    model: ${defaultModel}
`
}
