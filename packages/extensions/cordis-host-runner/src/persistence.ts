/**
 * Durable dynamic Cordis definitions under the Harness home. A manifest is the
 * commit point and references content-addressed JavaScript artifacts written
 * before it, so failed builds and interrupted publication leave the previous
 * complete registry readable.
 * @module @voyaseek-ai/dsh-cordis-host-runner/persistence
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomeDisplay, resolveDshHome } from '@voyaseek-ai/dsh-home-paths'
import type { SessionId } from '@voyaseek-ai/dsh-session/types'
import type {
  DynamicCordisDefinition, DynamicCordisPlugin, DynamicCordisRegistrySnapshot,
} from './registry.ts'
import type { CordisDynamicPackageId, CordisDynamicPluginId } from './types.ts'

/** Current on-disk registry format. Pre-release readers reject every other version. */
export const DYNAMIC_CORDIS_STORE_VERSION = 1

/** Harness-home child owned by this service. */
export const DYNAMIC_CORDIS_STORE_DIRECTORY = 'dynamic-cordis'

interface StoredArtifact {
  sha256: string
}

interface StoredPackage {
  packageId: string
  name: string
  purpose: string
  source: { host?: string; client?: string }
  artifacts: { host?: StoredArtifact; client?: StoredArtifact }
}

interface StoredPlugin {
  pluginId: string
  sessionId: string
  packages: StoredPackage[]
  currentPackageId?: string
}

interface StoredRegistry {
  formatVersion: number
  nextPlugin: number
  nextPackage: number
  plugins: StoredPlugin[]
}

/** Narrow one durable JSON object. */
function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Read one required durable string. */
function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${where} must be a non-empty string`)
  return value
}

/** Read one positive durable integer. */
function positiveInteger(value: unknown, where: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${where} must be a positive integer`)
  return value as number
}

/** SHA-256 identity of a built artifact. */
function digest(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Prove that one service-owned path is a physical directory, never a symlink. */
function ensureOwnedDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`dynamic Cordis owner path "${path}" must be a non-symlink directory`)
  }
}

/** Read one owner file without following a symlink. */
function readRegularText(path: string): string {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`dynamic Cordis file "${path}" must be a non-symlink regular file`)
  }
  return readFileSync(path, 'utf8')
}

/** Replace one owner-only text file without exposing a partial target. */
function writeAtomic(filename: string, content: string): void {
  ensureOwnedDirectory(dirname(filename))
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temp, filename)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** File-backed owner of dynamic definitions and built JavaScript artifacts. */
export class DynamicCordisPersistence {
  /** Absolute service-owned directory under the resolved Harness home. */
  readonly root: string
  /** Atomic manifest commit point. */
  readonly manifestPath: string
  private readonly artifactsPath: string
  private readonly sourcesPath: string
  private readonly rootDisplay: string

  /**
   * Resolve and prepare `$VOYASEEK_HOME/dynamic-cordis`.
   * @param configuredHome - explicit Harness-home override, primarily from plugin config.
   */
  constructor(configuredHome?: string) {
    const home = resolveDshHome(configuredHome)
    this.root = join(home, DYNAMIC_CORDIS_STORE_DIRECTORY)
    this.manifestPath = join(this.root, 'registry.json')
    this.artifactsPath = join(this.root, 'artifacts')
    this.sourcesPath = join(this.root, 'sources')
    this.rootDisplay = join(dshHomeDisplay(home), DYNAMIC_CORDIS_STORE_DIRECTORY)
    ensureOwnedDirectory(this.root)
    ensureOwnedDirectory(this.artifactsPath)
    ensureOwnedDirectory(this.sourcesPath)
  }

