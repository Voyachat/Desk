# Agent Note：输入区接管替换输入栏

Status: implemented

[English](2026-08-19-composer-takeover-restoration.md) | 中文

## Problem

审批或提问接管输入区时，composer chain 通过把包装层从 `display: contents` 切换为 `display: none`，使其 fallback InputBar 仍保持挂载。交互结束后，同一包装层会在会话滚动区的 sticky flex child 内切回原状。Electron 可能使该子树持续没有可见布局，直到重新打开会话；持久化 transcript 仍然完整，但选中的会话表面上会变成空白。

## Decision

`ConversationRoot` 对 `conversation.composer` 使用普通 chain 替换。存在待处理交互时，它会卸载 InputBar，并在同一 sticky composer seat 中挂载选中的接管面板；交互结束时，它会卸载接管面板并挂载 InputBar。草稿和附件 id 由 `InputHub` 而非 textarea DOM node 拥有，因此这种替换无需依赖隐藏的 fallback 子树便能保留用户输入。

通用 slot renderer 仍保留 overlay-chain 支持，供必须保持驻留 component identity 的 owner 使用。`ConversationRoot` 不使用该模式，因为其持久输入状态已有外部 owner，而 sticky 滚动区会把 display 状态恢复问题变成用户可见的失败。

## Alternatives considered

没有在每次审批后强制浏览器重绘，因为这只处理一个已观测到的引擎症状，仍然会让隐藏的 fallback 决定状态转换。没有让接管面板与 InputBar 同时位于 flow 中并用 visibility 隐藏其中一个，因为它们高度不同，会使 sticky seat 变形并改变 transcript 的滚动锚定。没有把草稿状态移入另一个本地组件，因为 `InputHub` 已经拥有该状态。

## Consequences

审批和提问面板在既有 sticky seat 中始终可达。接管结束后，InputBar 会获得新的 DOM identity，但其草稿和附件仍保留在既有状态机中。浏览器验收会等待恢复的 textarea 可见且已完成布局，而不会仅因控件已启用但未绘制就判定成功。
