/** Trusted Git-worktree preparation and audited patch promotion for complex goals. */

import { randomUUID } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@voyaseek-ai/cordis'
import { deadline, timeoutOf } from '@voyaseek-ai/dsh-timeout'
import type {} from '@voyaseek-ai/dsh-subprocess'
import type { ComplexGoalWorkspace, IsolatedComplexGoalWorkspace } from './types.ts'

const WORKSPACE_COMMAND_TIMEOUT_CODE = 'COMPLEX_GOAL_WORKSPACE_COMMAND_TIMEOUT'

/** Deployment choices for task workspace preparation and promotion. */
export interface ComplexGoalWorkspaceOptions {
  /** Whether isolation is disabled, best-effort, or mandatory. */
  readonly mode: 'off' | 'auto' | 'required'
  /** Durable parent directory for detached worktrees. */
  readonly root?: string
  /** Per-Git-command deadline. */
  readonly commandTimeoutMs: number
  /** Maximum exact patch size accepted for promotion. */
  readonly promotionPatchMaxBytes: number
}

interface GitResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
}

function shared(sourceCwd: string, reason: Extract<ComplexGoalWorkspace, { kind: 'shared' }>['reason']): ComplexGoalWorkspace {
  return { kind: 'shared', sourceCwd, taskCwd: sourceCwd, reason }
}

