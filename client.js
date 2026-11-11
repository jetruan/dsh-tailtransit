/**
 * Client half of dsh-tailtransit.
 *
 * A page in the main column: a compact status strip plus two setting groups,
 * built entirely from the Harness theme tokens so light and dark both read
 * correctly. State comes from the host half's `/api/tailtransit` routes.
 *
 * @module dsh-tailtransit/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-tailtransit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const API = '/api/tailtransit'

    const css = `
      .tse-page { max-width: 760px; margin: 0 auto; padding: 30px 34px 48px; color: var(--dsw-alias-label-primary); font-size: 13px; box-sizing: border-box; height: 100%; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2) transparent; }
      .tse-page::-webkit-scrollbar { width: 10px; }
      .tse-page::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 99px; border: 3px solid transparent; background-clip: content-box; }
      .tse-page::-webkit-scrollbar-track { background: transparent; }
      .tse-head { display: flex; align-items: center; gap: 14px; }
      .tse-logo { width: 40px; height: 40px; border-radius: 11px; flex: none; display: grid; place-items: center; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-brand-primary); }
      .tse-titles { flex: 1; min-width: 0; }
      .tse-title { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: .1px; }

      .tse-switch { position: relative; width: 40px; height: 23px; flex: none; padding: 0; border-radius: 999px; border: 0; background: #9aa3b2; cursor: pointer; transition: background .16s; }
      .tse-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: left .16s; }
      .tse-switch.on { background: #22c55e; }
      .tse-switch.on::after { left: 19px; }
      .tse-switch:disabled { opacity: .45; cursor: default; }

      .tse-metrics { display: grid; grid-template-columns: 1fr 1.35fr 1.35fr; margin-top: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
      .tse-metric { padding: 13px 16px; min-width: 0; }
      .tse-metric + .tse-metric { border-left: 1px solid var(--dsw-alias-border-l1); }
      .tse-metric .k { font-size: 11px; letter-spacing: .45px; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
      .tse-metric .v { display: flex; align-items: center; gap: 7px; margin-top: 5px; font-size: 13px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tse-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-idle-primary); }
      .tse-dot.ok { background: var(--dsw-alias-state-success-primary); }
      .tse-dot.warn { background: var(--dsw-alias-state-warn-primary); }
      .tse-dot.err { background: var(--dsw-alias-state-error-primary); }

      .tse-section { margin-top: 24px; }
      .tse-section-title { margin: 0 0 8px; font-size: 11.5px; font-weight: 600; letter-spacing: .45px; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
      .tse-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); padding: 0 20px 16px; overflow: hidden; }
      .tse-row { display: grid; grid-template-columns: 88px 1fr; align-items: center; gap: 12px; padding: 10px 0; min-height: 50px; }
      .tse-row + .tse-row { border-top: 1px solid var(--dsw-alias-border-l1); }
      .tse-label { font-size: 13px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .tse-controls { display: flex; align-items: center; gap: 10px; min-width: 0; }

      .tse-select { appearance: none; flex: 1; min-width: 0; padding: 7px 30px 7px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background-color: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238a93a5' stroke-width='1.4' stroke-linecap='round'/></svg>"); background-repeat: no-repeat; background-position: right 11px center; }
      .tse-select:disabled { opacity: .45; cursor: default; }

      .tse-seg { display: inline-flex; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); }
      .tse-seg button { appearance: none; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 5px 13px; border-radius: 7px; cursor: pointer; }
      .tse-seg button.on { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
      .tse-seg button:disabled { opacity: .45; cursor: default; }

      .tse-input { width: 96px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
      .tse-readonly { font-size: 12.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tse-mini { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }

      /* A precondition, not more feature copy: its own line so the colour and
         the icon carry the meaning without interrupting the paragraph above. */
      .tse-hint { display: flex; gap: 6px; margin-top: 5px; color: var(--dsw-alias-state-warn-primary, #d97706); }
      .tse-hint-ico { flex: none; font-size: 11px; line-height: 1.55; }
      .tse-hint-warn { color: var(--dsw-alias-state-warn-primary, #d97706); }

      /* Collapsed by default. Block-level flex for the same reason as the hint:
         an inline pill wraps into the sentence and reads as prose. */
      .tse-toggle { display: flex; width: fit-content; max-width: 100%; align-items: center; gap: 7px; margin-top: 9px; padding: 3px 11px 3px 4px; border-radius: 999px; cursor: pointer; font: inherit; border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); transition: border-color .15s, background .15s; }
      .tse-toggle:hover { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
      .tse-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .tse-toggle:disabled { opacity: .5; cursor: default; }
      .tse-tag { flex: none; font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); color: var(--dsw-alias-brand-primary); white-space: nowrap; }
      .tse-count { font-size: 11px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tse-chev { flex: none; font-size: 9px; line-height: 1; color: var(--dsw-alias-brand-primary); transition: transform .15s; }
      .tse-toggle.open .tse-chev { transform: rotate(90deg); }

      .tse-panel { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .tse-chip { display: inline-flex; align-items: center; max-width: 100%; font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; line-height: 1; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* The refusal of a preflight: the loudest thing in the card. */
      .tse-alert { display: flex; gap: 9px; margin-top: 9px; padding: 9px 11px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 11%, transparent); }
      .tse-alert-ico { flex: none; font-size: 12px; line-height: 1.45; color: var(--dsw-alias-state-warn-primary, #d97706); }
      .tse-alert-body { min-width: 0; }
      .tse-alert-title { font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-warn-primary, #d97706); }
      .tse-alert-detail { margin-top: 3px; font-family: "Cascadia Code", Consolas, monospace; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .tse-alert-actions { display: flex; gap: 10px; margin-top: 5px; }
      .tse-link { font-size: 11px; color: var(--dsw-alias-brand-primary); cursor: pointer; }
      .tse-link:hover { text-decoration: underline; }
      .tse-row.has-desc { row-gap: 3px; align-items: start; }
      .tse-row.has-desc .tse-label { padding-top: 2px; }
      .tse-row.has-desc .tse-controls { padding-top: 1px; }
      .tse-desc { grid-column: 2; padding-bottom: 8px; font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }

      .tse-foot { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
      .tse-egress { flex: 1; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .tse-egress b { color: var(--dsw-alias-label-primary); font-family: "Cascadia Code", Consolas, monospace; font-weight: 500; font-variant-numeric: tabular-nums; }
      .tse-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 7px 13px; border-radius: 8px; cursor: pointer; transition: border-color .15s, color .15s; white-space: nowrap; }
      .tse-btn:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .tse-btn:disabled { opacity: .45; cursor: default; }
      .tse-btn.primary { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-brand-primary); }
      .tse-btn.primary { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }
      .tse-btn.primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .tse-btn.ghost:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
      .tse-note { margin-top: 12px; font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
      .tse-note a { color: var(--dsw-alias-brand-primary); text-decoration: none; }
      .tse-note a:hover { text-decoration: underline; }
      .tse-error { margin-top: 10px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
      .tse-off .tse-card, .tse-off .tse-metrics { opacity: .55; }
      .tse-switch:focus-visible, .tse-btn:focus-visible, .tse-seg button:focus-visible, .tse-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      @media (max-width: 620px) {
        .tse-page { padding: 20px 18px 40px; }
        .tse-metrics { grid-template-columns: 1fr; }
        .tse-metric + .tse-metric { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
        .tse-row { grid-template-columns: 84px 1fr; }
        .tse-select { min-width: 0; width: 100%; }
      }
      .tse-page { max-width: 1120px; padding: 28px 32px 48px; width: 100%; }
      .tse-head { margin-bottom: 22px; }
      .tse-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, .85fr); gap: 18px; align-items: start; }
      .tse-col { display: grid; gap: 18px; min-width: 0; }
      .tse-card-title { margin: 0 -20px 4px; padding: 13px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: linear-gradient(180deg, rgba(45,212,191,.07), rgba(45,212,191,0)); color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 650; letter-spacing: .2px; display: flex; align-items: center; gap: 9px; }
      .tse-card-title::before { content: ""; width: 3px; height: 13px; border-radius: 2px; background: var(--dsw-alias-brand-primary); flex: none; }
      .tse-lang { display: inline-flex; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-2); margin-right: 10px; flex: none; }
      .tse-lang button { appearance: none; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; font-weight: 600; letter-spacing: .3px; padding: 5px 11px; border-radius: 7px; cursor: pointer; }
      .tse-lang button.on { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
      .tse-lang button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .tse-row { grid-template-columns: 92px 1fr; min-height: 48px; padding: 11px 0; }
      .tse-state { display: flex; align-items: center; gap: 9px; font-size: 17px; font-weight: 600; margin: 4px 0 14px; }
      .tse-kv { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 12.5px; }
      .tse-kv span { color: var(--dsw-alias-label-secondary); }
      .tse-kv b { font-weight: 550; font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; }
      .tse-actions { display: grid; gap: 8px; }
      .tse-btn.wide { width: 100%; }
      .tse-btn { background: var(--dsw-alias-bg-layer-2); }
      .tse-btn.ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
      .tse-login { margin-top: 10px; font-size: 12px; }
      .tse-login a { color: var(--dsw-alias-brand-primary); text-decoration: none; }
      @media (max-width: 900px) {
        .tse-page { padding: 22px 18px 36px; }
        .tse-grid { grid-template-columns: 1fr; }
      }
      .tse-sub { margin-top: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .tse-steps { display: flex; align-items: center; gap: 10px; margin: 0 0 18px; }
      .tse-step { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .tse-step .n { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); display: grid; place-items: center; font-size: 11px; transition: .18s; }
      .tse-step.on { color: var(--dsw-alias-label-primary); font-weight: 600; }
      .tse-step.on .n { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
      .tse-step.done .n { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent); color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
      .tse-steps .bar { flex: 1; height: 1px; background: var(--dsw-alias-border-l1); transition: .18s; }
      .tse-steps .bar.done { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
      .tse-wiz-title { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
      .tse-wiz-desc { margin: 0 0 14px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); line-height: 1.55; }
      .tse-wiz-note { margin-top: 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .tse-wiz-foot { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l1); }
      .tse-wiz-foot .grow { flex: 1; }
      .tse-keybox { display: grid; gap: 8px; margin-top: 10px; }
      .tse-input.wide { width: 100%; }
      .tse-nodes { display: grid; gap: 8px; }
      .tse-node { display: flex; justify-content: space-between; gap: 10px; width: 100%; text-align: left; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
      .tse-node.on { border-color: #2c6b5c; background: var(--dsw-alias-bg-layer-1); }
      .tse-node-ip { color: var(--dsw-alias-label-secondary); font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; }
      .tse-done { text-align: center; padding: 8px 0 4px; }
      .tse-done .big { width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 12px; display: grid; place-items: center; border: 1px solid #2c6b5c; color: #2dd4bf; }
      .tse-summary { display: grid; gap: 7px; max-width: 360px; margin: 16px auto 0; text-align: left; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
      .tse-summary b { display: inline-block; width: 48px; color: var(--dsw-alias-label-primary); font-weight: 550; }
    `

    function Icon(props) {
      const size = props.size || 18
      const stroke = props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke,
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
        h('path', { d: 'M3.4 21.2V11.4a8.6 8.6 0 0 1 17.2 0V21.2' }),
        h('path', { d: 'M8 21.2V13.2a4 4 0 0 1 8 0V21.2' }))
    }

    /**
     * UI strings. The panel ships with Chinese and English; the choice is kept
     * in localStorage so it survives reloads. `{name}` slots are filled by
     * `makeT`. Values are plain text only — never markup.
     */
    const STRINGS = {
      zh: {
        langName: '中文',
        subtitle: '仅 Harness 流量 · 独立用户态实例',
        cardConnection: '连接',
        cardTraffic: '流量',
        cardAdvanced: '高级',
        cardStatus: '状态',
        cardActions: '操作',
        exitNode: '出口节点',
        onFailure: '失败时',
        policyDirect: '自动直连',
        policyBlock: '严格阻断',
        noNodes: '没有可选节点',
        offlineSuffix: ' · 离线',
        notSelected: '未选择',
        notInUse: '未使用',
        webFetch: '网页抓取',
        webFetchDesc: 'web_fetch 的请求走出口节点。关掉后直接连接，切换立即生效。',
        shell: '命令行',
        shellDesc: 'Harness 启动的 curl、git、npm 等子进程继承代理，只影响新启动的命令。若「其他插件」已开启，子进程同样会被代理，此开关无法关闭。',
        plugins: '其他插件',
        pluginsDesc: '把代理写进 $DSH_HOME/.env，在同一 Harness 下对所有插件的请求生效；下次启动 Harness 才生效。开启后子进程也会一并走代理，命令行开关无法将其关闭。',
        llm: '大模型',
        llmDesc: 'LLM 和账号请求是否也走出口。默认直连，自动识别你在供应商配置里填的 API。需要重启 Harness 生效。',
        llmHint: '开启前请确认出口节点能访问该 API，否则模型将无法工作。',
        llmEndpointsAuto: '自动识别',
        llmEndpointsCount: '{count} 个 API',
        llmNoEndpointWarn: '未识别到大模型 API：开启「其他插件」后，大模型请求可能被一并送进出口节点而连不上。请确认供应商已配置，或在「高级」里手动填写直连域名。',
        llmCopyDetail: '复制详情',
        llmRetryProbe: '重新预检',
        llmProbeUnreachable: '出口节点无法访问该大模型端点，已保持直连。请确认出口节点所在网络能到达该地址（内网地址通常不能）。',
        llmProbeUnknown: '未能从供应商配置识别到大模型端点，本次未做预检。请确认已在设置中配置供应商，或在「高级」里手动填写直连域名。',
        deviceName: '设备名',
        localPort: '本地端口',
        apply: '应用',
        applying: '应用中…',
        stateDir: '状态目录',
        setWizard: '设置向导',
        rerun: '重新运行',
        running: '运行中',
        needsLogin: '需要登录',
        starting: '启动中',
        failed: '启动失败',
        daemonExited: '已退出',
        external: '外部代理',
        externalUnreachable: '外部代理不可达',
        disabled: '已停用',
        unsupported: '不支持',
        unknown: '未知',
        reading: '读取中',
        localProxy: '本地代理',
        exitIp: '出口 IP',
        directIp: '直连 IP',
        untested: '未测试',
        testExit: '测试出口',
        testing: '测试中…',
        restartProxy: '重启代理',
        restarting: '重启中…',
        copyDiag: '复制诊断',
        copied: '已复制',
        notTestedYet: '尚未测试出口',
        lastTested: '上次测试：{time}',
        loginRequired: '需要登录 · 打开登录页',
        requestFailed: '请求失败',
        portFailed: '端口设置失败',
        settingsFailed: '设置失败',
        authKeyFailed: 'Auth Key 登录失败',
        testFailed: '测试失败',
        enableLabel: '启用 Tailtransit',
        exitSwitchLabel: '使用出口节点',
        policyLabel: '失败策略',
        wizardSub: '首次设置 · 大约 1 分钟',
        step1: '连接',
        step2: '出口',
        step3: '范围',
        later: '稍后',
        connectTitle: '连接 Tailscale',
        connectDesc: '使用独立用户态实例加入 tailnet，不影响系统上的 Tailscale 服务。',
        connected: '已连接',
        notFoundDarwin: '未找到 Tailscale。请先执行 brew install tailscale（或安装官方客户端）后重试。',
        notFound: '未找到 Tailscale，请先安装客户端后重试。',
        waitingAuth: '等待授权…',
        loginInBrowser: '在浏览器中登录',
        useAuthKey: '使用 Auth Key',
        loginWithKey: '用 Key 登录',
        loggingIn: '登录中…',
        loginOnce: '登录只需一次；凭据保存在本机状态目录，不会上传。',
        openLogin: '打开登录页',
        next: '下一步',
        prev: '上一步',
        finish: '完成',
        exitTitle: '选择出口节点',
        exitDesc: 'Harness 的公网请求从这台节点出去；也可以只访问 tailnet 内网。',
        noExitNode: '不使用出口节点',
        tailnetOnly: '只访问 tailnet',
        scopeTitle: '代理范围与策略',
        scopeDesc: 'web_fetch 与 shell 默认开启，这里决定其他插件和失败策略。',
        writeEnv: '写入 .env（下次启动生效）',
        noWriteEnv: '不写入 .env',
        doneTitle: '设置完成',
        doneDesc: 'Tailtransit 已连接到你的 tailnet。',
        summaryDevice: '设备',
        summaryExit: '出口',
        summaryScope: '范围',
        scopeFull: 'web_fetch + shell + 插件',
        scopeBase: 'web_fetch + shell',
        openPanel: '打开面板',
      },
      en: {
        langName: 'EN',
        subtitle: 'Harness traffic only · dedicated userspace instance',
        cardConnection: 'Connection',
        cardTraffic: 'Traffic',
        cardAdvanced: 'Advanced',
        cardStatus: 'Status',
        cardActions: 'Actions',
        exitNode: 'Exit node',
        onFailure: 'On failure',
        policyDirect: 'Fall back',
        policyBlock: 'Block',
        noNodes: 'No nodes available',
        offlineSuffix: ' · offline',
        notSelected: 'None selected',
        notInUse: 'Not in use',
        webFetch: 'Web fetch',
        webFetchDesc: 'web_fetch requests use the exit node. Turned off, they connect directly — the switch takes effect immediately.',
        shell: 'Shell',
        shellDesc: 'Child processes Harness starts (curl, git, npm) inherit the proxy. Only affects newly started commands. When Other plugins is on, children are proxied too and this switch cannot turn that off.',
        plugins: 'Other plugins',
        pluginsDesc: 'Writes the proxy into $DSH_HOME/.env, covering requests from every plugin under the same Harness. Takes effect the next time Harness starts. Once on, child processes are proxied too and the Shell switch cannot turn that off.',
        llm: 'LLM',
        llmDesc: 'Whether LLM and account requests also use the exit node. Direct by default, with the APIs you configured in the provider settings discovered automatically. Needs a Harness restart.',
        llmHint: 'Before turning this on, confirm the exit node can reach that API. If it cannot, the model stops working.',
        llmEndpointsAuto: 'AUTO',
        llmEndpointsCount: '{count} API',
        llmCopyDetail: 'Copy details',
        llmRetryProbe: 'Probe again',
        llmNoEndpointWarn: 'No LLM API detected: with Other plugins on, model requests may be routed to the exit node and fail. Configure a provider, or list the domain manually under Advanced.',
        llmProbeUnreachable: 'The exit node cannot reach this API, so it stays direct and the switch was not turned on.',
        llmProbeUnknown: 'No LLM endpoint could be discovered from the provider settings, so this change was not preflighted. Configure a provider, or list the domain manually under Advanced.',
        deviceName: 'Device name',
        localPort: 'Local port',
        apply: 'Apply',
        applying: 'Applying…',
        stateDir: 'State directory',
        setWizard: 'Setup wizard',
        rerun: 'Run again',
        running: 'Running',
        needsLogin: 'Needs login',
        starting: 'Starting',
        failed: 'Failed to start',
        daemonExited: 'Daemon exited',
        external: 'External proxy',
        externalUnreachable: 'External proxy unreachable',
        disabled: 'Disabled',
        unsupported: 'Unsupported',
        unknown: 'Unknown',
        reading: 'Loading',
        localProxy: 'Local proxy',
        exitIp: 'Exit IP',
        directIp: 'Direct IP',
        untested: 'Not tested',
        testExit: 'Test exit',
        testing: 'Testing…',
        restartProxy: 'Restart proxy',
        restarting: 'Restarting…',
        copyDiag: 'Copy diagnostics',
        copied: 'Copied',
        notTestedYet: 'Exit not tested yet',
        lastTested: 'Last tested: {time}',
        loginRequired: 'Login required · open sign-in page',
        requestFailed: 'Request failed',
        portFailed: 'Could not set port',
        settingsFailed: 'Could not save settings',
        authKeyFailed: 'Auth key login failed',
        testFailed: 'Test failed',
        enableLabel: 'Enable Tailtransit',
        exitSwitchLabel: 'Use exit node',
        policyLabel: 'Failure policy',
        wizardSub: 'First-run setup · about a minute',
        step1: 'Connect',
        step2: 'Exit',
        step3: 'Scope',
        later: 'Later',
        connectTitle: 'Connect to Tailscale',
        connectDesc: 'Joins the tailnet with its own userspace instance, leaving the system Tailscale service untouched.',
        connected: 'Connected',
        notFoundDarwin: 'Tailscale not found. Run brew install tailscale (or install the official client), then retry.',
        notFound: 'Tailscale not found. Install the client, then retry.',
        waitingAuth: 'Waiting for approval…',
        loginInBrowser: 'Sign in with a browser',
        useAuthKey: 'Use an auth key',
        loginWithKey: 'Sign in with key',
        loggingIn: 'Signing in…',
        loginOnce: 'You sign in once; credentials stay in the local state directory and are never uploaded.',
        openLogin: 'Open sign-in page',
        next: 'Next',
        prev: 'Back',
        finish: 'Finish',
        exitTitle: 'Choose an exit node',
        exitDesc: 'Harness public requests leave through this node; you can also reach the tailnet only.',
        noExitNode: 'No exit node',
        tailnetOnly: 'Tailnet only',
        scopeTitle: 'Scope and failure policy',
        scopeDesc: 'web_fetch and shell are on by default; this decides other plugins and what happens on failure.',
        writeEnv: 'Write to .env (applies on next start)',
        noWriteEnv: 'Do not write .env',
        doneTitle: 'Setup complete',
        doneDesc: 'Tailtransit is connected to your tailnet.',
        summaryDevice: 'Device',
        summaryExit: 'Exit',
        summaryScope: 'Scope',
        scopeFull: 'web_fetch + shell + plugins',
        scopeBase: 'web_fetch + shell',
        openPanel: 'Open panel',
      },
    }

    const LANG_KEY = 'dsh-tailtransit-lang'

    function detectLang() {
      try {
        const saved = localStorage.getItem(LANG_KEY)
        if (saved === 'zh' || saved === 'en') return saved
      } catch {}
      const nav = typeof navigator !== 'undefined' && navigator.language ? navigator.language : ''
      return /^zh\b/i.test(nav) ? 'zh' : 'en'
    }

    function makeT(lang) {
      const dict = STRINGS[lang] || STRINGS.zh
      return function t(key, vars) {
        const raw = dict[key] != null ? dict[key] : (STRINGS.zh[key] != null ? STRINGS.zh[key] : key)
        if (!vars) return raw
        return raw.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] != null ? String(vars[name]) : whole))
      }
    }

    function stateKey(state) {
      switch (state) {
        case 'Running': return 'running'
        case 'NeedsLogin': return 'needsLogin'
        case 'starting': return 'starting'
        case 'failed': return 'failed'
        case 'daemon-exited': return 'daemonExited'
        case 'external': return 'external'
        case 'external-unreachable': return 'externalUnreachable'
        case 'disabled': return 'disabled'
        case 'unsupported': return 'unsupported'
        default: return 'unknown'
      }
    }

    function stateText(t, state) {
      const key = stateKey(state)
      if (key === 'unknown') return state || t('unknown')
      return t(key)
    }

    /** Segmented language control; the active choice is persisted. */
    function LangSwitch(props) {
      const build = (code) => h('button', {
        key: code,
        className: props.lang === code ? 'on' : '',
        'aria-pressed': String(props.lang === code),
        onClick: () => props.onChange(code),
      }, STRINGS[code].langName)
      return h('div', { className: 'tse-lang', role: 'group', 'aria-label': 'Language / 语言' },
        build('zh'), build('en'))
    }

    function tone(state, enabled) {
      if (!enabled) return 'err'
      if (state === 'Running' || state === 'external') return 'ok'
      if (state === 'starting' || state === 'NeedsLogin' || state === 'external-unreachable') return 'warn'
      if (state === 'failed' || state === 'daemon-exited' || state === 'unsupported') return 'err'
      return 'idle'
    }

    function Panel() {
      const [status, setStatus] = useState(null)
      const [settings, setSettings] = useState(null)
      const rootRef = useRef(null)
      const [port, setPort] = useState('')
      const [copied, setCopied] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [test, setTest] = useState(null)
      const [testedAt, setTestedAt] = useState('')
      const [step, setStep] = useState(1)
      const [wizardOpen, setWizardOpen] = useState(false)
      const [authKey, setAuthKey] = useState('')
      const [device, setDevice] = useState('')
      const [showKey, setShowKey] = useState(false)
      const [wizardBusy, setWizardBusy] = useState('')
      const [lang, setLang] = useState(detectLang)
      const [endpointsOpen, setEndpointsOpen] = useState(false)
      const [llmFault, setLlmFault] = useState(null)
      const t = makeT(lang)

      // Collapsed by default: the list is a detail, not the headline. Derived
      // from settings each render so a settings reload cannot leave a stale
      // list behind.
      const endpointList = Array.isArray(settings && settings.llmEndpoints) ? settings.llmEndpoints : []
      const copyLlmFault = () => {
        if (!llmFault) return
        const text = `${llmFault.host}${llmFault.detail ? ` \u00B7 ${llmFault.detail}` : ''}`
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(text))
          .then(() => setCopied(t('copied')))
          .catch(() => setError(text))
      }

      const changeLang = useCallback((next) => {
        setLang(next)
        try { localStorage.setItem(LANG_KEY, next) } catch {}
      }, [])

      const apply = useCallback((body) => {
        if (!body || body.ok !== true) throw new Error((body && body.error) || t('requestFailed'))
        setStatus(body.status)
        setError('')
      }, [])

      const load = useCallback(async () => {
        try {
          const response = await fetch(`${API}/status`, { headers: { accept: 'application/json' } })
          apply(await response.json())
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        }
      }, [apply])

      useEffect(() => {
        const fit = () => {
          const el = rootRef.current
          if (!el) return
          const top = el.getBoundingClientRect().top
          el.style.height = `${Math.max(240, window.innerHeight - top - 12)}px`
        }
        const frame = requestAnimationFrame(fit)
        window.addEventListener('resize', fit)
        return () => {
          cancelAnimationFrame(frame)
          window.removeEventListener('resize', fit)
        }
      }, [])

      useEffect(() => {
        load()
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [load])

      const loadSettings = useCallback(async () => {
        try {
          const response = await fetch(`${API}/settings`, { headers: { accept: 'application/json' } })
          const body = await response.json()
          if (body.ok) {
            setSettings(body.settings)
            setPort(String(body.settings.proxyPort))
            setDevice((prev) => prev || body.settings.hostname || '')
          }
        } catch {}
      }, [])

      useEffect(() => { loadSettings() }, [loadSettings])

      useEffect(() => {
        if (!settings || settings.onboarded) return
        if ((status && status.state === 'NeedsLogin') || settings.installed === false) setWizardOpen(true)
      }, [settings, status])

      const applyPort = async () => {
        const value = Number(port)
        if (!Number.isInteger(value)) return
        setBusy('port')
        try {
          const response = await fetch(`${API}/settings?proxyPort=${value}`, { method: 'POST' })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error || t('portFailed'))
          setStatus(body.status)
          await loadSettings()
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const envAction = async (state) => {
        setBusy('env')
        try {
          const response = await fetch(`${API}/settings?envProxy=${state === 'on' ? '1' : '0'}`, { method: 'POST' })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error || t('settingsFailed'))
          await loadSettings()
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const flagAction = async (name, value) => {
        setBusy(name)
        try {
          const response = await fetch(`${API}/settings?${name}=${value ? '1' : '0'}`, { method: 'POST' })
          const body = await response.json()
          if (!body.ok) {
            // A refused preflight belongs beside the switch it refused, not in
            // the panel-wide error line: the detail names the host and the
            // transport failure, which is what the user needs to act on.
            if (name === 'llmProxy' && body.code === 'LLM_PROXY_UNREACHABLE') {
              const first = Array.isArray(body.failures) && body.failures.length > 0 ? body.failures[0] : null
              setLlmFault({
                host: (first && first.host) || endpointList[0] || '',
                detail: (first && first.error) || body.error || '',
              })
              setError('')
              return
            }
            throw new Error(body.error || t('settingsFailed'))
          }
          setLlmFault(null)
          await loadSettings()
          if (body.warning === 'LLM_ENDPOINT_UNKNOWN') setError(t('llmProbeUnknown'))
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const copyDiag = async () => {
        try {
          const [diag, current] = await Promise.all([
            fetch(`${API}/diag`).then((r) => r.json()),
            fetch(`${API}/status`).then((r) => r.json()),
          ])
          const text = JSON.stringify({ diag, status: current.status, settings }, null, 2)
          await navigator.clipboard.writeText(text)
          setCopied(t('copied'))
          setTimeout(() => setCopied(''), 1600)
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        }
      }

      const set = async (patch, key) => {
        setBusy(key)
        try {
          const query = new URLSearchParams()
          for (const [name, value] of Object.entries(patch)) query.set(name, String(value))
          const response = await fetch(`${API}/set?${query.toString()}`, { method: 'POST' })
          apply(await response.json())
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const startLogin = async () => {
        setWizardBusy('login')
        try {
          const response = await fetch(`${API}/login`, { method: 'POST' })
          const body = await response.json()
          const url = (body && body.status && body.status.loginUrl) || (status && status.loginUrl)
          if (url) window.open(url, '_blank', 'noreferrer')
          await load()
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setWizardBusy('')
        }
      }

      const submitKey = async () => {
        setWizardBusy('key')
        try {
          const response = await fetch(`${API}/authkey`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: authKey.trim(), hostname: device.trim() }),
          })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error || t('authKeyFailed'))
          if (body.status) setStatus(body.status)
          await load()
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setWizardBusy('')
        }
      }

      const completeOnboarding = async () => {
        try {
          await fetch(`${API}/settings?onboarded=1`, { method: 'POST' })
          setWizardOpen(false)
          await loadSettings()
        } catch {}
      }

      const reopenOnboarding = async () => {
        try {
          await fetch(`${API}/settings?onboarded=0`, { method: 'POST' })
          await loadSettings()
          setStep(1)
          setWizardOpen(true)
        } catch {}
      }

      const runTest = async () => {
        setBusy('test')
        try {
          const response = await fetch(`${API}/test`, { method: 'POST' })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error || t('testFailed'))
          setTest(body.test)
          setTestedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
          setError(body.test.error || '')
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const restart = async () => {
        setBusy('restart')
        try {
          const response = await fetch(`${API}/restart`, { method: 'POST' })
          apply(await response.json())
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy('')
        }
      }

      const s = status
      const enabled = Boolean(s && s.enabled)
      const exitOn = Boolean(s && s.exitNodeEnabled)
      const exitName = s && s.exitNode ? s.exitNode.name : (s && s.configuredExitNode) || ''
      const nodes = (s && s.availableExitNodes) || []
      const options = nodes.slice()
      if (s && s.configuredExitNode && !options.some((node) => node.ip === s.configuredExitNode)) {
        options.push({ name: s.configuredExitNode, ip: s.configuredExitNode, online: true })
      }
      const selectValue = (s && s.configuredExitNode) || (options[0] && options[0].ip) || ''
      const policy = (s && s.failurePolicy) || 'direct'
      const proxyLabel = s && s.proxyUrl ? s.proxyUrl.replace(/^https?:\/\//, '') : '127.0.0.1:18888'

      if (wizardOpen && settings && !settings.onboarded) {
        const stepChip = (n, name) => h('div', { className: `tse-step${step === n ? ' on' : ''}${step > n ? ' done' : ''}` },
          h('span', { className: 'n' }, step > n ? '✓' : String(n)),
          name)
        const stepper = h('div', { className: 'tse-steps' },
          stepChip(1, t('step1')), h('span', { className: `bar${step > 1 ? ' done' : ''}` }),
          stepChip(2, t('step2')), h('span', { className: `bar${step > 2 ? ' done' : ''}` }),
          stepChip(3, t('step3')))
        const header = h('header', { className: 'tse-head' },
          h('div', { className: 'tse-logo' }, h(Icon, { size: 21 })),
          h('div', { className: 'tse-titles' },
            h('div', { className: 'tse-title' }, 'Tailtransit'),
            h('div', { className: 'tse-sub' }, t('wizardSub'))),
          h(LangSwitch, { lang, onChange: changeLang }),
          h('button', { className: 'tse-btn ghost', onClick: completeOnboarding }, t('later')))

        const connected = Boolean(s && s.state === 'Running')
        const nodeList = options.map((node) => h('button', {
          key: node.ip,
          className: `tse-node${selectValue === node.ip ? ' on' : ''}`,
          onClick: () => set({ exitNode: node.ip }, 'node'),
        },
          h('span', null, node.name),
          h('span', { className: 'tse-node-ip' }, `${node.ip}${node.online === false ? t('offlineSuffix') : ''}`)))

        const stepOne = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, t('connectTitle')),
          h('p', { className: 'tse-wiz-desc' }, t('connectDesc')),
          h('div', { className: 'tse-state' },
            h('span', { className: `tse-dot ${connected ? 'ok' : 'warn'}` }),
            connected ? t('connected') : (s ? stateText(t, s.state) : t('reading'))),
          settings.installed === false
            ? h('div', { className: 'tse-error' },
                settings.platform === 'darwin'
                  ? t('notFoundDarwin')
                  : t('notFound'))
            : null,
          h('div', { className: 'tse-actions' },
            h('button', {
              className: 'tse-btn primary',
              disabled: wizardBusy !== '' || connected,
              onClick: startLogin,
            }, wizardBusy === 'login' ? t('waitingAuth') : t('loginInBrowser')),
            h('button', { className: 'tse-btn', disabled: wizardBusy !== '', onClick: () => setShowKey(!showKey) }, t('useAuthKey'))),
          showKey
            ? h('div', { className: 'tse-keybox' },
                h('input', {
                  className: 'tse-input wide',
                  type: 'password',
                  placeholder: 'tskey-auth-…',
                  value: authKey,
                  onChange: (event) => setAuthKey(event.target.value),
                }),
                h('div', { className: 'tse-actions' },
                  h('button', {
                    className: 'tse-btn',
                    disabled: wizardBusy !== '' || !authKey.trim(),
                    onClick: submitKey,
                  }, wizardBusy === 'key' ? t('loggingIn') : t('loginWithKey'))))
            : null,
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, t('deviceName')),
            h('div', { className: 'tse-controls' },
              h('input', {
                className: 'tse-input',
                value: device,
                placeholder: 'dsh-pc',
                onChange: (event) => setDevice(event.target.value),
              }))),
          h('div', { className: 'tse-wiz-note' }, t('loginOnce')),
          s && s.loginUrl && !connected
            ? h('div', { className: 'tse-login' }, h('a', { href: s.loginUrl, target: '_blank', rel: 'noreferrer' }, t('openLogin')))
            : null,
          h('div', { className: 'tse-wiz-foot' },
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', disabled: !connected, onClick: () => setStep(2) }, t('next'))))

        const stepTwo = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, t('exitTitle')),
          h('p', { className: 'tse-wiz-desc' }, t('exitDesc')),
          h('div', { className: 'tse-nodes' },
            nodeList,
            h('button', {
              className: `tse-node${selectValue === '' ? ' on' : ''}`,
              onClick: () => set({ exitNode: '' }, 'node'),
            },
              h('span', null, t('noExitNode')),
              h('span', { className: 'tse-node-ip' }, t('tailnetOnly')))),
          h('div', { className: 'tse-wiz-foot' },
            h('button', { className: 'tse-btn ghost', onClick: () => setStep(1) }, t('prev')),
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', onClick: () => setStep(3) }, t('next'))))

        const stepThree = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, t('scopeTitle')),
          h('p', { className: 'tse-wiz-desc' }, t('scopeDesc')),
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, t('plugins')),
            h('div', { className: 'tse-controls' },
              h('button', {
                className: `tse-switch${settings.envProxy ? ' on' : ''}`,
                role: 'switch',
                'aria-checked': String(settings.envProxy),
                disabled: busy !== '',
                onClick: () => envAction(settings.envProxy ? 'off' : 'on'),
              }),
              h('span', { className: 'tse-mini' }, settings.envProxy ? t('writeEnv') : t('noWriteEnv')))),
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, t('onFailure')),
            h('div', { className: 'tse-controls' },
              h('div', { className: 'tse-seg' },
                h('button', { className: policy === 'direct' ? 'on' : '', onClick: () => set({ policy: 'direct' }, 'policy') }, t('policyDirect')),
                h('button', { className: policy === 'block' ? 'on' : '', onClick: () => set({ policy: 'block' }, 'policy') }, t('policyBlock'))))),
          h('div', { className: 'tse-wiz-foot' },
            h('button', { className: 'tse-btn ghost', onClick: () => setStep(2) }, t('prev')),
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', onClick: () => setStep(4) }, t('finish'))))

        const stepDone = h('section', { className: 'tse-card' },
          h('div', { className: 'tse-done' },
            h('div', { className: 'big' }, h('span', { style: { fontSize: 22 } }, '✓')),
            h('h2', { className: 'tse-wiz-title' }, t('doneTitle')),
            h('p', { className: 'tse-wiz-desc' }, t('doneDesc')),
            h('div', { className: 'tse-summary' },
              h('div', null, h('b', null, t('summaryDevice')), device || settings.hostname || '—'),
              h('div', null, h('b', null, t('summaryExit')), selectValue ? (exitName || selectValue) : t('tailnetOnly')),
              h('div', null, h('b', null, t('summaryScope')), settings.envProxy ? t('scopeFull') : t('scopeBase'))),
            h('div', { className: 'tse-wiz-foot', style: { justifyContent: 'center' } },
              h('button', { className: 'tse-btn primary', onClick: completeOnboarding }, t('openPanel')))))

        return h('div', { ref: rootRef, className: 'tse-page' },
          header, stepper,
          step === 1 ? stepOne : step === 2 ? stepTwo : step === 3 ? stepThree : stepDone)
      }

      const kv = (label, value) => h('div', { className: 'tse-kv' },
        h('span', null, label),
        h('b', null, value))

      return h('div', { ref: rootRef, className: `tse-page${s && !enabled ? ' tse-off' : ''}` },
        h('header', { className: 'tse-head' },
          h('div', { className: 'tse-logo' }, h(Icon, { size: 21 })),
          h('div', { className: 'tse-titles' },
            h('div', { className: 'tse-title' }, 'Tailtransit'),
            h('div', { className: 'tse-sub' }, t('subtitle'))),
          h(LangSwitch, { lang, onChange: changeLang }),
          h('button', {
            className: `tse-switch${enabled ? ' on' : ''}`,
            role: 'switch',
            'aria-checked': String(enabled),
            'aria-label': t('enableLabel'),
            disabled: busy !== '',
            onClick: () => set({ enabled: !enabled }, 'master'),
          })),

        h('div', { className: 'tse-grid' },
          h('div', { className: 'tse-col' },
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, t('cardConnection')),
              h('div', { className: 'tse-row' },
                h('div', { className: 'tse-label' }, t('exitNode')),
                h('div', { className: 'tse-controls' },
                  h('button', {
                    className: `tse-switch${exitOn && enabled ? ' on' : ''}`,
                    role: 'switch',
                    'aria-checked': String(exitOn && enabled),
                    'aria-label': t('exitSwitchLabel'),
                    disabled: !enabled || busy !== '',
                    onClick: () => set({ exitNodeEnabled: !exitOn }, 'exit'),
                  }),
                  h('select', {
                    className: 'tse-select',
                    value: selectValue,
                    disabled: !enabled || !exitOn || busy !== '',
                    onChange: (event) => set({ exitNode: event.target.value }, 'node'),
                  },
                    options.length === 0
                      ? h('option', { value: '' }, t('noNodes'))
                      : options.map((node) => h('option', { key: node.ip, value: node.ip },
                          `${node.name}${node.online ? '' : t('offlineSuffix')}`))))),
              h('div', { className: 'tse-row' },
                h('div', { className: 'tse-label' }, t('onFailure')),
                h('div', { className: 'tse-controls' },
                  h('div', { className: 'tse-seg', role: 'group', 'aria-label': t('policyLabel') },
                    h('button', {
                      className: policy === 'direct' ? 'on' : '',
                      disabled: !enabled || busy !== '',
                      onClick: () => set({ policy: 'direct' }, 'policy'),
                    }, t('policyDirect')),
                    h('button', {
                      className: policy === 'block' ? 'on' : '',
                      disabled: !enabled || busy !== '',
                      onClick: () => set({ policy: 'block' }, 'policy'),
                    }, t('policyBlock')))))),
            settings
              ? h('section', { className: 'tse-card' },
                  h('h2', { className: 'tse-card-title' }, t('cardTraffic')),
                  h('div', { className: 'tse-row has-desc' },
                    h('div', { className: 'tse-label' }, t('webFetch')),
                    h('div', { className: 'tse-controls' },
                      h('button', {
                        className: `tse-switch${settings.webFetch ? ' on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.webFetch),
                        disabled: busy !== '',
                        onClick: () => flagAction('webFetch', !settings.webFetch),
                      })),
                    h('div', { className: 'tse-desc' },
                      t('webFetchDesc'))),
                  h('div', { className: 'tse-row has-desc' },
                    h('div', { className: 'tse-label' }, t('shell')),
                    h('div', { className: 'tse-controls' },
                      h('button', {
                        className: `tse-switch${settings.proxyShell ? ' on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.proxyShell),
                        disabled: busy !== '',
                        onClick: () => flagAction('proxyShell', !settings.proxyShell),
                      })),
                    h('div', { className: 'tse-desc' },
                      t('shellDesc'))),
                  h('div', { className: 'tse-row has-desc' },
                    h('div', { className: 'tse-label' }, t('plugins')),
                    h('div', { className: 'tse-controls' },
                      h('button', {
                        className: `tse-switch${settings.envProxy ? ' on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.envProxy),
                        disabled: busy !== '',
                        onClick: () => envAction(settings.envProxy ? 'off' : 'on'),
                      })),
                    h('div', { className: 'tse-desc' },
                      t('pluginsDesc'))),
                  h('div', { className: 'tse-row has-desc' },
                    h('div', { className: 'tse-label' }, t('llm')),
                    h('div', { className: 'tse-controls' },
                      h('button', {
                        className: `tse-switch${settings.llmProxy ? ' on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.llmProxy),
                        disabled: busy !== '',
                        onClick: () => flagAction('llmProxy', !settings.llmProxy),
                      })),
                    h('div', { className: 'tse-desc' },
                      t('llmDesc'),
                      // The caution is a precondition, not more feature copy, so it
                      // gets its own line instead of running inside the paragraph.
                      settings.llmProxy
                        ? null
                        : h('div', { className: 'tse-hint' },
                            h('span', { className: 'tse-hint-ico' }, '\u26A0'),
                            h('span', null, t('llmHint'))),
                      endpointList.length > 0
                        ? h('button', {
                            className: `tse-toggle${endpointsOpen ? ' open' : ''}`,
                            type: 'button',
                            'aria-expanded': String(endpointsOpen),
                            disabled: busy !== '',
                            onClick: () => setEndpointsOpen(!endpointsOpen),
                          },
                            h('span', { className: 'tse-tag' }, t('llmEndpointsAuto')),
                            h('span', { className: 'tse-count' }, t('llmEndpointsCount', { count: endpointList.length })),
                            h('span', { className: 'tse-chev' }, '\u25B6'))
                        : (settings.envProxy
                            ? h('div', { className: 'tse-hint tse-hint-warn' },
                                h('span', { className: 'tse-hint-ico' }, '\u26A0'),
                                h('span', null, t('llmNoEndpointWarn')))
                            : null),
                      endpointsOpen && endpointList.length > 0
                        ? h('div', { className: 'tse-panel' },
                            endpointList.map((host) => h('span', { key: host, className: 'tse-chip' }, host)))
                        : null,
                      llmFault
                        ? h('div', { className: 'tse-alert', role: 'alert' },
                            h('span', { className: 'tse-alert-ico' }, '\u26A0'),
                            h('div', { className: 'tse-alert-body' },
                              h('div', { className: 'tse-alert-title' }, t('llmProbeUnreachable')),
                              h('div', { className: 'tse-alert-detail' },
                                `${llmFault.host}${llmFault.detail ? ` \u00B7 ${llmFault.detail}` : ''}`),
                              h('div', { className: 'tse-alert-actions' },
                                h('span', { className: 'tse-link', onClick: copyLlmFault }, t('llmCopyDetail')),
                                h('span', { className: 'tse-link', onClick: () => flagAction('llmProxy', true) }, t('llmRetryProbe')))))
                        : null)))
              : null,
            settings
              ? h('section', { className: 'tse-card' },
                  h('h2', { className: 'tse-card-title' }, t('cardAdvanced')),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, t('deviceName')),
                    h('div', { className: 'tse-controls' },
                      h('span', { className: 'tse-readonly' }, settings.hostname || '—'))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, t('localPort')),
                    h('div', { className: 'tse-controls' },
                      h('input', {
                        className: 'tse-input',
                        type: 'number',
                        min: 1024,
                        max: 65535,
                        value: port,
                        disabled: busy !== '',
                        onChange: (event) => setPort(event.target.value),
                      }),
                      h('button', {
                        className: 'tse-btn',
                        disabled: busy !== '' || Number(port) === settings.proxyPort,
                        onClick: applyPort,
                      }, busy === 'port' ? t('applying') : t('apply')))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, t('stateDir')),
                    h('div', { className: 'tse-controls' },
                      h('span', { className: 'tse-readonly', title: settings.stateDir }, settings.stateDir))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, t('setWizard')),
                    h('div', { className: 'tse-controls' },
                      h('button', { className: 'tse-btn', onClick: reopenOnboarding }, t('rerun')))))
              : null),
          h('aside', { className: 'tse-col' },
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, t('cardStatus')),
              h('div', { className: 'tse-state' },
                h('span', { className: `tse-dot ${s ? tone(s.state, enabled) : 'idle'}` }),
                s ? stateText(t, s.state) : t('reading')),
              kv(t('exitNode'), enabled ? (exitOn ? (exitName || t('notSelected')) : t('notInUse')) : '—'),
              kv(t('localProxy'), enabled && s && s.proxyReady ? proxyLabel : '—'),
              kv(t('exitIp'), test && test.proxied ? test.proxied : t('untested')),
              kv(t('directIp'), test && test.direct ? test.direct : '—'),
              s && s.loginUrl
                ? h('div', { className: 'tse-login' },
                    h('a', { href: s.loginUrl, target: '_blank', rel: 'noreferrer' }, t('loginRequired')))
                : null),
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, t('cardActions')),
              h('div', { className: 'tse-actions' },
                h('button', { className: 'tse-btn primary wide', disabled: busy !== '' || !enabled, onClick: runTest }, busy === 'test' ? t('testing') : t('testExit')),
                h('button', { className: 'tse-btn wide', disabled: busy !== '', onClick: restart }, busy === 'restart' ? t('restarting') : t('restartProxy')),
                h('button', { className: 'tse-btn ghost wide', onClick: copyDiag }, copied || t('copyDiag'))),
              h('div', { className: 'tse-note' }, testedAt ? t('lastTested', { time: testedAt }) : t('notTestedYet'))))),

        s && s.lastError ? h('div', { className: 'tse-error' }, s.lastError) : null,
        error ? h('div', { className: 'tse-error' }, error) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          try {
            return require('styles').insert(css)
          } catch {
            const el = document.createElement('style')
            el.setAttribute('data-dsh-tailtransit', '')
            el.textContent = css
            document.head.appendChild(el)
            return () => el.remove()
          }
        })
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'tailtransit', order: 30, label: 'Tailtransit' }, Icon))
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'tailtransit' }, Panel))
      },
    }
  },
})
