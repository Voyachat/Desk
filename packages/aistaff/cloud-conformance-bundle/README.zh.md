# Aistaff Cloud 一致性组合包

[English](README.md) | 中文

本包是用于无密钥 Cloud 员工体验验收的 `test_only` 确定性组合。它先安装一致性输入 Provider，再安装正常的生产 Provider、Remote 和 Cloud 客户端包装层。

该组合包使用与生产环境相同的 Provider、Remote 和可见客户端路径，只有第一个配置项不同。不得把本包加入生产 Profile 或生产 Cloud 组合包。
