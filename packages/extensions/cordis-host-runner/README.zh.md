# @deepseek-ai/dsh-cordis-host-runner

[English](README.md) | 中文

由模型挂载的动态包在 host 侧的那一半：定义注册表、host 半所用的 `node:vm` 沙箱与 fiber 生命周期、invoke handler 表，以及由某个浏览器页面执行的 run 往返。以 `ctx.dynamicCordisRunner` 提供。面向模型的工具在 [`@deepseek-ai/dsh-tool-cordis`](../tool-cordis/README.md) 中；浏览器半由 [`@deepseek-ai/dsh-cordis-client-runner`](../cordis-client-runner/README.md) 装载。

## 功能

分两个阶段：`define` 只做登记，一切带副作用的动作都挂在一次 run 上。

- `define`／`undefine` 掌管一个定义的生命周期。`define` 对元数据做首尾去空白与必填校验，在不运行任何一半的前提下编译 Host JavaScript／TypeScript 与 Client JavaScript／TypeScript／TSX，铸出稳定 Plugin ID 和不可变 Package ID，再把定义原子发布到发起调用的会话名下。Client JSX 会降级到浏览器求值器原本就提供的 `React` 绑定；两边都没有 import／export resolver。`undefine` 先停掉正在运行的 Plugin，再移除它的持久定义。两者都不上 wire：只有模型自己的工具调用才会 define。
- `run` 回答模型「运行某个定义」的请求，它的两种形态取决于这个包是谁的事。只有 host 半的包是本进程自己的事：host 半在 `cordis-dynamic` group fiber 之下于 vm 中求值，调用随即返回。带浏览器半的包必须由一个页面来执行，于是 `run` 变成一次可作答的往返——它 emit `cordis/request-run`、挂起，并由某个人允许或拒绝来结束。这里没有定时器；调用方的 `AbortSignal`（提问的那一轮次被取消）是唯一的另一条出路，而且它会把这次取消播报出去，让其他页面不再提供作答入口。请求发出时**并不知道**会不会有人作答——收到它的页面也可能永远不答，所以没有页面连接的部署与其他未作答请求一样挂起，最终以 `cancelled` 收场。`run` 没有 wire 面——`cordis_run` 在进程内调用它。
- `runHostHalf`／`getClientCode` 是获得允许的页面依次走的步骤，host 半在先，因此 host 半失败会在浏览器还没动作之前短路。`runHostHalf` 在约定上是幂等的：已在运行的包只做绑定，不再求值；针对同一个定义的并发调用只求值一次，`startedHere` 指出求值的是哪一个调用方。随后 `getClientCode` 把浏览器半的源码交给这一个页面；定义已消失、没有浏览器半、或未在运行时，它会拒绝。代码从不搭乘任何播报，所以这是它到达浏览器的唯一途径。
- `resolveRequestRun` 用作答页面的结论结束这次往返，并 emit `cordis/request-run-resolved`，让其他每个页面撤下待作答的入口。首答即成；更晚的或未知的 request id 会被接受并忽略。命名了注册表已越过的版本的成功结论会被拒绝而非应用（`accepted: false`，请求仍处于挂起），因为作答的那个页面装载的是一个已不再存活的下发。失败的结论只会在 host 半正是由这次请求求值时才将它回退，因此某个页面装不上自己那一半，绝不会把其他页面正在使用的包停掉。
- `stop` 回退一次存活的下发——丢弃 handler、把 host 半 fiber dispose（资源释放）到完全停稳、emit `dynamicCordisRunner/retract`——并让该定义仍然可运行。
- `inventory` 回答整个注册表，不按会话寻址，且每一行都指明拥有该定义的会话，因为运行控制面是全局的。能列出不等于能操作：每个有实际动作的动词仍会检查这份归属。每一行还会指明该定义有没有浏览器半，因此运行控制面只在确有可装载的半时，才提供「装入当前页面」。`snapshot` 是它按会话限定的 host 本地对侧，携带每个存活 host 半的 fiber，供 `cordis_inspect` 自行渲染 provides／waiting／state（fiber 无法跨 wire）。
- `reportRenderFailure` 记录某个页面看到一个**已装载**的浏览器半在渲染时做错了什么。渲染严格发生在装载成功之后，因此到那时 run 早已回答了 `ok`：这份上报是 fire-and-forget 的，不带任何结算权威，也绝不触碰 `resolveRequestRun` 或 run 结论的任何部分——**它不是那个已退役的 v2 `report`／ack**。host 按定义保留跨所有页面的最后一次失败（第二个页面上报即覆盖），而一次全新的 run、一次 stop 或一次 undefine 都会清掉它，因此模型绝不会看到一次已不存在的下发留下的失败。浏览器半的契约面自己保留一份「**这个页面**当前正在显示什么」；两者回答的是不同的问题，不是同一个问题的两份答案。上报的会话若并不拥有该定义，这次上报会被丢弃，因为上报路径绝不能让一次渲染失败。
- `invoke` 把一个包的浏览器半发起的一次调用，路由到它自己的 host 半用 `harness.handle` 注册的方法。这套基础设施只做路由：不存在 host 到浏览器的方向。