function failure(message: string, result: GitResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`
  return new Error(`${message}: ${detail}`)
}

async function runGit(
  ctx: Context,
  cwd: string,
  args: readonly string[],
  options: ComplexGoalWorkspaceOptions,
  signal: AbortSignal,
  stdin?: string,
  stdoutMaxBytes = 32_768,
): Promise<GitResult> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('complex-goal workspace isolation requires ctx.subprocess')
  const commandDeadline = deadline(signal, options.commandTimeoutMs, WORKSPACE_COMMAND_TIMEOUT_CODE)
  try {
    const git = await subprocess.resolveExecutable('git', undefined, commandDeadline.signal)
    const handle = subprocess.spawn({
      argv: [git, ...args],
      cwd,
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: stdoutMaxBytes },
        stderr: { maxBytes: 32_768 },
      },
      graceMs: Math.min(options.commandTimeoutMs, 2_000),
      signal: commandDeadline.signal,
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (timeoutOf(commandDeadline.signal, WORKSPACE_COMMAND_TIMEOUT_CODE) !== undefined) {
      throw new Error(`git ${args[0] ?? 'command'} exceeded ${options.commandTimeoutMs}ms`)
    }
    return {
      exitCode: outcome.exitCode,
      stdout: stdout?.text ?? '',
      stderr: stderr?.text ?? '',
      truncated: stdout?.lossy === true || stderr?.lossy === true,
    }
  } finally {
    commandDeadline[Symbol.dispose]()
  }
}

async function gitFact(
  ctx: Context,
  cwd: string,
  args: readonly string[],
  options: ComplexGoalWorkspaceOptions,
  signal: AbortSignal,
  label: string,
): Promise<string> {
  const result = await runGit(ctx, cwd, args, options, signal)
  if (result.exitCode !== 0 || result.truncated) throw failure(`could not resolve ${label}`, result)
  const value = result.stdout.trim()
  if (value.length === 0) throw new Error(`could not resolve ${label}: git returned empty output`)
  return value
}

/**
 * Create one detached worktree for a clean Git source, or return an explicit
 * shared-workspace degradation under `auto` mode.
 * @param ctx - host context carrying the subprocess provider.
 * @param source - immutable owning-session cwd, when present.
 * @param options - resolved deployment policy.
 * @param signal - cancellation for filesystem and Git preparation.
 * @returns the durable workspace description used by all later roles.
 */
export async function prepareComplexGoalWorkspace(
  ctx: Context,
  source: string | undefined,
  options: ComplexGoalWorkspaceOptions,
  signal: AbortSignal,
): Promise<ComplexGoalWorkspace> {
  const sourceCwd = source === undefined ? process.cwd() : await realpath(source)
  if (options.mode === 'off') return shared(sourceCwd, 'disabled')
  if (source === undefined) {
    if (options.mode === 'auto') return shared(sourceCwd, 'missing-cwd')
    throw new Error('complex-goal workspace isolation requires a session cwd')
  }
  if (ctx.get('subprocess') === undefined) {
    if (options.mode === 'auto') return shared(sourceCwd, 'subprocess-unavailable')
    throw new Error('complex-goal workspace isolation requires ctx.subprocess')
  }
  if (options.root === undefined) throw new Error('complex-goal workspace isolation requires workspaceRoot')

  const topLevel = await runGit(ctx, sourceCwd, ['rev-parse', '--show-toplevel'], options, signal)
  if (topLevel.exitCode !== 0) {
    if (options.mode === 'auto') return shared(sourceCwd, 'not-git')
    throw failure('complex-goal source is not a Git worktree', topLevel)
  }
  const sourceRoot = await realpath(topLevel.stdout.trim())
  const relativeCwd = relative(sourceRoot, sourceCwd)
  if (!inside(sourceRoot, sourceCwd)) throw new Error('complex-goal session cwd is outside its reported Git root')

  const status = await runGit(ctx, sourceRoot, ['status', '--porcelain=v1', '--untracked-files=normal'], options, signal)
  if (status.exitCode !== 0 || status.truncated) throw failure('could not inspect complex-goal source status', status)
  if (status.stdout.length !== 0) {
    if (options.mode === 'auto') return shared(sourceCwd, 'dirty')
    throw new Error('complex-goal source must be clean before creating an isolated worktree')
  }

  const configuredRoot = resolve(options.root)
  if (inside(sourceRoot, configuredRoot)) {
    throw new Error('complex-goal workspaceRoot must be outside the source Git worktree')
  }
  await mkdir(configuredRoot, { recursive: true })
  const workspaceRoot = await realpath(configuredRoot)
  if (inside(sourceRoot, workspaceRoot)) {
    throw new Error('complex-goal workspaceRoot must be outside the source Git worktree')
  }
  const taskRootCandidate = join(workspaceRoot, `goal-${randomUUID()}`)
  if (!inside(workspaceRoot, taskRootCandidate) || taskRootCandidate === workspaceRoot) {
    throw new Error('complex-goal task workspace escaped the configured workspaceRoot')
  }
  const baseCommit = await gitFact(ctx, sourceRoot, ['rev-parse', '--verify', 'HEAD'], options, signal, 'source HEAD')
  const created = await runGit(
    ctx,
    sourceRoot,
    ['worktree', 'add', '--detach', taskRootCandidate, baseCommit],
    options,
    signal,
  )
  if (created.exitCode !== 0) throw failure('could not create complex-goal Git worktree', created)
  const taskRoot = await realpath(taskRootCandidate)
  if (!inside(workspaceRoot, taskRoot) || taskRoot === workspaceRoot) {
    throw new Error('created complex-goal worktree escaped the configured workspaceRoot')
  }
  const taskCwd = relativeCwd.length === 0 ? taskRoot : join(taskRoot, relativeCwd)
  await realpath(taskCwd)
  return { kind: 'git-worktree', sourceRoot, sourceCwd, taskRoot, taskCwd, baseCommit }
}

/** Exact outcome of promoting an audited isolated worktree. */
export type ComplexGoalPromotion = 'no-changes' | 'applied' | 'already-applied'

/**
 * Promote the exact bounded diff from an audited task worktree into its
 * unchanged source checkout. A reverse apply check makes crash recovery
 * idempotent; conflicts preserve both directories and fail closed.
 * @param ctx - host context carrying the subprocess provider.
 * @param workspace - isolated workspace frozen in the goal snapshot.
 * @param options - resolved command and patch bounds.
 * @param signal - cancellation for Git operations.
 * @returns whether the patch was empty, newly applied, or already present.
 */
export async function promoteComplexGoalWorkspace(
  ctx: Context,
  workspace: IsolatedComplexGoalWorkspace,
  options: ComplexGoalWorkspaceOptions,
  signal: AbortSignal,
): Promise<ComplexGoalPromotion> {
  const [sourceRoot, taskRoot] = await Promise.all([
    realpath(workspace.sourceRoot),
    realpath(workspace.taskRoot),
  ])
  if (sourceRoot !== workspace.sourceRoot || taskRoot !== workspace.taskRoot) {
    throw new Error('complex-goal workspace filesystem identity changed before promotion')
  }
  const sourceHead = await gitFact(ctx, sourceRoot, ['rev-parse', '--verify', 'HEAD'], options, signal, 'source HEAD')
  if (sourceHead !== workspace.baseCommit) {
    throw new Error(`complex-goal source HEAD changed from ${workspace.baseCommit} to ${sourceHead}; task worktree was preserved`)
  }
  const intent = await runGit(ctx, taskRoot, ['add', '-N', '--', '.'], options, signal)
  if (intent.exitCode !== 0) throw failure('could not include untracked task files in the promotion patch', intent)
  const patch = await runGit(
    ctx,
    taskRoot,
    ['diff', '--binary', '--full-index', '--no-ext-diff', workspace.baseCommit, '--', '.'],
    options,
    signal,
    undefined,
    options.promotionPatchMaxBytes + 1,
  )
  if (patch.exitCode !== 0) throw failure('could not build complex-goal promotion patch', patch)
  if (patch.truncated || Buffer.byteLength(patch.stdout, 'utf8') > options.promotionPatchMaxBytes) {
    throw new Error(`complex-goal promotion patch exceeds ${options.promotionPatchMaxBytes} bytes; task worktree was preserved`)
  }
  if (patch.stdout.length === 0) return 'no-changes'

  const check = await runGit(ctx, sourceRoot, ['apply', '--check', '--whitespace=nowarn', '-'], options, signal, patch.stdout)
  if (check.exitCode === 0) {
    const applied = await runGit(ctx, sourceRoot, ['apply', '--whitespace=nowarn', '-'], options, signal, patch.stdout)
    if (applied.exitCode !== 0) throw failure('complex-goal patch passed validation but could not be applied', applied)
    return 'applied'
  }
  const reverse = await runGit(
    ctx,
    sourceRoot,
    ['apply', '--reverse', '--check', '--whitespace=nowarn', '-'],
    options,
    signal,
    patch.stdout,
  )
  if (reverse.exitCode === 0) return 'already-applied'
  throw new Error(`complex-goal promotion conflicts with the source checkout; task worktree was preserved: ${check.stderr.trim() || reverse.stderr.trim() || 'git apply rejected the patch'}`)
}
