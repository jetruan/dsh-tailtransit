# Changelog

## 0.2.9 — 2026-11-23

让 macOS 真正可用。0.2.5 ~ 0.2.8 的文档写着支持 macOS，但 `start()` 在非 Windows 平台直接返回 `unsupported`，插件在这台 Mac 上只注册了面板、从未启动过 daemon。

**修复**

- 平台闸门改为允许 `win32` 与 `darwin`，其他平台仍返回 `unsupported`，并在错误里说明支持范围。
- 新增启动前二进制检查：`tailscaled` / `tailscale` 缺失时状态为 `missing-binary`，给出可操作提示（macOS 指向 `brew install tailscale`，并说明图形界面安装包不含 `tailscaled`），不再让 `spawn` 抛 ENOENT 后只剩一句 "failed to start"。
- 二进制改为成对解析：优先取 `tailscaled` 同目录下的 `tailscale`，避免 macOS 上 `/usr/local/bin/tailscale`（图形界面客户端的 shim）与 Homebrew 的 `tailscaled` 混搭；显式候选都不存在时再查 `PATH`。
- 面板新增 `missing-binary` 状态，中英文文案与错误色同步。
- `debug watch-ipn` 继续保持常开：实测 macOS 1.104.7 在没有 LocalAPI 客户端时 daemon 不会退出，watch 无害，两个平台共用同一条监督路径。

**首次登录流程修复**

- 登录完成后不再残留登录链接：节点进入 `Running` 时清空 `loginUrl`，`describe()` 也不再打印 `login:`。此前面板会在「运行中」旁边一直显示「需要登录 · 打开登录页」，实际上那是一次旧登录尝试留下的 URL。
- `POST /api/tailtransit/login` 改为等待 URL 出现再返回（最多 8 秒）。以前固定等 1.5 秒，`tailscale up` 稍有延迟就返回空 URL，第一次点击看起来什么都没发生。
- 面板在窗口重新获得焦点或变得可见时立即刷新，向导等待登录期间改为 2 秒轮询。浏览器会把后台标签页的定时器节流到分钟级，之前从登录页切回来时，「下一步」会长时间保持灰色。
- 向导在任何「尚未完成引导」的面板挂载上都显示，不再只在 `NeedsLogin` 时显示。此前登录成功后切换插件页，会直接跳到主界面，而出口节点与范围两步还没答。
- 登录按钮在点击瞬间同步占位新标签页，再把拿到 URL 的标签页导航过去；`await fetch` 之后再 `window.open` 会被当作弹窗拦截。
- 出口节点列表不再「第一次打开是空的」：`start()` 会在控制面下发 netmap 之前缓存状态（`Running` 但 `Peer` 为空），而缓存此前 15 秒才刷新一次。现在状态超过 3 秒即按需刷新（并发请求合并为一次 CLI 调用），向导打开期间 2 秒轮询，点「下一步」时立即拉取；列表确实为空时显示「正在读取出口节点…」。

**验证**

环境：macOS 26.6.2 / arm64，Tailscale 1.104.7（Homebrew 包，临时解压到独立目录运行，未安装到系统）。

- 用插件原样的参数启动用户态 daemon：不创建 TUN、不改路由与 DNS，与已登录的图形界面版 Tailscale（macsys 1.104.7）同时运行互不影响。
- 同一端口同时提供 HTTP CONNECT 与 SOCKS5；`transport.js` 的 `fetchThroughProxy` 经该代理取回 `https://example.com/` 200，`probeOrigin` 返回可达。
- LocalAPI unix socket 正常：`status --json` 返回 `NeedsLogin`，`tailscale up` 约 3 秒内产出登录链接，`ps -p <pid> -o comm=` 能识别残留 daemon 并回收。
- 以 harness 驱动真实插件入口：工具、fetch provider、`/api/tailtransit` 路由均注册；`/status`、`/settings` 返回 `proxyReady: true`、`installed: true`、`platform: darwin`；卸载时 daemon 被回收。
- 新增 `test/daemon.test.mjs`，覆盖上述启动、注册、状态、代理取页与回收；找不到 `tailscaled` 时自动跳过（退出码 0）。
- 用伪 `tailscaled` / `tailscale` 驱动真实插件入口，验证登录状态机：`/login` 等到 URL、进入 `Running` 后清空 URL、`describe()` 不再显示登录行、卸载后 daemon 停止。8 项检查全部通过。
- 同一套伪二进制模拟「`Running` 但 peer 列表晚到」：节点在 502ms 内出现在 `availableExitNodes` 中（修复前要等满 15 秒刷新周期）。

**实机端到端验证**

安装 Homebrew 版 Tailscale 1.102.2 后，在 macOS 26.6（arm64）上完成了一次真实登录与出口验证：

