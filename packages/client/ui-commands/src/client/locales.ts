/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'catalog.compact.label': '压缩',
  'catalog.compact.description': '压缩较早的对话历史',
  'catalog.export.label': '导出',
  'catalog.export.description': '将此会话日志下载为 ZIP 压缩包',
  'catalog.feedback.label': '反馈',
  'catalog.feedback.description': '记录关于此会话的反馈',
  'catalog.goal.label': '目标',
  'catalog.goal.description': '设置或查看长时任务的目标',
  'catalog.permission.label': '权限',
  'catalog.permission.description': '切换权限预设（沙箱模式与审批策略）',
  'catalog.plan.label': '计划',
  'catalog.plan.description': '进入或退出计划模式',
  'catalog.workflow-retry.label': '重试工作流',
  'catalog.workflow-retry.description': '从已记录的源调用重新启动中断或失败的工作流',
  'search.placeholder': '搜索…',
  'search.aria': '筛选选项',
  'status.loading': '正在加载选项…',
  'status.applying': '正在应用…',
  'status.empty': '无选项',
  'overlay.aria': '/{command} 选项',
  'listbox.aria': '/{command} 匹配项',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'catalog.compact.label': 'Compact',
  'catalog.compact.description': 'Compact older conversation history',
  'catalog.export.label': 'Export',
  'catalog.export.description': 'Download this Session log as a ZIP archive',
  'catalog.feedback.label': 'Feedback',
  'catalog.feedback.description': 'Record feedback about this session',
  'catalog.goal.label': 'Goal',
  'catalog.goal.description': 'Set or view the goal for a long-running task',
  'catalog.permission.label': 'Permission',
  'catalog.permission.description': 'Switch the permission preset (sandbox mode + approval policy)',
  'catalog.plan.label': 'Plan',
  'catalog.plan.description': 'Enter or leave plan mode',
  'catalog.workflow-retry.label': 'Retry workflow',
  'catalog.workflow-retry.description': 'Restart an interrupted or failed workflow from its logged source call',
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
} satisfies Record<CommandKey, string>
