import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TARGET_NODE_PTY_PREBUILD } from './stage-runtime.mjs'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultRepoRoot = resolve(packageDir, '..', '..')
const defaultPolicyPath = resolve(packageDir, 'startup-policy.json')
const expectedActivation = 'after-startup-shell-show'
const expectedDistExtensions = new Set(['.cjs', '.js'])

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requiredOnly = process.argv[2] === '--required-only'
  if (process.argv.length !== (requiredOnly ? 3 : 2)) {
    throw new Error('usage: node scripts/verify-startup-policy.mjs [--required-only]')
  }
  const summary = verifyStartupPolicy(defaultPolicyPath, defaultRepoRoot, { requiredOnly })
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

/**
 * Verify the files and activation rule that define interactive desktop startup.
 *
 * @param {string} policyPath Startup policy JSON path.
 * @param {string} repoRoot Repository root used to resolve policy paths.
 * @param {{ requiredOnly?: boolean }} [options] Skip generated-runtime inspection during ordinary TypeScript compilation.
 * @returns {{ event: string, verification: string, policyPath: string, required: { totalBytes: number, fileCount: number, maxTotalBytes: number }, deferred: { managedRuntimeRoot: string, activation: string }, excluded: { nodePtyPrebuildRoot: string, target: string } }} Verification summary.
 */
export function verifyStartupPolicy(policyPath, repoRoot, options = {}) {
  const policy = parsePolicy(policyPath)
  const shellHtml = resolvePolicyPath(repoRoot, policy.required.startupShell.html)
  const shellResources = policy.required.startupShell.resources.map(path => resolvePolicyPath(repoRoot, path))
  const distRoot = resolvePolicyPath(repoRoot, policy.required.desktopDist.root)
  const managedRuntimeRoot = resolvePolicyPath(repoRoot, policy.deferred.managedRuntimeRoot)
  const nodePtyPrebuildRoot = resolvePolicyPath(repoRoot, policy.excluded.nodePtyPrebuilds.root)

  assertPhysicalFile(shellHtml, 'required startup HTML')
  for (const resource of shellResources) assertPhysicalFile(resource, 'required startup resource')
  const distFiles = collectDistFiles(distRoot, policy.required.desktopDist.extensions)
  const requiredFiles = [shellHtml, ...shellResources, ...distFiles]
  assertUniquePaths(requiredFiles, 'required startup file')
  if (options.requiredOnly !== true) {
    assertDirectory(managedRuntimeRoot, 'deferred managed runtime root')
    assertDirectory(nodePtyPrebuildRoot, 'excluded node-pty prebuild root')
  }
  assertCategoriesAreDisjoint(requiredFiles, managedRuntimeRoot, nodePtyPrebuildRoot)
  verifyStartupHtml(shellHtml, shellResources)
  if (options.requiredOnly !== true) {
    verifyExcludedNodePtyPrebuilds(nodePtyPrebuildRoot, policy.excluded.nodePtyPrebuilds.target)
  }

  const totalBytes = requiredFiles.reduce((total, path) => total + lstatSync(path).size, 0)
  if (totalBytes > policy.required.maxTotalBytes) {
    throw new Error(
      `desktop startup required-byte budget exceeded: ${String(totalBytes)} > ${String(policy.required.maxTotalBytes)}`,
    )
  }

  return {
    event: 'aistaff_desktop_startup_policy_verified',
    verification: options.requiredOnly === true ? 'required-only' : 'full',
    policyPath: relative(repoRoot, policyPath),
    required: {
      totalBytes,
      fileCount: requiredFiles.length,
      maxTotalBytes: policy.required.maxTotalBytes,
    },
    deferred: {
      managedRuntimeRoot: policy.deferred.managedRuntimeRoot,
      activation: policy.deferred.activation,
    },
    excluded: {
      nodePtyPrebuildRoot: policy.excluded.nodePtyPrebuilds.root,
      target: policy.excluded.nodePtyPrebuilds.target,
    },
  }
}

