# 牛马办公技术执行基线

## 1. 总体架构

```text
macOS Desktop
Electron + React + TypeScript
  ├─ Product Service
  ├─ SQLite / Local Files / Keychain
  ├─ Runtime Adapter
  │    └─ OpenClaw Adapter → bundled OpenClaw Gateway/Runtime
  └─ Cloud Client → HTTPS + authenticated WebSocket

Cloud
  ├─ API / future Auth
  ├─ Model Gateway → Volcengine Ark
  ├─ Channel Gateway → Feishu / Telegram
  ├─ Offline Task Queue
  ├─ Catalog / Admin API
  ├─ PostgreSQL
  └─ Admin Web
```

云端不执行用户 Agent，不读取用户本地 Workspace，也不保存完整本地会话和知识库。

## 2. 建议仓库结构

```text
apps/
  desktop/          Electron macOS 客户端
  website/          正式官网、下载、指南、安全与版本页面
  api/              云端 API、消息中继和未来认证
  admin/            管理后台
packages/
  contracts/        API、事件和产品 Schema
  product-core/     Task/Project/Expert 等业务规则
  runtime-adapter/  Runtime 抽象接口
  openclaw-adapter/ OpenClaw 进程、事件和配置适配
  channel-adapter/  飞书、Telegram 与产品消息契约
  model-gateway/    模型目录、路由、用量与错误归一化
  ui/               共享设计 Token 和组件
infra/
  docker/           云服务器 Compose 与配置模板
docs/
```

## 3. OpenClaw 封装

- OpenClaw 固定到已验证版本，随应用安装；不依赖用户全局 Node 或现有 OpenClaw。
- Runtime、配置、SQLite、日志和 OpenClaw 状态位于牛马专用的 macOS Application Support 目录；用户可见 Workspace 不放在此处。
- OpenClaw 由主进程监督：初始化、健康检查、启动、停止、崩溃恢复、迁移和升级。
- UI 只消费牛马事件：`task.queued/running/waiting/completed/failed/cancelled`、`expert_run.*`、`tool.*`、`permission.requested`、`artifact.created`。
- Adapter 负责把 OpenClaw session/task/tool 状态映射为牛马 Schema，禁止数据库层直接依赖 OpenClaw 表结构。
- OpenClaw 错误先归一化成用户可理解的错误，再把脱敏诊断保存到本地日志。

## 4. Workspace 与默认目录

用户不需要在创建 Task 或 Project 时选择文件夹。默认可见文件根目录为：

```text
~/Documents/牛马办公/
├── 任务/YYYY-MM/<task_id>-<slug>/
└── 项目/<project_id>-<slug>/
```

- 路径中的稳定 ID 防止重名；标题变化不自动改目录名，避免路径失效。
- 项目内 Task 继承 Project Workspace；独立 Task 使用自己的目录。
- 从飞书或 Telegram 创建的 Task 也自动使用默认目录。
- 用户可以通过系统文件夹选择器改用现有目录；产品保存授权 Bookmark 与稳定路径引用。
- 默认根目录可在设置中修改。只影响新建对象，历史目录不静默迁移；迁移必须使用可预览、可取消、可恢复的显式流程。
- Documents 不可写、磁盘不足或授权失效时，Task 进入 `waiting_user`，不得悄悄改写到未知位置。
- SQLite、Session、Message、Memory、日志、Credential 和 Runtime 状态仍在 Application Support/Keychain，与可见 Workspace 分开。

## 5. 本地数据

SQLite 至少包含：

- projects
- tasks
- task_sessions
- messages
- execution_events
- experts / expert_teams / expert_team_members
- expert_runs
- skills / connectors / installations
- knowledge_bases / knowledge_sources / knowledge_chunks
- artifacts
- automations / automation_runs
- permission_grants
- channel_binding_mirrors
- local_model_profiles

Credential、API Key、Refresh Token、Bot/App Secret 不进入 SQLite，统一使用 macOS Keychain。文件使用稳定 ID 与显式路径关联，不把绝对路径同步到云端。

自动化使用独立的 `automations/automations.sqlite`。调度器以本机时区计算下次运行，在事务中原子领取到期规则，并通过唯一的 `automation_id + scheduled_for` 防止重复创建。每次 AutomationRun 必须生成真实 Task，不设置专家时由默认助手执行。应用或电脑离线时不执行；恢复后每条规则最多补跑一次，再从当前时间计算后续计划。进程中断的 `running` 记录恢复为可重试队列；失败信息经用户可见错误归一化后保存。