- 出口节点下发成功且在线；经代理的出口 IP 与直连 IP 分离，`web_fetch` 与 Shell 命令都从出口节点出去，SOCKS5 与 HTTP 代理结果一致。
- 经代理访问 tailnet 内网服务正常；面板 `/status`、`/settings`、`/test` 与工具 `describe` 返回一致。
- Harness 进程自身未设置 `NODE_USE_ENV_PROXY`，模型与账号域名在 `NO_PROXY` 中保持直连；`~/.dsh/.env` 已写入受管代理块。
- 系统图形界面版 Tailscale 仍为 `Running` 且未选择出口节点；插件使用独立进程、socket 与状态目录，不接管路由与 DNS。

**已知限制**

- 图形界面安装包（App Store 或官方 pkg）仍不能单独使用：它们提供 GUI 与 CLI，但不附带可独立运行的 `tailscaled`；Homebrew 版才提供。
- Linux 仅保留可执行文件候选路径，未做端到端验证。

## 0.2.8 — 2026-11-19

仅文档更新，无代码变更。

核实插件在 DeepSeek Harness `0.2.2-rc.5` 上的兼容性，并把结论写进文档。

**兼容性核实**

- rc5 相对 rc3 新增两条升级项：`v0.2.2-rc.3/deepseek-refusal-code`（流式拒绝码 `MALFORMED_RESPONSE` 更名为 `CONTENT_REFUSED`）与 `v0.2.2-rc.4/web-search-deepseek-model-default`（基座组合不再固定 `searchProvider`，改为按模型路由自动选择）。前者插件不涉及；后者因插件在自己的补丁中显式设置了 `searchProvider: deepseek-official` 与 `fetchProvider: tailtransit`，按官方说明不受影响，且 `deepseek-official` 在 rc5 中仍是有效提供方 id。
- 逐一实测确认所用 API 未变：`ctx.web.registerFetchProvider` 及其提供方选择失败语义、`WebFetchResult` 结构、`ctx.webServer.register` 的 `WebRouteKind`、`ctx.tools.register`（未使用 `{ when }`，不受 `conditional-tools` 变更影响）、`sidebar.panellist` 与 `main` 槽位。`styles` 仍未出现在 rc5 的浏览器种子模块表中，0.2.7 的修复依然必要。
- 实机状态正常：`Running`、`proxyReady` 为真、出口节点在线，出口与直连 IP 正常分离，跨域重定向策略仍为阻断。

**文档**

- README 中英双语的 Harness 要求改为 `0.2.2-rc.1` ~ `0.2.2-rc.5`，Node.js 要求改为 24.9 或更高，徽章同步更新。
- 新增「兼容性 / Compatibility」一节，说明 `engines.dsh` 的生效方式与已验证版本。

## 0.2.7 — 2026-11-17

适配 DeepSeek Harness 0.2.2-rc.3，修正两处与 rc3 不一致之处。

**修复**

- 面板样式不再调用 `require('styles')`。`styles` 不是浏览器模块表的平台种子词（rc3 前端只提供 `react`、`react-dom`、`@deepseek-ai/cordis`、`zod`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit` 等），该调用在每次加载都会抛 `missed the module table` 后被兜底吞掉。现在直接插入 `<style>` 元素并在 `ctx.effect` 清理函数中移除，行为不变而去掉恒失败分支。

**工程**

- `package.json` 新增 `engines.dsh: ">=0.2.2-rc.1 <0.3.0"`。rc3 起插件兼容性检查优先读 `engines.dsh`，声明后该范围单独决定，不再回退到 peer 规则；此前未声明，任何不兼容的 rc 版本只会在运行时静默失败，而不会被安装时拦下。
- `engines.node` 由 `>=20` 改为 `>=24.9.0`，与 DSH 自 rc3 起的最低 Node 要求一致。
- CI 的 Node 版本由 22 改为 24，与 `engines.node` 对齐；此前 CI 实际未覆盖声明的最低运行环境。

## 0.2.6 — 2026-11-13

修复「测试出口」显示的直连 IP 在 IPv4 与 IPv6 之间跳动的问题，并转入隐私门禁等工程变更。

**修复**

- 探测地址从 `https://ifconfig.me/ip` 改为 `https://ipv4.icanhazip.com/`。前者是双栈端点，返回哪个地址族取决于系统为该次连接选定的地址（DNS 记录顺序、RFC 6724 排序、Happy Eyeballs 竞速），因此双栈网络上直连 IP 会时而显示 IPv4、时而显示 IPv6；后者仅发布 A 记录，出口与直连两条探测均稳定返回 IPv4。

**工程**

仅工程与文档变更，无运行时行为变更。

