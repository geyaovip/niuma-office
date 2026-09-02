# OpenClaw 2.0 能力接入基线

本文是 `XB-108` 的唯一主文档。目标不是把 OpenClaw 变成用户可见产品，而是让牛马办公尽可能复用可靠底层能力，并保持自己的对象、界面、安全和数据边界。

## 1. 接入原则

1. OpenClaw 原生能力满足产品规则时直接使用，由 Adapter 转成牛马 Contract。
2. 原生能力与产品规则不完全一致时保留执行引擎，由牛马补身份、策略、审计和界面适配。
3. OpenClaw 缺失或无法满足正式交付要求时才自研，并保留同一 Contract，避免客户端感知实现差异。
4. 所有能力必须固定版本、可关闭、可观测、可回滚；“底层已支持”不等于“对用户开放”。
5. Control UI、Workboard、OpenClaw 名称、配置、端口、错误原文和供应商路由不进入普通用户界面。

## 2. 能力映射

| 能力 | 当前实现 | 归属与边界 |
|---|---|---|
| Gateway、Session、SQLite | 已接入公开 SDK；固定协议与版本 | 原生执行，Task/Project 仍由牛马管理 |
| 持久进度卡、结构化提问 | 已映射 Task 状态、事件和正式交互 | 原生能力，牛马负责文案与恢复 |
| exec/plugin 权限 | 已统一到任务权限请求、超时和审计 | 原生暂停，牛马决策；高风险始终确认 |
| 凭证请求 | 已支持单次保密输入和用户明确授权的本机保存；禁用 OpenClaw 持久 Secret Store | 只有运行时声明明确授权域名时才允许保存；牛马加密凭证库按名称与域名复用，Key 不上传或写日志 |
| subagents、任务账本 | 已开放受控子 Agent；停止父任务时清理账本中的子任务 | 原生子 Agent；固定专家身份与团长汇总由牛马管理 |
| 自动化 | 牛马本地调度、重试、离线恢复和历史已运行 | 自研接管；不开放原生无人值守全权限任务 |
| Session 全文搜索 | 已接入左侧任务搜索；本地标题/正文始终兜底 | 原生索引，只返回可见牛马 Task |
| widgets/dashboard/A2UI/MCP Apps | 已纳入代码策略表，当前禁止显示和写操作 | 待牛马结果容器与授权 Adapter 完成后开放 |
| 文件、网页检索、图片读取 | 已按权限模式进入允许列表 | 原生工具，限制在 Workspace 和产品范围 |
| 远程设备、云 Worker、终端/浏览器控制 | 已纳入策略表并默认拒绝 | 当前产品范围不开放，不显示入口 |
| Provider/Plugin 生态 | 平台 Provider 使用 `niuma-platform/auto`；桌端以设备签名换取两小时短时令牌，网关强制路由物理模型；插件授权已归一化 | 方舟 Key、Endpoint 和物理模型 ID 只在服务端；外部组件仍须逐项固定版本、License 和权限 |
| 飞书、Telegram | 继续使用牛马扫码、身份、幂等和审计 Contract | 不暴露 OpenClaw 原生渠道配置界面 |

## 3. 版本与兼容

- 内置 Node：`24.15.0`。
- 内置 OpenClaw：`2026.8.2`，精确固定，不使用浮动 `latest`。
- Gateway SDK 与协议包：使用可用的同版本精确依赖；协议能力必须在连接时协商，不能只依赖硬编码版本号。
- 平台 Provider：`niuma-platform/<logical-model-id>`。火山方舟 Endpoint、模型部署 ID 和平台 Key 只存在于配置 Adapter 或云 Model Gateway。
- 启动前备份上一个有效配置；新配置校验、健康检查或首个 Task 失败时恢复旧配置并给出牛马错误状态。

## 4. 允许列表

每项外部 Plugin、MCP、Skill、Channel 或设备能力进入生产构建前必须记录：精确版本、来源、License、声明能力、网络访问、文件范围、Credential、写操作、回滚方式和审核结论。未记录或请求新增能力的组件保持禁用，不使用静默同意参数绕过审核。

## 5. 分段迁移

1. 运行时：版本、公开 SDK、Provider 逻辑 ID、配置备份、真实 Gateway 启动和回滚。
2. 核心交互：状态、进度卡、结构化问题、权限、凭证、Session 搜索。
3. 多 Agent：单助手、固定专家团、成员失败和团长汇总。
4. 自动化与产物：持久授权、交互产物、媒体、离线和恢复。
5. 生态与设备：逐项审核后进入允许列表；不在当前产品范围的能力只保留兼容 Adapter，不显示入口。

## 6. 完成标准

- 新运行时和 SDK 在开发态、未签名打包态均通过真实 Gateway 与 Task 验证。
- 现有 Task、Project、专家团、知识库、自动化、Telegram/飞书 Contract 回归通过。
- 任何 OpenClaw 原生事件都有牛马归一化状态或明确忽略策略；未知高权限能力默认拒绝。
- 升级、首启、旧状态迁移、配置损坏、插件未授权和回滚均有测试与用户可理解恢复路径。

## 7. 代码落点

- 运行时与原子回滚：`apps/desktop/electron/services/openclaw-supervisor.ts`
- 公开 SDK、进度、提问、权限、搜索与子任务清理：`apps/desktop/electron/services/openclaw-gateway-client.ts`
- 全能力允许/接管/禁用策略：`apps/desktop/electron/services/openclaw-capability-policy.ts`
- Task 映射：`apps/desktop/electron/services/task-executor.ts`
- 本机凭证边界：`apps/desktop/electron/services/credential-repository.ts`
- 平台模型短时会话与方舟代理：`apps/api/src/app.ts`、`apps/api/src/channel-repository.ts`
- 桌端云服务签名客户端：`apps/desktop/electron/services/channel-client.ts`
