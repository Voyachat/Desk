/** `claudeRuntime` namespace dictionaries (the composer runtime selector's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.aria': '运行模式',
  'chip.title': '运行模式 — 切换后将在同一项目下开启对应模式的新会话',
  'chip.busy': '正在切换运行模式…',
  'option.native': '本机模式',
  'option.native.desc': '由 Voyaseek Harness 本机调度',
  'option.claude': 'Claude 模式',
  'option.claude.desc': '由 Claude Agent SDK 调度',
  'option.codex': 'Codex 模式',
  'option.codex.desc': '由 OpenAI Codex 调度',
} satisfies Record<string, string>

/** The claudeRuntime namespace key union. */
export type ClaudeRuntimeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.aria': 'Runtime mode',
  'chip.title': 'Runtime mode — switching opens a new session in the same project under the chosen mode',
  'chip.busy': 'Switching runtime mode…',
  'option.native': 'Native',
  'option.native.desc': 'Driven by the Voyaseek Harness loop',
  'option.claude': 'Claude',
  'option.claude.desc': 'Driven by the Claude Agent SDK',
  'option.codex': 'Codex',
  'option.codex.desc': 'Driven by OpenAI Codex',
} satisfies Record<ClaudeRuntimeKey, string>
