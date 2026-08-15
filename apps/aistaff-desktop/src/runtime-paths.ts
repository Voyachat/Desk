import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'

const RUNTIME_ENTRY_PARTS = ['runtime', 'apps', 'cli', 'lib', 'bin.js'] as const
const SUPERVISOR_SIDECAR_PARTS = ['runtime', 'native', 'aistaff-desktop-supervisor'] as const

/** Resolve the packaged or staged DSH CLI without consulting PATH. */
export function resolveRuntimeEntry(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  return isPackaged
    ? resolve(resourcesPath, ...RUNTIME_ENTRY_PARTS)
    : resolve(appPath, '..', 'aistaff-desktop-runtime', ...RUNTIME_ENTRY_PARTS)
}

/**
 * Resolve and validate the Host-only Supervisor sidecar without consulting PATH.
 * @param isPackaged - Whether Electron is running from an application package.
 * @param resourcesPath - Electron's packaged resources directory.
 * @param appPath - Electron's application path for source-checkout launches.
 * @returns The physical executable path reserved for the Host process.
 */
export function resolveSupervisorSidecar(isPackaged: boolean, resourcesPath: string, appPath: string): string {
  const sidecar = isPackaged
    ? resolve(resourcesPath, ...SUPERVISOR_SIDECAR_PARTS)
    : resolve(appPath, '..', 'aistaff-desktop-runtime', ...SUPERVISOR_SIDECAR_PARTS)
  let metadata: ReturnType<typeof lstatSync>
  try {
    metadata = lstatSync(sidecar)
  } catch (error) {
    if (isMissingPathError(error)) throw new Error(`Bundled Supervisor sidecar is missing: ${sidecar}`)
    throw error
  }
  if (metadata.isSymbolicLink()) throw new Error(`Bundled Supervisor sidecar must not be a symbolic link: ${sidecar}`)
  if (!metadata.isFile()) throw new Error(`Bundled Supervisor sidecar is not a regular file: ${sidecar}`)
  if ((metadata.mode & 0o111) === 0) throw new Error(`Bundled Supervisor sidecar is not executable: ${sidecar}`)
  return sidecar
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
