import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  globSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDir, '..', '..')
const outputDir = join(packageDir, 'runtime')
const pnpm = process.env.PNPM_EXEC_PATH ?? 'pnpm'
const supervisorCrateDir = join(repoRoot, 'native', 'aistaff-desktop-supervisor')
const supervisorTargetDir = join(supervisorCrateDir, 'target')
const supervisorName = 'aistaff-desktop-supervisor'
const supervisorRuntimePath = join('native', supervisorName)
const expectedMachOArchitecture = 'x86_64'

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 2) stageRuntime()
  else if (process.argv.length === 3 && process.argv[2] === '--verify-only') verifyRuntime(outputDir)
  else throw new Error('usage: node scripts/stage-runtime.mjs [--verify-only]')
}

/** Build and atomically replace the physical desktop runtime closure. */
export function stageRuntime() {
  const stageDir = mkdtempSync(join(tmpdir(), 'aistaff-desktop-runtime-'))
  try {
    const builtSupervisor = buildSupervisorSidecar()
    const deployEnvironment = scrubBuildEnvironment(process.env)
    deployEnvironment.PNPM_CONFIG_OFFLINE = 'true'
    run(pnpm, [
      '--offline',
      '--filter', '@voyaseek-ai/dsh-aistaff-desktop-runtime',
      'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      '--config.lockfile=false',
      '--config.frozen-lockfile=false',
      stageDir,
    ], { env: deployEnvironment, label: 'runtime deploy' })

    materializeLinks(stageDir)
    const builtCli = join(repoRoot, 'apps', 'cli')
    const stagedCli = join(stageDir, 'apps', 'cli')
    if (!existsSync(join(builtCli, 'lib', 'bin.js'))) {
      throw new Error(`built CLI entry is missing: ${join(builtCli, 'lib', 'bin.js')}`)
    }
    mkdirSync(dirname(stagedCli), { recursive: true })
    mkdirSync(stagedCli)
    for (const entry of ['package.json', 'lib', 'config']) {
      cpSync(join(builtCli, entry), join(stagedCli, entry), {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
      })
    }
    addProductBundleAnchor(join(stagedCli, 'package.json'))
    copyMissingWorkspaceClosure(stageDir, join(stagedCli, 'package.json'))
    stageSupervisorSidecar(builtSupervisor, stageDir)
    materializeLinks(stageDir)
    removeDeployMetadata(stageDir)
    pruneDevelopmentArtifacts(stageDir)
    rejectLinks(stageDir)
    verifyRuntime(stageDir)

    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true })
    renameSync(stageDir, outputDir)
    process.stdout.write(`Staged AI Staff runtime at ${outputDir}\n`)
  } catch (error) {
    if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true })
    throw error
  }
}

function run(command, args, options = {}) {
  const capture = options.capture === true
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? scrubBuildEnvironment(process.env),
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = capture && result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : ''
    throw new Error(`${options.label ?? command} failed with exit code ${String(result.status)}${detail}`)
  }
  return result.stdout
}

function buildSupervisorSidecar() {
  assertMacOSX64Host()
  const manifest = join(supervisorCrateDir, 'Cargo.toml')
  const lockfile = join(supervisorCrateDir, 'Cargo.lock')
  assertPhysicalFile(manifest, 'supervisor Cargo manifest')
  assertPhysicalFile(lockfile, 'supervisor Cargo lockfile')
  const environment = scrubBuildEnvironment(process.env)
  delete environment.CARGO_BUILD_TARGET
  delete environment.RUSTFLAGS
  environment.CARGO_NET_OFFLINE = 'true'
  environment.CARGO_TARGET_DIR = supervisorTargetDir
  environment.CARGO_ENCODED_RUSTFLAGS = [
    `--remap-path-prefix=${repoRoot}=.`,
    `--remap-path-prefix=${homedir()}=~`,
  ].join('\u001f')
  run('cargo', [
    'build',
    '--manifest-path', manifest,
    '--release',
    '--locked',
    '--offline',
  ], {
    cwd: supervisorCrateDir,
    env: environment,
    label: 'locked offline supervisor build',
  })
  const artifact = join(supervisorTargetDir, 'release', supervisorName)
  verifySupervisorSidecar(artifact)
  return artifact
}

function scrubBuildEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => {
    return !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)
  }))
}

function stageSupervisorSidecar(source, runtimeRoot) {
  const destination = join(runtimeRoot, supervisorRuntimePath)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  verifySupervisorSidecar(destination)
}

function assertMacOSX64Host() {
  if (process.platform !== 'darwin' || process.arch !== 'x64') {
    throw new Error(
      `desktop supervisor staging requires macOS x64, received ${process.platform} ${process.arch}`,
    )
  }
}

function assertPhysicalFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  const metadata = lstatSync(path)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`)
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file: ${path}`)
  return metadata
}

/** Verify the physical x86_64 Mach-O staged for the desktop Host. */
export function verifySupervisorSidecar(path) {
  assertMacOSX64Host()
  const metadata = assertPhysicalFile(path, 'desktop supervisor sidecar')
  if ((metadata.mode & 0o111) === 0) {
    throw new Error(`desktop supervisor sidecar is not executable: ${path}`)
  }
  const fileDescription = run('file', ['-b', path], {
    capture: true,
    label: 'supervisor Mach-O file inspection',
  }).trim()
  if (!fileDescription.includes('Mach-O 64-bit executable') || !fileDescription.includes(expectedMachOArchitecture)) {
    throw new Error(
      `desktop supervisor sidecar must be a ${expectedMachOArchitecture} Mach-O executable: ${fileDescription}`,
    )
  }
  const machHeader = run('otool', ['-hv', path], {
    capture: true,
    label: 'supervisor Mach-O architecture inspection',
  })
  if (!/\bX86_64\b/u.test(machHeader)) {
    throw new Error(`desktop supervisor sidecar has the wrong Mach-O architecture: ${path}`)
  }
  const linkedLibraries = run('otool', ['-L', path], {
    capture: true,
    label: 'supervisor Mach-O dependency inspection',
  })
  rejectDevelopmentPaths(path)
  for (const line of linkedLibraries.split('\n').slice(1)) {
    const dependency = line.trim().split(' (', 1)[0]
    if (dependency === undefined || dependency.length === 0) continue
    if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) continue
    throw new Error(`desktop supervisor sidecar links a non-system dependency: ${dependency}`)
  }
  process.stdout.write(`Verified desktop supervisor sidecar: ${fileDescription}\n`)
}

function rejectDevelopmentPaths(path) {
  const content = readFileSync(path)
  for (const forbidden of new Set([repoRoot, realpathSync(repoRoot), homedir()])) {
    if (forbidden === sep) continue
    if (content.includes(Buffer.from(forbidden))) {
      throw new Error(`runtime artifact contains a development-machine path: ${path}`)
    }
  }
}

function addProductBundleAnchor(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = {
    ...manifest.dependencies,
    '@voyaseek-ai/dsh-aistaff-product-bundle': '0.1.0-rc.5',
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

function copyMissingWorkspaceClosure(runtimeRoot, cliManifestPath) {
  const workspace = new Map()
  for (const manifestPath of globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: repoRoot })) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'))
    workspace.set(manifest.name, { manifest, source: dirname(join(repoRoot, manifestPath)) })
  }
  const runtimeManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  const queue = Object.keys({ ...runtimeManifest.dependencies, ...cliManifest.dependencies })
    .filter(name => workspace.has(name))
  const seen = new Set(queue)
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index]
    const descriptor = workspace.get(name)
    const target = join(runtimeRoot, 'node_modules', ...name.split('/'))
    if (!existsSync(target)) copyPublishedPackage(descriptor, target)
    const peerDependencies = Object.fromEntries(Object.entries(descriptor.manifest.peerDependencies ?? {})
      .filter(([peer]) => descriptor.manifest.peerDependenciesMeta?.[peer]?.optional !== true))
    for (const dependency of Object.keys({
      ...descriptor.manifest.dependencies,
      ...descriptor.manifest.optionalDependencies,
      ...peerDependencies,
    })) {
      if (!workspace.has(dependency) || seen.has(dependency)) continue
      seen.add(dependency)
      queue.push(dependency)
    }
  }
}

function copyPublishedPackage(descriptor, target) {
  const files = descriptor.manifest.files
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`workspace runtime package has no files manifest: ${descriptor.manifest.name}`)
  }
  mkdirSync(target, { recursive: true })
  cpSync(join(descriptor.source, 'package.json'), join(target, 'package.json'), { preserveTimestamps: true })
  for (const entry of globSync(files, { cwd: descriptor.source })) {
    const source = join(descriptor.source, entry)
    const destination = join(target, entry)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    })
  }
}

function materializeLinks(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const linkStat = lstatSync(path)
    if (linkStat.isSymbolicLink()) {
      const target = realpathSync(path)
      const replacement = `${path}.materialized`
      rmSync(replacement, { recursive: true, force: true })
      cpSync(target, replacement, { recursive: statSync(target).isDirectory(), dereference: true, preserveTimestamps: true })
      rmSync(path)
      renameSync(replacement, path)
    }
    if (statSync(path).isDirectory()) materializeLinks(path)
  }
}

function removeDeployMetadata(runtimeRoot) {
  for (const metadata of ['node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']) {
    rmSync(join(runtimeRoot, ...metadata.split('/')), { force: true })
  }
}

