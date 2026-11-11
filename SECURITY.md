# Security

## 报告问题

请通过 GitHub Security Advisories 私下报告，不要开公开 issue。

请附上：影响版本、复现步骤、系统信息、必要的最小日志。**不要**粘贴 auth key、完整 `config.json` 或 `.env`。

## 范围

Tailtransit 在本机运行一个用户态 `tailscaled` 和回环代理：

- 代理只监听 `127.0.0.1`，没有鉴权；不要把端口改成对外地址
- Auth Key 存放在 `<stateDir>/authkey`（尽力设置 0600），不会写进 `config.json`
- `$DSH_HOME/.env` 的代理块会影响同一个 `DSH_HOME` 下的所有 profile，可在面板关闭
- 插件没有遥测。唯一的外部诊断请求是用户点击「测试出口」时向 `ifconfig.me` 查询当前 IP，用于对比出口与直连地址；该请求不包含账号或本机信息。

## 支持版本

| 版本 | 支持 |
|---|---|
| 0.1.x | 是 |

## 仓库卫生

- 提交门禁在 `git commit` 时扫描暂存文件，CI 另外扫描整棵文件树和新提交。规则与豁免见 `.sensitive-gate.json`。
- 门禁覆盖 IP、邮箱、内部域名、tailnet 域名、Auth Key、云令牌、私钥、带用户名的绝对路径和已脱敏标识的哈希。
- 公司/组织域名、设备名等已泄露标识按类别记录在 `.sensitive-gate.json` 的 `denyCategories`，仓库只保存哈希，不要把明文补回仓库。
- 截图中的文字无法被扫描。面板截图包含设备名、出口节点名、出口/直连 IP 和状态目录，分享前必须逐项打码。
- `/api/tailtransit/status` 与「复制诊断」会返回 tailnet IP、出口节点地址、设备名和本机状态目录。它们只应发给可信对象，公开 issue 里请先删除这些字段。
- Git 提交的作者姓名与邮箱是公开元数据。不想公开个人邮箱时，把 `user.email` 设为 GitHub 提供的 noreply 地址。
- remote URL 可能带有 tailnet 地址；分享整个仓库目录前先检查 `.git/config`。
- 删除文件不会删除历史。旧提交中的内容仍可从公开仓库恢复；一旦确认历史泄露，应重写历史并强推，同时联系 GitHub 清理缓存。
