# 牛马办公文档入口

## 开始开发前

1. 从根目录 `README.md` 了解当前状态；执行工作时阅读 `AGENTS.md`。
2. 打开 `project/current-story.md`，只读取它指向的 Story 卡和一份主文档。
3. 只有创建或更换 Story 时，才使用 `context-routes.md` 从 Backlog 生成新的 Story 卡。
4. 若实现与现有决策冲突，先登记问题，不得静默修改产品定义。

## 文档地图

- `context-routes.md`：按任务关键词选择最小上下文，避免重复加载完整 PRD。
- `product/product-baseline.md`：当前产品范围、核心对象、功能边界与验收闭环。
- `product/ui-and-flows.md`：WorkBuddy 参考原则、页面结构、扫码绑定和主要交互。
- `product/website.md`：官网信息架构、页面内容、正式文案和上线验收。
- `product/brand.md`：品牌定位、Logo、颜色、字标和资产使用规则。
- `research/workbuddy-reference.md`：基于真实网页端、客户端与用户截图形成的功能和视觉对照。
- `architecture/technical-baseline.md`：客户端、OpenClaw、云端、模型、渠道、数据与部署架构。
- `project/decision-log.md`：已经确认、必须传播到实现的产品与技术决策。
- `project/open-questions.md`：尚未阻塞开发、但在相应里程碑前必须补齐的运营输入。
- `project/mvp-backlog.md`：开发顺序、Story 与阶段验收。
- `project/current-story.md`：唯一的当前开发指针；未开工时明确标记 `NONE`。
- `stories/_template.md`：当前 Story 的短执行卡模板；只为正在开发的 Story 建卡。
- `archive/牛马办公_V1产品方案.md`：原始完整蓝图，仅用于追溯；发生冲突时服从以上执行基线。

## 维护规则

- 决策先写入 `decision-log.md`，再同步修改受影响的产品、技术、UI 和验收文档。
- 未确认能力必须标记为“后续”或“不在当前范围”，不得提前生成 API、菜单、表结构或占位页面。
- 模型 ID、价格、OpenClaw 版本、插件版本、域名和服务器信息具有时效性，实施时重新核验。
- 跨文档修改完成后运行 `./scripts/check-docs.sh`。
- 不提前为全部 Backlog 生成详细方案；仅把当前 Story 展开为短卡，完成后保留其验收结果并切换指针。
