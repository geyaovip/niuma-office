# 最小上下文路由

本文件只用于创建或调整 Story 卡。日常实现不必重复读取本文件；默认组合始终是：`AGENTS.md + 当前 Story 卡 + 一份主文档`。

| 任务关键词 | 必读主文档 | 只在需要时追加 |
|---|---|---|
| 产品范围、对象、Task、Project、Workspace、产物 | `product/product-baseline.md` | `project/decision-log.md` 对应 ID |
| 页面、导航、交互、个人中心、主题、无障碍 | `product/ui-and-flows.md` | WorkBuddy 参考截图；不要加载完整 PRD |
| WorkBuddy 对照、界面密度、模型入口、专家团选择 | `research/workbuddy-reference.md` | `product/ui-and-flows.md` 的对应页面 |
| 官网、首页、下载、SEO、帮助、隐私、条款、公开文案 | `product/website.md` | `product/product-baseline.md` 的发布范围 |
| Logo、品牌色、应用图标、字标、视觉资产 | `product/brand.md` | `product/ui-and-flows.md` 的规范章节 |
| Electron、SQLite、本地文件、Keychain | `architecture/technical-baseline.md` 的 1–5 节 | 当前 Contract 或 Schema |
| OpenClaw 2.0、Runtime、Adapter、事件、恢复 | `architecture/openclaw-2-capability-map.md` | `architecture/technical-baseline.md` 的 1–3、6 节；OpenClaw 当前官方文档 |
| 专家、固定专家团、成员输出 | `product/product-baseline.md` 的第 5 节 | `architecture/technical-baseline.md` 的专家团执行节 |
| 火山方舟、模型、Auto、用量、自定义 Key | `architecture/technical-baseline.md` 的模型网关节 | 实施时核验火山方舟当前模型列表 |
| 飞书、Telegram、扫码、离线队列 | `product/ui-and-flows.md` 的扫码与渠道节 | `architecture/technical-baseline.md` 的渠道节 |
| 权限、文件越界、删除、外部发送 | `product/product-baseline.md` 的权限节 | `AGENTS.md` 安全规则 |
| 云服务器、GitHub、Cloudflare、发布 | `architecture/technical-baseline.md` 的部署节 | `project/open-questions.md` 对应运营输入 |
| Resend、邮箱 OTP、身份合并 | `architecture/technical-baseline.md` 的登录节 | D-002 及认证 Contract |
| 排期、下一项工作、阶段验收 | `project/mvp-backlog.md` | 当前 Story 对应的一份主文档 |

## 定向查找

优先搜索再读取小段，不要整份加载：

```bash
rg -n 'XB-[0-9]{3}|D-[0-9]{3}|关键词' docs AGENTS.md
rg -n '^## ' docs/product/product-baseline.md
rg -n '^## ' docs/product/ui-and-flows.md
rg -n '^## ' docs/architecture/technical-baseline.md
```

## 停止规则

- 当前主文档已给出范围、状态、错误处理和验收时，不再打开原始完整方案。
- 只有发生冲突或需要追溯原始意图时才读取 `archive/牛马办公_V1产品方案.md` 的相关段落。
- 时效性信息只在实施该能力时联网核验，不把旧模型 ID、价格、插件版本或部署状态当成当前事实。
- 一个 Story 若需要同时加载三份以上主文档，先拆分 Story 或补充更窄的 Contract，不继续堆上下文。
