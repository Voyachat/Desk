import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@voyaseek-ai/dsh-loader-smoke'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@voyaseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const deepseekConfigPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const qwenConfigPath = fileURLToPath(new URL('./fixtures/qwen-real.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const hasDeepSeekKey = Boolean(process.env.DEEPSEEK_API_KEY)
const hasDashScopeKey = Boolean(process.env.DASHSCOPE_API_KEY)
const MAX_QWEN_MODEL_STEPS = 4

function countEventRecords(jsonl: string, type: string): number {
  return jsonl.split('\n').filter((line) => {
    if (line.length === 0) return false
    const record = JSON.parse(line) as { type?: unknown; event?: { type?: unknown } }
    return record.type === type || record.event?.type === type
  }).length
}

async function readPersistedLog(file: string): Promise<string> {
  const content = await readFile(file)
  if (!file.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`persisted real-model log has a torn Zstandard frame: ${file}`)
  const decoded = await Promise.all(scan.frames.map(frame => (
    decompressZstdFrame(content.subarray(frame.start, frame.end))
  )))
  return Buffer.concat(decoded).toString('utf8')
}

describe.skipIf(!hasDeepSeekKey)('headless-agent with real DeepSeek model', () => {
  it('modifies a temporary workspace and verifies the file outside the agent', async () => {
    let verified = ''
    const { stdout } = await runLoaderSmoke({
      label: 'headless-agent real model',
      tempDirPrefix: 'headless-agent-real-',
      binScript,
      libBinScript: binScript,
      configPath: deepseekConfigPath,
      binArgs: [
        deepseekConfigPath,
        'Read task.txt, replace its complete contents with exactly "value=after" followed by a newline, read it again, and report briefly.',
      ],
      tsconfigPath,
      processTimeoutMs: 120_000,
      prepare: cwd => writeFile(join(cwd, 'task.txt'), 'value=before\n'),
      inspect: async (cwd) => { verified = await readFile(join(cwd, 'task.txt'), 'utf8') },
    })
    expect(verified).toBe('value=after\n')
    expect(stdout.trim().length).toBeGreaterThan(0)
  }, 135_000)
})

describe.skipIf(!hasDashScopeKey)('headless-agent with real DashScope Qwen model', () => {
  it('modifies a temporary workspace within the bounded live-model budget', { retry: 0, timeout: 135_000 }, async () => {
    let verified = ''
    let persistedModelSteps = 0
    const { stdout } = await runLoaderSmoke({
      label: 'headless-agent real DashScope Qwen model',
      tempDirPrefix: 'headless-agent-qwen-real-',
      binScript,
      libBinScript: binScript,
      configPath: qwenConfigPath,
      binArgs: [
        qwenConfigPath,
        'Read task.txt, replace its complete contents with exactly "value=after" followed by a newline, read it again, and report briefly.',
      ],
      tsconfigPath,
      processTimeoutMs: 120_000,
      env: { DSH_FIXTURE_MAX_MODEL_STEPS: String(MAX_QWEN_MODEL_STEPS) },
      prepare: cwd => writeFile(join(cwd, 'task.txt'), 'value=before\n'),
      inspect: async (cwd) => {
        verified = await readFile(join(cwd, 'task.txt'), 'utf8')
        const sessionsRoot = join(cwd, '.sessions')
        const sessionFiles = (await readdir(sessionsRoot, { recursive: true }))
          .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
        expect(sessionFiles).toHaveLength(1)
        persistedModelSteps = countEventRecords(
          await readPersistedLog(join(sessionsRoot, sessionFiles[0]!)),
          'assistant/message',
        )
      },
    })
    const modelSteps = countEventRecords(stdout, 'assistant/message')
    expect(verified).toBe('value=after\n')
    expect(modelSteps).toBeGreaterThanOrEqual(2)
    expect(modelSteps).toBeLessThanOrEqual(MAX_QWEN_MODEL_STEPS)
    expect(persistedModelSteps).toBe(modelSteps)
    expect(countEventRecords(stdout, 'llm/retry')).toBe(0)
    expect(countEventRecords(stdout, 'llm/retry-started')).toBe(0)
  })
})
