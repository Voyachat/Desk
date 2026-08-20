import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { isRuntimeDocument, isStartupDocument } from './window-policy.js'

/** Maximum UTF-16 code units retained for a pre-session draft. */
export const STARTUP_DRAFT_MAX_LENGTH = 32_000

/** Fixed IPC channels owned by the desktop startup bridge. */
export const STARTUP_CHANNELS = {
  getIntent: 'voyaseek:startup:get-intent',
  setIntent: 'voyaseek:startup:set-intent',
  acknowledge: 'voyaseek:startup:acknowledge',
  getState: 'voyaseek:startup:get-state',
  retry: 'voyaseek:startup:retry',
  stateChanged: 'voyaseek:startup:state-changed',
} as const

/** Agent presets that can be selected before a session exists. */
type StartupAgentPreset = 'standard' | 'code'

/** User input retained by the main process while the runtime starts. */
export interface StartupIntent {
  readonly draft: string
  readonly agentPreset: StartupAgentPreset
}

/** Runtime availability presented by the startup renderer. */
export type StartupState =
  | { readonly phase: 'starting' }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'ready' }

/** Renderer API exposed without the underlying Electron IPC object. */
export interface StartupApi {
  /** Read the retained input, or null after the product acknowledges it. */
  getIntent(): Promise<StartupIntent | null>
  /** Replace the retained input after main-process validation. */
  setIntent(intent: StartupIntent): Promise<StartupIntent>
  /** Remove the retained input after the product applies both preset and draft. */
  acknowledge(): Promise<void>
  /** Read the current managed-runtime availability. */
  getState(): Promise<StartupState>
  /** Request another runtime launch after a failed attempt. */
  retry(): Promise<StartupState>
  /** Subscribe to runtime availability changes for the lifetime of the current document. */
  onState(listener: (state: StartupState) => void): () => void
}

/** Validate and copy renderer-supplied pre-session input. */
export function parseStartupIntent(value: unknown): StartupIntent {
  if (typeof value !== 'object' || value === null) throw new TypeError('Startup intent must be an object')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.draft !== 'string') throw new TypeError('Startup draft must be a string')
  if (candidate.draft.length > STARTUP_DRAFT_MAX_LENGTH) {
    throw new RangeError(`Startup draft exceeds ${String(STARTUP_DRAFT_MAX_LENGTH)} characters`)
  }
  if (candidate.agentPreset !== 'standard' && candidate.agentPreset !== 'code') {
    throw new TypeError('Startup agent preset must be standard or code')
  }
  return { draft: candidate.draft, agentPreset: candidate.agentPreset }
}

/** Reject IPC that does not come from the main frame of the owned startup or runtime document. */
export function assertTrustedStartupSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | undefined,
  startupUrl: URL,
  runtimeUrl: URL | undefined,
): void {
  const frame = event.senderFrame
  const mainFrame = event.sender.mainFrame
  const fromMainFrame = frame !== null
    && frame.parent === null
    && frame.processId === mainFrame.processId
    && frame.routingId === mainFrame.routingId
  const fromAllowedDocument = frame !== null && (
    isStartupDocument(frame.url, startupUrl)
    || (runtimeUrl !== undefined && isRuntimeDocument(frame.url, runtimeUrl))
  )
  if (window === undefined || event.sender !== window.webContents || !fromMainFrame || !fromAllowedDocument) {
    throw new Error('Startup IPC sender is not trusted')
  }
}