`run` 或 `stop` 的拒绝会给出 `definition-missing`、`host-half-failed`、`client-half-failed`、`rejected`、`cancelled`、`not-running` 之一；后三者是答复而非缺陷——有人拒绝了、提问的那一轮次已结束，或本来就没有在运行的东西可停。

别的会话登记的定义读起来是不存在，而不是被禁止，因此不会跨会话泄漏任何东西。`invoke` 与 `resolveRequestRun` 完全不携带会话：组件的一次调用和页面的一次作答都是页面全局的事实，不属于某一个会话。

本功能拥有四条转发事件，由本包在其 client-safe 的 [`./types`](src/types.ts) 子路径上声明，并由 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) 的白名单准许投递——正是这一点让浏览器能经 `ctx.remote.$on` 收到它们：`cordis/request-run`（`{requestId, agentId, id, name, purpose}`——只有元数据，绝无代码）、`cordis/request-run-resolved`（`{requestId, outcome}`）、`dynamicCordisRunner/package`（`{id, name, rev}`），以及 `dynamicCordisRunner/retract`（`{id, rev}`）。后两者是对称的一对运行状态播报：每次全新启动与每次停止都播，与该包有没有浏览器半无关。

## 存储与开发态 HMR

`$DSH_HOME/dynamic-cordis` 是本服务的持久 owner。`registry.json` 是源码、稳定 identity counter、不可变 Package ID 与最后成功激活 Package 指针的原子 commit point。编译后的 JavaScript 先写入 content-addressed 的 `artifacts/<sha256>.js`，随后才 rename manifest。启动时会拒绝软链接形式的 owner／artifact 目录，并在恢复前验证每个被引用 artifact 都是普通文件且 SHA-256 匹配。因此编译或发布失败不会替换最后一次可用 manifest；未被引用的 artifact 只是无害 orphan。

重启会恢复定义与 current Package 指针，但明确不会恢复 Fiber、handler、pending approval、按 Package 的 grant 或 `run` 状态。每个 Plugin 都以 stopped／restorable 状态出现，仍须通过原有的显式 run／approval 路径激活。生产态不会对留存的 TypeScript／TSX 求值：所有运行方法只消费校验过的 JavaScript artifact。

每次成功 define 还会维护稳定工作副本 `$DSH_HOME/dynamic-cordis/sources/<pluginId>/host.ts` 和／或 `client.tsx`。当 `developmentHmr: true` 时，一个串行 poller 比较这些文件的真实字节。成功编辑会编译两边现存源码、追加不可变 Package、原子提交，并且只在 Plugin 当前正在运行且用户已允许其后续 Client 版本时请求更新。既有 Client runner 会先移除并排空旧 Fiber，再装载新 artifact。错误编辑会原样留在可编辑文件中，不改变 active Package 或 manifest，并在 `inventory` 与 Cordis 面板中以符号化 `$DSH_HOME` 路径和编译消息展示。Watcher dispose 后会停止新轮询，也不会让刚完成的构建在 teardown 后触发 HMR。

## 信任立场

