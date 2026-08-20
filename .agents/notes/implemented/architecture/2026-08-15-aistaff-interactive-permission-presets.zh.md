# AI Staff 在每种权限预设下均保持审批交互性

[English](2026-08-15-aistaff-interactive-permission-presets.md) | 中文

AI Staff 是面向客户的桌面表面（desktop surface）。其 profile（配置文件）覆盖了通用的 DSH 基线，因此 `read-only`、`workspace-write` 和 `danger-full-access` 这三种权限均采用 `ask` 审批策略，其中 `workspace-write` 为默认预设。选择 `danger-full-access` 仅会更改文件沙箱范围。它不会抑制那些需要显式授权的操作所触发的审批请求。

通用 DSH 基线仍保留 `danger-full-access + never` 组合，用于明确的无人值守部署（unattended deployment）场景。因此，该产品行为由 `apps/aistaff-desktop/src/profile.ts` 负责，而非由共享的权限服务或审批服务控制。

profile（配置文件）初始化过程仅替换此前由 AI Staff 生成的两个精确匹配的补丁主体。其余所有 `cordis.patch.yml` 内容均由用户自主管理，保持不变。已存在的会话将继续保留其已记录的 `approval/policy` 事件；再次选择权限预设时，系统将追加当前的交互式审批策略，而不会重写历史记录。