function rejectLinks(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const linkStat = lstatSync(path)
    if (linkStat.isSymbolicLink()) throw new Error(`runtime contains a link: ${relative(directory, path)}`)
    if (linkStat.isDirectory()) rejectLinks(path)
  }
}

/** Verify the complete physical runtime consumed by Electron Forge. */
export function verifyRuntime(runtimeRoot) {
  rejectLinks(runtimeRoot)
  rejectDevelopmentArtifacts(runtimeRoot)
  const required = [
    'apps/cli/lib/bin.js',
    supervisorRuntimePath,
    'node_modules/@voyaseek-ai/dsh-web-frontend/dist/index.html',
    'node_modules/@voyaseek-ai/dsh-aistaff-client-product/lib/client.js',
    'node_modules/@voyaseek-ai/dsh-aistaff-product-bundle/cordis.patch.yml',
    'node_modules/@voyaseek-ai/dsh-code-runtime-worker-thread/lib/worker.cjs',
    'node_modules/@voyaseek-ai/dsh-workflow-worker-thread/lib/worker.cjs',
  ]
  for (const artifact of required) {
    const path = join(runtimeRoot, ...artifact.split('/'))
    if (!existsSync(path)) throw new Error(`runtime artifact is missing: ${artifact}`)
  }
  const nativeAddon = findPath(runtimeRoot, (path) => path.endsWith(`${sep}node-pty${sep}prebuilds${sep}darwin-x64${sep}pty.node`))
  if (nativeAddon === undefined) throw new Error('runtime is missing the macOS x86_64 node-pty prebuild')
  const spawnHelper = findPath(runtimeRoot, (path) => path.endsWith(`${sep}node-pty${sep}prebuilds${sep}darwin-x64${sep}spawn-helper`))
  if (spawnHelper === undefined) throw new Error('runtime is missing the macOS x86_64 node-pty spawn-helper')
  const languagePolicyChunk = findPath(runtimeRoot, (path) => {
    const directory = `${sep}@voyaseek-ai${sep}dsh-aistaff-language-policy${sep}lib${sep}`
    return path.includes(directory) && /rules-[A-Za-z0-9_-]+\.js$/.test(path)
  })
  if (languagePolicyChunk === undefined) throw new Error('runtime is missing the Aistaff language-policy rule chunk')
  verifyEsmImport(runtimeRoot, 'node_modules/@voyaseek-ai/dsh-aistaff-language-policy/lib/index.js')
  verifySupervisorSidecar(join(runtimeRoot, supervisorRuntimePath))
  rejectRuntimeDevelopmentPaths(runtimeRoot)
  process.stdout.write(`Verified AI Staff runtime closure at ${runtimeRoot}\n`)
}

function verifyEsmImport(runtimeRoot, entry) {
  const path = join(runtimeRoot, ...entry.split('/'))
  run(process.execPath, [
    '--input-type=module',
    '--eval',
    `await import(${JSON.stringify(pathToFileURL(path).href)})`,
  ], { capture: true, label: `runtime import ${entry}` })
}

function rejectRuntimeDevelopmentPaths(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const metadata = lstatSync(path)
    if (metadata.isDirectory()) rejectRuntimeDevelopmentPaths(path)
    else if (metadata.isFile()) rejectDevelopmentPaths(path)
  }
}

function findPath(directory, predicate) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (predicate(path)) return path
    if (lstatSync(path).isDirectory()) {
      const found = findPath(path, predicate)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * Strip development-only artifacts a deployed closure still carries: source
 * maps and incremental-build metadata. They expose the complete internal
 * structure of first-party packages to anyone who unpacks the app and serve
 * nothing at runtime.
 */
function pruneDevelopmentArtifacts(runtimeRoot) {
  let removed = 0
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) continue
      if (metadata.isDirectory()) { walk(path); continue }
      if (entry.endsWith('.map') || entry.endsWith('.tsbuildinfo')) {
        rmSync(path)
        removed += 1
      }
    }
  }
  walk(runtimeRoot)
  process.stdout.write('Pruned ' + String(removed) + ' development artifacts from the staged runtime\n')
}

/** Refuse a runtime that still carries source maps or build metadata. */
function rejectDevelopmentArtifacts(runtimeRoot) {
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      const metadata = lstatSync(path)
      if (metadata.isSymbolicLink()) continue
      if (metadata.isDirectory()) { walk(path); continue }
      if (entry.endsWith('.map') || entry.endsWith('.tsbuildinfo')) {
        throw new Error('runtime contains a development artifact: ' + relative(runtimeRoot, path))
      }
    }
  }
  walk(runtimeRoot)
}
