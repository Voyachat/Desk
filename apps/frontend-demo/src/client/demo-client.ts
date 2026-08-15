import type {
  AppState, ClientCommand, PendingApproval, SessionSummary, ToolDetails, TranscriptItem,
} from '../domain/client-state.ts'
import type { ClientPort } from './client-port.ts'

const STORAGE_KEY = 'aidesktop.frontend-demo.v2'

const READ_DETAILS: ToolDetails = {
  title: '读取项目说明',
  summary: '读取工作区内的产品文档，用于生成本地摘要。',
  input: '{ "path": "Doc/客户反馈.md" }',
  output: '读取 84 行，发现 12 条客户反馈和 3 个重复主题。',
  duration: '0.8s',
}

const WRITE_DETAILS: ToolDetails = {
  title: '写入本地交付物',
  summary: '即将把整理结果写入当前工作区；该动作超出员工任务的默认只读权限。',
  input: '{ "path": "交付/客户反馈摘要.md", "mode": "create" }',
  output: '等待用户授权，尚未执行。',
  duration: '等待中',
}

function item(id: string, kind: TranscriptItem['kind'], body: string, extra: Partial<TranscriptItem> = {}): TranscriptItem {
  return { id, kind, body, ...extra }
}

function initialState(): AppState {
  const sessions: readonly SessionSummary[] = [
    {
      id: 'local-feedback',
      workspaceId: 'aidesktop',
      title: '整理客户反馈',
      preset: '标准模式',
      updatedAt: '刚刚',
      kind: 'local',
      items: [
        item('l1', 'user', '把客户反馈按主题整理，并给出优先级建议。'),
        item('l2', 'context', '上下文注入 · AiDesktop / 客户反馈', { meta: '@workspace-instructions' }),
        item('l3', 'tool', '读取 Doc/客户反馈.md', { label: 'read_file', meta: '84 行 · 0.8s', details: READ_DETAILS }),
        item('l4', 'assistant', '已归纳为「授权体验、任务可见性、交付质量」三个主题。建议先处理授权提示不清晰的问题，其次补齐任务进度和失败回执；这些改动直接影响用户是否敢让 AI 员工持续运行。'),
        item('l5', 'status', '5 轮 · 8 步', { meta: '上下文 18%' }),
      ],
    },
    {
      id: 'employee-report',
      workspaceId: 'aidesktop',
      title: '客户反馈日报',
      preset: '客户运营员工',
      updatedAt: '3 分钟',
      kind: 'employee',
      employeeRun: {
        employeeName: '客户运营员工',
        employeeRole: '汇总反馈并生成日报',
        runLabel: '云端下发 · RUN-0821',
        status: 'waiting-approval',
        progress: 72,
      },
      items: [
        item('e1', 'context', 'AI 员工任务已同步到本机', { meta: 'RUN-0821 · 只读权限' }),
        item('e2', 'assistant', '我已完成反馈归类与优先级排序。下一步需要在工作区创建日报文件，等待你确认本次写入。'),
        item('e3', 'tool', '准备写入 交付/客户反馈摘要.md', { label: 'write_file', meta: '等待授权', tone: 'warn', details: WRITE_DETAILS }),
      ],
    },
  ]
  return {
    workspaces: [
      { id: 'aidesktop', title: 'AiDesktop', path: '/Users/baron/projects/AiDesktop' },
      { id: 'client-demo', title: '客户演示空间', path: '/Users/baron/projects/Demo' },
    ],
    sessions,
    activeSessionId: 'local-feedback',
    selectedWorkspaceId: 'aidesktop',
    stagedPreset: '标准模式',
    view: 'chat',
    composer: {
      draft: '',
      permission: 'workspace-write',
      model: 'DeepSeek-V4-Flash',
      reasoning: 'High',
    },
    pendingApproval: null,
    details: null,
    menu: null,
    sidebarCollapsed: false,
    settingsOpen: false,
    settingsSection: 'general',
    toast: null,
  }
}

function activeSession(state: AppState): SessionSummary | undefined {
  return state.sessions.find(session => session.id === state.activeSessionId)
}

function replaceSession(state: AppState, session: SessionSummary): AppState {
  return { ...state, sessions: state.sessions.map(current => current.id === session.id ? session : current) }
}

function approvalFor(sessionId: string): PendingApproval {
  return {
    key: `approval-${sessionId}`,
    sessionId,
    reason: '允许 AI 员工在当前工作区创建客户反馈日报？',
    toolName: 'write_file',
    command: 'create 交付/客户反馈摘要.md',
  }
}