vm 沙箱隔离全局变量，但不是安全边界：Node 全局变量不存在，或重定向到 Cordis 服务（`ctx.fs`、`ctx.web`、`ctx.bash` 以及定时器 helper），host 半收到的是不含框架内部机制的 façade，但它声明的服务仍会触达存活运行时。应当像对待 bash 访问一样对待动态包，参见[自引用工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `vmTimeoutMs` | `5000` | host 半在 vm 中同步执行的那部分被中止求值前可运行的毫秒数 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 拥有持久 registry、artifact 与可编辑源码的 Harness home |
| `developmentHmr` | `false` | 启用工作副本 watcher 与已授权的 Client 热替换 |
| `developmentHmrPollMs` | `500` | 开发源码串行轮询间隔（毫秒） |

## 导出形状

服务包：默认导出 `DynamicCordisRunnerService`（服务键 `dynamicCordisRunner`），`./types` 则承载 `dynamicCordisRunner` remote namespace 与其消费方共享的载荷形状。`define`／`undefine` 的形状留在包内部，因为它们从不跨 wire。

## 模型体验

### 经 cordis 工具转达的拒绝与教学式错误

#### 模型看到的内容

没有直接可见的内容：本包不注册任何工具，也不注入提示词。它的拒绝经调用它的 `cordis_*` 工具结果到达模型——无法解析的半会指出出错的那一行，缺失的定义会说明它不在持久 registry 中，`rejected` 或 `cancelled` 的 run 报告的是有人拒绝或该轮次已结束而非出了故障，浏览器半装载失败则带上作答页面自己的错误文本。

#### Token 影响

本包自身没有：上述每条消息都由调用它的那个工具的结果承载。

#### KV Cache 影响

注册工具的 host 半会改变下一次请求的工具视图，从第一个变化的 schema token 起使前缀复用失效；运行或停止一个不注册任何工具的包对前缀不产生影响。

## 已知限制与暂缓事项

- **run 成功不等于 UI 渲染成功。** 只要作答页面**已装载**浏览器半，`run` 就会返回；React 是随后才渲染的，因此一个抛异常的组件根本不可能出现在 run 的回执里。该失败经 `reportRenderFailure` 浮现，并通过 `cordis_inspect what:"temporary"` 读回；run 的结果会把这一点说出来，而不是暗示成功。

- 带浏览器半的包在**没有页面连接的地方会挂起**——headless 与 ACP（Agent Client Protocol）部署会把这次 run 一直挂到提问的轮次被取消，因为转发事件不回报谁收到了它。只有 host 半的包不受影响。
- 挂起的 run 请求**没有超时**：它一直等人，直到提问的那一轮次被取消，因此无人值守的自动化用不了带浏览器半的包。
- `vmTimeoutMs` 只约束同步求值；async 的 host 半函数体会逃出该上限，这与该工具集基于协作的信任立场一致。
- `runHostHalf` 不携带 request id，因此「这个 host 半是哪次请求求值的」由 host 侧归因到该定义最近一次挂起的请求；若同一个定义出现多个并发 run 请求，这条规则需要重新审议。
- 命名了已被取代版本的成功结论会被拒绝（`accepted: false`）并让该请求继续挂起，因此模型这次调用只能靠一次有效作答或自身被取消才结束。要把它结算掉，需要对着存活版本重新走一遍编排，而当前没有任何页面会这么做——[浏览器半](../cordis-client-runner/README.md)不读这个 ack——所以这类请求实际上由别的页面作答、或由调用方取消来收尾。
- 浏览器半声明的 `inject` 是从它在页面里返回的插件上读出的，因此播报完全不携带服务声明字段。
- **`zod` 是生成的 TypeRT 契约面的运行时依赖，不是 `src` 的依赖。** `./typert` 与 `./remote` 解析到 `lib/typert.*.js`，`tsc` 以不打包的形式产出它们，其中带有裸的 `import { z } from 'zod'`，所以本包必须声明它（沿用 `@deepseek-ai/dsh-goal` 的先例），而 `knip.json` 必须在这个 workspace 里忽略它：knip 读的是源码，而这些契约面是构建产物。`src` 里没有任何代码 import zod。
