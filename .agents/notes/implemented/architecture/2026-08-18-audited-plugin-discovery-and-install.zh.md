# Agent Note：经审计的插件发现与本机安装

Status: implemented

[English](2026-08-18-audited-plugin-discovery-and-install.md) | 中文

## Problem

profile 插件命令会把任意参数直接转发给 pnpm，因此发现与安装之间没有共享的信任状态：产品尚未检查包元数据、bundle patch、运行时入口、源码能力或生命周期脚本时，目录条目就可能成为可执行依赖。Git 与 registry spec 还会在包管理器内部解析可变远程名称，使此前的源码审查失效。

## Decision

基础组合挂载只读 `find_dsh_plugin` 工具。它基于[开源采用台账](../../../../.open-source/adoptions.yaml)记录的 MIT 许可 `awesome-dsh-plugin/dsh-find-plugin` 基线改造，只搜索精选的机器可读目录，验证全部外部字段，每个插件实例只保留一份有界且已验证的目录，并把所有结果标记为 `unreviewed`。工具暴露源码和包元数据，但不提供可执行安装命令；进入目录不构成安装授权。

`dsh plugin audit` 与 `dsh plugin add` 接受一个本机目录、`.tgz` 或 `.tar.gz`。审计不会执行包代码，只读取常规文件；它拒绝文件系统和归档链接、路径穿越、特殊文件、包管理器配置，以及缺少 identity、license、`dsh.bundle.patch`、有效 patch YAML 或已构建 `main` 的包，并报告生命周期脚本、依赖、不透明运行时、超出扫描限制的文本和特权运行时能力的源码迹象。报告摘要以确定顺序覆盖所有被接受的源码路径与字节。

阻断项会在 profile 初始化前停止 `add`。警告要求通过 `--approve-audit` 提供精确报告摘要；安装仍强制使用 pnpm `--ignore-scripts`。远程 npm 与 GitHub spec、`link:`、安装别名和更新别名保持失败关闭，直至 CLI 能在 pnpm 修改前解析其精确制品和依赖图。本机目录会保留开发用途警告，因为被安装的链接可在审查后变化；已构建 tarball 是不可变交付路径。

## Alternatives considered

没有直接从社区目录安装，因为该目录明确只负责发现而非安全审查，且其 GitHub spec 未固定 commit。没有复制上游自动演进安装器，因为其 SATA 许可与旧包命名空间不适合源码采用，而它拥有超出发现需求的子进程和文件系统修改权限。没有只依赖 pnpm 生命周期脚本策略，因为即使安装脚本从未运行，profile 启动时仍会执行插件及依赖的运行时代码。归档解析复用受维护的 `node-tar`，不自写 tar parser；这里只列出条目，并在不解压的情况下施加更严格的路径、链接、文件数量和字节限制。

## Consequences

用户可以从 Agent 搜索当前精选 DSH 生态，并安装已经过本机审查的制品，安装期不会执行包代码。摘要批准只表示用户知晓列出的静态分析缺口，不表示插件或依赖可信。远程一键安装、递归依赖源码审查、签名验证、二进制检查和沙箱化运行时激活仍不可用；这些操作会失败或显示明确警告，不会静默降低审查强度。CLI 只提供 audit、add、remove 和直接依赖 list 操作，插件管理不开放任意 pnpm 执行 verb。
