# Tailtransit

> Harness-scoped Tailscale egress: a per-user, no-TUN `tailscaled` plus a loopback proxy, so only DeepSeek Harness traffic uses your tailnet exit node.

让 Tailscale **只对 DeepSeek Harness 生效**，系统其他流量继续走原有路由。

Tailtransit 是一个 [DeepSeek Harness](https://deepseek.com) 插件：它为 Harness 单独启动一个 **per-user、no-TUN** 的 `tailscaled`，只监听回环代理，因此 `web_fetch` 和 Harness 派生的命令行走 Tailscale 出口，而 Windows 的默认路由、系统 DNS、其他应用完全不受影响。

```text
系统默认路由 ── 浏览器 / 其他应用

Harness (web_fetch / shell) ── HTTP_PROXY ── 127.0.0.1:18888 ── tailscaled(userspace) ── exit node
```

## 特性

- **只影响 Harness**：不建 TUN、不改系统路由、不改系统 DNS，不需要管理员权限
- **两条链路**：`web_fetch` 走自定义 fetch provider；shell 命令继承代理环境变量
- **其他插件可选**：需要时把代理写进 `$DSH_HOME/.env`，影响同一 Harness 下的所有插件（可在面板关闭）
- **出口节点**：从 tailnet 节点里选择，失败时可选「自动直连」或「严格阻断」
- **首次向导**：浏览器登录或 Auth Key 登录，选设备名、出口、范围
- **可诊断**：状态、出口 IP / 直连 IP、一键复制诊断信息

## 环境要求

- Windows 10 / 11，或 macOS 13+（Apple Silicon / Intel）
- Tailscale 的 `tailscaled` / `tailscale` 二进制：
  - **Windows**：安装[官方客户端](https://tailscale.com/download)，默认路径 `C:\Program Files\Tailscale`
  - **macOS**：`brew install tailscale`（提供 userspace 可用的 `tailscaled`；App Store 版不能作为独立实例运行）
- DeepSeek Harness 桌面版，且能安装 Cordis 插件

插件会自动发现以下路径，也可以在 `config.json` 里显式指定 `tailscaledPath` / `tailscalePath`：

| 平台 | `tailscaled` |
|---|---|
| Windows | `C:\Program Files\Tailscale\tailscaled.exe` |
| macOS | `/opt/homebrew/bin/tailscaled`、`/usr/local/bin/tailscaled` |
| Linux（未验证） | `/usr/bin/tailscaled`、`/usr/sbin/tailscaled` |

## 安装

插件以本地 bundle 的形式安装，不需要发布到 npm：

1. 把仓库克隆到本机任意目录，例如 `D:\tools\dsh-tailtransit`
2. 在 Harness 里用插件管理器安装这个目录（`install_bundle`，target 传绝对路径）
3. 重启一次 Harness

首次打开左侧栏的 **Tailtransit** 会进入设置向导。

> macOS：先执行 `brew install tailscale`，确认 `tailscaled` 与 `tailscale` 在 `/opt/homebrew/bin` 或 `/usr/local/bin`，再安装插件。

## 首次设置

1. **连接**：点「在浏览器中登录」完成 Tailscale 授权；或粘贴 Auth Key（存入 `<stateDir>/authkey`，不会写进 `config.json`）
2. **出口**：选择出口节点，或选「不使用出口节点」只访问 tailnet 内网
3. **范围**：是否把代理写进 `.env`（影响其他插件），以及失败策略
4. 完成后回到面板

登录只需一次；状态与凭据保存在 `%USERPROFILE%\.dsh\tailtransit`。

## 面板

- 左侧栏入口：**Tailtransit**
- 双栏布局：左侧「连接 / 高级」，右侧「状态 / 操作」
- 状态卡：运行状态、出口节点、本地代理、出口 IP、直连 IP
- 操作：测试出口、重启代理、复制诊断
- 高级：设备名、本地端口、状态目录、启动环境开关、重新运行向导

窗口变窄时自动折叠为单列，面板内部滚动，底部按钮不会被裁掉。

## 配置

配置优先级：`<stateDir>/config.json` > bundle patch 的 `config` > 默认值。

| 字段 | 默认 | 说明 |
|---|---|---|
| `exitNode` | 空 | 出口节点的 100.x IP；空则只走 tailnet |
| `proxyPort` | `18888` | 本地代理端口 |
| `stateDir` | `$DSH_HOME/tailtransit` | 独立状态目录（登录态、配置、日志） |
| `hostname` | `dsh-<计算机名>` | 在 tailnet 里显示的设备名 |
| `authKeyFile` | `<stateDir>/authkey` | Auth Key 文件；也支持环境变量 `TS_AUTHKEY` |
| `envProxy` | `true` | 是否把代理写进 `$DSH_HOME/.env`（影响其他插件） |
| `onboarded` | `false` | 是否已完成首次设置 |
| `proxyShell` | `true` | 是否给 shell 注入代理变量 |
| `fallbackToDirect` | `true` | 代理不可用时是否放行直连 |
| `noProxy` | `localhost,127.0.0.1,::1,deepseek.com,deepseeksvc.com` | 不走代理的域名/IP，逗号分隔；本地服务、内网域名加在这里 |
| `timeoutMs` / `maxRedirects` / `maxResponseBytes` / `maxBodyChars` | 30s / 5 / 5MB / 100k | 抓取上限 |

## 关于 `$DSH_HOME/.env`

开启「启动环境」后，插件会在 `$DSH_HOME/.env` 写入一段带标记的代理配置：

```ini
# >>> dsh-tailtransit
HTTP_PROXY=http://127.0.0.1:18888
HTTPS_PROXY=http://127.0.0.1:18888
NO_PROXY=localhost,127.0.0.1,::1,...
# <<< dsh-tailtransit
```

它的作用域是 **同一个 `DSH_HOME` 下的所有 profile 和插件**，不是整台电脑。关闭开关会清理这段配置；插件卸载或代理故障时如果块还在，Harness 内所有插件的网络会一起受影响，所以不建议长期保留而不监控。

## 安全

- 本地代理只绑定 `127.0.0.1`，没有鉴权，不要改成对外地址
- Auth Key 只写入 `<stateDir>/authkey`（尽力设置 0600 权限），不写进 `config.json`
- 插件不收集遥测、不上传数据；日志只写到状态目录
- 卸载 bundle 会移除 `web.fetchProvider` 覆盖，`web_fetch` 回到内置 provider

## 已知限制

- **macOS 为实验性支持**：代码路径（Unix socket、SIGTERM 收尾、无 `--windows-mode`）已实现，但还没有在真实 macOS 上做完整验证
- **Linux 未验证**：只做了路径发现，未测试
- userspace 只代理 **TCP**：`ssh`、ICMP、UDP 不走；`ssh` 需要自行配 `ProxyCommand`
- 会多出一个 tailnet 设备，需要在管理台允许它使用 exit node
- userspace 下 MagicDNS / split DNS 有限制，普通域名仍由系统 DNS 解析
- 系统 Tailscale 服务不能同时开着 exit node，否则系统级路由冲突
- 插件把 `web.fetchProvider` 固定为 `tailtransit`；只禁用而不卸载时，`web_fetch` 会报 provider 未注册
- profile 安装的插件无法解析 `@deepseek-ai/*`，因此没有 `Config` schema，设置通过面板和 `config.json` 完成
- 客户端 bundle 有启动时快照：更新 client 后需要完全退出 Harness 再打开

## 开发

```powershell
node --test test/transport.test.mjs
```

目录：

```
index.js          Host 半：tailscaled 管理、代理、路由、工具
client.js         Client 半：面板、向导、设置
transport.js      无依赖的 HTTP/SOCKS 代理传输
cordis.patch.yml  bundle patch
locale/           中英文元数据
test/             transport 测试
```

## 贡献

提交规范、分支命名和 PR 检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全

漏洞请按 [SECURITY.md](SECURITY.md) 私下报告；不要在 issue 里粘贴 auth key 或诊断里的敏感地址。

## 许可

MIT