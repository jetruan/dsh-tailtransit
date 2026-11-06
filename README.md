# Tailtransit

Tailtransit 是 DeepSeek Harness 的一个插件，只让 Harness 的流量走 Tailscale，系统上其他程序该怎么走还怎么走。

做它的原因：Windows 版 Tailscale 只要选了 exit node，就会接管默认路由和系统 DNS。机器上如果还开着别的 VPN，两边会抢路由，最后总有一个不能用。Tailscale 没有 per-app split tunneling，所以“只让某个进程走 Tailscale”在系统服务层面做不到。

换个思路：不碰系统那个 Tailscale 服务，给 Harness 单独跑一个用户态实例。它不建 TUN、不改路由、不改 DNS，只在 `127.0.0.1` 上开代理。Harness 的网页抓取和命令行走这个代理，其他程序完全不知道它的存在。

```text
系统默认路由 -> 浏览器 / 其他应用

Harness (web_fetch / shell)
      -> HTTP_PROXY 127.0.0.1:18888
      -> tailscaled (userspace, no TUN)
      -> exit node
```

## 接入了哪些东西

1. `web_fetch`：插件注册了一个 fetch provider，bundle patch 把 `web.fetchProvider` 指到它。
2. 命令行：把 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY` 写进 Harness 的进程环境，`curl`、`git`、`npm` 这些都会继承。
3. 其他插件（可选）：把同样的代理写进 `$DSH_HOME/.env`，这样插件自己的 `fetch` 也走代理。默认开启，可以在面板关掉。

LLM 请求不走代理。插件没有装全局 undici dispatcher，也没改 launcher 的代理策略——那会把 LLM 和搜索一起代理走。

## 环境要求

- Windows 10/11，或 macOS 13+。Linux 只做了路径发现，没测过。
- Tailscale 的 `tailscaled` 和 `tailscale`：
  - Windows 装官方客户端就行，默认在 `C:\Program Files\Tailscale`
  - macOS 用 `brew install tailscale`。App Store 版没有可独立运行的 tailscaled，不行。
- DeepSeek Harness 桌面版，能装 Cordis 插件。

路径一般能自动找到；找不到就在 `config.json` 里写 `tailscaledPath` 和 `tailscalePath`。

## 安装

插件按本地 bundle 安装，没发 npm：

1. clone 到任意目录，比如 `D:\tools\dsh-tailtransit`
2. 在 Harness 的插件管理器里安装这个目录（`install_bundle`，target 传绝对路径）
3. 重启 Harness

第一次打开左侧栏的 Tailtransit，会进设置向导。

## 第一次用

1. **连接**：浏览器登录，或者填 Auth Key。Key 存在 `<stateDir>/authkey`，不会写进 `config.json`。
2. **出口**：选一个出口节点。也可以不选，只访问 tailnet 内网。
3. **范围**：其他插件要不要走代理，以及出口挂了是直连还是报错。
4. 点完成。

登录一次就够了。状态和凭据都在 `%USERPROFILE%\.dsh\tailtransit`。

## 面板

双栏：左边是连接和高级设置，右边是状态和操作。

状态卡里有运行状态、出口节点、本地代理、出口 IP 和直连 IP。操作是测试出口、重启代理、复制诊断。高级里能改端口、设备名、`.env` 开关，也能重新跑向导。

窗口窄了会折叠成单列，内容在面板内部滚动，底部的按钮不会被裁掉。

## 配置

`<stateDir>/config.json` 优先级最高，其次是 bundle patch 里的 config，最后是默认值。

| 字段 | 默认 | 说明 |
|---|---|---|
| `exitNode` | 空 | 出口节点的 100.x IP；空则只走 tailnet |
| `proxyPort` | `18888` | 本地代理端口 |
| `stateDir` | `$DSH_HOME/tailtransit` | 登录态、配置、日志都放这 |
| `hostname` | `dsh-<计算机名>` | 在 tailnet 里显示的设备名 |
| `authKeyFile` | `<stateDir>/authkey` | Auth Key 文件；也认环境变量 `TS_AUTHKEY` |
| `envProxy` | `true` | 是否把代理写进 `$DSH_HOME/.env` |
| `onboarded` | `false` | 是否走完首次设置 |
| `proxyShell` | `true` | 是否给 shell 注入代理变量 |
| `fallbackToDirect` | `true` | 代理不可用时是否放行直连 |
| `noProxy` | `localhost,127.0.0.1,::1,deepseek.com,deepseeksvc.com` | 不走代理的域名/IP，逗号分隔 |
| `timeoutMs` / `maxRedirects` / `maxResponseBytes` / `maxBodyChars` | 30s / 5 / 5MB / 100k | 抓取上限 |

## 关于 `$DSH_HOME/.env`

开启「启动环境」后，插件会往 `$DSH_HOME/.env` 写一段带标记的代理配置：

```ini
# >>> dsh-tailtransit
HTTP_PROXY=http://127.0.0.1:18888
HTTPS_PROXY=http://127.0.0.1:18888
NO_PROXY=localhost,127.0.0.1,::1,...
# <<< dsh-tailtransit
```

这段配置对同一个 `DSH_HOME` 下的所有 profile 和插件生效，不是整台电脑。关掉开关会清掉它。

要注意的是：如果插件被卸载，或者代理挂了但这段配置还在，Harness 里所有插件的网络都会受影响。所以要么开着并保持代理正常，要么就关掉。

## 限制

- macOS 是实验性支持。Unix socket、SIGTERM 收尾、去掉 `--windows-mode` 都按 macOS 写了，但我手头没有 Mac，没做完整验证。
- userspace 只代理 TCP。`ssh`、ICMP、UDP 不走，`ssh` 得自己配 `ProxyCommand`。
- 会多一个 tailnet 设备，需要在管理台允许它用 exit node。
- userspace 下 MagicDNS 和 split DNS 有限制，普通域名还是系统 DNS 解析。
- 系统 Tailscale 服务可以同时开 exit node，实测互不影响：插件走自己的用户态实例和本地代理，系统流量继续走系统路由。
- 插件把 `web.fetchProvider` 钉死在 `tailtransit`。只禁用不卸载时，`web_fetch` 会报 provider 未注册。
- profile 安装的插件读不到 `@deepseek-ai/*`，所以没有 Config schema，设置只能走面板和 `config.json`。
- 改完 client 要完全退出 Harness 再开，刷新页面不够。

## 开发

```powershell
node --test test/transport.test.mjs
```

```
index.js          Host 半：tailscaled 管理、代理、路由、工具
client.js         Client 半：面板、向导、设置
transport.js      无依赖的 HTTP/SOCKS 代理传输
cordis.patch.yml  bundle patch
locale/           中英文元数据
test/             transport 测试
```

## 安全

代理只监听 `127.0.0.1`，没有鉴权，别改成对外地址。Auth Key 存在 stateDir 下，文件权限尽力设成 0600；日志也只写本地。插件不收集遥测，不上传数据。

漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要在 issue 里贴 auth key 或诊断里的敏感地址。

## 贡献

提交规范、分支命名和 PR 检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT