# @voyaseek-ai/dsh-client-ui-permission-presets

[English](README.md) | 中文

面向三个作用域的浏览器权限界面。「通用」设置块读取显式暴露的 `permission` Settings 描述符，从 host 的动态 `defaultPreset` enum 中推导选项，同时显示全局默认值与当前 Workspace 路径的可选覆盖。写入使用带 revision 的 `settings.mutate` 操作：`defaultPreset` 保存全局值，`workspacePresets[canonicalPath]` 保存项目覆盖，`unset` 让项目重新跟随全局值。这些默认值仅在后续会话创建时生效，绝不切换已有会话。选择完全访问权限时，两个默认入口都会先显示与作用域对应的风险确认。

当前会话界面仍是挂在 host `/permission` 命令上的 popupSelect **装饰**（`ctx.commandUi.decorate`）。装饰不是第二条命令——host 命令保留斜杠菜单行、带参路径（`/permission <preset>` 直接切换）与持久生命周期记账。三个内置预设在渲染时随语言设置展示为「请求批准」「帮我批准」「完全访问权限」；自定义预设保留 host 名称与说明。选项与 active 标记读取会话的 `permissions` 投影（与 composer chip 渲染的同一份 host 计算 select），因此两个当前会话界面共享同一读源与同一写路径。装饰恰在投影 key 存在时可用；无权限组合既不显示选择框，也不显示 Settings 设置块。

`/client` 导出面为插件本体（`apply`／`inject`）。

## 模型体验

通过两个界面写入的权限事实间接影响：Settings 行使未来会话带着全量值旋钮事件（`permission/preset`、`sandbox/mode`、`approval/policy`）启动，而 `/permission` 选择框切换当前会话时会追加相同的事实；这些事件决定后续工具调用解析到的沙箱模式与审批策略，选择框交互本身不添加任何提示词内容。

#### KV Cache 影响

无直接失效；请求前缀的变化由旋钮消费方自行承担。

## 已知限制与暂缓事项

- **Settings 设置块仅在 Web 中可用**：非 Web 客户端仍可通过 `/permission` 切换当前会话，但不会获得这项浏览器贡献。
- 权限预设控制文件效果与审批提示，目前不控制网络访问。
