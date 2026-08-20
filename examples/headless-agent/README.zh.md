# headless-agent

[English](README.md) | 中文

本目录负责 headless coding agent（智能体）的回放和真实模型测试组装：DeepSeek V4 + 本地 bash 与文件系统工具 + subagent 委托 + 工作流与全新 agent Ralph 迭代 + `todo_write` + JSONL 持久化。本目录显式挂载共享 agent 主干、一个根 agent、持久化和检查点策略；它不是第二个产品入口。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm dsh --profile headless "fix the failing test in this workspace"
```

产品命令是 [`dsh --profile headless`](../../apps/cli/README.md)：它接受一项非空任务，创建并持久化新会话，打印最终 assistant 文本，然后退出。

快照套件通过 [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts) 运行本目录的配置。这个未导出且仅供测试使用的进程会在结果记录之前，以 JSONL 发出规范会话事件。该事件流属于测试基础设施，不是受支持的 CLI（命令行界面）输出格式。子会话只通过父会话的工具事件和结果对外显示。

## 真实提供方变体

默认真实产品组装仍使用 DeepSeek。[`tests/fixtures/qwen-real.cordis.yml`](tests/fixtures/qwen-real.cordis.yml) 仅将 LLM 路由替换为 DashScope `qwen-plus`；Loader 启动、本地工具、agent loop 和 JSONL 持久化保持不变。

Qwen 场景通过 `maxRetries: 0` 禁用提供方重试，对该付费用例禁用 Vitest 重试，将每次响应限制为 `maxTokens: 1024`，并在第五次模型请求开始前强制停止。父测试进程只有在从临时工作区重新读取 `task.txt`、观察到预期修改，并确认持久化的 `assistant/message` 步骤与进程记录一致后才接受该次运行，而不会信任模型的最终声明。

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) 使用一个共享 E2B 沙箱替换本地文件系统与子进程提供方，同时保留 `dsh-bash-local` 和相同的面向模型工具。请在 git 忽略的根目录 `.env` 中，将 `E2B_API_KEY` 与 `DEEPSEEK_API_KEY` 放在一起，然后运行凭据门控的实机组合测试；它在同一个沙箱中驱动 FS、Bash、PTY 和 LSP，并证明沙箱最终被删除：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

该 overlay 会在沙箱中创建相同的绝对 cwd，但不会上传或挂载宿主工作区。文件与 Bash 变更只存在于 E2B；Cordis、模型调用、agent／会话状态、会话日志、skill（技能）和 SDK 缓冲仍在宿主上。该组合会在超时和资源释放时终止其沙箱。它是提供方组合 POC，而不是完整 harness 迁移或工作区同步功能。

## 高级配置

[`advanced.cordis.yml`](advanced.cordis.yml) 在测试组装中添加 Code Mode 和 Cordis 工具。
