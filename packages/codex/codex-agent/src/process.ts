/** Process command and quiescent teardown for the Codex app-server child. */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import type { SubprocessHandle } from '@voyaseek-ai/dsh-subprocess'

interface BundledCodexTarget {
  readonly packageName: string
  readonly targetTriple: string
}

/** Filesystem and package-resolution inputs used to locate the bundled Codex binary. */
export interface BundledCodexExecutableOptions {
  /** Host platform whose native binary must be selected. */
  readonly platform?: NodeJS.Platform
  /** Host architecture whose native binary must be selected. */
  readonly arch?: string
  /** Resolve one package's package.json to an absolute path. */
  readonly resolvePackageJson?: (packageName: string) => string
  /** Test whether the resolved native executable exists. */
  readonly exists?: (path: string) => boolean
}

const require = createRequire(import.meta.url)

function bundledCodexTarget(platform: NodeJS.Platform, arch: string): BundledCodexTarget | undefined {
  if (platform === 'darwin' && arch === 'x64') {
    return { packageName: '@openai/codex-darwin-x64', targetTriple: 'x86_64-apple-darwin' }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { packageName: '@openai/codex-darwin-arm64', targetTriple: 'aarch64-apple-darwin' }
  }
  if ((platform === 'linux' || platform === 'android') && arch === 'x64') {
    return { packageName: '@openai/codex-linux-x64', targetTriple: 'x86_64-unknown-linux-musl' }
  }
  if ((platform === 'linux' || platform === 'android') && arch === 'arm64') {
    return { packageName: '@openai/codex-linux-arm64', targetTriple: 'aarch64-unknown-linux-musl' }
  }
  if (platform === 'win32' && arch === 'x64') {
    return { packageName: '@openai/codex-win32-x64', targetTriple: 'x86_64-pc-windows-msvc' }
  }
  if (platform === 'win32' && arch === 'arm64') {
    return { packageName: '@openai/codex-win32-arm64', targetTriple: 'aarch64-pc-windows-msvc' }
  }
  return undefined
}

function resolveBundledPackageJson(packageName: string): string {
  const codexPackageJson = require.resolve('@openai/codex/package.json')
  return createRequire(codexPackageJson).resolve(`${packageName}/package.json`)
}

/**
 * Resolve the native Codex executable shipped by the pinned `@openai/codex`
 * dependency instead of relying on the desktop process `PATH`.
 * @param options - optional host and resolver overrides for deterministic tests.
 * @returns the absolute native executable path.
 */
export function bundledCodexExecutable(options: BundledCodexExecutableOptions = {}): string {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const target = bundledCodexTarget(platform, arch)
  if (target === undefined) {
    throw new Error(`codex-agent: bundled Codex does not support ${platform} (${arch})`)
  }
  let packageJson: string
  try {
    packageJson = (options.resolvePackageJson ?? resolveBundledPackageJson)(target.packageName)
  } catch {
    throw new Error(`codex-agent: bundled Codex package ${target.packageName} is unavailable for ${platform} (${arch})`)
  }
  const executable = join(
    dirname(packageJson),
    'vendor',
    target.targetTriple,
    'bin',
    platform === 'win32' ? 'codex.exe' : 'codex',
  )
  if (!(options.exists ?? existsSync)(executable)) {
    throw new Error(`codex-agent: bundled Codex executable is missing at ${executable}`)
  }
  return executable
}

/**
 * Resolve the fixed app-server argv, with an optional exact deployment
 * executable or complete argv override.
 * @param executable - executable replacing bundled Codex while retaining fixed app-server arguments.
 * @param argv - complete argv override, used verbatim when present.
 * @param platform - host platform selecting the Windows batch boundary.
 * @returns the complete child argv.
 */
export function codexAppServerArgv(
  executable?: string,
  argv?: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (argv !== undefined) {
    if (argv.length === 0 || argv.some(part => part.length === 0)) {
      throw new Error('codex-agent: argv must contain non-empty strings')
    }
    return [...argv]
  }
  const command = executable ?? bundledCodexExecutable()
  if (command.length === 0) throw new Error('codex-agent: executable must not be empty')
  const appServer = [command, 'app-server', '--stdio']
  if (platform !== 'win32' || !['.cmd', '.bat'].includes(extname(command).toLowerCase())) return appServer
  return ['cmd.exe', '/d', '/v:off', '/s', '/c', ...appServer]
}

/**
 * Close the protocol pipes, terminate the owned process tree, and wait until
 * the subprocess owner proves quiescence.
 * @param child - managed app-server process.
 */
export async function disposeCodexProcess(child: SubprocessHandle): Promise<void> {
  try {
    child.stdin?.end()
  } catch {
    // A concurrent protocol close cannot change process-tree ownership.
  }
  if (child.pid > 0) child.terminate()
  await child.waitForExit()
  await child.done.catch(() => {})
}
