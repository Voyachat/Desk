/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@voyaseek-ai/cordis-plugin-include'
import { evaluate } from '@voyaseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown> }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'premature-stop-recovery')?.config).toEqual({
      maxContinuations: 3,
    })
    expect(rows.find(row => row.id === 'llm-pi-ai')?.config).toMatchObject({
      providers: {
        'zhipu-vision': {
          reasoning: 'off',
          compat: { thinkingFormat: 'zai', supportsReasoningEffort: false },
          models: [
            { id: 'glm-4.6v-flash', reasoningEfforts: { off: null, high: 'high' } },
            { id: 'glm-4.6v-flashx', reasoningEfforts: { off: null, high: 'high' } },
            { id: 'glm-4.6v', reasoningEfforts: { off: null, high: 'high' } },
          ],
        },
      },
    })
    expect(rows.find(row => row.id === 'image-fallback')?.config).toMatchObject({
      local: true,
      routes: [
        { provider: 'zhipu-vision', model: 'glm-4.6v-flash', tier: 'free' },
        { provider: 'zhipu-vision', model: 'glm-4.6v-flashx', tier: 'paid-low' },
        { provider: 'zhipu-vision', model: 'glm-4.6v', tier: 'paid-quality' },
      ],
    })
    const skillDirectoryExpression = (rows.find(row => row.id === 'skill-filesystem')
      ?.config?.['bundledSkillDir'] as { __jsExpr?: string } | undefined)?.__jsExpr
    expect(skillDirectoryExpression).toBeDefined()
    const skillDirectory = evaluate({ process, baseUrl: new URL('../', import.meta.url).href }, skillDirectoryExpression!)
    expect(skillDirectory).toBe(resolve(root, 'skills'))
    expect(existsSync(resolve(skillDirectory as string, 'design-taste-frontend', 'SKILL.md'))).toBe(true)
    expect(rows.find(row => row.id === 'tool-skill')?.config?.['autoInvoke']).toEqual([
      expect.objectContaining({
        skill: 'design-taste-frontend',
        include: expect.arrayContaining(['website design', '网页设计']),
        exclude: expect.arrayContaining(['dashboard', '管理后台']),
      }),
    ])
    expect(rows.find(row => row.id === 'subagent-prime-computer-use')?.config).toMatchObject({
      providerName: 'prime-computer-use',
      command: 'prime-agent',
      availability: 'when-available',
      permission: 'reject',
      args: expect.arrayContaining([
        '--offline',
        '--no-builtin-tools',
        'find_roots,observe_ui,search_ui,expand_ui,inspect_ui,act_ui,read_text,wait_for',
      ]),
    })
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'DISABLED'",
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(manifest.dependencies).not.toHaveProperty('@voyaseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@voyaseek-ai/dsh-subagent-claude-code')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
