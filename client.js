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
      .tse-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 0 16px; }
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
      .tse-card { padding: 18px 20px; border-radius: 14px; }
      .tse-card-title { margin: 0 0 6px; font-size: 11.5px; font-weight: 600; letter-spacing: .45px; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
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

    function stateText(state) {
      switch (state) {
        case 'Running': return '运行中'
        case 'NeedsLogin': return '需要登录'
        case 'starting': return '启动中'
        case 'failed': return '启动失败'
        case 'daemon-exited': return '已退出'
        case 'external': return '外部代理'
        case 'external-unreachable': return '外部代理不可达'
        case 'disabled': return '已停用'
        case 'unsupported': return '不支持'
        default: return state || '未知'
      }
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

      const apply = useCallback((body) => {
        if (!body || body.ok !== true) throw new Error((body && body.error) || '请求失败')
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
          if (!body.ok) throw new Error(body.error || '端口设置失败')
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
          if (!body.ok) throw new Error(body.error || '设置失败')
          await loadSettings()
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
          setCopied('已复制')
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
          if (!body.ok) throw new Error(body.error || 'Auth Key 登录失败')
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
          if (!body.ok) throw new Error(body.error || '测试失败')
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
          stepChip(1, '连接'), h('span', { className: `bar${step > 1 ? ' done' : ''}` }),
          stepChip(2, '出口'), h('span', { className: `bar${step > 2 ? ' done' : ''}` }),
          stepChip(3, '范围'))
        const header = h('header', { className: 'tse-head' },
          h('div', { className: 'tse-logo' }, h(Icon, { size: 21 })),
          h('div', { className: 'tse-titles' },
            h('div', { className: 'tse-title' }, 'Tailtransit'),
            h('div', { className: 'tse-sub' }, '首次设置 · 大约 1 分钟')),
          h('button', { className: 'tse-btn ghost', onClick: completeOnboarding }, '稍后'))

        const connected = Boolean(s && s.state === 'Running')
        const nodeList = options.map((node) => h('button', {
          key: node.ip,
          className: `tse-node${selectValue === node.ip ? ' on' : ''}`,
          onClick: () => set({ exitNode: node.ip }, 'node'),
        },
          h('span', null, node.name),
          h('span', { className: 'tse-node-ip' }, `${node.ip}${node.online === false ? ' · 离线' : ''}`)))

        const stepOne = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, '连接 Tailscale'),
          h('p', { className: 'tse-wiz-desc' }, '使用独立用户态实例加入 tailnet，不影响系统上的 Tailscale 服务。'),
          h('div', { className: 'tse-state' },
            h('span', { className: `tse-dot ${connected ? 'ok' : 'warn'}` }),
            connected ? '已连接' : (s ? stateText(s.state) : '读取中')),
          settings.installed === false
            ? h('div', { className: 'tse-error' },
                settings.platform === 'darwin'
                  ? '未找到 Tailscale。请先执行 brew install tailscale（或安装官方客户端）后重试。'
                  : '未找到 Tailscale，请先安装客户端后重试。')
            : null,
          h('div', { className: 'tse-actions' },
            h('button', {
              className: 'tse-btn primary',
              disabled: wizardBusy !== '' || connected,
              onClick: startLogin,
            }, wizardBusy === 'login' ? '等待授权…' : '在浏览器中登录'),
            h('button', { className: 'tse-btn', disabled: wizardBusy !== '', onClick: () => setShowKey(!showKey) }, '使用 Auth Key')),
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
                  }, wizardBusy === 'key' ? '登录中…' : '用 Key 登录')))
            : null,
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, '设备名'),
            h('div', { className: 'tse-controls' },
              h('input', {
                className: 'tse-input',
                value: device,
                placeholder: 'dsh-pc',
                onChange: (event) => setDevice(event.target.value),
              }))),
          h('div', { className: 'tse-wiz-note' }, '登录只需一次；凭据保存在本机状态目录，不会上传。'),
          s && s.loginUrl && !connected
            ? h('div', { className: 'tse-login' }, h('a', { href: s.loginUrl, target: '_blank', rel: 'noreferrer' }, '打开登录页'))
            : null,
          h('div', { className: 'tse-wiz-foot' },
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', disabled: !connected, onClick: () => setStep(2) }, '下一步')))

        const stepTwo = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, '选择出口节点'),
          h('p', { className: 'tse-wiz-desc' }, 'Harness 的公网请求从这台节点出去；也可以只访问 tailnet 内网。'),
          h('div', { className: 'tse-nodes' },
            nodeList,
            h('button', {
              className: `tse-node${selectValue === '' ? ' on' : ''}`,
              onClick: () => set({ exitNode: '' }, 'node'),
            },
              h('span', null, '不使用出口节点'),
              h('span', { className: 'tse-node-ip' }, '只访问 tailnet'))),
          h('div', { className: 'tse-wiz-foot' },
            h('button', { className: 'tse-btn ghost', onClick: () => setStep(1) }, '上一步'),
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', onClick: () => setStep(3) }, '下一步')))

        const stepThree = h('section', { className: 'tse-card' },
          h('h2', { className: 'tse-wiz-title' }, '代理范围与策略'),
          h('p', { className: 'tse-wiz-desc' }, 'web_fetch 与 shell 默认开启，这里决定其他插件和失败策略。'),
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, '其他插件'),
            h('div', { className: 'tse-controls' },
              h('button', {
                className: `tse-switch${settings.envProxy ? ' on' : ''}`,
                role: 'switch',
                'aria-checked': String(settings.envProxy),
                disabled: busy !== '',
                onClick: () => envAction(settings.envProxy ? 'off' : 'on'),
              }),
              h('span', { className: 'tse-mini' }, settings.envProxy ? '写入 .env（下次启动生效）' : '不写入 .env'))),
          h('div', { className: 'tse-row' },
            h('div', { className: 'tse-label' }, '失败时'),
            h('div', { className: 'tse-controls' },
              h('div', { className: 'tse-seg' },
                h('button', { className: policy === 'direct' ? 'on' : '', onClick: () => set({ policy: 'direct' }, 'policy') }, '自动直连'),
                h('button', { className: policy === 'block' ? 'on' : '', onClick: () => set({ policy: 'block' }, 'policy') }, '严格阻断')))),
          h('div', { className: 'tse-wiz-foot' },
            h('button', { className: 'tse-btn ghost', onClick: () => setStep(2) }, '上一步'),
            h('div', { className: 'grow' }),
            h('button', { className: 'tse-btn primary', onClick: () => setStep(4) }, '完成')))

        const stepDone = h('section', { className: 'tse-card' },
          h('div', { className: 'tse-done' },
            h('div', { className: 'big' }, h('span', { style: { fontSize: 22 } }, '✓')),
            h('h2', { className: 'tse-wiz-title' }, '设置完成'),
            h('p', { className: 'tse-wiz-desc' }, 'Tailtransit 已连接到你的 tailnet。'),
            h('div', { className: 'tse-summary' },
              h('div', null, h('b', null, '设备'), device || settings.hostname || '—'),
              h('div', null, h('b', null, '出口'), selectValue ? (exitName || selectValue) : '仅 tailnet'),
              h('div', null, h('b', null, '范围'), settings.envProxy ? 'web_fetch + shell + 插件' : 'web_fetch + shell')),
            h('div', { className: 'tse-wiz-foot', style: { justifyContent: 'center' } },
              h('button', { className: 'tse-btn primary', onClick: completeOnboarding }, '打开面板'))))

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
            h('div', { className: 'tse-title' }, 'Tailtransit')),
          h('button', {
            className: `tse-switch${enabled ? ' on' : ''}`,
            role: 'switch',
            'aria-checked': String(enabled),
            'aria-label': '启用 Tailtransit',
            disabled: busy !== '',
            onClick: () => set({ enabled: !enabled }, 'master'),
          })),

        h('div', { className: 'tse-grid' },
          h('div', { className: 'tse-col' },
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, '连接'),
              h('div', { className: 'tse-row' },
                h('div', { className: 'tse-label' }, '出口节点'),
                h('div', { className: 'tse-controls' },
                  h('button', {
                    className: `tse-switch${exitOn && enabled ? ' on' : ''}`,
                    role: 'switch',
                    'aria-checked': String(exitOn && enabled),
                    'aria-label': '使用出口节点',
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
                      ? h('option', { value: '' }, '没有可选节点')
                      : options.map((node) => h('option', { key: node.ip, value: node.ip },
                          `${node.name}${node.online ? '' : ' · 离线'}`))))),
              h('div', { className: 'tse-row' },
                h('div', { className: 'tse-label' }, '失败时'),
                h('div', { className: 'tse-controls' },
                  h('div', { className: 'tse-seg', role: 'group', 'aria-label': '失败策略' },
                    h('button', {
                      className: policy === 'direct' ? 'on' : '',
                      disabled: !enabled || busy !== '',
                      onClick: () => set({ policy: 'direct' }, 'policy'),
                    }, '自动直连'),
                    h('button', {
                      className: policy === 'block' ? 'on' : '',
                      disabled: !enabled || busy !== '',
                      onClick: () => set({ policy: 'block' }, 'policy'),
                    }, '严格阻断'))))),
            settings
              ? h('section', { className: 'tse-card' },
                  h('h2', { className: 'tse-card-title' }, '高级'),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, '设备名'),
                    h('div', { className: 'tse-controls' },
                      h('span', { className: 'tse-readonly' }, settings.hostname || '—'))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, '本地端口'),
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
                      }, busy === 'port' ? '应用中…' : '应用'))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, '状态目录'),
                    h('div', { className: 'tse-controls' },
                      h('span', { className: 'tse-readonly', title: settings.stateDir }, settings.stateDir))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, '启动环境'),
                    h('div', { className: 'tse-controls' },
                      h('button', {
                        className: `tse-switch${settings.envProxy ? ' on' : ''}`,
                        role: 'switch',
                        'aria-checked': String(settings.envProxy),
                        'aria-label': '写入 .env 代理',
                        disabled: busy !== '',
                        onClick: () => envAction(settings.envProxy ? 'off' : 'on'),
                      }),
                      h('span', { className: 'tse-mini' },
                        settings.envProxy ? '写入 .env（下次启动生效）' : '不写入 .env'))),
                  h('div', { className: 'tse-row' },
                    h('div', { className: 'tse-label' }, '设置向导'),
                    h('div', { className: 'tse-controls' },
                      h('button', { className: 'tse-btn', onClick: reopenOnboarding }, '重新运行'))))
              : null),
          h('aside', { className: 'tse-col' },
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, '状态'),
              h('div', { className: 'tse-state' },
                h('span', { className: `tse-dot ${s ? tone(s.state, enabled) : 'idle'}` }),
                s ? stateText(s.state) : '读取中'),
              kv('出口节点', enabled ? (exitOn ? (exitName || '未选择') : '未使用') : '—'),
              kv('本地代理', enabled && s && s.proxyReady ? proxyLabel : '—'),
              kv('出口 IP', test && test.proxied ? test.proxied : '未测试'),
              kv('直连 IP', test && test.direct ? test.direct : '—'),
              s && s.loginUrl
                ? h('div', { className: 'tse-login' },
                    h('a', { href: s.loginUrl, target: '_blank', rel: 'noreferrer' }, '需要登录 · 打开登录页'))
                : null),
            h('section', { className: 'tse-card' },
              h('h2', { className: 'tse-card-title' }, '操作'),
              h('div', { className: 'tse-actions' },
                h('button', { className: 'tse-btn primary wide', disabled: busy !== '' || !enabled, onClick: runTest }, busy === 'test' ? '测试中…' : '测试出口'),
                h('button', { className: 'tse-btn wide', disabled: busy !== '', onClick: restart }, busy === 'restart' ? '重启中…' : '重启代理'),
                h('button', { className: 'tse-btn ghost wide', onClick: copyDiag }, copied || '复制诊断')),
              h('div', { className: 'tse-note' }, testedAt ? `上次测试：${testedAt}` : '尚未测试出口')))),

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
