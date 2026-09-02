# 牛马办公云端部署

本目录只部署牛马独立 API、Model Gateway、PostgreSQL 和只读版本下载服务。共享服务器目标路径为 `/opt/niuma-office/current`，数据路径为 `/srv/niuma-office`，安装包路径为 `/srv/niuma-office/releases`，Secret 路径为 `/etc/niuma-office/secrets`；不得与映川或其他项目共用容器、数据库、卷、配置文件和写权限。

## 发布前门禁

1. 完成共享服务器全部 Compose、容器、端口、磁盘、内存、卷与健康状态只读盘点。
2. Secret 文件由服务器管理员创建；PostgreSQL Secret 保持 root-only，API Secret 归属专用数值 UID `10001` 且权限 `0400`。禁止通过 Git、构建参数、镜像层、终端输出或日志传递真实值。
3. 先运行 `docker compose -f deploy/compose.production.yml config --quiet`，再构建 API 镜像。
4. 只启动 `niuma-office` Compose 项目；禁止执行全局 `docker system prune`、其他项目 `down` 或修改其卷。
5. 本机 `http://127.0.0.1:4310/health` 返回 `modelGateway: true` 后，才把 `api.alipayclaw.cn` 增加到现有 Cloudflare Tunnel ingress；先验证配置，再原子替换并 reload。
6. 验收短时模型会话、真实 Task、错误状态和日志脱敏；随后复查全部 18 个既有容器、健康端点、磁盘、内存和 OOM 日志。
7. 下载服务只发布校验通过的不可变版本目录和根目录 `release-manifest.json`。清单中的大小与 SHA-256 必须由最终 ZIP 重新计算；`download.alipayclaw.cn` 只映射到本机 `4311`，不与 API 或其他项目共用可写目录。

Telegram 与飞书尚未配置时不创建相关 Secret，也不开放 Webhook 路由。API 健康状态必须明确返回对应能力为 `false`。

## 官网发布门禁

官网构建入口为 `apps/website/site.routes.mjs`，SEO、站内路由和下载清单一致性由 `npm --workspace @niuma/website run check` 统一检查。根域名发布前必须关闭 `OQ-010`：确认运营主体、公开联系方式、备案信息和经审核的隐私政策/用户协议。技术预览或自动检查通过不代表可以把草案法律文本发布到生产域名。
