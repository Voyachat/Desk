# Agent Note: DSH 发布快照导入与品牌 epoch

Status: implemented

[English](2026-08-20-dsh-release-snapshot-import.md) | 中文

## 问题

AiDesktop 持续跟随 DSH 源码仓，同时保留 Voyaseek 品牌、Electron 产品壳和 Aistaff 插件。若直接把官方 release 合入产品分支，每次升级都会重复源码识别、品牌修改、来源核验和冲突分类。若维护第二棵可编辑产品 fork，又会让产品行为在两个位置静默分叉。品牌规则也会变化：不能用新版 codemod 改写旧 release 后，仍把结果当作此前已记录的同一基线。

rc.5 到 rc.8 的升级还暴露了两类集成风险。上游删除后仍残留在 `src/` 下的生成 JavaScript 和声明文件，可能在合并后继续存在，并在 Vite 解析时遮蔽当前 TypeScript。过去产品专用的图片上下文注入，也可能与上游新增的通用 Code Mode 转发重复。把 `DSH_HOME` 品牌化为 `VOYASEEK_HOME` 虽然改变了环境变量名，却没有改变浏览器 launcher 子进程不得继承产品私有用户目录的要求。语义合并也可能在上游修改默认值后保留过时产品默认：rc.8 在浏览器未声明任何已发布语言时使用英文，而 rc.5 的共享 locale 常量仍选择中文。Client package manifest 与面向 Git tracked 文件的品牌扫描还暴露了两类机械风险：仅供静态构建或由 peer 安装的 Client 输入可能被误归类为运行时依赖；worktree 中已经删除但 Git 仍跟踪的文件，可能让只读 codemod 在报告品牌残留前直接失败。

## 决策

AiDesktop 只保留一棵可编辑产品源码树。`/Users/baron/projects/开源代码` 下的官方 DSH checkout 是干净、只读的评审输入，不构成运行时依赖。每个采用的 release 由 [`scripts/import-dsh-release.ts`](../../../../scripts/import-dsh-release.ts) 创建两条本地不可变快照链：一条是精确上游原始树，另一条是对同一棵树执行仓库机械品牌化后的结果。原始快照树必须与官方 commit tree 完全一致。快照 commit 记录上游 commit、tree 和 tag；品牌化快照还记录精确的品牌脚本 blob。

Importer 接收官方 tag；若上游不再暴露某个历史 tag，也可接收已记录的精确 commit。它验证 checkout origin、干净状态、release 祖先关系、tree 身份、确定性父子关系、不可变 ref 和品牌脚本幂等性。它不会合并产品分支、更新 [`.open-source/adoptions.yaml`](../../../../.open-source/adoptions.yaml)、push、打包、签名、公证或发布。这些动作仍须在产品验证后单独决定。

品牌规则变化时创建 script-hash epoch，不改写既有品牌化快照。Epoch 为字母 `r` 加脚本 blob 前十二位十六进制字符。分支命名为 `codex/dsh-upstream-rebranded-snapshots-r<hash>`，tag 使用相同后缀；不使用斜杠，因为这些 ref 与既有非 epoch 分支共用前缀。同一升级 pair 的两个 release 使用同一个 epoch，因此也使用同一个脚本 blob。调用者显式选择 `--recorded-rebrand-epoch` 重放已有链，或选择 `--current-rebrand-epoch` 创建当前脚本 epoch；当前 blob 与已记录 blob 不同时，无显式选择失败。历史脚本执行两次并要求 tree 不变，当前脚本首次应用后使用更强的 `--check`。首次冻结 refs 的三个 metadata 缺字段只按精确 snapshot commit 例外接受；所有新 snapshot 必须记录完整 upstream commit、tree 和 tag。

品牌 codemod 忽略 worktree 中已不存在的 tracked 路径，并保护 `.open-source/**`、法律归属、vendor 来源、Importer 及其记录的上游事实。Manifest 中作为协议或包身份使用的公共 `dsh` 字段继续保留 `dsh`，它们不是产品可见品牌文案。用户可见名称、资产、Client wordmark 和产品文案由 Client brand 插件与上游 brand slots 负责。Aistaff 行为继续位于 `packages/aistaff/**` 插件包及产品 composition 中，不进入 agent loop 或通用 Client 框架。Client package manifest 把静态构建输入归入 development dependency，把由 peer 安装的 DSH 关系归入 peer 加 development dependency；`verify-client-packages` 拒绝违反该 owner 关系的 runtime dependency。

共享 locale fallback 为英文，与 rc.8 浏览器行为及无显式偏好时的 Host 模型语言上下文保持一致。Source plane 不得保留会遮蔽自有 `.ts` 或 `.tsx` 文件的同名生成 `.js`、`.d.ts` 或 source map。Release 合并必须在 source-plane 验证前删除上游已经移除的生成残留。构建输出只能进入声明的 artifact 目录，并且构建完成后不得重新产生这些 `src/` 文件。

图片子工具上下文由通用 Code Mode 转发统一负责。`tool-fs/read_image` 返回图片结果，但在存在父执行时不再单独调用 `deferContext()`。子进程环境清理器会删除 credential-shaped 变量、大小写不敏感的全部 `DSH_*` 键，以及大小写不敏感且精确匹配的 `VOYASEEK_HOME`；调用方仍可通过显式 child `env` 有意传入替代值。

## 考虑过的替代方案

- **在产品树之外维护一棵可编辑上游 fork。** 否决，因为修复和产品变更可能落在任一棵树，下一次 release 比较会依赖未记录的分支状态。
- **每次都把产品分支直接 rebase 到官方 release。** 否决，因为这会把上游身份、机械品牌化和产品集成混入同一个冲突面，也没有不可变的 raw 或 rebranded 对照点。
- **保存通用 patch pool 并整体重放。** 否决，因为无关功能会产生顺序依赖。产品能力应进入插件；不可避免的 core delta 必须有 owner、聚焦覆盖、上游退休入口和删除条件。
- **品牌规则变化时重写旧品牌化快照。** 否决，因为快照会失去对此前已评审、已合并 tree 的身份指向。Script-hash epoch 能显式表达规则变化，又不丢失历史。
- **替换所有 `dsh` 文本。** 否决，因为包名、manifest、协议标识、来源和法律归属不是用户可见的 DeepSeek 品牌，必须保留权威身份。
- **rc.8 后继续保留 `read_image` 特例注入。** 否决，因为通用 Code Mode bridge 已转发带图片的子结果，特例会重复注入同一图片。

## 结果

- 升级从精确、可评审的 raw 与机械品牌化 release tree 开始，产品开发继续集中在一条分支。
- 品牌规则变化会产生新 epoch，并可能要求在该 epoch 下同时导入 previous 与 target release 后再比较。
- 只有源码、包、组装 Client 与 keyless snapshot 验证完成后才推进 adoption 元数据；创建快照本身不代表接受上游版本。
- Voyaseek 与 Aistaff 行为保持在 Cordis 插件、Client slots 和产品 composition 后，上游功能复用和版本适配成本更低。
- 升级评审仍必须判断产品语义冲突、SQLite 变更、Provider 行为、打包和发布证据；Importer 刻意不替代这些决策。
- Locale、Client 依赖分类、已删除 worktree 文件的品牌扫描、source-plane 残留、Code Mode 图片和 launcher 环境测试继续作为 rc.8 合并所发现故障模式的必要回归证据。
