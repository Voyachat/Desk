/** Static, side-effect-free pre-install review for local DSH plugin artifacts. */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import parseSpdx from 'spdx-expression-parse'
import { list as listTar, type ReadEntry } from 'tar'

const MAX_FILES = 2_000
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_SCANNED_FILE_BYTES = 1024 * 1024
const TEXT_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.yaml', '.yml'])

/** Severity attached to one pre-install finding. */
export type PluginAuditSeverity = 'block' | 'warning' | 'info'

/** One source-specific security or compatibility observation. */
export interface PluginAuditFinding {
  readonly severity: PluginAuditSeverity
  readonly code: string
  readonly file?: string
  readonly message: string
}

/** Complete report bound to the reviewed local bytes by SHA-256. */
export interface PluginAuditReport {
  readonly source: string
  readonly sourceKind: 'directory' | 'tarball'
  readonly digest: string
  readonly packageName: string | null
  readonly packageVersion: string | null
  readonly license: string | null
  readonly status: 'pass' | 'review' | 'blocked'
  readonly findings: readonly PluginAuditFinding[]
}

interface SourceFile {
  readonly path: string
  readonly bytes: Buffer
}

function finding(
  severity: PluginAuditSeverity,
  code: string,
  message: string,
  file?: string,
): PluginAuditFinding {
  return file === undefined ? { severity, code, message } : { severity, code, message, file }
}

function assertBudget(files: readonly SourceFile[]): void {
  if (files.length > MAX_FILES) throw new Error(`plugin source exceeds ${String(MAX_FILES)} files`)
  const bytes = files.reduce((sum, file) => sum + file.bytes.length, 0)
  if (bytes > MAX_TOTAL_BYTES) throw new Error(`plugin source exceeds ${String(MAX_TOTAL_BYTES)} bytes`)
}

function readDirectory(root: string, findings: PluginAuditFinding[]): SourceFile[] {
  const files: SourceFile[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      const local = relative(root, absolute).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        findings.push(finding('block', 'symbolic_link', 'symbolic links are not accepted in reviewed plugin sources', local))
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        visit(absolute)
        continue
      }
      if (!entry.isFile()) {
        findings.push(finding('block', 'special_file', 'special filesystem entries are not accepted', local))
        continue
      }
      files.push({ path: local, bytes: readFileSync(absolute) })
      assertBudget(files)
    }
  }
  visit(root)
  return files
}

function unsafeArchivePath(value: string): boolean {
  const normalized = posix.normalize(value)
  return /[\\\u0000-\u001f\u007f]/.test(value)
    || posix.isAbsolute(value)
    || normalized !== value
    || normalized === '..'
    || normalized.startsWith('../')
}

function readTarball(file: string, findings: PluginAuditFinding[]): SourceFile[] {
  const files: SourceFile[] = []
  const paths = new Set<string>()
  listTar({
    file,
    sync: true,
    strict: true,
    onReadEntry(entry: ReadEntry) {
      if (unsafeArchivePath(entry.path)) {
        findings.push(finding('block', 'archive_path', 'archive entry path is unsafe or non-canonical', entry.path))
        entry.resume()
        return
      }
      if (paths.has(entry.path)) {
        findings.push(finding('block', 'archive_duplicate', 'archive contains a duplicate path', entry.path))
        entry.resume()
        return
      }
      paths.add(entry.path)
      if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
        findings.push(finding('block', 'archive_link', 'archive links are not accepted', entry.path))
        entry.resume()
        return
      }
      if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'ContiguousFile') {
        entry.resume()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      entry.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_TOTAL_BYTES) throw new Error(`archive entry ${entry.path} exceeds audit byte budget`)
        chunks.push(chunk)
      })
      entry.on('end', () => {
        files.push({ path: entry.path, bytes: Buffer.concat(chunks) })
        assertBudget(files)
      })
    },
  })
  return files
}

function stableDigest(files: readonly SourceFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.bytes)
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function manifestFile(files: readonly SourceFile[]): SourceFile | undefined {
  return files
    .filter(file => file.path === 'package.json' || file.path.endsWith('/package.json'))
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length)[0]
}

function packageRoot(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/')
  return slash === -1 ? '' : manifestPath.slice(0, slash + 1)
}

