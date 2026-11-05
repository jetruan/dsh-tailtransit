# Contributing

感谢愿意改进 Tailtransit。这个项目是 DeepSeek Harness 的 Cordis 插件，Host 与 Client 各一半，改动前建议先看 README 的「工作原理」和「已知限制」。

## 开发环境

- Windows 10/11 或 macOS 13+
- Node.js 20+
- Tailscale（Windows 安装官方客户端；macOS `brew install tailscale`）
- DeepSeek Harness 桌面版

## 本地运行

```powershell
node --test test/transport.test.mjs
```

插件本身通过 Harness 的插件管理器以本地 bundle 安装：

1. 把仓库克隆到本机
2. 用 `plugin_manager install_bundle` 安装仓库目录（传绝对路径）
3. 安装后完全退出 Harness 再打开

## 代码约定

- `transport.js` 保持**零依赖**，不要引入运行时包
- profile 安装的插件**不能解析 `@deepseek-ai/*`**，不要新增这类 import；需要错误类型时用本地实现（见 `index.js` 的 `WebError`）
- Client 样式只用主题 token（`--dsw-alias-*`），不要写死颜色
- Host 侧新增路由统一挂在 `/api/tailtransit` 下
- 平台相关代码用 `process.platform` 分支，并在 README 标注验证状态
- 客户端 bundle 有启动时快照：改完 client 需要重装并重启 Harness

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 增加出口故障切换
fix: 修复 macOS 下 socket 清理
docs: 补充 .env 作用域说明
chore: 更新 CI
refactor: 拆分平台路径解析
test: 补充 redirect 测试
```

- 一个提交只做一件事
- 标题用祈使句，不超过 72 字符
- 破坏性变更在正文写 `BREAKING CHANGE:`

## 分支

- `main` 保持可发布
- 功能分支：`feat/<short-name>`
- 修复分支：`fix/<short-name>`

## Pull Request

- 填写 PR 模板
- 至少跑过 `node --test test/transport.test.mjs`
- UI 改动请附截图（深色/浅色各一张）
- 涉及平台路径的改动请说明在哪些系统上验证过，未验证的要写明

## 安全

不要提交 auth key、`config.json`、`.env`、日志或诊断输出。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。