function reduce(state: AppState, command: ClientCommand): AppState {
  switch (command.type) {
    case 'session.new':
      return { ...state, activeSessionId: null, view: 'chat', details: null, pendingApproval: null, menu: null, composer: { ...state.composer, draft: '' } }
    case 'session.open': {
      const session = state.sessions.find(candidate => candidate.id === command.sessionId)
      if (session === undefined) return state
      return {
        ...state,
        activeSessionId: command.sessionId,
        selectedWorkspaceId: session.workspaceId,
        view: 'chat',
        details: null,
        menu: null,
        pendingApproval: session.employeeRun?.status === 'waiting-approval' ? approvalFor(session.id) : null,
      }
    }
    case 'session.start': {
      const prompt = command.prompt.trim()
      if (prompt === '') return state
      const id = `local-${Date.now()}`
      const session: SessionSummary = {
        id,
        workspaceId: state.selectedWorkspaceId,
        title: prompt.length > 18 ? `${prompt.slice(0, 18)}…` : prompt,
        preset: state.stagedPreset,
        updatedAt: '刚刚',
        kind: 'local',
        items: [
          item(`${id}-u`, 'user', prompt),
          item(`${id}-c`, 'context', `上下文注入 · ${state.workspaces.find(workspace => workspace.id === state.selectedWorkspaceId)?.title ?? '工作区'}`, { meta: `@${state.stagedPreset}` }),
          item(`${id}-a`, 'assistant', '本地会话已建立。正式 Client 接入后，这条提交会交给 DSAgent session/agent-loop；当前 Demo 仅验证用户可见的页面与状态迁移。'),
        ],
      }
      return { ...state, sessions: [session, ...state.sessions], activeSessionId: id, view: 'chat', composer: { ...state.composer, draft: '' }, menu: null }
    }
    case 'view.select':
      return { ...state, view: command.view, menu: null }
    case 'composer.draft':
      return { ...state, composer: { ...state.composer, draft: command.draft } }
    case 'composer.permission':
      return { ...state, composer: { ...state.composer, permission: command.permission }, menu: null }
    case 'composer.model':
      return { ...state, composer: { ...state.composer, model: command.model, reasoning: command.reasoning }, menu: null }
    case 'composer.submit': {
      const draft = state.composer.draft.trim()
      if (draft === '') return state
      if (state.activeSessionId === null) return reduce(state, { type: 'session.start', prompt: draft })
      const session = activeSession(state)
      if (session === undefined || state.pendingApproval !== null) return state
      const stamp = Date.now()
      const next: SessionSummary = {
        ...session,
        updatedAt: '刚刚',
        items: [
          ...session.items,
          item(`u-${stamp}`, 'user', draft),
          item(`a-${stamp}`, 'assistant', session.kind === 'employee'
            ? '已把你的补充要求加入当前 AI 员工任务。正式版本会将其作为 session steering 发送并记录到任务轨迹。'
            : '已收到。本 Demo 保留同一 Composer、会话和轨迹状态；正式接入时由 ClientPort 把提交转发给 DSAgent。'),
        ],
      }
      return { ...replaceSession(state, next), composer: { ...state.composer, draft: '' }, toast: '消息已加入当前会话' }
    }
    case 'approval.answer': {
      const approval = state.pendingApproval
      if (approval === null) return state
      const session = state.sessions.find(candidate => candidate.id === approval.sessionId)
      if (session === undefined) return { ...state, pendingApproval: null }
      const allowed = command.outcome === 'allowed-once'
      const next: SessionSummary = {
        ...session,
        employeeRun: session.employeeRun === undefined ? undefined : {
          ...session.employeeRun,
          status: allowed ? 'completed' : 'rejected',
          progress: allowed ? 100 : session.employeeRun.progress,
        },
        items: [
          ...session.items,
          item(`receipt-${Date.now()}`, 'receipt', allowed
            ? '已允许一次 · 已创建 交付/客户反馈摘要.md'
            : '已拒绝 · 未执行本地写入', {
            label: allowed ? '授权回执' : '拒绝回执',
            meta: allowed ? '本次动作 · 100%' : '工作区未发生变更',
            tone: allowed ? 'success' : 'warn',
            details: allowed ? { ...WRITE_DETAILS, output: '已创建文件；Demo 未实际写入磁盘。', duration: '1.2s' } : undefined,
          }),
        ],
      }
      return { ...replaceSession(state, next), pendingApproval: null, toast: allowed ? '已允许本次动作' : '已拒绝本次动作' }
    }
    case 'workspace.select':
      return { ...state, selectedWorkspaceId: command.workspaceId, menu: null }
    case 'preset.select':
      return { ...state, stagedPreset: command.preset, menu: null }
    case 'menu.toggle':
      return { ...state, menu: state.menu === command.menu ? null : command.menu }
    case 'menu.close':
      return { ...state, menu: null }
    case 'details.open':
      return { ...state, details: command.details, menu: null }
    case 'details.close':
      return { ...state, details: null }
    case 'sidebar.toggle':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed, menu: null }
    case 'settings.open':
      return { ...state, settingsOpen: true, settingsSection: command.section ?? state.settingsSection, menu: null }
    case 'settings.section':
      return { ...state, settingsSection: command.section }
    case 'settings.close':
      return { ...state, settingsOpen: false }
    case 'demo.reset':
      return initialState()
    case 'toast.clear':
      return { ...state, toast: null }
  }
}

function parseStored(storage: Storage): AppState | null {
  try {
    const value = storage.getItem(STORAGE_KEY)
    return value === null ? null : JSON.parse(value) as AppState
  } catch {
    return null
  }
}

export function createDemoClient(storage: Storage): ClientPort {
  let state = parseStored(storage) ?? initialState()
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispatch(command) {
      const next = reduce(state, command)
      if (Object.is(next, state)) return
      state = next
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage is optional */ }
      for (const listener of listeners) listener()
    },
  }
}