function manifestRecord(file: SourceFile, findings: PluginAuditFinding[]): Record<string, unknown> | null {
  try {
    const value = JSON.parse(file.bytes.toString('utf8')) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch (error) {
    findings.push(finding('block', 'manifest_json', `package.json is not valid JSON: ${String(error)}`, file.path))
    return null
  }
  findings.push(finding('block', 'manifest_object', 'package.json must contain an object', file.path))
  return null
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' && record[key] !== '' ? record[key] : null
}

function inspectManifest(
  manifest: Record<string, unknown>,
  root: string,
  files: ReadonlyMap<string, SourceFile>,
  findings: PluginAuditFinding[],
): { name: string | null; version: string | null; license: string | null } {
  const name = stringValue(manifest, 'name')
  const version = stringValue(manifest, 'version')
  const license = stringValue(manifest, 'license')
  if (name === null) findings.push(finding('block', 'package_name', 'package.json must declare a non-empty name'))
  if (version === null) findings.push(finding('block', 'package_version', 'package.json must declare a non-empty version'))
  if (license === null) {
    findings.push(finding('block', 'package_license', 'package.json must declare an SPDX license expression'))
  } else {
    try {
      parseSpdx(license)
    } catch {
      findings.push(finding('block', 'package_license', 'package.json license is not a valid SPDX expression'))
    }
  }

  const dsh = nestedRecord(manifest, 'dsh')
  const bundle = dsh === null ? null : nestedRecord(dsh, 'bundle')
  const patch = bundle === null ? null : stringValue(bundle, 'patch')
  if (patch === null) {
    findings.push(finding('block', 'bundle_manifest', 'package.json must declare dsh.bundle.patch'))
  } else {
    const localPatch = patch.replace(/^\.\//, '')
    const patchPath = `${root}${localPatch}`
    if (unsafeArchivePath(localPatch)) {
      findings.push(finding('block', 'bundle_patch_path', `declared bundle patch ${patch} is not a canonical package-relative path`))
    }
    const patchFile = files.get(patchPath)
    if (patchFile === undefined) {
      findings.push(finding('block', 'bundle_patch_missing', `declared bundle patch ${patch} is absent`))
    } else {
      try {
        const document = loadYaml(patchFile.bytes.toString('utf8'))
        if (!Array.isArray(document)) throw new Error('top level must be a patch array')
      } catch (error) {
        findings.push(finding('block', 'bundle_patch_yaml', `bundle patch is invalid: ${String(error)}`, patchPath))
      }
    }
  }

  const main = stringValue(manifest, 'main')
  if (main === null) {
    findings.push(finding('block', 'runtime_entry', 'package.json must declare a built main entry'))
  } else {
    const localMain = main.replace(/^\.\//, '')
    if (unsafeArchivePath(localMain)) {
      findings.push(finding('block', 'runtime_entry_path', `built main entry ${main} is not a canonical package-relative path`))
    } else if (!files.has(`${root}${localMain}`)) {
      findings.push(finding('block', 'runtime_entry_missing', `built main entry ${main} is absent`))
    }
  }

  const scripts = nestedRecord(manifest, 'scripts')
  const lifecycle = scripts === null
    ? []
    : ['preinstall', 'install', 'postinstall', 'prepare'].filter(key => typeof scripts[key] === 'string')
  if (lifecycle.length > 0) {
    findings.push(finding(
      'warning',
      'lifecycle_scripts',
      `lifecycle scripts (${lifecycle.join(', ')}) will be disabled during installation`,
    ))
  }
  const dependencyCount = ['dependencies', 'optionalDependencies', 'peerDependencies']
    .map(key => nestedRecord(manifest, key))
    .reduce((total, dependencies) => total + Object.keys(dependencies ?? {}).length, 0)
  if (dependencyCount > 0) {
    findings.push(finding(
      'warning',
      'dependency_sources',
      `static review does not inspect the ${String(dependencyCount)} declared dependency entries`,
    ))
  }
  if (dependencyCount > 100) {
    findings.push(finding('warning', 'dependency_count', `package declares ${String(dependencyCount)} direct dependency entries`))
  }
  return { name, version, license }
}

const CODE_PATTERNS: ReadonlyArray<{
  code: string
  expression: RegExp
  message: string
}> = [
  { code: 'subprocess', expression: /(?:node:)?child_process|\b(?:exec|spawn)(?:Sync)?\s*\(/, message: 'source can launch subprocesses' },
  { code: 'environment', expression: /process\.env|DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY/, message: 'source reads process environment or named credentials' },
  { code: 'network', expression: /\bfetch\s*\(|(?:node:)?https?|WebSocket/, message: 'source can make network requests' },
  { code: 'listener', expression: /\.listen\s*\(/, message: 'source can open a network listener' },
  { code: 'destructive_fs', expression: /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/, message: 'source can delete filesystem entries' },
  { code: 'dynamic_code', expression: /\beval\s*\(|new\s+Function\s*\(/, message: 'source can evaluate dynamic code' },
  { code: 'sensitive_paths', expression: /\.(?:ssh|aws|codex)(?:[/\\]|['"])/, message: 'source names a sensitive local configuration path' },
]

function inspectSource(files: readonly SourceFile[], findings: PluginAuditFinding[]): void {
  for (const file of files) {
    const base = file.path.split('/').at(-1) ?? file.path
    if (base === '.npmrc' || base === '.pnpmfile.cjs' || base === 'pnpm-workspace.yaml') {
      findings.push(finding('block', 'package_manager_config', 'plugin-local package-manager configuration is not accepted', file.path))
    }
    if (['.node', '.wasm'].includes(extname(file.path))) {
      findings.push(finding('warning', 'opaque_runtime', 'native or WebAssembly runtime content is not statically inspected', file.path))
    }
    if (!TEXT_EXTENSIONS.has(extname(file.path))) continue
    if (file.bytes.length > MAX_SCANNED_FILE_BYTES) {
      findings.push(finding('warning', 'large_source', 'source file exceeds the static text scan limit', file.path))
      continue
    }
    const text = file.bytes.toString('utf8')
    for (const pattern of CODE_PATTERNS) {
      if (pattern.expression.test(text)) findings.push(finding('warning', pattern.code, pattern.message, file.path))
    }
  }
}

function status(findings: readonly PluginAuditFinding[]): PluginAuditReport['status'] {
  if (findings.some(item => item.severity === 'block')) return 'blocked'
  if (findings.some(item => item.severity === 'warning')) return 'review'
  return 'pass'
}

/** Audit a local directory or `.tgz`/`.tar.gz` before pnpm sees it. */
export function auditPluginSource(source: string): PluginAuditReport {
  const absolute = resolve(source)
  const stat = lstatSync(absolute)
  const findings: PluginAuditFinding[] = []
  let sourceKind: PluginAuditReport['sourceKind']
  let files: SourceFile[]
  if (stat.isDirectory()) {
    sourceKind = 'directory'
    files = readDirectory(absolute, findings)
    findings.push(finding('warning', 'mutable_directory', 'a directory install remains linked to mutable local source'))
  } else if (stat.isFile() && (absolute.endsWith('.tgz') || absolute.endsWith('.tar.gz'))) {
    sourceKind = 'tarball'
    files = readTarball(absolute, findings)
  } else {
    throw new Error('plugin audit accepts a local directory, .tgz, or .tar.gz artifact')
  }
  assertBudget(files)
  const byPath = new Map(files.map(file => [file.path, file]))
  const manifest = manifestFile(files)
  let identity = { name: null, version: null, license: null } as {
    name: string | null
    version: string | null
    license: string | null
  }
  if (manifest === undefined) {
    findings.push(finding('block', 'manifest_missing', 'plugin source contains no package.json'))
  } else {
    const root = packageRoot(manifest.path)
    if (sourceKind === 'tarball' && root !== '') {
      for (const file of files) {
        if (!file.path.startsWith(root)) {
          findings.push(finding('block', 'archive_root', 'archive file sits outside the package manifest root', file.path))
        }
      }
    }
    const record = manifestRecord(manifest, findings)
    if (record !== null) identity = inspectManifest(record, root, byPath, findings)
  }
  inspectSource(files, findings)
  return {
    source: absolute,
    sourceKind,
    digest: stableDigest(files),
    packageName: identity.name,
    packageVersion: identity.version,
    license: identity.license,
    status: status(findings),
    findings,
  }
}

/** Resolve a CLI package spec only when it points to reviewable local bytes. */
export function localPluginSource(spec: string, cwd: string): string {
  if (spec.startsWith('link:')) throw new Error('link: plugin specs are mutable and cannot pass the install audit')
  const value = spec.startsWith('file:') ? spec.slice('file:'.length) : spec
  const looksLocal = isAbsolute(value) || value === '.' || value === '..'
    || value.startsWith('./') || value.startsWith('../')
  if (!looksLocal) {
    throw new Error('remote plugin specs are disabled until exact npm/GitHub artifacts can be pinned and audited; download an exact tarball or checkout and pass its local path')
  }
  return resolve(cwd, value)
}

/** Render a stable human-readable report for explicit review and approval. */
export function renderPluginAudit(report: PluginAuditReport): string {
  const lines = [
    `plugin audit: ${report.status}`,
    `source: ${report.source}`,
    `artifact: ${report.sourceKind} ${report.digest}`,
    `package: ${report.packageName ?? 'unknown'}@${report.packageVersion ?? 'unknown'}`,
    `license: ${report.license ?? 'unknown'}`,
  ]
  for (const item of report.findings) {
    lines.push(`${item.severity.toUpperCase()} ${item.code}${item.file === undefined ? '' : ` ${item.file}`}: ${item.message}`)
  }
  return `${lines.join('\n')}\n`
}
