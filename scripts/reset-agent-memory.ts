/**
 * Explicit recovery command for an unsupported local agent-memory database.
 *
 * The command only moves or unlinks the exact database under one resolved
 * Voyaseek home. It rejects live WAL state, links, foreign databases, and the
 * current schema so ordinary memory deletion remains a UI operation.
 */

import { linkSync, lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { resolveDshHome } from '@voyaseek-ai/dsh-home-paths'

const AGENT_MEMORY_APPLICATION_ID = 0x4453484d
const CURRENT_SCHEMA_VERSION = 3

/** Parsed destructive mode and optional home override. */
export interface ResetAgentMemoryOptions {
  /** Recovery action selected explicitly by the operator. */
  mode: 'backup' | 'delete'
  /** Voyaseek home override; the normal resolver is used when omitted. */
  home?: string
}

/** Metadata required to decide whether the database is eligible for reset. */
export interface AgentMemoryDatabaseMetadata {
  /** Absolute database file path. */
  path: string
  /** SQLite application id owned by agent-memory. */
  applicationId: number
  /** On-disk agent-memory schema version. */
  schemaVersion: number
}

/** Result of one successful reset. */
export interface ResetAgentMemoryResult {
  /** Absolute path removed from active use. */
  path: string
  /** Previous unsupported schema version. */
  schemaVersion: number
  /** Backup path when the recoverable mode was selected. */
  backupPath?: string
}

/** Parse the explicit reset mode and optional home override. */
export function parseResetAgentMemoryArgs(argv: readonly string[]): ResetAgentMemoryOptions {
  let mode: ResetAgentMemoryOptions['mode'] | undefined
  let home: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--backup' || argument === '--delete') {
      const nextMode = argument.slice(2) as ResetAgentMemoryOptions['mode']
      if (mode !== undefined) throw new Error('memory:reset accepts exactly one of --backup or --delete')
      mode = nextMode
      continue
    }
    if (argument === '--home') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('memory:reset: --home requires a directory')
      home = value
      index += 1
      continue
    }
    throw new Error(`memory:reset: unknown argument ${JSON.stringify(argument)}`)
  }
  if (mode === undefined) throw new Error('memory:reset requires exactly one of --backup or --delete')
  return { mode, ...(home === undefined ? {} : { home }) }
}

function databasePath(home: string | undefined): string {
  return join(realpathSync(resolveDshHome(home)), 'memory', 'agent-memory.sqlite')
}

function assertRegularFile(path: string): void {
  if (realpathSync(path) !== path) {
    throw new Error(`memory:reset refuses database path with a linked component ${JSON.stringify(path)}`)
  }
  const file = lstatSync(path)
  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error(`memory:reset refuses non-regular database path ${JSON.stringify(path)}`)
  }
}

function assertNoLiveSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${path}${suffix}`
    try {
      lstatSync(sidecar)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error(`memory:reset refuses ${JSON.stringify(path)} while ${JSON.stringify(sidecar)} exists; stop every Host first`)
  }
}

/** Inspect the exact local database without reading stored memory content. */
export function inspectAgentMemoryDatabase(home?: string): AgentMemoryDatabaseMetadata {
  const path = resolve(databasePath(home))
  assertRegularFile(path)
  assertNoLiveSidecars(path)
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const { application_id: applicationId } = database.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: schemaVersion } = database.prepare('PRAGMA user_version').get() as { user_version: number }
    return { path, applicationId, schemaVersion }
  } finally {
    database.close()
  }
}

function backupDestination(path: string, schemaVersion: number, now: Date): string {
  const timestamp = now.toISOString().replaceAll(/[:.]/g, '-')
  return join(dirname(path), 'backups', `agent-memory-v${String(schemaVersion)}-${timestamp}.sqlite`)
}

/** Reset an unsupported agent-memory database through the selected explicit mode. */
export function resetAgentMemoryDatabase(options: ResetAgentMemoryOptions, now = new Date()): ResetAgentMemoryResult {
  const metadata = inspectAgentMemoryDatabase(options.home)
  if (metadata.applicationId !== AGENT_MEMORY_APPLICATION_ID) {
    throw new Error(`memory:reset refuses ${JSON.stringify(metadata.path)} because it is not an agent-memory database`)
  }
  if (metadata.schemaVersion === CURRENT_SCHEMA_VERSION) {
    throw new Error(`memory:reset refuses current schema version ${String(CURRENT_SCHEMA_VERSION)}; use the Long-term memory page to clear entries`)
  }
  if (options.mode === 'delete') {
    unlinkSync(metadata.path)
    return { path: metadata.path, schemaVersion: metadata.schemaVersion }
  }
  const destination = backupDestination(metadata.path, metadata.schemaVersion, now)
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const backupDirectory = lstatSync(dirname(destination))
  if (backupDirectory.isSymbolicLink() || !backupDirectory.isDirectory()) {
    throw new Error(`memory:reset refuses non-directory backup path ${JSON.stringify(dirname(destination))}`)
  }
  linkSync(metadata.path, destination)
  unlinkSync(metadata.path)
  return { path: metadata.path, schemaVersion: metadata.schemaVersion, backupPath: destination }
}

async function main(): Promise<void> {
  const result = resetAgentMemoryDatabase(parseResetAgentMemoryArgs(process.argv.slice(2)))
  if (result.backupPath === undefined) {
    console.log(`memory:reset: deleted unsupported schema v${String(result.schemaVersion)} database ${result.path}`)
  } else {
    console.log(`memory:reset: moved unsupported schema v${String(result.schemaVersion)} database to ${result.backupPath}`)
  }
  console.log('memory:reset: the next Host start will create an empty schema v3 database; session logs and settings were not changed')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
