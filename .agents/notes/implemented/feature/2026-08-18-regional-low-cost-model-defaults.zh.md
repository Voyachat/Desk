# Agent Note：按地区选择低价桌面模型默认值

Status: implemented

[English](2026-08-18-regional-low-cost-model-defaults.md) | 中文

## Problem

桌面安装包在中国大陆需要一个通过国内端点工作的经济型默认模型，在其他地区需要一个经济型 Gemini 路由。内置共享凭据会把计费和租户权限转移到应用中；IP 定位则会在本机 Runtime 启动前增加网络依赖并披露位置数据。

## Decision

生成的桌面 profile 注册 `dashscope/qwen3.7-flash` 与 `google/gemini-3.1-flash-lite`。Electron 提供的操作系统 ISO 国家码仅在 `CN` 时选择 DashScope，其他值或无法取得国家码时选择 Gemini。该选择只写入新 profile 或内容完全匹配旧版生成模板的 profile。用户编辑过的 profile 始终具有最高优先级。

凭据继续保存在仓库外、仅所有者可读的现有文件中，并且只进入 Runtime 子进程环境。DMG 只包含 provider 名称和环境变量引用，不包含 API key。用户仍可通过模型选择器显式覆盖生成的默认值。

## Alternatives considered

没有采用 IP 定位，因为默认模型选择不足以证明位置请求、第三方查询、启动延迟或网络推断歧义的必要性。没有内置或抓取所谓低价共享 key，因为 API key 是凭据而不是价格档位，这会带来不可控的计费、轮换和租户隔离风险。没有新增地区路由插件，因为桌面 profile 生成器已经负责初始模型选择。

## Consequences

中国大陆安装可以直接使用 DashScope，其他地区安装使用 Gemini Flash-Lite。可用性和计费仍取决于用户自己的 provider 账户。改变操作系统国家设置不会覆盖用户编辑过的 profile。