- 新增依赖无关的隐私门禁 `scripts/check-sensitive.mjs`：拦截 IP、邮箱、内部与 tailnet 域名、Auth Key、云令牌、私钥、带用户名的绝对路径，以及已脱敏标识的哈希
- 新增 `.githooks/pre-commit` 与 `.githooks/commit-msg`，通过 `npm run hooks:install` 安装
- CI 增加隐私扫描任务，覆盖当前文件树与新提交
- 新增 `test/sensitive-gate.test.mjs`，并补充 `check:privacy` / `check:privacy:history` 脚本
- 文档补充截图打码、诊断信息脱敏和历史泄露说明

## 0.2.5 — 2026-11-11

仅文档更新，无代码变更。

- 移除面板截图：README 不再嵌入图片，`screenshots.json` 一并删除
- 因此 README 也不再依赖外部 CDN 渲染图片

## 0.2.4 — 2026-11-11

仅截图与文档更新，无代码变更。

- 面板截图按 0.2.3 的实际界面重拍：中英各一张，包含大模型行的 API 识别与开启前提醒
- 截图中的出口节点名与对外 IP 已打码
- README 图片改为 jsDelivr 绝对地址，npm 页面也能正常显示（此前相对路径在 npm 上是坏图）
- 截图清单 `screenshots.json` 指向的两张图同步替换

## 0.2.3 — 2026-11-11

仅文档与发布元数据更新，无代码变更。

- 新增 format 1 插件索引（`docs/index.json`），可通过 Harness 插件市场的 Discover 页添加并安装。索引已通过 `@deepseek-ai/dsh-plugin-market-index` 的校验器。
- 安装章节补充「通过插件市场安装」，中英各一节。
- 简介改为先讲用途、后讲机制：`package.json` 描述强调「只让 Harness 走出口、不动整机网络」，商店列表同样处理——原来的写法需要读者从实现方式反推它能做什么。

## 0.2.2 — 2026-11-11

修复开启「其他插件」后大模型请求被误送出口节点、最终连接失败的问题。

**修复**

- 不再向本进程写入 `NODE_USE_ENV_PROXY`。该变量会让 Harness 自身的 `fetch` 也遵循代理环境变量，导致 LLM 与账号请求被一并送进出口节点；内网端点此时会一直挂到连接超时，最终报 `Connection error.`。子进程仍由 Harness 侧下发该变量，命令行代理不受影响。
- 进程内 `NO_PROXY` 改用与 `.env` 相同的合成函数，此前它只带三项回环地址，连手动配置的例外域名都不生效。
- 修正回环例外顺序被逐条前置而反转的问题。

**变更**

- LLM 端点不再依赖固定清单：改为通过 Harness 的配置服务读取供应商 `baseURL` 自动派生，用户换任何服务商都无需改配置；`llmNoProxy` 默认值改为空，仅作手动补充。
- 保留 `deepseek.com` / `deepseeksvc.com` 作为厂商基线例外。它是 Harness 自己的账号与配额服务，供应商配置里不会出现（`baseURL` 只覆盖模型端点），无法派生，与客户域名无关。
- 打开「大模型」开关前先经出口节点做连通性预检；连不通则拒绝开启并说明原因，不再让用户以连接超时的形式发现。无法识别端点时允许开启，但提示未经预检。预检超时固定 10 秒。
- 面板显示自动识别到的端点，并说明「其他插件」开启后子进程一并走代理、命令行开关无法关闭。
- 「大模型」一行重做：端点清单默认折叠为「自动识别 · N 个 API」，点开才展开；「端点」统一改称「API」；增加一句前提提醒——开启前须确认出口节点能访问该 API，否则模型无法工作。
- 预检被拒时，错误就地显示在开关下方，含主机名、底层传输原因，并提供「复制详情」与「重新预检」。

**新增**

- `noproxy.js`：代理例外策略独立成无依赖模块，便于测试与复用。
- `probeOrigin()`：只做隧道与 TLS 连通性探测，不读取响应内容，避免把端点正常的 401/404 或不可识别的 Content-Type 误判为不可达。
- 测试：`test/noproxy.test.mjs`、`test/probe.test.mjs`，共 33 项检查。

## 0.2.1 — 2026-11-10

仅文档更新，无代码变更。

- README 改写为产品文档风格：定位、设计目标与能力边界改为客观陈述，去掉口语化表达
- 新增「设计目标」「初始配置」「常见问题」三节，FAQ 覆盖双设备、Exit Node 必要性、LLM 默认直连、重启生效四个问题
- 中英文术语统一：出口节点 / Exit Node、用户态 / userspace、故障回退 / failover、严格阻断 / fail closed

## 0.2.0 — 2026-11-10

首个 npm 发布版本。

- 界面支持中英双语：右上角切换，选择记在 localStorage，首次打开跟随浏览器语言
- 卡片标题改为带品牌竖条与渐变底的标题带，层级更清楚
- 修复卡片边框与圆角被标题带覆盖的问题
- 补齐 repository / homepage / bugs 元数据

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
