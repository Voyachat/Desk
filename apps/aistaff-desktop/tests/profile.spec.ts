import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAistaffProfile } from '../src/profile.js'

const temporaryDirectories: string[] = []
const EMPTY_LEGACY_PROFILE_PATCH = `# User overrides for the bundled AI Staff profile.\n[]\n`
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
const EXPECTED_PROFILE_PATCH = `# Voyaseek desktop defaults. Elevated operations always require interactive approval.\n- id: approval
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Voyaseek profile initialization', () => {
  it('creates the product bundle profile with Gemini and DashScope routes', () => {
    const home = mkdtempSync(join(tmpdir(), 'aistaff-profile-'))
    temporaryDirectories.push(home)
    const profile = ensureAistaffProfile(home)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-aistaff-product-bundle',
    ])
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(EXPECTED_PROFILE_PATCH)
  })

  it.each([
    ['empty legacy patch', EMPTY_LEGACY_PROFILE_PATCH],
    ['model-only generated patch', MODEL_ONLY_PROFILE_PATCH],
    ['pre-image-fallback generated patch', PRE_IMAGE_FALLBACK_PROFILE_PATCH],
  ])('migrates the exact %s', (_label, generatedPatch) => {
    const home = mkdtempSync(join(tmpdir(), 'aistaff-profile-'))
    temporaryDirectories.push(home)
    const profile = ensureAistaffProfile(home)
    const patch = join(profile, 'cordis.patch.yml')
    writeFileSync(patch, generatedPatch)

    ensureAistaffProfile(home)

    expect(readFileSync(patch, 'utf8')).toBe(EXPECTED_PROFILE_PATCH)
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
