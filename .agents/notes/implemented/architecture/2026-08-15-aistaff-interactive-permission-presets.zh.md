# Agent Note: AI Staff 在每种权限预设下均保持审批交互性

Status: implemented

[English](2026-08-15-aistaff-interactive-permission-presets.md) | 中文

## 问题

AI Staff 是面向客户的桌面界面。通用 DSH 基线允许显式的无人值守组合 `danger-full-access + never`，但若产品权限选择器沿用该审批策略，就会抑制需要显式授权的操作所触发的审批请求。产品初始化还必须保留用户拥有的补丁内容和现有会话历史。

## 决策

AI Staff 配置文件覆盖通用 DSH 基线，使 `read-only`、`workspace-write` 和 `danger-full-access` 三种权限均采用 `ask` 审批策略，其中 `workspace-write` 为默认预设。选择 `danger-full-access` 仅更改文件沙箱范围，不会抑制需要显式授权的操作所触发的审批请求。

通用 DSH 基线仍保留 `danger-full-access + never` 组合，用于明确的无人值守部署场景。因此，该产品行为由 `apps/aistaff-desktop/src/profile.ts` 负责，而非由共享的权限服务或审批服务控制。

配置文件初始化过程仅替换此前由 AI Staff 生成的两个精确匹配补丁主体。其余所有 `cordis.patch.yml` 内容均由用户拥有并保持不变。已存在的会话继续保留其已记录的 `approval/policy` 事件；再次选择权限预设时，系统追加当前交互式审批策略，而不会重写历史记录。

## 考虑过的替代方案

**继承通用的 `danger-full-access + never` 预设。** 该组合继续用于显式的无人值守部署，但会使面向客户的桌面端抑制需要用户授权的审批请求。

**修改共享权限服务或审批服务。** 该行为只属于 AI Staff 产品配置文件，而共享部署仍需要现有的无人值守组合。

## 影响

AI Staff 的每种权限预设都保持交互式审批，文件沙箱仍遵循所选预设。通用无人值守部署保留现有行为。初始化会保留用户拥有的补丁，权限预设变更会追加历史而不是重写历史。
