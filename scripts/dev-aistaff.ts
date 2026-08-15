/** Start the source-tree AiDesktop profile without changing the stock DSH Web profile. */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  healProfilesModuleFallback,
  initProfile,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'

const repoRoot = resolve(import.meta.dirname, '..')
const home = process.env.DSH_HOME?.trim() || join(repoRoot, '.aidesktop-dev')
const profileName = 'aistaff'
const bundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-aistaff-product-bundle',
]
const profileDir = resolveProfileDir(profileName, home)
const developmentHmrPatch = join(profileDir, 'development-hmr.cordis.patch.yml')

if (!existsSync(join(profileDir, 'package.json'))) {
  initProfile(profileDir, bundles)
} else {
  const manifest = readProfileManifest('aidesktop', profileDir)
  const current = manifest.dsh?.profile?.bundles ?? []
  const missing = bundles.filter(bundle => !current.includes(bundle))
  if (missing.length > 0) {
    writeProfileManifest(profileDir, {
      ...manifest,
      dsh: {
        ...manifest.dsh,
        profile: { ...manifest.dsh?.profile, bundles: [...current, ...missing] },
      },
    })
  }
}

writeFileSync(developmentHmrPatch, [
  '- id: cordis-host-runner',
  '  config:',
  '    developmentHmr: true',
  '',
].join('\n'))

// The source-tree root owns the private Aistaff bundle dependency. Seed its
// complete dependency closure into this isolated profile before the stock CLI
// adds its own DSH closure; the stock healer is additive and leaves these
// product links intact.
healProfilesModuleFallback(join(repoRoot, 'package.json'), home)

const requestedArgs = process.argv.slice(2)
const args = requestedArgs.length === 0 ? ['--port', '3081'] : requestedArgs
const child = spawn(process.execPath, [
  '--import',
  'tsx/esm',
  join(repoRoot, 'apps/cli/src/bin.ts'),
  '--profile',
  profileName,
  '--patch',
  developmentHmrPatch,
  ...args,
], {
  cwd: repoRoot,
  env: { ...process.env, DSH_HOME: home },
  stdio: 'inherit',
})

const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
if (signal !== null) process.kill(process.pid, signal)
process.exitCode = code ?? 1
