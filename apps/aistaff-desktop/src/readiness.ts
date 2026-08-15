const READINESS_PREFIX = 'dsh web: '
const READINESS_PATTERN = /^dsh web: http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/

/** Maximum accepted runtime stdout line length. */
export const MAX_RUNTIME_LINE_BYTES = 16 * 1024

/** Parse an exact DSH loopback readiness line, ignoring unrelated log lines. */
export function parseReadinessLine(line: string): URL | undefined {
  if (!line.startsWith(READINESS_PREFIX)) return undefined
  const match = READINESS_PATTERN.exec(line)
  if (match === null) throw new Error(`Invalid DSH readiness line: ${JSON.stringify(line)}`)
  const port = Number(match[1])
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error(`Invalid DSH readiness port: ${JSON.stringify(match[1])}`)
  }
  return new URL(`http://127.0.0.1:${port}`)
}

/** Incrementally decode bounded UTF-8 runtime stdout lines. */
export class ReadinessDecoder {
  readonly #decoder = new TextDecoder('utf-8', { fatal: true })
  #pending = ''

  /** Consume one stdout chunk and return the first exact readiness URL. */
  push(chunk: Uint8Array): URL | undefined {
    this.#pending += this.#decoder.decode(chunk, { stream: true })
    if (Buffer.byteLength(this.#pending, 'utf8') > MAX_RUNTIME_LINE_BYTES && !this.#pending.includes('\n')) {
      throw new Error('DSH runtime stdout line exceeded the readiness limit')
    }
    for (;;) {
      const newline = this.#pending.indexOf('\n')
      if (newline < 0) return undefined
      let line = this.#pending.slice(0, newline)
      this.#pending = this.#pending.slice(newline + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (Buffer.byteLength(line, 'utf8') > MAX_RUNTIME_LINE_BYTES) {
        throw new Error('DSH runtime stdout line exceeded the readiness limit')
      }
      const ready = parseReadinessLine(line)
      if (ready !== undefined) return ready
    }
  }
}
