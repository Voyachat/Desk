import { describe, expect, it } from 'vitest'
import { rebrand } from './rebrand.ts'

describe('rebrand', () => {
  it('rewrites every brand form longest-first', () => {
    const source = [
      'import { Context } from \'@deepseek-ai/cordis\'',
      'url: git+https://github.com/deepseek-ai/deepseek-harness.git',
      'url: git+https://github.com/deepseek-harness/deepseek-harness.git',
      'agentInfo: { name: \'deepseek-harness-acp\' }',
      'class DeepSeekHarnessSession {}',
      'title DeepSeek Harness Architecture',
      'from deepseek_harness import Client',
      'DSH_TELEMETRY_OTLP_URL=https://harness-telemetry.deepseeksvc.com/v1/logs',
      'process.env.DSH_HOME',
    ].join('\n')
    const { text } = rebrand(source, 'some/file.ts')
    expect(text).toBe([
      'import { Context } from \'@voyaseek-ai/cordis\'',
      'url: git+https://github.com/voyaseek-ai/voyaseek-harness.git',
      'url: git+https://github.com/voyaseek-ai/voyaseek-harness.git',
      'agentInfo: { name: \'voyaseek-harness-acp\' }',
      'class VoyaseekHarnessSession {}',
      'title Voyaseek Harness Architecture',
      'from voyaseek_harness import Client',
      'DSH_TELEMETRY_OTLP_URL=https://harness-telemetry.voyaseeksvc.com/v1/logs',
      'process.env.VOYASEEK_HOME',
    ].join('\n'))
  })

  it('keeps the DeepSeek API contract untouched', () => {
    const source = [
      'baseURL: \'https://api.deepseek.com\'',
      'process.env.DEEPSEEK_API_KEY',
      'provider: \'deepseek-official\'',
      'model: \'deepseek-v4-flash\'',
      'name: \'@deepseek-ai/dsh-llm-deepseek\'',
    ].join('\n')
    const { text } = rebrand(source, 'packages/llm/llm-deepseek/src/adapter.ts')
    expect(text).toBe([
      'baseURL: \'https://api.deepseek.com\'',
      'process.env.DEEPSEEK_API_KEY',
      'provider: \'deepseek-official\'',
      'model: \'deepseek-v4-flash\'',
      'name: \'@voyaseek-ai/dsh-llm-deepseek\'',
    ].join('\n'))
  })

  it('masks vendored upstream provenance while rebranding the rest of the file', () => {
    const source = '| `@voyaseek-ai/cordis/` | `@deepseek-ai/cordis` | https://github.com/deepseek-harness/cordis | MIT |'
    const { text } = rebrand(source, 'vendor/README.md')
    expect(text).toBe('| `@voyaseek-ai/cordis/` | `@voyaseek-ai/cordis` | https://github.com/deepseek-harness/cordis | MIT |')
  })

  it('renames only the standalone home-directory token', () => {
    const source = 'home=~/.dsh paths.dshHome value.dsh_session_id tmp/.dsh-e2b manifest.dsh.profile join(home, \'.dsh\')'
    const { text } = rebrand(source, 'a.ts')
    expect(text).toBe('home=~/.voyaseek paths.dshHome value.dsh_session_id tmp/.dsh-e2b manifest.dsh.profile join(home, \'.voyaseek\')')
  })

  it('honours per-rule skip prefixes', () => {
    const source = 'see [DeepSeek](https://deepseek.com) for the API'
    expect(rebrand(source, 'packages/web/web-search-deepseek/README.md').text).toBe(source)
    expect(rebrand(source, 'packages/client/ui-primitives/tests/x.spec.tsx').text).toBe('see [DeepSeek](https://voyaseek.com) for the API')
  })

  it('is idempotent', () => {
    const source = '@deepseek-ai/dsh-session deepseek-harness DSH_HOME ~/.dsh https://deepseek.com'
    const once = rebrand(source, 'x.ts').text
    expect(rebrand(once, 'x.ts').text).toBe(once)
  })
})
