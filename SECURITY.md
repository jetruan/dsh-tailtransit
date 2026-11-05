# Security

## 报告问题

请通过 GitHub Security Advisories 私下报告，不要开公开 issue。

请附上：影响版本、复现步骤、系统信息、必要的最小日志。**不要**粘贴 auth key、完整 `config.json` 或 `.env`。

## 范围

Tailtransit 在本机运行一个用户态 `tailscaled` 和回环代理：

- 代理只监听 `127.0.0.1`，没有鉴权；不要把端口改成对外地址
- Auth Key 存放在 `<stateDir>/authkey`（尽力设置 0600），不会写进 `config.json`
- `$DSH_HOME/.env` 的代理块会影响同一个 `DSH_HOME` 下的所有 profile，可在面板关闭
- 插件没有遥测，也不会上传数据

## 支持版本

| 版本 | 支持 |
|---|---|
| 0.1.x | 是 |