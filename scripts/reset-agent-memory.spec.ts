import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  inspectAgentMemoryDatabase,
  parseResetAgentMemoryArgs,
  resetAgentMemoryDatabase,
} from './reset-agent-memory.ts'

function database(home: string, applicationId = 0x4453484d, version = 1): string {
  const memory = join(home, 'memory')
  mkdirSync(memory, { recursive: true })
  const path = join(memory, 'agent-memory.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA application_id = ${String(applicationId)}; PRAGMA user_version = ${String(version)};`)
  db.close()
  return realpathSync(path)
}

function tempHome(label: string): string {
  return mkdtempSync(join(tmpdir(), `dsh-${label}`))
}

describe('memory reset arguments', () => {
  it('requires exactly one explicit destructive mode', () => {
    expect(() => parseResetAgentMemoryArgs([])).toThrow('requires exactly one')
    expect(() => parseResetAgentMemoryArgs(['--backup', '--delete'])).toThrow('accepts exactly one')
    expect(parseResetAgentMemoryArgs(['--backup', '--home', '/tmp/example'])).toEqual({ mode: 'backup', home: '/tmp/example' })
  })
})

describe('agent-memory database reset', () => {
  it('moves an unsupported database to a deterministic private backup', () => {
    const home = tempHome('memory-reset-backup-')
    const path = database(home)
    const result = resetAgentMemoryDatabase({ mode: 'backup', home }, new Date('2026-08-20T07:00:00.000Z'))
    expect(result).toEqual({
      path,
      schemaVersion: 1,
      backupPath: join(dirname(path), 'backups', 'agent-memory-v1-2026-08-20T07-00-00-000Z.sqlite'),
    })
    expect(() => inspectAgentMemoryDatabase(home)).toThrow()
    expect(existsSync(result.backupPath ?? '')).toBe(true)
  })

  it('deletes only an unsupported owned database', () => {
    const home = tempHome('memory-reset-delete-')
    const path = database(home)
    expect(resetAgentMemoryDatabase({ mode: 'delete', home })).toEqual({ path, schemaVersion: 1 })
    expect(() => inspectAgentMemoryDatabase(home)).toThrow()
  })

  it('rejects current, foreign, linked, and live databases', () => {
    const currentHome = tempHome('memory-reset-current-')
    database(currentHome, 0x4453484d, 3)
    expect(() => resetAgentMemoryDatabase({ mode: 'delete', home: currentHome })).toThrow('current schema version 3')

    const foreignHome = tempHome('memory-reset-foreign-')
    database(foreignHome, 1234, 1)
    expect(() => resetAgentMemoryDatabase({ mode: 'delete', home: foreignHome })).toThrow('not an agent-memory database')

    const linkedHome = tempHome('memory-reset-linked-')
    mkdirSync(join(linkedHome, 'memory'), { recursive: true })
    const target = join(linkedHome, 'target.sqlite')
    writeFileSync(target, '')
    symlinkSync(target, join(linkedHome, 'memory', 'agent-memory.sqlite'))
    expect(() => inspectAgentMemoryDatabase(linkedHome)).toThrow('linked component')

    const liveHome = tempHome('memory-reset-live-')
    const livePath = database(liveHome)
    writeFileSync(`${livePath}-wal`, '')
    expect(() => inspectAgentMemoryDatabase(liveHome)).toThrow('stop every Host first')
  })
})
