import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rebrand, runRebrand } from './rebrand.ts'

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

  it('preserves the upstream legal-resource directory without hiding ordinary product slugs', () => {
    const source = [
      "openLegalDocument('third-party', 'deepseek-harness', 'LICENSE')",
      "resolve(legalDir, 'third-party', 'deepseek-harness', 'LICENSE')",
      "const productSlug = 'deepseek-harness'",
    ].join('\n')
    const { text, hits } = rebrand(source, 'apps/aistaff-desktop/src/main.ts')
    expect(text).toBe([
      "openLegalDocument('third-party', 'deepseek-harness', 'LICENSE')",
      "resolve(legalDir, 'third-party', 'deepseek-harness', 'LICENSE')",
      "const productSlug = 'voyaseek-harness'",
    ].join('\n'))
    expect(hits).toBe(1)
  })

  it('does not report protected legal-resource references as residue', () => {
    const root = mkdtempSync(join(tmpdir(), 'voyaseek-rebrand-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      const source = join(root, 'legal-reference.ts')
      writeFileSync(source, "resolve(legalDir, 'third-party', 'deepseek-harness', 'LICENSE')\n")
      execFileSync('git', ['add', 'legal-reference.ts'], { cwd: root })

      expect(runRebrand(root, 'check')).toEqual({ changed: [], hits: 0, failures: [] })
    } finally {
      rmSync(root, { recursive: true })
    }
  })

  it('renames only the standalone home-directory token', () => {
    const source = [
      'home=~/.dsh paths.dshHome value.dsh_session_id tmp/.dsh-e2b',
      "manifest.dsh manifest.dsh.profile rootPackage.scripts?.dsh readProfileManifest('t').dsh?.profile",
      "join(home, '.dsh')",
    ].join(' ')
    const { text } = rebrand(source, 'a.ts')
    expect(text).toBe([
      'home=~/.voyaseek paths.dshHome value.dsh_session_id tmp/.dsh-e2b',
      "manifest.dsh manifest.dsh.profile rootPackage.scripts?.dsh readProfileManifest('t').dsh?.profile",
      "join(home, '.voyaseek')",
    ].join(' '))
  })

  it('honours per-rule skip prefixes', () => {
    const source = 'see [DeepSeek](https://deepseek.com) for the API'
    expect(rebrand(source, 'packages/web/web-search-deepseek/README.md').text).toBe(source)
    expect(rebrand(source, 'packages/client/ui-primitives/tests/x.spec.tsx').text).toBe('see [DeepSeek](https://voyaseek.com) for the API')
  })

  it('rebrands the complete static design-token family', () => {
    const source = 'var(--dsw-static-deepseek-100) var(--dsw-static-deepseek-900)'
    expect(rebrand(source, 'theme.css').text)
      .toBe('var(--dsw-static-voyaseek-100) var(--dsw-static-voyaseek-900)')
  })

  it('ignores tracked files deleted from the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'voyaseek-rebrand-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      const deleted = join(root, 'deleted.md')
      writeFileSync(deleted, 'DeepSeek Harness')
      execFileSync('git', ['add', 'deleted.md'], { cwd: root })
      unlinkSync(deleted)

      expect(runRebrand(root, 'check')).toEqual({ changed: [], hits: 0, failures: [] })
    } finally {
      rmSync(root, { recursive: true })
    }
  })

  it('is idempotent', () => {
    const source = '@deepseek-ai/dsh-session deepseek-harness DSH_HOME ~/.dsh https://deepseek.com'
    const once = rebrand(source, 'x.ts').text
    expect(rebrand(once, 'x.ts').text).toBe(once)
  })
})