知识库使用独立的 `knowledge/knowledge.sqlite`，资料源与片段不写入 Task 会话 JSON。PDF 由固定版本 `pdfjs-dist`（Apache-2.0）、DOCX 由 `mammoth`（BSD-2-Clause）、网页正文由 `html-to-text`（MIT）解析；版本与 License 随依赖锁文件审计。Markdown/TXT 只接受有效 UTF-8。PDF 上限 50 MB/300 页、DOCX 25 MB、Markdown/TXT 10 MB、网页响应 5 MB；超过限制、无正文、格式不支持和解析中断都保存可恢复失败状态。

网页导入只接受无账号信息的 HTTP/HTTPS 标准端口，解析前检查 DNS，拒绝回环、链路本地、私网和 ULA 地址；每次重定向重新校验，连接使用已核验地址避免 DNS 重绑定。Task 只保存用户本轮主动选择的 `source_id + name + kind + content_digest + selected_at`，执行前重新核验摘要并选取相关片段；来源变化或移除后拒绝新执行，不把完整敏感正文复制进历史 Task。

## 6. 固定专家团执行

```text
Task
→ TeamRun 使用 ExpertTeam 当前已发布版本生成快照
→ LeaderRun 制定分工
→ 为模板中的固定成员创建 ExpertRun
→ 顺序或并行执行
→ 成员结果写入独立输出与 Artifact 来源
→ LeaderRun 汇总
→ Task 完成或部分完成
```

运行快照保证专家团后续更新不会改变历史 Task。不得运行模板之外的未展示成员；确需动态能力时只能作为 Tool/Skill 调用记录，而不是成员。

## 7. 模型网关

平台模型请求路径：Desktop → Cloud Model Gateway → Volcengine Ark。

Desktop 首次访问云服务时生成 Ed25519 设备身份并登记公钥。每次平台 Task 开始前，主进程用设备私钥签名申请两小时短时模型会话；云端只保存令牌 SHA-256、设备 ID、过期时间、调用次数与最后使用时间。短时令牌只存在桌端主进程和 OpenClaw 子进程环境，配置文件只保存环境变量占位符。OpenClaw 固定调用 `niuma-platform/auto`，Model Gateway 强制把逻辑模型替换为后台启用的物理模型 ID，客户端传入的供应商模型名不参与路由。

当前内部体验版的设备级保护包括：签名与重放窗口、每设备每小时最多 20 个短时会话、每会话最多 1000 次请求、2 小时过期、固定请求体上限、固定方舟上游与错误归一化。邮箱登录接入后，设备必须归属有效账号，并在同一入口增加账号套餐、用量预算和异常封禁；不得把“能登记设备”等同于正式商业鉴权。

后台模型字段：

- logical_model_id / display_name
- provider / provider_model_id / endpoint
- capability tags：reasoning、vision、tools、coding、long-context
- input/output/context cache price
- context/output limits
- enabled、sort、health、fallback priority
- minimum client version

Model Gateway 负责鉴权、流式转发、超时、限流、重试、熔断、用量、成本和错误归一化。首个可运行基线已实现短时会话、流式转发、超时、会话限流和错误归一化；多模型 Fallback、分布式熔断、精确 Token/成本账本和后台模型目录归 `XB-502` 后续验收，不得在完成前对外宣称。模型目录可通过火山方舟管理 API 同步，但启用、展示名和路由由牛马后台决定。

用户自定义模型由 Desktop 直接调用用户配置的 Provider；Key 在 Keychain，调用记录只保存必要的本地统计。首版支持火山方舟预设和 OpenAI 兼容协议。

## 8. 渠道与扫码绑定

开发期虽然没有用户登录，但设备不能依赖一个可伪造的字符串身份。客户端首次启动时生成设备密钥对，私钥进入 macOS Keychain，云端只保存公钥和 `device_installation_id`；扫码申请、WebSocket 建连、领取离线任务和回传结果均需设备签名。登录完成后再把设备归属合并到账号。

### Pairing Session

云端表 `channel_pairing_sessions` 保存哈希后的高熵 Token、channel、device_installation_id、过期时间、状态、失败次数和消费时间。原始 Token 只返回创建请求一次，有效期 5 分钟。

状态：`pending → scanned → confirmed → consumed`，以及 `expired/cancelled/failed`。消费必须是数据库原子操作。

