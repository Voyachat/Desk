# Agent Note：将动态 Cordis 源构建为持久化且已停止的 Package

[English](2026-08-15-dynamic-cordis-durable-build-hmr.md) | 中文

状态：已实现

## 问题

动态 Cordis 定义此前依赖进程内存和可供求值器执行的 JavaScript 函数体。服务重启会丢失 Plugin 和 Package 身份；如果在没有产物 owner 的情况下接受 TypeScript 或 TSX，生产环境要么必须直接执行作者源码，要么会让构建失败替换掉唯一可用的版本。客户端开发也没有常规文件编辑入口来触发现有且可安全释放的替换路径。

## 决策

`$DSH_HOME/dynamic-cordis` 负责动态定义。`registry.json` 是原子提交点；它存储源码、稳定身份计数器、不可变 Package 元数据、内容寻址的 JavaScript 产物摘要，以及最后一次成功激活的 Package 指针。产物在 manifest 重命名前写入，并在恢复时通过 SHA-256 验证为非符号链接的普通文件。服务根目录、产物目录和源码目录必须是物理目录。Fiber、handler、待审批、运行和授权状态绝不持久化。

Host 在发布前编译 JavaScript 或 TypeScript，Client 编译 JavaScript、TypeScript 或 TSX。Client JSX 降级为现有求值器已经提供的 `React` 参数。动态两半仍是没有模块解析能力的函数体，因此拒绝 import 和 export。生产运行时方法只消费编译后的产物文本。

跨运行时 development-HMR 集成规格使用独立的 `tsconfig.hybrid.json` 编译程序。它有意同时加载两个 service face，而仓库 Host 与 Client 聚合保持隔离，避免互不兼容的 `Context.sessions` 声明影响无关测试。常规 Host 构建在打包前编译这个第三程序。

稳定的开发工作副本位于 `$DSH_HOME/dynamic-cordis/sources/<pluginId>/host.ts` 和 `client.tsx`。默认禁用的 watcher 串行比较文件字节。有效变更会编译当前存在的所有半边，追加并原子发布不可变 Package；只有 Plugin 正在运行且先前用户决策覆盖未来 Client 版本时，才使用常规运行请求。Client runner 的每 Plugin 队列会先移除并排空旧 Loader Fiber，再挂载新的激活实例。构建失败既不改变 manifest，也不改变当前激活状态，并以符号源路径出现在 inventory 中。释放 watcher 后不会再发生后续激活。

## 已考虑的替代方案

我们否决了持久化求值器 Fiber 或 `running` 布尔值，因为两者都不能证明恢复后的运行时效果，还会在重启后静默执行代码。我们否决了在生产环境重新求值保留的 TypeScript 或 TSX，因为这会混合源码平面和产物平面，且编译器故障可能切断恢复路径。我们否决了把可变工作文件作为不可变 Package 的记录源，因为 HMR 编辑需要稳定文件名，而 Package 身份必须永不改变。我们也否决了通过静态 client-module SSE 图路由动态源码编辑，因为动态 Package 已有精确的运行身份和可安全释放的 Loader 入口。

## 影响

定义、Package 身份、当前指针和最后可用的产物可以跨重启保留，但每个恢复的 Plugin 都保持停止状态，直到显式运行或审批路径将其激活。损坏的编辑仍可修正，不会替换正在运行的 Client UI。开发编辑会创建不可变历史；替换会刻意挂载新 Fiber，因此组件本地 React 状态会丢失。Package manifest 新增 TypeScript 和仅测试使用的跨运行时依赖；工作区 lockfile 以及任何启用 `developmentHmr` 的共享组合必须由所属集成变更同步更新。