function parsePolicy(policyPath) {
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'))
  assertRecord(policy, 'startup policy')
  assertExactKeys(policy, ['schemaVersion', 'required', 'deferred', 'excluded'], 'startup policy')
  if (policy.schemaVersion !== 1) throw new Error('startup policy schemaVersion must be 1')

  assertRecord(policy.required, 'startup policy required category')
  assertExactKeys(policy.required, ['startupShell', 'desktopDist', 'maxTotalBytes'], 'startup policy required category')
  assertRecord(policy.required.startupShell, 'startup policy required.startupShell')
  assertExactKeys(policy.required.startupShell, ['html', 'resources'], 'startup policy required.startupShell')
  assertRelativePath(policy.required.startupShell.html, 'startup policy required.startupShell.html')
  if (extname(policy.required.startupShell.html) !== '.html') {
    throw new Error('startup policy required.startupShell.html must be an HTML file')
  }
  assertStringArray(policy.required.startupShell.resources, 'startup policy required.startupShell.resources')
  for (const path of policy.required.startupShell.resources) {
    assertRelativePath(path, 'startup policy required.startupShell.resources entry')
    if (!['.css', '.js'].includes(extname(path))) {
      throw new Error(`startup shell resource must be CSS or JS: ${path}`)
    }
  }
  if (new Set(policy.required.startupShell.resources).size !== policy.required.startupShell.resources.length) {
    throw new Error('startup policy required.startupShell.resources contains a duplicate')
  }
  const shellExtensions = new Set(policy.required.startupShell.resources.map(path => extname(path)))
  if (!shellExtensions.has('.css') || !shellExtensions.has('.js')) {
    throw new Error('startup policy required.startupShell.resources must include CSS and JS')
  }

  assertRecord(policy.required.desktopDist, 'startup policy required.desktopDist')
  assertExactKeys(policy.required.desktopDist, ['root', 'extensions'], 'startup policy required.desktopDist')
  assertRelativePath(policy.required.desktopDist.root, 'startup policy required.desktopDist.root')
  assertStringArray(policy.required.desktopDist.extensions, 'startup policy required.desktopDist.extensions')
  const extensions = new Set(policy.required.desktopDist.extensions)
  if (extensions.size !== expectedDistExtensions.size || [...expectedDistExtensions].some(extension => !extensions.has(extension))) {
    throw new Error('startup policy required.desktopDist.extensions must contain exactly .js and .cjs')
  }
  if (!Number.isSafeInteger(policy.required.maxTotalBytes) || policy.required.maxTotalBytes <= 0) {
    throw new Error('startup policy required.maxTotalBytes must be a positive safe integer')
  }

  assertRecord(policy.deferred, 'startup policy deferred category')
  assertExactKeys(policy.deferred, ['managedRuntimeRoot', 'activation'], 'startup policy deferred category')
  assertRelativePath(policy.deferred.managedRuntimeRoot, 'startup policy deferred.managedRuntimeRoot')
  if (policy.deferred.activation !== expectedActivation) {
    throw new Error(`startup policy deferred.activation must be ${expectedActivation}`)
  }

  assertRecord(policy.excluded, 'startup policy excluded category')
  assertExactKeys(policy.excluded, ['nodePtyPrebuilds'], 'startup policy excluded category')
  assertRecord(policy.excluded.nodePtyPrebuilds, 'startup policy excluded.nodePtyPrebuilds')
  assertExactKeys(policy.excluded.nodePtyPrebuilds, ['root', 'mode', 'target'], 'startup policy excluded.nodePtyPrebuilds')
  assertRelativePath(policy.excluded.nodePtyPrebuilds.root, 'startup policy excluded.nodePtyPrebuilds.root')
  if (policy.excluded.nodePtyPrebuilds.mode !== 'all-except-target') {
    throw new Error('startup policy excluded.nodePtyPrebuilds.mode must be all-except-target')
  }
  if (policy.excluded.nodePtyPrebuilds.target !== TARGET_NODE_PTY_PREBUILD) {
    throw new Error(
      `startup policy node-pty target must match the runtime stager target ${TARGET_NODE_PTY_PREBUILD}`,
    )
  }
  return policy
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} keys must be exactly: ${sortedExpected.join(', ')}`)
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`${label} must be a non-empty string array`)
  }
}

function assertRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`${label} must be a repository-relative path`)
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`${label} must stay inside the repository`)
  }
}

function resolvePolicyPath(repoRoot, path) {
  const resolved = resolve(repoRoot, path)
  const repoRelative = relative(repoRoot, resolved)
  if (repoRelative === '..' || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
    throw new Error(`startup policy path escapes the repository: ${path}`)
  }
  return resolved
}

function assertPhysicalFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${label} must be a regular file: ${path}`)
}