  /**
   * Load and validate the complete durable registry. Temporary or orphaned
   * artifacts are ignored because only the atomic manifest is authoritative.
   * @returns definitions and stable Plugin/Package identity counters.
   */
  load(): DynamicCordisRegistrySnapshot {
    let raw: string
    try {
      raw = readRegularText(this.manifestPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { plugins: [], nextPlugin: 1, nextPackage: 1 }
      }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`dynamic Cordis registry at "${this.manifestPath}" is not valid JSON`, { cause: error })
    }
    return this.parseRegistry(parsed)
  }

  /**
   * Publish a complete registry. Every content-addressed artifact is present
   * and verified before the manifest rename commits references to it.
   * @param snapshot - current in-memory definitions and identity counters.
   */
  save(snapshot: DynamicCordisRegistrySnapshot): void {
    const stored: StoredRegistry = {
      formatVersion: DYNAMIC_CORDIS_STORE_VERSION,
      nextPlugin: snapshot.nextPlugin,
      nextPackage: snapshot.nextPackage,
      plugins: snapshot.plugins.map(plugin => this.storePlugin(plugin)),
    }
    writeAtomic(this.manifestPath, `${JSON.stringify(stored, null, 2)}\n`)
  }

  /**
   * Stable development source files for one Plugin. They are working copies;
   * immutable source history remains in `registry.json` beside built artifacts.
   * @param pluginId - validated Host-minted Plugin identity.
   * @returns absolute paths for file I/O and symbolic paths safe for UI display.
   */
  sourceFiles(pluginId: CordisDynamicPluginId): {
    host: string
    client: string
    display: { host: string; client: string }
  } {
    const directory = join(this.sourcesPath, pluginId)
    ensureOwnedDirectory(directory)
    return this.sourceFilePaths(pluginId, directory)
  }

  /**
   * Symbolic working-copy paths without touching the filesystem.
   * @param pluginId - Plugin whose user-facing paths are needed after manifest commit.
   * @param definition - immutable Package selecting the present halves.
   * @returns symbolic paths for exactly those halves.
   */
  sourceDisplay(
    pluginId: CordisDynamicPluginId,
    definition: DynamicCordisDefinition,
  ): { host?: string; client?: string } {
    const paths = this.sourceFilePaths(pluginId, join(this.sourcesPath, pluginId))
    return {
      ...definition.hostSource === undefined ? {} : { host: paths.display.host },
      ...definition.clientSource === undefined ? {} : { client: paths.display.client },
    }
  }

  /** Build absolute and symbolic paths after the caller applies its I/O policy. */
  private sourceFilePaths(pluginId: CordisDynamicPluginId, directory: string): {
    host: string
    client: string
    display: { host: string; client: string }
  } {
    return {
      host: join(directory, 'host.ts'),
      client: join(directory, 'client.tsx'),
      display: {
        host: join(this.rootDisplay, 'sources', pluginId, 'host.ts'),
        client: join(this.rootDisplay, 'sources', pluginId, 'client.tsx'),
      },
    }
  }

  /**
   * Replace the supplied working-source halves atomically. An omitted half is
   * left alone because another immutable Package may still use it as its edit base.
   * @param pluginId - Plugin whose stable working copy is updated.
   * @param source - successfully compiled source halves.
   */
  writeSources(pluginId: CordisDynamicPluginId, source: { host?: string; client?: string }): void {
    const files = this.sourceFiles(pluginId)
    if (source.host !== undefined) writeAtomic(files.host, source.host)
    if (source.client !== undefined) writeAtomic(files.client, source.client)
  }

  /**
   * Read working copies for the halves present in one immutable definition.
   * Missing files fall back to that definition's retained source and are
   * atomically created; existing invalid edits are preserved across restart.
   * @param pluginId - Plugin whose edit base is needed.
   * @param definition - latest immutable Package supplying present halves.
   * @returns the exact working text and symbolic paths shown to users.
   */
  readSources(
    pluginId: CordisDynamicPluginId,
    definition: DynamicCordisDefinition,
  ): { source: { host?: string; client?: string }; display: { host?: string; client?: string } } {
    const files = this.sourceFiles(pluginId)
    const source: { host?: string; client?: string } = {}
    const display: { host?: string; client?: string } = {}
    if (definition.hostSource !== undefined) {
      try {
        source.host = readRegularText(files.host)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        writeAtomic(files.host, definition.hostSource)
        source.host = definition.hostSource
      }
      display.host = files.display.host
    }
    if (definition.clientSource !== undefined) {
      try {
        source.client = readRegularText(files.client)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        writeAtomic(files.client, definition.clientSource)
        source.client = definition.clientSource
      }
      display.client = files.display.client
    }
    return { source, display }
  }

  /** Persist one plugin and ensure all of its immutable artifacts exist first. */
  private storePlugin(plugin: DynamicCordisPlugin): StoredPlugin {
    const packages = [...plugin.packages.values()].map(definition => this.storePackage(definition))
    if (plugin.currentPackageId !== undefined
      && !plugin.packages.has(plugin.currentPackageId)) {
      throw new Error(`dynamic plugin "${plugin.pluginId}" points at missing current package "${plugin.currentPackageId}"`)
    }
    return {
      pluginId: plugin.pluginId,
      sessionId: plugin.sessionId,
      packages,
      ...plugin.currentPackageId === undefined ? {} : { currentPackageId: plugin.currentPackageId },
    }
  }

  /** Persist one immutable package after writing its built halves. */
  private storePackage(definition: DynamicCordisDefinition): StoredPackage {
    if ((definition.hostSource === undefined) !== (definition.hostCode === undefined)
      || (definition.clientSource === undefined) !== (definition.clientCode === undefined)
      || (definition.hostCode === undefined && definition.clientCode === undefined)) {
      throw new Error(`dynamic package "${definition.packageId}" has incomplete source/artifact pairs`)
    }
    return {
      packageId: definition.packageId,
      name: definition.name,
      purpose: definition.purpose,
      source: {
        ...definition.hostSource === undefined ? {} : { host: definition.hostSource },
        ...definition.clientSource === undefined ? {} : { client: definition.clientSource },
      },
      artifacts: {
        ...definition.hostCode === undefined ? {} : { host: this.storeArtifact(definition.hostCode) },
        ...definition.clientCode === undefined ? {} : { client: this.storeArtifact(definition.clientCode) },
      },
    }
  }

  /** Ensure one content-addressed JavaScript artifact is complete and owner-only. */
  private storeArtifact(code: string): StoredArtifact {
    const sha256 = digest(code)
    const path = join(this.artifactsPath, `${sha256}.js`)
    let current: string | undefined
    try {
      current = readRegularText(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (current !== code) writeAtomic(path, code)
    return { sha256 }
  }

  /** Parse the durable boundary and materialize runtime definitions from built artifacts only. */
  private parseRegistry(value: unknown): DynamicCordisRegistrySnapshot {
    const root = record(value, 'dynamic Cordis registry')
    if (root.formatVersion !== DYNAMIC_CORDIS_STORE_VERSION) {
      throw new Error(
        `dynamic Cordis registry format ${String(root.formatVersion)} is unsupported; expected ${DYNAMIC_CORDIS_STORE_VERSION}`,
      )
    }
    const nextPlugin = positiveInteger(root.nextPlugin, 'dynamic Cordis registry.nextPlugin')
    const nextPackage = positiveInteger(root.nextPackage, 'dynamic Cordis registry.nextPackage')
    if (!Array.isArray(root.plugins)) throw new Error('dynamic Cordis registry.plugins must be an array')
    const pluginIds = new Set<string>()
    const packageIds = new Set<string>()
    let highestPlugin = 0
    let highestPackage = 0
    const plugins = root.plugins.map((item, index) => {
      const stored = record(item, `dynamic Cordis registry.plugins[${index}]`)
      const pluginId = text(stored.pluginId, `dynamic Cordis registry.plugins[${index}].pluginId`)
      const pluginMatch = /^([a-z]{3,6})-([1-9]\d*)$/.exec(pluginId)
      if (pluginMatch === null) throw new Error(`invalid durable dynamic Plugin ID "${pluginId}"`)
      if (pluginIds.has(pluginId)) throw new Error(`duplicate durable dynamic Plugin ID "${pluginId}"`)
      pluginIds.add(pluginId)
      highestPlugin = Math.max(highestPlugin, Number(pluginMatch[2]))
      const sessionId = text(stored.sessionId, `dynamic plugin ${pluginId}.sessionId`) as SessionId
      if (!Array.isArray(stored.packages) || stored.packages.length === 0) {
        throw new Error(`dynamic plugin "${pluginId}" must contain at least one Package`)
      }
      const packages = new Map<CordisDynamicPackageId, DynamicCordisDefinition>()
      for (const [packageIndex, packageValue] of stored.packages.entries()) {
        const definition = this.parsePackage(pluginId, packageIndex, packageValue)
        if (packageIds.has(definition.packageId)) {
          throw new Error(`duplicate durable dynamic Package ID "${definition.packageId}"`)
        }
        packageIds.add(definition.packageId)
        highestPackage = Math.max(highestPackage, Number(definition.packageId.slice(4)))
        packages.set(definition.packageId, definition)
      }
      const current = stored.currentPackageId
      if (current !== undefined && (typeof current !== 'string' || !packages.has(current as CordisDynamicPackageId))) {
        throw new Error(`dynamic plugin "${pluginId}" has invalid currentPackageId "${String(current)}"`)
      }
      return {
        pluginId: pluginId as CordisDynamicPluginId,
        sessionId,
        packages,
        approvedClientPackages: new Set<CordisDynamicPackageId>(),
        clientVersionUpdatesApproved: false,
        ...current === undefined ? {} : { currentPackageId: current as CordisDynamicPackageId },
      }
    })
    if (nextPlugin <= highestPlugin || nextPackage <= highestPackage) {
      throw new Error('dynamic Cordis registry identity counters would reuse a durable Plugin or Package ID')
    }
    return { plugins, nextPlugin, nextPackage }
  }

  /** Parse one immutable Package and read only its digest-verified built artifacts. */
  private parsePackage(pluginId: string, index: number, value: unknown): DynamicCordisDefinition {
    const stored = record(value, `dynamic plugin ${pluginId}.packages[${index}]`)
    const packageId = text(stored.packageId, `dynamic plugin ${pluginId}.packages[${index}].packageId`)
    if (!/^pkg-[1-9]\d*$/.test(packageId)) throw new Error(`invalid durable dynamic Package ID "${packageId}"`)
    const source = record(stored.source, `dynamic package ${packageId}.source`)
    const artifacts = record(stored.artifacts, `dynamic package ${packageId}.artifacts`)
    const hostSource = source.host === undefined ? undefined : text(source.host, `dynamic package ${packageId}.source.host`)
    const clientSource = source.client === undefined ? undefined : text(source.client, `dynamic package ${packageId}.source.client`)
    const hostCode = artifacts.host === undefined ? undefined : this.readArtifact(packageId, 'host', artifacts.host)
    const clientCode = artifacts.client === undefined ? undefined : this.readArtifact(packageId, 'client', artifacts.client)
    if ((hostSource === undefined) !== (hostCode === undefined)
      || (clientSource === undefined) !== (clientCode === undefined)
      || (hostCode === undefined && clientCode === undefined)) {
      throw new Error(`dynamic package "${packageId}" has incomplete durable source/artifact pairs`)
    }
    const definition: DynamicCordisDefinition = {
      packageId: packageId as CordisDynamicPackageId,
      name: text(stored.name, `dynamic package ${packageId}.name`),
      purpose: text(stored.purpose, `dynamic package ${packageId}.purpose`),
    }
    if (hostSource !== undefined && hostCode !== undefined) {
      definition.hostSource = hostSource
      definition.hostCode = hostCode
    }
    if (clientSource !== undefined && clientCode !== undefined) {
      definition.clientSource = clientSource
      definition.clientCode = clientCode
    }
    return definition
  }

  /** Read one regular artifact and prove its content identity. */
  private readArtifact(packageId: string, half: 'host' | 'client', value: unknown): string {
    const stored = record(value, `dynamic package ${packageId}.artifacts.${half}`)
    const sha256 = text(stored.sha256, `dynamic package ${packageId}.artifacts.${half}.sha256`)
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`dynamic package "${packageId}" has invalid ${half} artifact digest`)
    const path = join(this.artifactsPath, `${sha256}.js`)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`dynamic package "${packageId}" ${half} artifact is not a regular file`)
    }
    const code = readFileSync(path, 'utf8')
    if (digest(code) !== sha256) throw new Error(`dynamic package "${packageId}" ${half} artifact digest mismatch`)
    return code
  }
}
