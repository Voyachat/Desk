/** Read model credentials from Codex's owner-only user secret files. */

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const GROUP_OR_OTHER_BITS = 0o077
const MAX_SECRET_FILE_BYTES = 64 * 1024
const GEMINI_KEY = 'GEMINI_API_KEY'
const DASHSCOPE_KEY = 'DASHSCOPE_API_KEY'
const QWEN_KEY = 'QWEN_API_KEY'

/**
 * Load the model credentials shared with Codex from a user's home directory.
 * Missing files and missing or empty target variables contribute no entry.
 * Existing files must be regular owner-only files and valid dotenv documents.
 * @param homePath - User home directory containing `.codex/secrets`.
 * @returns A fresh environment containing only supported model credential keys.
 */
export function loadModelCredentials(homePath: string): NodeJS.ProcessEnv {
  const secretsDirectory = join(homePath, '.codex', 'secrets')
  const gemini = readDotenvFile(join(secretsDirectory, 'gemini.env'))
  const qwen = readDotenvFile(join(secretsDirectory, 'qwen.env'))
  const environment: NodeJS.ProcessEnv = {}

  const geminiValue = gemini?.get(GEMINI_KEY)
  if (geminiValue !== undefined && geminiValue.length > 0) environment[GEMINI_KEY] = geminiValue

  const dashscopeValue = qwen?.get(DASHSCOPE_KEY)
  const qwenValue = qwen?.get(QWEN_KEY)
  const effectiveQwenValue = dashscopeValue !== undefined && dashscopeValue.length > 0
    ? dashscopeValue
    : qwenValue
  if (effectiveQwenValue !== undefined && effectiveQwenValue.length > 0) {
    environment[DASHSCOPE_KEY] = effectiveQwenValue
  }

  return environment
}

function readDotenvFile(filename: string): Map<string, string> | undefined {
  let pathStats
  try {
    pathStats = lstatSync(filename)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  if (!pathStats.isFile()) {
    throw new Error(`model-credentials: ${filename} must be a regular file`)
  }
  assertOwnerOnly(filename, pathStats.mode)

  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  let descriptor: number
  try {
    descriptor = openSync(filename, constants.O_RDONLY | noFollow)
  } catch (error) {
    throw fileReadError(filename, error)
  }
  try {
    const openedStats = fstatSync(descriptor)
    if (!openedStats.isFile()) {
      throw new Error(`model-credentials: ${filename} must be a regular file`)
    }
    assertOwnerOnly(filename, openedStats.mode)
    if (openedStats.size > MAX_SECRET_FILE_BYTES) {
      throw new Error(
        `model-credentials: ${filename} exceeds the ${String(MAX_SECRET_FILE_BYTES)}-byte limit`,
      )
    }
    return parseDotenv(decodeUtf8(readFileSync(descriptor), filename), filename)
  } finally {
    closeSync(descriptor)
  }
}

function assertOwnerOnly(filename: string, mode: number): void {
  /* v8 ignore next -- Windows permissions are ACLs rather than POSIX mode bits. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- exercised on POSIX; ignored for native Windows coverage. */
  if ((mode & GROUP_OR_OTHER_BITS) !== 0) {
    throw new Error(
      `model-credentials: ${filename} has insecure permissions (mode ${(mode & 0o777).toString(8)});`
      + ` run "chmod 600 ${filename}" before starting again`,
    )
  }
  /* v8 ignore stop */
}

function parseDotenv(text: string, filename: string): Map<string, string> {
  const entries = new Map<string, string>()
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  if (source.includes('\0')) throw dotenvError(filename, 1)

  const lines = source.split(/\r\n|\n|\r/u)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/u.exec(line)
    if (match === null) throw dotenvError(filename, index + 1)
    const key = match[1]
    const rawValue = match[2]
    if (key === undefined || rawValue === undefined || entries.has(key)) {
      throw dotenvError(filename, index + 1)
    }
    entries.set(key, parseDotenvValue(rawValue, filename, index + 1))
  }
  return entries
}

function parseDotenvValue(rawValue: string, filename: string, line: number): string {
  const value = rawValue.trimStart()
  const quote = value[0]
  if (quote !== "'" && quote !== '"') {
    const comment = value.indexOf('#')
    return (comment === -1 ? value : value.slice(0, comment)).trim()
  }

  let parsed = ''
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index]
    if (character === quote) {
      const remainder = value.slice(index + 1).trim()
      if (remainder.length > 0 && !remainder.startsWith('#')) throw dotenvError(filename, line)
      return parsed
    }
    if (quote === '"' && character === '\\') {
      index += 1
      const escaped = value[index]
      if (escaped === undefined) throw dotenvError(filename, line)
      parsed += decodeEscape(escaped, filename, line)
      continue
    }
    parsed += character
  }
  throw dotenvError(filename, line)
}

function decodeEscape(character: string, filename: string, line: number): string {
  switch (character) {
    case 'n': return '\n'
    case 'r': return '\r'
    case 't': return '\t'
    case '"': return '"'
    case '\\': return '\\'
    case '$': return '$'
    default: throw dotenvError(filename, line)
  }
}

function decodeUtf8(bytes: Buffer, filename: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`model-credentials: ${filename} is not valid UTF-8`)
  }
}

function dotenvError(filename: string, line: number): Error {
  return new Error(`model-credentials: invalid dotenv syntax in ${filename} at line ${String(line)}`)
}

function fileReadError(filename: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code
  const suffix = code === undefined ? '' : ` (${code})`
  return new Error(`model-credentials: cannot safely open ${filename}${suffix}`)
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}
