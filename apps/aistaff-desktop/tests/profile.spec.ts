import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAistaffProfile } from '../src/profile.js'

const temporaryDirectories: string[] = []
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Voyaseek profile initialization', () => {
  it.each([
    ['mainland China', 'cn', 'dashscope', 'qwen3.7-flash'],
    ['an overseas country', 'US', 'google', 'gemini-3.1-flash-lite'],
    ['an unknown country', '', 'google', 'gemini-3.1-flash-lite'],
  ])('creates the product bundle profile for %s', (_label, countryCode, provider, model) => {
    const home = mkdtempSync(join(tmpdir(), 'aistaff-profile-'))
    temporaryDirectories.push(home)
    const profile = ensureAistaffProfile(home, countryCode)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual([
      '@voyaseek-ai/dsh-base',
      '@voyaseek-ai/dsh-web-app',
      '@voyaseek-ai/dsh-aistaff-product-bundle',
    ])
    const patch = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- id: gemini-3.1-flash-lite\n')
    expect(patch).toContain('- id: qwen3.7-flash\n')
    expect(patch).toContain('- id: qwen3.8-max\n')
    expect(patch).toContain('- id: kimi/kimi-k3\n')
    expect(patch).toContain('- id: deepseek-v4-flash\n')
    expect(patch).not.toContain('gemini-3.6-flash')
    expect(patch).not.toContain('qwen-plus')
    expect(patch).toContain(`- id: agent-default-model\n  config:\n    provider: ${provider}\n    model: ${model}\n`)
  })

  it.each([
    ['empty legacy patch', EMPTY_LEGACY_PROFILE_PATCH],
    ['model-only generated patch', MODEL_ONLY_PROFILE_PATCH],
    ['pre-image-fallback generated patch', PRE_IMAGE_FALLBACK_PROFILE_PATCH],
    ['pre-full-access-never generated patch', PRE_FULL_ACCESS_NEVER_PROFILE_PATCH],
    ['pre-regional generated patch', PRE_REGIONAL_PROFILE_PATCH],
  ])('migrates the exact %s', (_label, generatedPatch) => {
    const home = mkdtempSync(join(tmpdir(), 'aistaff-profile-'))
    temporaryDirectories.push(home)
    const profile = ensureAistaffProfile(home)
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(patch, generatedPatch)

    ensureAistaffProfile(home, 'CN')

    expect(readFileSync(patch, 'utf8')).toContain(
      '- id: agent-default-model\n  config:\n    provider: dashscope\n    model: qwen3.7-flash\n',
    )
  })

  it.each([
    '- disable: user-choice\n',
    `${MODEL_ONLY_PROFILE_PATCH}# user edit\n`,
  ])('preserves user overrides on subsequent initialization', (userPatch) => {
    const home = mkdtempSync(join(tmpdir(), 'aistaff-profile-'))
    temporaryDirectories.push(home)
    const profile = ensureAistaffProfile(home)
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(patch, userPatch)

    ensureAistaffProfile(home)

    expect(readFileSync(patch, 'utf8')).toBe(userPatch)
  })
})