### Channel Binding

`channel_bindings` 保存 channel、channel_user_id、chat_id、account_id（登录完成后）、device_installation_id、DM/group scope、状态和最后验证时间。平台 Bot/App Secret 只在云端 Secret Store。

### 消息路径

```text
Feishu/Telegram webhook or update
→ 验证签名与来源
→ 生成 provider_event_id 幂等键
→ 解析 ChannelBinding 与 conversation key
→ Desktop 在线：WebSocket 投递
→ Desktop 离线：PostgreSQL Queue，TTL 24h
→ Desktop ACK 后创建本地 Task
→ 状态/结果经 Cloud 回传原渠道
```

同一 provider_event_id 不得创建两个 Task。离线队列使用 `queued/delivered/acked/expired` 状态和可重复 ACK；云端只保存执行所需消息、短期附件引用和最小路由信息，任务 ACK 后按保留策略清理。附件下载使用短时签名地址，不把渠道永久凭证交给客户端。

## 9. Skill 安装与固定版本执行

- Skill 目录只展示牛马办公已审核的清单；每项必须具有稳定 ID、精确语义化版本、来源、License、能力、依赖、权限和唯一入口。
- 安装记录与技能文件分别保存在 Application Support 下的 `data/skills.json` 和 `skills/<skill_id>/<version>/`，写入采用临时文件替换，应用重启后可恢复安装、停用和失败状态。
- 安装入口只接受目录中的稳定 Skill ID，不接受用户输入的路径、远程 URL 或任意脚本。清单采用严格 Schema，拒绝未知字段、浮动版本、空 License 和越过版本目录的入口路径。
- Composer 只展示已安装且启用的 Skill；输入 `/` 打开选择器。每轮 Task 保存完整 Skill 公开快照与指令摘要，历史轮次不随目录更新改变。
- 执行前由主进程根据 `skill_id + version + instruction_digest` 重新核对已安装文件，只把精确匹配的指令注入本轮 Prompt；未安装、已停用、版本或摘要不匹配时拒绝执行。
- Skill 权限不得超过本轮 Task 权限：受限权限仅允许读取当前 Workspace；默认权限允许 Workspace 读写和公开网络；命令、外部发送和 Workspace 外访问只能在完全访问模式下继续，并仍受操作确认规则约束。
- 首版不提供公开投稿、付费、评分、任意本地脚本导入或未经审核的远程自动更新。

## 10. 连接器安装、凭证与任务快照

- 首版连接器目录包含本地文件、公开网页和用户自定义远程 MCP；目录项必须固定 ID、精确版本、来源、License、能力和权限，不提供未经审核的公开市场。
- 普通连接器与飞书、Telegram 的“接收任务渠道”分开管理。渠道凭证只存在云端 Secret Store，远程 MCP Credential 只由 macOS 主进程经系统加密能力保存，Renderer、任务快照、日志和配置 JSON 不得出现明文。
- 远程 MCP 只接受没有 URL 用户信息、查询参数和片段的 HTTPS 地址；保存后必须完成有超时的 `initialize` 握手才能启用。鉴权失败、超时、服务不兼容和网络中断保存可恢复状态，但不保存服务响应原文。
- 每轮 Task 保存用户主动选择的连接器公开快照和配置摘要。执行前由主进程重新核验状态、版本、摘要和本轮权限；停用、失败、配置变更或权限不足时拒绝执行，历史轮次仍保留原快照。
- 通用远程 MCP 首版只开放 `list/get/read/search/fetch/query/lookup/resources/prompts` 等只读工具，并显式排除发送、创建、更新、写入、删除、购买和支付。未来若开放写操作，必须按动作单独声明权限并进入 Task 高风险确认链路。
- Runtime 配置只写 Credential 环境变量占位符；实际凭证只在启动子进程时注入环境，不进入 Runtime 配置文件或错误日志。

## 11. 登录最后接入

开发阶段使用 `LOCAL_DEVELOPMENT_IDENTITY` 创建单一设备身份，只能在非生产构建启用。ChannelBinding 先绑定 `device_installation_id`。

接入登录后：

- Resend 只负责发送邮箱 OTP。
- Backend 负责验证码哈希、有效期、频率限制、尝试次数、一次性消费和 Session。
- 首次登录把本地设备、渠道绑定和云端匿名记录合并到账号。
- 生产构建不存在本地身份绕过或返回明文 OTP 的路径。

## 12. 部署拓扑