function assertDirectory(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`${label} must be a physical directory: ${path}`)
}

function collectDistFiles(distRoot, extensions) {
  assertDirectory(distRoot, 'required desktop dist root')
  const files = []
  const extensionCounts = new Map(extensions.map(extension => [extension, 0]))
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) throw new Error(`required desktop dist contains a link: ${path}`)
      if (metadata.isDirectory()) { walk(path); continue }
      if (!metadata.isFile()) continue
      const extension = extname(entry)
      if (!extensionCounts.has(extension)) continue
      files.push(path)
      extensionCounts.set(extension, extensionCounts.get(extension) + 1)
    }
  }
  walk(distRoot)
  for (const [extension, count] of extensionCounts) {
    if (count === 0) throw new Error(`required desktop dist has no ${extension} output`)
  }
  return files.sort()
}

function assertUniquePaths(paths, label) {
  if (new Set(paths).size !== paths.length) throw new Error(`${label} is classified more than once`)
}

function assertCategoriesAreDisjoint(requiredFiles, managedRuntimeRoot, nodePtyPrebuildRoot) {
  for (const path of requiredFiles) {
    if (isWithin(managedRuntimeRoot, path)) {
      throw new Error(`required startup file is also inside the deferred runtime: ${path}`)
    }
    if (isWithin(nodePtyPrebuildRoot, path)) {
      throw new Error(`required startup file is also covered by the excluded rule: ${path}`)
    }
  }
  if (!isWithin(managedRuntimeRoot, nodePtyPrebuildRoot)) {
    throw new Error('excluded node-pty prebuild root must be inside the deferred managed runtime')
  }
}

function isWithin(root, candidate) {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))
}

function verifyStartupHtml(htmlPath, shellResources) {
  const html = readFileSync(htmlPath, 'utf8')
  if (/https?:\/\//iu.test(html)) throw new Error('startup HTML must not contain an http or https URL')
  const references = []
  const attributePattern = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/giu
  for (const match of html.matchAll(attributePattern)) {
    const reference = match[2]
    if (reference === undefined || reference.length === 0) throw new Error('startup HTML contains an empty resource reference')
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(reference) || reference.includes('?') || reference.includes('#')) {
      throw new Error(`startup HTML resource reference must be a local file: ${reference}`)
    }
    if (!['.css', '.js'].includes(extname(reference))) {
      throw new Error(`startup HTML may reference only local CSS or JS: ${reference}`)
    }
    references.push(resolve(dirname(htmlPath), reference))
  }
  const expected = [...shellResources].sort()
  const actual = [...new Set(references)].sort()
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error('startup HTML local CSS and JS references must match required.startupShell.resources')
  }
}

function verifyExcludedNodePtyPrebuilds(prebuildRoot, target) {
  const entries = readdirSync(prebuildRoot)
  if (!entries.includes(target)) throw new Error(`deferred runtime is missing the target node-pty prebuild: ${target}`)
  for (const entry of entries) {
    if (entry !== target) throw new Error(`deferred runtime contains an excluded node-pty prebuild: ${entry}`)
  }
}
