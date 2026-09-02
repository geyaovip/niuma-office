# 牛马办公

> 专门替“牛马”干活的 AI 办公工具

牛马办公是一款面向中国个人用户的 macOS AI 办公产品，包括桌面客户端、正式官网和必要的云端服务。用户可以把真实工作交给专家或固定专家团，由应用内置且隐藏的 OpenClaw Runtime 在本机执行，并交付文档、表格、PPT、图片、HTML 或代码等文件成果。

当前阶段：macOS 客户端已进入开发，基础壳层、任务主路径、专家团目录与本地工作空间正在持续实现。登录最后接入 Resend 邮箱验证码。

## 文档入口

- 开发规则与权威顺序：[AGENTS.md](AGENTS.md)
- 当前开发 Story：[docs/project/current-story.md](docs/project/current-story.md)
- 创建 Story 时的上下文路由：[docs/context-routes.md](docs/context-routes.md)
- 完整文档地图：[docs/README.md](docs/README.md)
- 当前开发 Backlog：[docs/project/mvp-backlog.md](docs/project/mvp-backlog.md)
- 已确认决策：[docs/project/decision-log.md](docs/project/decision-log.md)
- 官网范围与内容：[docs/product/website.md](docs/product/website.md)
- 品牌与 Logo：[docs/product/brand.md](docs/product/brand.md)

开始开发时，只读取 `AGENTS.md`、当前 Story 卡和卡片指定的一份主文档。不要默认加载完整 PRD；路由表只用于创建 Story 卡。

## 当前核心边界

- Task 可独立存在，Project 是可选组织容器。
- Task 和 Project 不强制用户选择文件夹；未选择时自动创建默认 Workspace。
- OpenClaw 对用户不可见，所有调用经过 Adapter。
- 专家团成员固定，每位成员的执行与输出可查看。
- 消息渠道只做飞书和 Telegram；Mac 离线时云端排队最多 24 小时。
- UI 参考 WorkBuddy 的产品结构，遵循 macOS HIG、WCAG 2.2 AA 和 WAI-ARIA 键盘规范，不照搬 iOS UI 或第三方品牌资产。
- “内部体验版”只是发布阶段，范围内的客户端、官网、文案和交互均按正式客户交付标准完成，不制作 Demo 式页面。

## 文档检查

```bash
./scripts/check-docs.sh
```
