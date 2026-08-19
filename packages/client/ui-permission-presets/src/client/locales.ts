/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '设置新会话的默认权限；不会改变已经创建的会话',
  'global.title': '全局默认',
  'global.description': '没有项目覆盖时，新会话使用此权限',
  'project.title': '当前项目',
  'project.description': '{name} 中新建的会话使用此权限',
  'project.inherit': '跟随全局（{mode}）',
  'mode.readOnly.title': '请求批准',
  'mode.readOnly.description': '默认保持只读；需要写入文件时请求你的批准',
  'mode.workspaceWrite.title': '帮我批准',
  'mode.workspaceWrite.description': '允许修改当前项目；扩大文件访问范围时请求批准',
  'mode.fullAccess.title': '完全访问权限',
  'mode.fullAccess.description': '可修改电脑上的任意文件，并跳过权限确认',
  'loading': '加载中',
  'unavailable': '不可用',
  'confirm.global.title': '确认将全局默认设为完全访问权限？',
  'confirm.global.description': '之后创建且没有项目覆盖的会话可以修改电脑上的任意文件，并跳过权限确认。仅在你信任后续任务时启用。',
  'confirm.project.title': '确认将项目默认设为完全访问权限？',
  'confirm.project.description': '之后在此项目中创建的会话可以修改电脑上的任意文件，并跳过权限确认。仅在你信任此项目时启用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问权限',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permissions',
  'description': 'Set defaults for new sessions; existing sessions do not change',
  'global.title': 'Global default',
  'global.description': 'New sessions use this permission when no project override exists',
  'project.title': 'Current project',
  'project.description': 'New sessions in {name} use this permission',
  'project.inherit': 'Use global default ({mode})',
  'mode.readOnly.title': 'Ask for approval',
  'mode.readOnly.description': 'Stay read-only by default and ask before writing files',
  'mode.workspaceWrite.title': 'Agent approval',
  'mode.workspaceWrite.description': 'Allow changes in this project and ask before broader file access',
  'mode.fullAccess.title': 'Full access',
  'mode.fullAccess.description': 'Modify any file on this computer and skip permission prompts',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.global.title': 'Make Full access the global default?',
  'confirm.global.description': 'Future sessions without a project override can modify any file on this computer and skip permission prompts. Only enable this when you trust subsequent tasks.',
  'confirm.project.title': 'Make Full access this project’s default?',
  'confirm.project.description': 'Future sessions in this project can modify any file on this computer and skip permission prompts. Only enable this when you trust the project.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'mode.readOnly.title': '请求批准',
  'mode.readOnly.description': '默认保持只读；需要写入文件时请求你的批准',
  'mode.workspaceWrite.title': '帮我批准',
  'mode.workspaceWrite.description': '允许修改当前项目；扩大文件访问范围时请求批准',
  'mode.fullAccess.title': '完全访问权限',
  'mode.fullAccess.description': '可修改电脑上的任意文件，并跳过权限确认',
  'confirm.title': '确认启用完全访问权限？',
  'confirm.description': '启用后，当前会话可以修改电脑上的任意文件，并跳过权限确认。仅在你信任当前任务时启用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续',
  'confirm.cancel': '取消',
  'confirm.enable': '启用完全访问权限',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'mode.readOnly.title': 'Ask for approval',
  'mode.readOnly.description': 'Stay read-only by default and ask before writing files',
  'mode.workspaceWrite.title': 'Agent approval',
  'mode.workspaceWrite.description': 'Allow changes in this project and ask before broader file access',
  'mode.fullAccess.title': 'Full access',
  'mode.fullAccess.description': 'Modify any file on this computer and skip permission prompts',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>
