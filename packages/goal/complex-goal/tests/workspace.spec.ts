import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import LocalSubprocessRuntime from '@voyaseek-ai/dsh-subprocess-local'
import {
  prepareComplexGoalWorkspace,
  promoteComplexGoalWorkspace,
  type ComplexGoalWorkspaceOptions,
} from '../src/workspace.ts'

const run = promisify(execFile)
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

async function repository(): Promise<{ root: string; source: string; workspaces: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-complex-workspace-'))
  roots.push(root)
  const sourcePath = join(root, 'source')
  const workspaces = join(root, 'workspaces')
  await mkdir(sourcePath)
  const source = await realpath(sourcePath)
  await run('git', ['init', '--quiet'], { cwd: source })
  await run('git', ['config', 'user.email', 'complex-goal@example.invalid'], { cwd: source })
  await run('git', ['config', 'user.name', 'Complex Goal Test'], { cwd: source })
  await writeFile(join(source, 'tracked.txt'), 'before\n')
  await run('git', ['add', 'tracked.txt'], { cwd: source })
  await run('git', ['commit', '--quiet', '-m', 'base'], { cwd: source })
  return { root, source, workspaces }
}

function options(root: string, mode: ComplexGoalWorkspaceOptions['mode'] = 'required'): ComplexGoalWorkspaceOptions {
  return {
    mode,
    root,
    commandTimeoutMs: 10_000,
    promotionPatchMaxBytes: 1_048_576,
  }
}

describe('complex-goal Git workspace', () => {
  it('isolates a clean task and promotes its exact patch idempotently', async () => {
    const paths = await repository()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)

    const workspace = await prepareComplexGoalWorkspace(
      ctx,
      paths.source,
      options(paths.workspaces),
      new AbortController().signal,
    )
    expect(workspace).toMatchObject({ kind: 'git-worktree', sourceCwd: paths.source })
    if (workspace.kind !== 'git-worktree') throw new Error('test requires an isolated worktree')
    await writeFile(join(workspace.taskCwd, 'tracked.txt'), 'after\n')
    await writeFile(join(workspace.taskCwd, 'created.txt'), 'new\n')

    await expect(promoteComplexGoalWorkspace(
      ctx,
      workspace,
      options(paths.workspaces),
      new AbortController().signal,
    )).resolves.toBe('applied')
    await expect(readFile(join(paths.source, 'tracked.txt'), 'utf8')).resolves.toBe('after\n')
    await expect(readFile(join(paths.source, 'created.txt'), 'utf8')).resolves.toBe('new\n')

    await expect(promoteComplexGoalWorkspace(
      ctx,
      workspace,
      options(paths.workspaces),
      new AbortController().signal,
    )).resolves.toBe('already-applied')
  })

  it('reports an explicit shared-workspace degradation for a dirty source in auto mode', async () => {
    const paths = await repository()
    await writeFile(join(paths.source, 'tracked.txt'), 'dirty\n')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)

    await expect(prepareComplexGoalWorkspace(
      ctx,
      paths.source,
      options(paths.workspaces, 'auto'),
      new AbortController().signal,
    )).resolves.toEqual({
      kind: 'shared',
      sourceCwd: paths.source,
      taskCwd: paths.source,
      reason: 'dirty',
    })
  })

  it('rejects a workspace root inside the source before mutating the repository', async () => {
    const paths = await repository()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalSubprocessRuntime)

    await expect(prepareComplexGoalWorkspace(
      ctx,
      paths.source,
      options(join(paths.source, 'task-workspaces')),
      new AbortController().signal,
    )).rejects.toThrow('workspaceRoot must be outside')

    const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: paths.source })
    expect(status.stdout).toBe('')
  })
})