- GitHub：私有 Monorepo、Pull Request、Actions 检查与发布流水线。
- 共享云服务器：Docker Compose 运行 API、Channel Gateway、Model Gateway、PostgreSQL 和必要的 Redis/队列组件；上线前先盘点现有端口、反向代理、磁盘、容器、卷和备份。
- Cloudflare Pages：正式官网和管理后台前端，使用独立项目与发布环境。
- Cloudflare DNS/TLS/WAF：`alipayclaw.cn` 正式主站、`www` 永久跳转、`api.alipayclaw.cn` 消息与设备 API、`download.alipayclaw.cn` 安装包分发，以及对应证书和基础防护。
- 共享云服务器发布目录：DMG、ZIP、版本清单与 SHA-256 文件保存在牛马独立的 `/srv/niuma-office/releases/`，由独立下载域名以 HTTPS 提供 Range 请求；发布采用临时文件写入、校验完成后原子改名，不与其他项目共用可写目录。
- 发布目录设置容量上限、剩余空间告警、每日增量备份和版本保留策略；删除旧版本前先确认当前版本清单、回滚版本和下载引用，后续迁移对象存储时保持下载 URL 与 Manifest 契约稳定。
- Cloudflare Pages：只承载正式官网和管理后台静态前端；下载按钮读取服务器上的受控版本清单，不把安装包打进 Pages 构建，也不使用 Cloudflare R2。
- macOS 内部体验包：当前允许未使用 Developer ID 签名、未完成 Notarization 的 DMG/ZIP，通过 SHA-256 校验和明确安装说明分发；自动更新默认关闭，避免未签名更新链造成完整性误导。
- macOS 正式公开包：获得 Apple Developer 资质后再启用 Developer ID、Hardened Runtime、Notarization、更新签名、灰度和最低支持版本控制；不得把内部未签名包描述为已验证发布包。
- 官网发布：Preview 与 Production 隔离；生产域名只发布通过检查的构建。下载按钮读取受控版本清单，不在页面硬编码失效的 DMG 地址。
- 官网公开页面采用静态生成或服务端预渲染，构建时生成每页 Metadata、Canonical、JSON-LD、`sitemap.xml` 和 `robots.txt`；不得以只有客户端 App Shell 的 SPA 作为生产官网。

不得把 PostgreSQL、管理接口、模型 Key 或渠道 Secret 暴露到公网前端。

默认复用用户在既有项目中已授权使用的 GitHub、Cloudflare、共享服务器、火山方舟、飞书和 Telegram 安全配置源，但牛马必须使用独立仓库、项目名、容器、数据库/Schema、存储前缀、回调路由、审计记录和发布流水线。不得把密钥复制到文档或仓库。

复用 Telegram Bot 前必须先读取 `getWebhookInfo`，确认现有 Webhook 与消费方；Telegram Bot API 的 `setWebhook` 只配置一个目标 URL，禁止直接覆盖其他项目正在使用的地址。需要共享时由一个已验证的统一入口按事件归属路由。飞书应用同样先只读核验当前事件订阅、权限和回调，再决定通过统一入口分流；任何配置修改都要求回归原项目。

## 13. 最低验证

- Runtime Adapter 合约测试和真实 OpenClaw 冒烟测试
- Task 取消、崩溃恢复、重复事件和断网重连测试
- 固定专家团成员快照、并行、部分失败和单成员重试测试
- 默认 Workspace 自动创建、自定义目录授权失效、磁盘不足、越界、删除、外部发送和权限过期测试
- 模型流式、Fallback、用量一致性和后台启停测试
- 连接器 HTTPS 边界、Credential 密文、MCP 握手、固定版本快照、停用恢复、只读工具过滤和客户端错误文案测试
- 知识库 PDF/DOCX/Markdown/TXT/网页解析、中文检索、格式限制、私网与 DNS 重绑定边界、解析中断恢复、来源摘要变化和 Task 引用注入测试
- Telegram/飞书私聊、群聊提及、重复消息、二维码过期、解绑和离线 24h 队列测试
- macOS 未签名内部包的下载、SHA-256、安装提示、首次打开、升级和卸载后数据保留测试；正式发布阶段另执行签名、Notarization、Gatekeeper 和更新签名测试
- 官网桌面/移动布局、真实下载、状态码、重定向、Canonical、初始 HTML、结构化数据、站点地图、索引指令、无障碍与 Core Web Vitals 检查
