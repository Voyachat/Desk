import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadModelCredentials } from '../src/model-credentials.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('model credentials', () => {
  it('loads only supported keys and prefers the native DashScope name', () => {
    const home = createHome()
    writeSecret(home, 'gemini.env', [
      '# shared with Voyaseek',
      'GEMINI_API_KEY="gemini-value"',
      'IGNORED_KEY=ignored-value',
    ].join('\n'))
    writeSecret(home, 'qwen.env', [
      'QWEN_API_KEY=legacy-value',
      'export DASHSCOPE_API_KEY=preferred-value # comment',
    ].join('\n'))
    writeSecret(home, 'zhipu.env', [
      'ZHIPUAI_API_KEY=zhipu-value',
      'IGNORED_ZHIPU_KEY=ignored-value',
    ].join('\n'))

    expect(loadModelCredentials(home)).toEqual({
      GEMINI_API_KEY: 'gemini-value',
      DASHSCOPE_API_KEY: 'preferred-value',
      ZHIPUAI_API_KEY: 'zhipu-value',
    })
  })

  it('maps QWEN_API_KEY and treats missing files, variables, and empty values as absent', () => {
    const missingHome = createHome(false)
    expect(loadModelCredentials(missingHome)).toEqual({})

    const home = createHome()
    writeSecret(home, 'gemini.env', 'OTHER_KEY=value\n')
    writeSecret(home, 'qwen.env', 'DASHSCOPE_API_KEY=\nQWEN_API_KEY=legacy-value\n')
    expect(loadModelCredentials(home)).toEqual({ DASHSCOPE_API_KEY: 'legacy-value' })
  })

  it.skipIf(process.platform === 'win32')('rejects files readable by group or other users', () => {
    const home = createHome()
    const filename = writeSecret(home, 'gemini.env', 'GEMINI_API_KEY=private-value\n')
    chmodSync(filename, 0o640)

    expect(() => loadModelCredentials(home)).toThrow(/insecure permissions.*640/u)
  })

  it('rejects non-regular files, including symbolic links', () => {
    const directoryHome = createHome()
    mkdirSync(join(directoryHome, '.codex', 'secrets', 'gemini.env'))
    expect(() => loadModelCredentials(directoryHome)).toThrow('must be a regular file')

    const symlinkHome = createHome()
    const target = join(symlinkHome, 'target.env')
    writeFileSync(target, 'GEMINI_API_KEY=private-value\n', { mode: 0o600 })
    symlinkSync(target, join(symlinkHome, '.codex', 'secrets', 'gemini.env'))
    expect(() => loadModelCredentials(symlinkHome)).toThrow('must be a regular file')
  })

  it('rejects oversized files before reading or exposing their contents', () => {
    const home = createHome()
    const secret = 'oversized-secret-must-not-leak'
    const filename = writeSecret(home, 'gemini.env', `${secret}${'x'.repeat(64 * 1024)}\n`)

    let thrown: unknown
    try {
      loadModelCredentials(home)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(filename)
    expect((thrown as Error).message).toContain('65536-byte limit')
    expect((thrown as Error).message).not.toContain(secret)
  })

  it('keeps command and variable syntax literal without executing or expanding it', () => {
    const home = createHome()
    const marker = join(home, 'must-not-exist')
    const command = `$(touch ${marker})`
    writeSecret(home, 'gemini.env', `GEMINI_API_KEY=${command}\n`)
    writeSecret(home, 'qwen.env', 'QWEN_API_KEY="${GEMINI_API_KEY}"\n')

    expect(loadModelCredentials(home)).toEqual({
      GEMINI_API_KEY: command,
      DASHSCOPE_API_KEY: '${GEMINI_API_KEY}',
    })
    expect(existsSync(marker)).toBe(false)
  })

  it('fails on malformed dotenv without exposing the secret value', () => {
    const home = createHome()
    const secret = 'do-not-echo-this-value'
    writeSecret(home, 'gemini.env', `GEMINI_API_KEY="${secret}\n`)

    let thrown: unknown
    try {
      loadModelCredentials(home)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/invalid dotenv syntax.*line 1/u)
    expect((thrown as Error).message).not.toContain(secret)
  })
})

function createHome(withSecretsDirectory = true): string {
  const home = mkdtempSync(join(tmpdir(), 'aistaff-model-credentials-'))
  temporaryDirectories.push(home)
  if (withSecretsDirectory) mkdirSync(join(home, '.codex', 'secrets'), { recursive: true })
  return home
}

function writeSecret(home: string, basename: string, contents: string): string {
  const filename = join(home, '.codex', 'secrets', basename)
  writeFileSync(filename, contents, { encoding: 'utf8', mode: 0o600 })
  return filename
}
