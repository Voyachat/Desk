# Agent Note：会话视图虚拟化与滚动分页

Status: implemented

[English](2026-08-18-chat-view-virtualization-and-autoload.md) | 中文

## Problem

长会话会使 Web 前端崩溃：会话增长后，所有已加载行（Markdown、KaTeX、代码块和工具树）持续挂载在 DOM 中，会话事件窗口也单调增长，直至 renderer 内存压力或渲染错误导致页面失效，阅读者会同时失去输入框和转录内容。`ChatView` 把完整 flow 渲染为普通 flex child，加载更早历史则每页都要手动点击按钮。

## Decision

分组行数超过 `VIRTUALIZATION_THRESHOLD_ROWS`（100）后，`ChatView` 使用项目已有的 `@tanstack/react-virtual` 挂载 flow。窗口外的行会卸载，动态高度在挂载时测量；column 的 16px 节奏使用库的 `gap` 选项，使虚拟与普通 flex flow 的间距一致。虚拟器通过 prepend 解析稳定 key；`ChatView` 会在后续测量 frame 中保留阅读者所在的语义行和 viewport offset，新 wheel、touch、pointer 或 keyboard 意图会立即取消这次有界校正。阅读者离开底部时，同一语义位置也会补偿响应式 column 和输入框尺寸变化。恢复打开位置分两阶段：先以保存的原始 offset 把窗口落到 anchor 附近，再通过有界 `scrollToIndex` 重试挂载 anchor 行并精确定位。

无论 flow 规模大小，滚动进入顶部 320px 都会在每次进入时自动请求一页更早历史（`OLDER_AUTOLOAD_THRESHOLD_PX`），阅读者离开该区域后重新启用；prepend 自身的 anchor 位移会把位置推出该区域，所以已完成的页不会重复触发。header 按钮保留为明确的重试与无障碍入口。虚拟化与普通 flex flow 使用同一语义 anchor，因此更早页面到达时，并发 streaming 与响应式 reflow 不会移动阅读者正在查看的行。

浏览器 Session 最多保留 `SESSION_EVENT_WINDOW_LIMIT`（5,000）个连续原始事件。分页只请求剩余容量，窗口满后移除加载更早历史的动作。实时投递超过限制时，Session 丢弃一块有界的旧事件，并根据保留的连续范围重建 Conversation assembler；由此产生的头部 gap 保持显式，最新轮次和实时 stream 则继续驻留。

## Alternatives considered

没有在所有行数下都虚拟化，因为 jsdom 单元测试与短会话不会获得 DOM 节省，却要承担虚拟器协调成本。没有自写 windowing renderer，因为既有库已经提供窗口、key 映射、estimate 补偿和测量原语，仓内 `ui-trajectory` 也验证了该模式。没有把所有 prepend 行为交给 `anchorTo: 'end'`，因为浏览器测试表明，并发 streaming 与响应式 reflow 会在库的首次校正后继续改变测量高度。没有把自动加载限制在虚拟化 flow，因为单条很长的 Assistant 消息可能需要大量滚动，而分组行数仍低于虚拟化阈值。本轮也没有实现双向窗口分页，因为 Host 历史 API 没有 forward cursor；有界 client window 保留实时尾部，只在还有容量时允许更早分页。

## Consequences

长会话 DOM 规模限制为可见窗口和 overscan，而不是完整已加载历史。数据层原始事件、wire view 和 Conversation index 受连续 Session window 限制。很早的历史仍持久保存在 Host，但浏览器窗口已满后，重新打开会话前无法继续读取；实时投递剪除旧块后可能重新产生分页容量。浏览器 e2e 规则覆盖并发历史与 streaming、工具展开、阅读者输入、标签页和会话恢复、响应式缩放及长消息交互。
