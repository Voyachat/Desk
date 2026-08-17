/** Regression coverage for source declarations and split compiler aggregates. */

import { existsSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function clientCssDeclarations(): string[] {
  const clientGroups = ['aistaff', 'claude', 'client', 'extensions']
  return clientGroups.flatMap((group) => {
    const clientRoot = resolve(root, 'packages', group)
    return readdirSync(clientRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => resolve(clientRoot, entry.name, 'src/css-modules.d.ts'))
  })
    .filter(existsSync)
    .map(file => file.replaceAll(sep, '/'))
    .sort()
}

function stringArrayProperty(value: unknown, key: string): string[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected TypeScript config to contain ${key}`)
  }
  const property = Reflect.get(value, key) as unknown
  if (!Array.isArray(property)) {
    throw new Error(`Expected TypeScript config ${key} to be an array`)
  }
  const values: unknown[] = property
  if (!values.every((item): item is string => typeof item === 'string')) {
    throw new Error(`Expected TypeScript config ${key} to contain only strings`)
  }
  return values
}

describe('client TypeScript aggregate', () => {
  it('loads package CSS declarations without relying on workspace-link realpaths', () => {
    const configPath = resolve(root, 'tsconfig.client.json')
    const read = ts.readConfigFile(configPath, file => ts.sys.readFile(file))
    if (read.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const loaded = parsed.fileNames
      .map(file => file.replaceAll(sep, '/'))
      .filter(file => file.endsWith('/src/css-modules.d.ts'))
      .sort()
    expect(loaded).toEqual(clientCssDeclarations())
  })

  it('isolates the cross-runtime HMR integration from both service faces', () => {
    const hostPath = resolve(root, 'tsconfig.host.json')
    const host = ts.readConfigFile(hostPath, file => ts.sys.readFile(file))
    if (host.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(host.error.messageText, '\n'))
    }
    expect(stringArrayProperty(host.config, 'exclude')).toContain(
      'packages/extensions/cordis-host-runner/tests/development-hmr.spec.ts',
    )

    const hybridPath = resolve(root, 'tsconfig.hybrid.json')
    const hybrid = ts.readConfigFile(hybridPath, file => ts.sys.readFile(file))
    if (hybrid.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(hybrid.error.messageText, '\n'))
    }
    expect(stringArrayProperty(hybrid.config, 'files')).toEqual([
      'packages/extensions/cordis-host-runner/tests/development-hmr.spec.ts',
      'packages/extensions/cordis-host-runner/tests/helpers.ts',
    ])
  })
})
