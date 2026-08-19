/** Process command and quiescent teardown for the Codex app-server child. */

import { extname } from 'node:path'
import type { SubprocessHandle } from '@voyaseek-ai/dsh-subprocess'

/**
 * Resolve the fixed app-server argv, with an optional exact deployment
 * executable or complete argv override.
 * @param executable - executable replacing `codex` while retaining fixed app-server arguments.
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
  const command = executable ?? 'codex'
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
