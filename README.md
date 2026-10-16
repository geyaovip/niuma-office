# 牛马办公 · macOS AI 办公客户端

面向个人办公场景的 macOS 应用，以任务为中心组织 AI 执行过程与文件成果。项目包含 Electron 桌面客户端、产品官网和必要云端 API，通过运行时适配层连接本地执行能力。

[产品官网](https://alipayclaw.cn/) · [产品与研发文档](docs/README.md) · [当前开发进度](docs/project/current-story.md)

**当前阶段：内部体验版持续开发。** 官网用于产品介绍；任务执行在 macOS 客户端完成，实际可用范围以当前版本与开发记录为准。

## 产品结构

| 模块 | 设计与实现方向 |
| --- | --- |
| 任务工作台 | 独立创建任务，查看消息、执行过程、状态及文件成果。 |
| 项目与工作空间 | 项目作为可选组织容器，未选目录时使用默认 Workspace。 |
| 专家与专家团 | 按固定成员组织专业分工，保留成员执行和汇总记录。 |
| 本地运行时 | 通过 Adapter 管理内置 OpenClaw 的启动、事件与运行状态。 |
| 官网 | 提供产品介绍、下载、指南、安全说明和版本信息。 |
| 云端 API | 承担设备与模型访问等必要能力，模型网关可靠性仍在持续开发。 |

## 工程设计

- **产品与运行时解耦**：React 界面通过产品服务和 Runtime Adapter 访问执行能力。
- **任务与目录解耦**：Task 可独立于 Project 存在，不将选目录作为创建任务的前置要求。
- **数据边界明确**：本地工作文件、会话、知识资料与凭据分开管理。
- **模型访问分层**：平台模型通过云端网关访问，自定义模型按客户端凭据规则处理。
- **执行过程可追踪**：任务、工具、专家成员和成果使用产品事件表达运行状态。

这些是当前工程结构与约束；不表示全部规划模块已通过正式发布验收。邮箱登录、渠道能力与模型可靠性等状态应查看[当前 Story](docs/project/current-story.md)和[开发清单](docs/project/mvp-backlog.md)。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| macOS 客户端 | Electron、React、TypeScript、Vite |
| 本地执行 | 内置 OpenClaw Runtime 与适配层 |
| 云端 API | Fastify、TypeScript、PostgreSQL |
| 契约与校验 | 共享 TypeScript 契约、Zod |
| 官网 | Vite 静态页面与路由检查 |
| 工程 | npm workspaces、Vitest、Electron Builder |

## 本地开发

需要 macOS、Node.js 22+ 与 npm。首次运行需按[技术基线](docs/architecture/technical-baseline.md)准备内置 Runtime 和本地配置。

```bash
git clone https://github.com/geyaovip/niuma-office.git
cd niuma-office
npm ci
npm --workspace @niuma/desktop run runtime:prepare
npm run dev:desktop
```

预览官网：

```bash
npm run dev:website
```

## 项目结构与检查

| 路径 | 用途 |
| --- | --- |
| [`apps/desktop/`](apps/desktop/) | Electron 主进程、React 界面与运行时管理 |
| [`apps/website/`](apps/website/) | 产品官网 |
| [`apps/api/`](apps/api/) | 云端 API 与模型访问 |
| [`packages/contracts/`](packages/contracts/) | 共享接口与数据契约 |
| [`packages/channel-adapter/`](packages/channel-adapter/) | 消息渠道适配契约 |
| [`deploy/`](deploy/) | 云端部署说明与配置 |

```bash
npm run check
npm run test:desktop
npm run build:desktop
```

客户端功能需要 macOS 实际运行验证；浏览器预览、静态截图和类型检查不能替代桌面验收。开发协作规则见 [AGENTS.md](AGENTS.md)，公开能力描述以已实现、可复现的版本行为为准。
