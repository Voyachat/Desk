export type SessionId = string
export type WorkspaceId = string
export type ViewId = 'chat' | 'trajectory'
export type PermissionMode = 'read-only' | 'workspace-write' | 'full-access'
export type MenuId = 'permission' | 'model' | 'preset' | 'workspace' | 'sidebar-view' | null

export interface WorkspaceSummary {
  id: WorkspaceId
  title: string
  path: string
}

export interface ToolDetails {
  title: string
  summary: string
  input: string
  output: string
  duration: string
}

export interface TranscriptItem {
  id: string
  kind: 'user' | 'assistant' | 'context' | 'tool' | 'receipt' | 'status'
  body: string
  label?: string
  meta?: string
  tone?: 'default' | 'warn' | 'success'
  details?: ToolDetails
}

export interface EmployeeRun {
  employeeName: string
  employeeRole: string
  runLabel: string
  status: 'running' | 'waiting-approval' | 'completed' | 'rejected'
  progress: number
}

export interface SessionSummary {
  id: SessionId
  workspaceId: WorkspaceId
  title: string
  preset: string
  updatedAt: string
  kind: 'local' | 'employee'
  items: readonly TranscriptItem[]
  employeeRun?: EmployeeRun
}

export interface PendingApproval {
  key: string
  sessionId: SessionId
  reason: string
  toolName: string
  command: string
}

export interface ComposerState {
  draft: string
  permission: PermissionMode
  model: string
  reasoning: string
}

export interface AppState {
  workspaces: readonly WorkspaceSummary[]
  sessions: readonly SessionSummary[]
  activeSessionId: SessionId | null
  selectedWorkspaceId: WorkspaceId
  stagedPreset: string
  view: ViewId
  composer: ComposerState
  pendingApproval: PendingApproval | null
  details: ToolDetails | null
  menu: MenuId
  sidebarCollapsed: boolean
  settingsOpen: boolean
  settingsSection: 'general' | 'models' | 'plugins' | 'presets'
  toast: string | null
}

export type ClientCommand =
  | { type: 'session.new' }
  | { type: 'session.open'; sessionId: SessionId }
  | { type: 'session.start'; prompt: string }
  | { type: 'view.select'; view: ViewId }
  | { type: 'composer.draft'; draft: string }
  | { type: 'composer.permission'; permission: PermissionMode }
  | { type: 'composer.model'; model: string; reasoning: string }
  | { type: 'composer.submit' }
  | { type: 'approval.answer'; outcome: 'allowed-once' | 'rejected' }
  | { type: 'workspace.select'; workspaceId: WorkspaceId }
  | { type: 'preset.select'; preset: string }
  | { type: 'menu.toggle'; menu: Exclude<MenuId, null> }
  | { type: 'menu.close' }
  | { type: 'details.open'; details: ToolDetails }
  | { type: 'details.close' }
  | { type: 'sidebar.toggle' }
  | { type: 'settings.open'; section?: AppState['settingsSection'] }
  | { type: 'settings.section'; section: AppState['settingsSection'] }
  | { type: 'settings.close' }
  | { type: 'demo.reset' }
  | { type: 'toast.clear' }
