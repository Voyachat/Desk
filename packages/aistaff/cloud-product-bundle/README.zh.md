# Aistaff 云产品组合包

[English](README.md) | 中文

这是 DSH Web Profile 使用的生产专用 Cloud AI 员工组合层。它依次安装由部署支撑的 Cloud Provider、对 Renderer 安全的 Employee Experience Remote，以及显式 Cloud 客户端包装层。

该组合包不提供 Client Gateway 输入。生产部署必须在 `cloud-provider` 之前注册这些输入；缺失输入会在 Provider 处失败，不会选择内存 fallback。

该组合排除 `cloud-conformance`、旧版 `product-projection` 和 `product-remote` 包，以及 Fixture `aistaff-client-product` 配置项。

## 模型体验

无，因为该 bundle 只组合由各 owner 自行声明模型可见行为的包。

#### KV Cache 影响

本包没有直接影响；被组合的运行时 owner 决定模型请求的缓存影响。

## 已知限制与待办事项

- **需要部署输入** —— 该 bundle 不提供 Client Gateway 产物、已认证 transport 或凭据；生产组合必须在 `cloud-provider` 之前注册这些输入。
