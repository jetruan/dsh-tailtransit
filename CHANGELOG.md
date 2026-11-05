# Changelog

## 0.1.0 — 2026-11-05

首个可发布版本。

- 用户态 `tailscaled`（no-TUN）+ 本地 HTTP/SOCKS 代理，Harness 流量单独走 Tailscale 出口
- `web_fetch` fetch provider、shell 代理环境、其他插件的 `.env` 启动代理（可关闭）
- 双栏面板：连接、高级设置、状态、操作、诊断复制
- 首次设置向导：浏览器登录 / Auth Key、设备名、出口节点、范围与失败策略
- 出口节点选择与失败策略（自动直连 / 严格阻断）
- 设置页：本地端口、设备名、状态目录、启动环境开关
- 图标、中英文元数据
- 重命名为 Tailtransit（包名 `dsh-tailtransit`），旧状态目录自动迁移
- macOS 实验性支持：自动发现 Homebrew 路径、Unix domain socket、SIGTERM 收尾