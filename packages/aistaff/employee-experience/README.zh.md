# Aistaff 员工体验

[English](README.md) | 中文

本包拥有正式的、Renderer 安全的 AI 员工服务 seam、`EmployeeExperiencePort` 作为 `ctx.employeeExperience` 注册；云服务与本地服务提供方仍各自独立成包。`EmployeeExperienceObjectLayer` 负责管理一个完整的员工实体、其参与度（engagement）以及当前已加载的参与度投影，并通过原子化的「首次读取 + 监听器」调用 `observe()` 发布不可变的替换对象。

本包刻意不包含任何云传输逻辑、检查点（checkpoint）、身份认证凭据、文件系统路径、执行引擎标识或测试前置数据（fixture）依赖。各提供方在构造这些数据传输对象（DTO）前，须自行验证其所属方的协议格式（wire）。Renderer 仅对不透明的版本号（revision）进行相等性比对，并在协调不确定结果时原样发送原始 `OperationId`。

## 表面接口

```text
import {
  EmployeeExperienceObjectLayer,
  type EmployeeExperienceSnapshot,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'

const observation = ctx.employeeExperience.observe((replacement) => {
  render(replacement)
})
render(observation.snapshot)
observation.dispose()

abstract class ProviderBase extends EmployeeExperienceObjectLayer {
  protected replace(next: EmployeeExperienceSnapshot): void {
    this.publishReplacement(next)
  }
}
```

`observe()` 同步注册监听器，并在返回前捕获匹配的快照。它**不会**通过监听器派发初始值。此后每次通知均传递一个完整、深度冻结的替换对象，且其 `view_generation` 严格递增；监听器执行失败会被隔离处理，确保一个 UI 消费方无法阻塞其他消费方。

## 模型体验

无，因为本包只承载 Renderer 业务投影，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；没有导出值会直接进入模型请求。

## 已知限制与待办事项

- **提供方验证为外部职责** —— 云服务提供方必须验证所绑定的约定产物（contract artifact），并在发布替换对象前移除传输恢复逻辑与身份认证状态。
- **尚无生产环境提供方** —— 本包仅为服务定义（Service Definition）与共享对象层；生产环境组合包必须显式注入云服务或本地服务提供方，不得回退至测试前置数据（fixture）。
