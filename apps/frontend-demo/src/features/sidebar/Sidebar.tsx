import type { MenuId, SessionId, SessionSummary, WorkspaceSummary } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './Sidebar.module.css'

export interface SidebarProps {
  collapsed: boolean
  workspaces: readonly WorkspaceSummary[]
  sessions: readonly SessionSummary[]
  activeSessionId: SessionId | null
  openMenu: MenuId
  onNewSession(): void
  onOpenSession(sessionId: SessionId): void
  onToggle(): void
  onToggleMenu(menu: 'sidebar-view'): void
  onOpenSettings(): void
}

function FishMark() {
  return <span className={css.fish}>◒</span>
}

function SessionRow({ session, active, onOpen }: { session: SessionSummary; active: boolean; onOpen(): void }) {
  return (
    <button type="button" className={css.session} data-active={active || undefined} onClick={onOpen}>
      <span className={css.sessionTitle}>{session.title}</span>
      <span className={css.sessionTime}>{session.updatedAt}</span>
      {session.employeeRun?.status === 'waiting-approval' && <span className={css.waitDot} title="等待授权" />}
    </button>
  )
}

export function Sidebar(props: SidebarProps) {
  const localSessions = props.sessions.filter(session => session.kind === 'local')
  const employeeSessions = props.sessions.filter(session => session.kind === 'employee')
  if (props.collapsed) {
    return (
      <div className={css.rail}>
        <button type="button" className={css.railBrand} aria-label="展开侧边栏" onClick={props.onToggle}><FishMark /></button>
        <button type="button" className={css.railButton} aria-label="新会话" onClick={props.onNewSession}><Icon name="plus" size={19} /></button>
        <button type="button" className={css.railButton} aria-label="工作区"><Icon name="folder" size={18} /></button>
        <button type="button" className={css.railButton} aria-label="AI 员工"><Icon name="robot" size={18} /><span className={css.railBadge} /></button>
        <div className={css.railSpacer} />
        <button type="button" className={css.railButton} aria-label="设置" onClick={props.onOpenSettings}><Icon name="settings" size={18} /></button>
      </div>
    )
  }
  return (
    <div className={css.root}>
      <div className={css.brandRow}>
        <button type="button" className={css.wordmark} aria-label="新会话" onClick={props.onNewSession}>
          <FishMark /><span>deepseek</span><b>HARNESS</b>
        </button>
        <button type="button" className={css.iconButton} aria-label="收起侧边栏" onClick={props.onToggle}><Icon name="panel" /></button>
      </div>
      <button type="button" className={css.newSession} onClick={props.onNewSession}>
        <Icon name="plus" size={15} /><span>新会话</span>
      </button>

      <div className={css.workspaceHeader}>
        <span>工作区</span>
        <div className={css.headerActions} data-menu-root>
          <button type="button" aria-label="搜索"><Icon name="search" size={18} /></button>
          <button type="button" aria-label="视图选项" onClick={() => { props.onToggleMenu('sidebar-view') }}><Icon name="tune" size={18} /></button>
          <button type="button" aria-label="添加工作区"><Icon name="plus" size={18} /></button>
          {props.openMenu === 'sidebar-view' && (
            <div className={css.viewMenu} role="menu">
              <div className={css.menuLabel}>视图</div>
              <button type="button"><span>按工作区分组</span><Icon name="check" /></button>
              <button type="button"><span>单一列表</span></button>
              <div className={css.menuDivider} />
              <div className={css.menuLabel}>排序</div>
              <button type="button"><span>最近更新</span><Icon name="check" /></button>
              <button type="button"><span>手动排序</span></button>
            </div>
          )}
        </div>
      </div>

      <div className={css.browser}>
        {props.workspaces.slice(0, 1).map(workspace => (
          <section key={workspace.id} className={css.workspaceGroup}>
            <div className={css.groupTitle}><Icon name="folder" size={17} /><span>{workspace.title === 'AiDesktop' ? 'DS' : workspace.title}</span></div>
            <div className={css.sessionList}>
              {localSessions.map(session => <SessionRow key={session.id} session={session} active={session.id === props.activeSessionId} onOpen={() => { props.onOpenSession(session.id) }} />)}
            </div>
          </section>
        ))}

        <section className={css.extensionGroup} aria-label="AI 员工插件区">
          <div className={css.extensionTitle}>
            <span><Icon name="robot" size={16} />AI 员工</span>
            <span className={css.extensionCount}>{employeeSessions.length}</span>
          </div>
          {employeeSessions.map(session => (
            <button key={session.id} type="button" className={css.employee} data-active={session.id === props.activeSessionId || undefined} onClick={() => { props.onOpenSession(session.id) }}>
              <span className={css.employeeAvatar}><Icon name="spark" size={14} /></span>
              <span className={css.employeeText}><b>{session.employeeRun?.employeeName}</b><small>{session.title}</small></span>
              {session.employeeRun?.status === 'waiting-approval' && <span className={css.approvalBadge}>待确认</span>}
            </button>
          ))}
          <button type="button" className={css.inbox}><Icon name="inbox" size={16} /><span>任务收件箱</span><b>1</b></button>
        </section>
      </div>

      <button type="button" className={css.settings} onClick={props.onOpenSettings}><Icon name="settings" size={18} /><span>设置</span></button>
    </div>
  )
}
