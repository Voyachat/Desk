# Agent Note：图片发送乐观气泡

Status: implemented

[English](2026-08-18-optimistic-image-send-bubble.md) | 中文

## Problem

图片提示词在 Host 接纳前要先进行浏览器侧序列化。提交时清空输入框会导致最慢的发送阶段没有任何可见消息；失败时还必须恢复原始文本和浏览器持有的图片，同时不能泄漏 blob URL。

## Decision

普通发送开始序列化前，InputHub 会把它作为本机 pending send 写入每个会话的输入状态。ChatView 把该状态渲染成用户样式气泡，其中图片块只携带本机 blob 预览 URL。prompt RPC 接受回执会移除本机气泡，随后由持久或排队中的 Host 投影负责展示。拒绝会移除气泡，并且只通过既有的未触碰草稿回滚规则恢复文本和图片 id。

pending-send identity 在浏览器进程内单调递增。队列预览文本不是 identity，也不会结算发送，因为两条消息可能拥有相同文本和图片数量。会话 scope 销毁会把 pending send 仍持有的每个图片 id 交还 ConversationController，由后者释放 registry 条目和 blob URL；更晚到达的异步结算不会造成影响。

## Alternatives considered

没有等待 Host 队列或持久事件，因为图片序列化发生在两种投影出现之前。没有按截断的 `session/queue` 预览匹配 pending send，因为重复消息可能共享该值并相互移除气泡。没有记录乐观行，因为它只是接纳前的呈现状态，Host 仍是模型可见内容的权威来源。

## Consequences

文本与图片消息提交后会立即出现在会话中，包括浏览器仍在序列化时。被接受的发送在 RPC commit point 移交所有权且不保留浏览器文件；被拒绝的发送恢复原始草稿输入；移除会话不会保留进行中的预览 URL。乐观气泡在重新加载后不会重放，因为尚未被接受的浏览器事务不是持久会话事实。
