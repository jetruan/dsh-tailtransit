/**
 * dsh-tailtransit — Harness-scoped Tailscale egress.
 *
 * Tailscale on Windows is a machine-wide VPN: a TUN adapter, a default route
 * and system DNS. There is no per-process split tunneling, so a global exit
 * node and an existing VPN fight over the same routes.
 *
 * This plugin sidesteps the fight instead of isolating the service: it runs a
 * *second*, per-user `tailscaled` in userspace-networking mode (no TUN, no
 * routes, no system DNS) that only listens on a loopback SOCKS5/HTTP proxy.
 * The Harness then uses that proxy for its own web access and shell commands,
 * while the operating system — including any existing VPN — keeps its own routes.
 *
 * Two consumers are wired:
 *   1. a `ctx.web` fetch provider (`tailtransit`) so `web_fetch` goes
 *      through the proxy;
 *   2. the standard proxy variables in `process.env`, inherited by every shell
 *      command the Harness spawns (curl, git, pip, npm, node --use-env-proxy).
 *
 * LLM traffic stays direct: nothing here installs a global undici dispatcher
 * and the Harness launcher's own proxy policy is left untouched.
 *
 * @module dsh-tailtransit
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, hostname as osHostname } from 'node:os'
import path from 'node:path'
import { fetchThroughProxy } from './transport.js'

/**
 * Local stand-in for the web seam's `WebError`: profile-installed plugins
 * cannot resolve the bundled `@deepseek-ai/*` packages, and the seam only
 * reads `message` and the open-string `code`.
 */
class WebError extends Error {
  constructor(message, code = 'WEB_PROVIDER_ERROR', options) {
    super(message, options)
    this.name = 'WebError'
    this.code = code
  }
}

export const name = 'tailtransit'
export const inject = ['web', 'tools', 'webServer', 'clientModules']

const PROVIDER_ID = 'tailtransit'
const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    try { if (existsSync(candidate)) return candidate } catch {}
  }
  return fallback || candidates[0]
}

const TAILSCALED_CANDIDATES = IS_WINDOWS
  ? ['C:\\Program Files\\Tailscale\\tailscaled.exe']
  : IS_MAC
    ? ['/opt/homebrew/bin/tailscaled', '/usr/local/bin/tailscaled', '/opt/homebrew/sbin/tailscaled', '/usr/local/sbin/tailscaled']
    : ['/usr/bin/tailscaled', '/usr/sbin/tailscaled', '/usr/local/bin/tailscaled']

const TAILSCALE_CANDIDATES = IS_WINDOWS
  ? ['C:\\Program Files\\Tailscale\\tailscale.exe']
  : IS_MAC
    ? ['/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/sbin/tailscale', '/usr/local/sbin/tailscale']
    : ['/usr/bin/tailscale', '/usr/sbin/tailscale', '/usr/local/bin/tailscale']

const DEFAULT_TAILSCALED = firstExisting(TAILSCALED_CANDIDATES, TAILSCALED_CANDIDATES[0])
const DEFAULT_TAILSCALE = firstExisting(TAILSCALE_CANDIDATES, TAILSCALE_CANDIDATES[0])
const DEFAULT_PORT = 18888

function socketPathFor(stateDir) {
  return IS_WINDOWS ? '\\\\.\\pipe\\dsh-tailtransit' : path.join(stateDir, 'tailscaled.sock')
}
const DEFAULT_UA = 'deepseek-harness-tailtransit/0.1'

const ENV_MARKERS = [
  ['# >>> dsh-tailtransit', '# <<< dsh-tailtransit'],
  ['# >>> dsh-tailscale-egress', '# <<< dsh-tailscale-egress'],
]

function stripManagedEnv(content) {
  const kept = []
  let closing = null
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!closing) {
      const pair = ENV_MARKERS.find(([begin]) => trimmed === begin)
      if (pair) { closing = pair[1]; continue }
      kept.push(line)
    } else if (trimmed === closing) {
      closing = null
    }
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  return kept
}

const PROXY_ENV_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_USE_ENV_PROXY',
]

const DEFAULT_CONFIG = {
  tailscaledPath: DEFAULT_TAILSCALED,
  tailscalePath: DEFAULT_TAILSCALE,
  stateDir: '',
  proxyPort: DEFAULT_PORT,
  proxyUrl: '',
  exitNode: '',
  hostname: '',
  authKey: '',
  authKeyFile: '',
  proxyShell: true,
  fallbackToDirect: true,
  noProxy: 'localhost,127.0.0.1,::1,deepseek.com,deepseeksvc.com',
  enabled: true,
  failurePolicy: 'direct',
  exitNodeEnabled: true,
  envProxy: true,
  onboarded: false,
  startupTimeoutMs: 30000,
  timeoutMs: 30000,
  maxRedirects: 5,
  maxResponseBytes: 5000000,
  maxBodyChars: 100000,
  userAgent: DEFAULT_UA,
}

/**
 * No `Config` export: a profile-installed plugin cannot resolve the bundled
 * `@deepseek-ai/schemastery`, so the row's config is merged here instead.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const text = (value, fallback) => (typeof value === 'string' ? value : fallback)
  const number = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  return {
    tailscaledPath: text(source.tailscaledPath, DEFAULT_CONFIG.tailscaledPath),
    tailscalePath: text(source.tailscalePath, DEFAULT_CONFIG.tailscalePath),
    stateDir: text(source.stateDir, DEFAULT_CONFIG.stateDir),
    proxyPort: number(source.proxyPort, DEFAULT_CONFIG.proxyPort),
    proxyUrl: text(source.proxyUrl, DEFAULT_CONFIG.proxyUrl).trim(),
    exitNode: text(source.exitNode, DEFAULT_CONFIG.exitNode).trim(),
    hostname: text(source.hostname, DEFAULT_CONFIG.hostname),
    authKey: text(source.authKey, DEFAULT_CONFIG.authKey),
    authKeyFile: text(source.authKeyFile, DEFAULT_CONFIG.authKeyFile),
    proxyShell: bool(source.proxyShell, DEFAULT_CONFIG.proxyShell),
    fallbackToDirect: bool(source.fallbackToDirect, DEFAULT_CONFIG.fallbackToDirect),
    noProxy: text(source.noProxy, DEFAULT_CONFIG.noProxy),
    enabled: bool(source.enabled, DEFAULT_CONFIG.enabled),
    failurePolicy: text(source.failurePolicy, DEFAULT_CONFIG.failurePolicy) === 'block' ? 'block' : 'direct',
    exitNodeEnabled: bool(source.exitNodeEnabled, DEFAULT_CONFIG.exitNodeEnabled),
    envProxy: bool(source.envProxy, DEFAULT_CONFIG.envProxy),
    onboarded: bool(source.onboarded, DEFAULT_CONFIG.onboarded),
    startupTimeoutMs: number(source.startupTimeoutMs, DEFAULT_CONFIG.startupTimeoutMs),
    timeoutMs: number(source.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxRedirects: number(source.maxRedirects, DEFAULT_CONFIG.maxRedirects),
    maxResponseBytes: number(source.maxResponseBytes, DEFAULT_CONFIG.maxResponseBytes),
    maxBodyChars: number(source.maxBodyChars, DEFAULT_CONFIG.maxBodyChars),
    userAgent: text(source.userAgent, DEFAULT_CONFIG.userAgent),
  }
}

function noProxyList(config) {
  const list = String(config.noProxy || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  for (const base of ['localhost', '127.0.0.1', '::1']) {
    if (!list.includes(base)) list.unshift(base)
  }
  return list.join(',')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

async function readFileIfPresent(file) {
  if (!file) return ''
  try {
    return (await readFile(file, 'utf8')).trim()
  } catch {
    return ''
  }
}

function tcpReachable(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function runProcess(exe, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error) })
      return
    }
    let out = ''
    let err = ''
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, out, err })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish(-2)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out = (out + chunk).slice(-200000) })
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-200000) })
    child.on('error', (error) => { err += String(error); finish(-1) })
    child.on('close', (code) => finish(code ?? -1))
  })
}

/** Kill a stale daemon only when the PID still belongs to tailscaled.exe. */
async function killTailscaledPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (IS_WINDOWS) {
    const listing = await runProcess('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    if (!/tailscaled\.exe/i.test(listing.out)) return
    await runProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
    return
  }
  const stat = await runProcess('ps', ['-p', String(pid), '-o', 'comm='])
  if (!/tailscaled/i.test(stat.out)) return
  try { process.kill(pid, 'SIGTERM') } catch {}
  await sleep(500)
  try { process.kill(pid, 'SIGKILL') } catch {}
}

/* ------------------------------------------------------------------ */
/* Daemon supervision                                                  */
/* ------------------------------------------------------------------ */

class TailscaleEgress {
  constructor(config) {
    this.config = config
    this.stateDir = config.stateDir || path.join(dshHome(), 'tailtransit')
    this.socket = socketPathFor(this.stateDir)
    this.port = config.proxyPort
    this.pidFile = path.join(this.stateDir, 'daemon.pid')
    this.child = null
    this.upChild = null
    this.watchChild = null
    this.loginUrl = ''
    this.lastError = ''
    this.logTail = []
    this.info = null
    this.proxyReady = false
    this.backendState = 'starting'
    this.timer = null
    this.stopping = false
    this.external = Boolean(this.config.proxyUrl)
    this.savedEnv = null
    this.busy = false
    this.enabled = config.enabled !== false
    this.exitNodeEnabled = config.exitNodeEnabled !== false
    this.failurePolicy = config.failurePolicy === 'block' ? 'block' : 'direct'
    this.settingsFile = path.join(this.stateDir, 'config.json')
  }

  async init() {
    await this.migrateLegacyState()
    await this.loadFileConfig()
    this.enabled = this.config.enabled !== false
    this.failurePolicy = this.config.failurePolicy === 'block' ? 'block' : 'direct'
    this.exitNodeEnabled = this.config.exitNodeEnabled !== false
    if (!this.enabled) {
      this.backendState = 'disabled'
      await this.clearLauncherProxy()
      return
    }
    await this.start()
  }

  /**
   * Move the pre-rename state directory (`tailscale-egress`) to the new
   * `tailtransit` location once, so an existing login survives the rename.
   */
  async migrateLegacyState() {
    if (this.config.stateDir) return
    try { await access(this.stateDir); return } catch {}
    const legacy = path.join(dshHome(), 'tailscale-egress')
    try { await access(legacy) } catch { return }
    try {
      const pid = Number.parseInt((await readFile(path.join(legacy, 'daemon.pid'), 'utf8')).trim(), 10)
      if (Number.isInteger(pid) && pid > 0) {
        await killTailscaledPid(pid)
        await sleep(400)
      }
    } catch {}
    try { await cp(legacy, this.stateDir, { recursive: true }) } catch {}
    try { await rm(path.join(this.stateDir, 'daemon.pid'), { force: true }) } catch {}
  }

  async enable() {
    if (this.enabled && (this.child || this.external)) return
    this.enabled = true
    this.config.enabled = true
    await this.start()
    await this.saveSettings()
  }

  async disable() {
    this.enabled = false
    this.config.enabled = false
    await this.stop()
    this.backendState = 'disabled'
    await this.saveSettings()
    await this.clearLauncherProxy()
    const proxy = this.proxyUrl()
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      if (process.env[key] === proxy) delete process.env[key]
    }
  }

  proxyUrl() {
    if (this.config.proxyUrl) return this.config.proxyUrl
    return `http://127.0.0.1:${this.port}`
  }

  proxyEndpoint() {
    const url = new URL(this.proxyUrl())
    return { host: url.hostname, port: Number(url.port || 80) }
  }

  nodeName() {
    const configured = this.config.hostname.trim()
    if (configured) return configured
    const base = osHostname().replace(/[^A-Za-z0-9-]/g, '-').toLowerCase()
    return `dsh-${base}`.slice(0, 63)
  }

  async start() {
    this.stopping = false
    this.lastError = ''
    if (process.platform !== 'win32') {
      this.backendState = 'unsupported'
      this.lastError = 'Harness-scoped Tailscale egress is implemented for Windows only'
      return
    }
    try {
      await mkdir(this.stateDir, { recursive: true })
    } catch (error) {
      this.backendState = 'failed'
      this.lastError = `cannot create state directory ${this.stateDir}: ${error.message}`
      return
    }

    this.external = Boolean(this.config.proxyUrl)
    if (this.config.envProxy !== false) await this.writeLauncherProxy()
    else await this.clearLauncherProxy()
    if (this.external) {
      this.applyProcessEnv()
      const endpoint = this.proxyEndpoint()
      this.proxyReady = await tcpReachable(endpoint.port, endpoint.host)
      this.backendState = this.proxyReady ? 'external' : 'external-unreachable'
      if (!this.proxyReady) this.lastError = `external proxy ${this.proxyUrl()} is not reachable`
      this.timer = setInterval(() => {
        this.refresh().catch(() => {})
      }, 15000)
      return
    }

    await this.reapStaleDaemon()
    this.applyProcessEnv()
    this.spawnDaemon()
    this.timer = setInterval(() => {
      this.refresh().catch(() => {})
    }, 15000)

    await this.waitForProxy()
    this.startWatch()
    await this.ensureAuthenticated()
    await this.refresh()
  }

  applyProcessEnv() {
    if (!this.config.proxyShell || this.savedEnv) return
    this.savedEnv = {}
    for (const key of PROXY_ENV_KEYS) this.savedEnv[key] = process.env[key]
    const proxy = this.proxyUrl()
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      process.env[key] = proxy
    }
    const bypass = noProxyList(this.config)
    process.env.NO_PROXY = bypass
    process.env.no_proxy = bypass
    // Child Node processes (npx, pnpm, node scripts) read this at startup.
    // The current process already booted, so Harness/LLM traffic is unaffected.
    process.env.NODE_USE_ENV_PROXY = '1'
  }

  restoreProcessEnv() {
    if (!this.savedEnv) return
    for (const [key, value] of Object.entries(this.savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    this.savedEnv = null
  }

  /**
   * `<stateDir>/config.json` overrides the row config without editing the
   * profile patch. Only known keys are merged.
   */
  async loadFileConfig() {
    try {
      const raw = JSON.parse(await readFile(this.settingsFile, 'utf8'))
      if (raw !== null && typeof raw === 'object') {
        this.config = resolveConfig({ ...this.config, ...raw })
        this.port = this.config.proxyPort
      }
    } catch {}
  }

  async saveSettings() {
    let current = {}
    try {
      const parsed = JSON.parse(await readFile(this.settingsFile, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') current = parsed
    } catch {}
    const next = {
      ...current,
      enabled: Boolean(this.enabled),
      failurePolicy: this.failurePolicy,
      exitNode: this.config.exitNode || '',
      exitNodeEnabled: Boolean(this.exitNodeEnabled),
      proxyPort: this.port,
      envProxy: this.config.envProxy !== false,
      onboarded: Boolean(this.config.onboarded),
      hostname: this.config.hostname || '',
    }
    try {
      await mkdir(this.stateDir, { recursive: true })
      await writeFile(this.settingsFile, JSON.stringify(next, null, 2), 'utf8')
    } catch {}
  }

  /**
   * Make plugin-originated Node `fetch` use this proxy too, without touching
   * the LLM/account endpoints. The launcher reads `$DSH_HOME/.env` before the
   * first plugin loads and installs the process-wide dispatcher from it, so
   * this block takes effect on the next Harness start.
   */
  async writeLauncherProxy() {
    const envPath = path.join(dshHome(), '.env')
    let content = ''
    try { content = await readFile(envPath, 'utf8') } catch {}
    const begin = '# >>> dsh-tailtransit'
    const end = '# <<< dsh-tailtransit'
    const kept = stripManagedEnv(content)
    const proxy = this.proxyUrl()
    const noProxy = noProxyList(this.config)
    kept.push(begin, `HTTP_PROXY=${proxy}`, `HTTPS_PROXY=${proxy}`, `NO_PROXY=${noProxy}`, end, '')
    try {
      await mkdir(dshHome(), { recursive: true })
      await writeFile(envPath, kept.join('\n'), 'utf8')
    } catch {}
  }

  async clearLauncherProxy() {
    const envPath = path.join(dshHome(), '.env')
    let content = ''
    try { content = await readFile(envPath, 'utf8') } catch { return }
    const kept = stripManagedEnv(content)
    try { await writeFile(envPath, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf8') } catch {}
  }

  /** Kill a daemon left behind by an earlier Harness process before rebinding. */
  async reapStaleDaemon() {
    try {
      const pid = Number.parseInt((await readFile(this.pidFile, 'utf8')).trim(), 10)
      if (Number.isInteger(pid) && pid > 0) {
        await killTailscaledPid(pid)
        await sleep(400)
      }
    } catch {}
    try { await rm(this.pidFile, { force: true }) } catch {}
  }

  /** Environment for tailscaled and its CLI: never inherit the loopback proxy. */
  cleanEnv() {
    const env = { ...process.env }
    for (const key of PROXY_ENV_KEYS) delete env[key]
    return env
  }

  /**
   * Windows tailscaled stops the backend when its last LocalAPI client
   * disconnects (the GUI normally holds that connection). A long-lived
   * `debug watch-ipn` subscription keeps the userspace node running.
   */
  startWatch() {
    if (this.watchChild || this.stopping) return
    let child
    try {
      child = spawn(this.config.tailscalePath, [`--socket=${this.socket}`, 'debug', 'watch-ipn'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: this.cleanEnv(),
      })
    } catch {
      return
    }
    this.watchChild = child
    child.stderr.on('data', (chunk) => this.onLog(chunk))
    child.on('error', () => { this.watchChild = null })
    child.on('exit', () => {
      this.watchChild = null
      if (!this.stopping) {
        const timer = setTimeout(() => this.startWatch(), 1000)
        timer.unref?.()
      }
    })
  }

  spawnDaemon() {
    const args = [
      '--tun=userspace-networking',
      ...(IS_WINDOWS ? ['--windows-mode=dev'] : []),
      '--port=0',
      `--statedir=${this.stateDir}`,
      `--socket=${this.socket}`,
      `--socks5-server=127.0.0.1:${this.port}`,
      `--outbound-http-proxy-listen=127.0.0.1:${this.port}`,
      '--no-logs-no-support',
      '--verbose=1',
    ]

    let child
    try {
      child = spawn(this.config.tailscaledPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.cleanEnv(),
      })
    } catch (error) {
      this.backendState = 'failed'
      this.lastError = `cannot spawn tailscaled: ${error.message}`
      return
    }

    this.child = child
    this.backendState = 'starting'
    if (child.pid) writeFile(this.pidFile, String(child.pid), 'utf8').catch(() => {})
    child.stdout.on('data', (chunk) => this.onLog(chunk))
    child.stderr.on('data', (chunk) => this.onLog(chunk))
    child.on('error', (error) => {
      this.backendState = 'failed'
      this.lastError = `tailscaled failed to start: ${error.message}`
    })
    child.on('exit', (code) => {
      this.proxyReady = false
      if (!this.stopping) {
        this.backendState = 'daemon-exited'
        if (!this.lastError) this.lastError = `tailscaled exited with code ${code}`
      }
    })
  }

  onLog(chunk) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.length === 0) continue
      this.logTail.push(line)
      if (this.logTail.length > 40) this.logTail.shift()
      const match = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/.exec(line)
      if (match) this.loginUrl = match[0]
    }
  }

  async waitForProxy() {
    const deadline = Date.now() + this.config.startupTimeoutMs
    while (!this.stopping && Date.now() < deadline) {
      if (await tcpReachable(this.port)) {
        this.proxyReady = true
        return
      }
      if (this.child && this.child.exitCode !== null) return
      await sleep(400)
    }
  }

  runCli(args, timeoutMs) {
    return new Promise((resolve) => {
      let child
      try {
        child = spawn(this.config.tailscalePath, [`--socket=${this.socket}`, ...args], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: this.cleanEnv(),
        })
      } catch (error) {
        resolve({ code: -1, out: '', err: String(error) })
        return
      }
      let out = ''
      let err = ''
      let settled = false
      const finish = (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, out, err })
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch {}
        finish(-2)
      }, timeoutMs)
      child.stdout.on('data', (chunk) => { out = (out + chunk).slice(-200000) })
      child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-200000) })
      child.on('error', (error) => { err += String(error); finish(-1) })
      child.on('close', (code) => finish(code ?? -1))
    })
  }

  async statusJson() {
    const result = await this.runCli(['status', '--json'], 8000)
    if (result.out.trim().length === 0) return null
    try {
      return JSON.parse(result.out)
    } catch {
      return null
    }
  }

  async resolveAuthKey() {
    if (this.config.authKey) return this.config.authKey
    const file = this.config.authKeyFile || path.join(this.stateDir, 'authkey')
    return readFileIfPresent(file) || process.env.TS_AUTHKEY || ''
  }

  /** Store an auth key for this per-user instance without writing it to config.json. */
  async setAuthKey(key) {
    await mkdir(this.stateDir, { recursive: true })
    const file = path.join(this.stateDir, 'authkey')
    await writeFile(file, key.trim(), { encoding: 'utf8', mode: 0o600 })
    this.config.authKey = ''
    this.config.authKeyFile = file
  }

  async ensureAuthenticated() {
    if (!this.proxyReady) return
    const status = await this.statusJson()
    if (status) {
      this.info = status
      this.backendState = status.BackendState || this.backendState
      if (status.AuthURL) this.loginUrl = status.AuthURL
      if (status.BackendState === 'Running') {
        this.lastError = ''
        await this.maybeApplyExitNode(status)
        return
      }
    }

    const key = await this.resolveAuthKey()
    if (key) {
      const args = ['up', `--hostname=${this.nodeName()}`, `--auth-key=${key}`]
      if (this.config.exitNode) args.push(`--exit-node=${this.config.exitNode}`)
      const result = await this.runCli(args, 120000)
      if (result.code !== 0) {
        this.lastError = (result.err || result.out || `tailscale up exited with code ${result.code}`).trim()
      }
      return
    }

    await this.beginLogin()
  }

  async beginLogin() {
    if (this.upChild) return
    const args = [`--socket=${this.socket}`, 'up', `--hostname=${this.nodeName()}`]
    if (this.config.exitNode) args.push(`--exit-node=${this.config.exitNode}`)

    let child
    try {
      child = spawn(this.config.tailscalePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.cleanEnv(),
      })
    } catch (error) {
      this.lastError = `cannot run tailscale up: ${error.message}`
      return
    }
    this.upChild = child
    let buffer = ''
    const onData = (chunk) => {
      buffer = (buffer + chunk.toString('utf8')).slice(-8192)
      this.onLog(chunk)
      const match = /https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/.exec(buffer)
      if (match) this.loginUrl = match[0]
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => {
      this.lastError = `tailscale up failed: ${error.message}`
    })
    child.on('exit', () => {
      this.upChild = null
      this.refresh().catch(() => {})
    })
  }

  async refresh() {
    if (this.stopping) return
    if (this.external) {
      const endpoint = this.proxyEndpoint()
      this.proxyReady = await tcpReachable(endpoint.port, endpoint.host)
      this.backendState = this.proxyReady ? 'external' : 'external-unreachable'
      return
    }
    this.proxyReady = await tcpReachable(this.port)
    if (this.child && this.child.exitCode !== null) {
      if (this.backendState !== 'daemon-exited') this.backendState = 'daemon-exited'
      return
    }
    const status = await this.statusJson()
    if (!status) {
      if (this.proxyReady) this.backendState = 'starting'
      return
    }
    this.info = status
    this.backendState = status.BackendState || this.backendState
    if (status.AuthURL) this.loginUrl = status.AuthURL
    if (status.BackendState === 'Running') {
      this.lastError = ''
      await this.maybeApplyExitNode(status)
    }
  }

  /** Apply (or clear) the configured exit node once the node is authenticated. */
  async maybeApplyExitNode(status) {
    if (status.BackendState !== 'Running') return
    const desired = this.exitNodeEnabled ? (this.config.exitNode || '') : ''
    const currentIp = (status.ExitNodeStatus?.TailscaleIPs ?? []).find((ip) => !ip.includes(':')) || ''
    if (desired === currentIp) return
    const result = await this.runCli(['set', `--exit-node=${desired}`], 30000)
    if (result.code === 0) {
      this.lastError = ''
      const updated = await this.statusJson()
      if (updated) this.info = updated
    } else {
      this.lastError = (result.err || result.out || `tailscale set exited with code ${result.code}`).trim()
    }
  }

  async stop() {
    this.stopping = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    try { this.upChild?.kill() } catch {}
    this.upChild = null
    try { this.watchChild?.kill() } catch {}
    this.watchChild = null
    const child = this.child
    this.child = null
    if (child) {
      try { child.kill() } catch {}
      if (child.pid) await killTailscaledPid(child.pid)
    }
    try { await rm(this.pidFile, { force: true }) } catch {}
    this.proxyReady = false
    this.backendState = 'stopped'
    this.restoreProcessEnv()
  }

  async restart() {
    if (this.busy) return
    this.busy = true
    try {
      await this.loadFileConfig()
      this.failurePolicy = this.config.failurePolicy === 'block' ? 'block' : 'direct'
      await this.stop()
      if (this.config.enabled === false) {
        this.enabled = false
        this.backendState = 'disabled'
        return
      }
      this.enabled = true
      await this.start()
    } finally {
      this.busy = false
    }
  }

  async statusPayload() {
    const peers = Object.values(this.info?.Peer ?? {})
    const current = this.info?.ExitNodeStatus
    const exitPeer = current ? peers.find((peer) => peer.ID === current.ID) : undefined
    const self = this.info?.Self
    const availableExitNodes = peers
      .filter((peer) => peer?.ExitNodeOption === true)
      .map((peer) => {
        const ips = Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : []
        return {
          id: peer.ID,
          name: peer.HostName || peer.DNSName || peer.ID,
          ip: ips.find((ip) => !ip.includes(':')) || '',
          online: peer.Online !== false,
        }
      })
      .filter((peer) => peer.ip)
    return {
      state: this.backendState,
      enabled: Boolean(this.enabled),
      proxyUrl: this.proxyUrl(),
      proxyReady: this.proxyReady,
      external: Boolean(this.external),
      failurePolicy: this.failurePolicy,
      exitNodeEnabled: Boolean(this.exitNodeEnabled),
      node: self
        ? {
            hostName: self.HostName || this.nodeName(),
            ips: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [],
          }
        : null,
      configuredExitNode: this.config.exitNode,
      exitNode: current
        ? { id: current.ID, name: exitPeer?.HostName || current.ID, online: current.Online !== false }
        : null,
      availableExitNodes,
      loginUrl: this.loginUrl,
      lastError: this.lastError,
      watch: Boolean(this.watchChild),
    }
  }

  /** Fetch a public IP echo through the proxy and directly, for the panel's self-check. */
  async testEgress() {
    const options = {
      timeoutMs: 15000,
      maxRedirects: 2,
      maxBytes: 100000,
      maxChars: 200,
      userAgent: this.config.userAgent,
    }
    const probe = 'https://ifconfig.me/ip'
    const result = { proxied: '', direct: '', error: '' }
    const proxyUrl = this.enabled && this.proxyReady ? this.proxyUrl() : undefined
    try {
      const proxied = await fetchThroughProxy(probe, { ...options, proxyUrl })
      result.proxied = proxied.body.content.trim()
    } catch (error) {
      result.error = error?.message ?? String(error)
    }
    try {
      const direct = await fetchThroughProxy(probe, { ...options, proxyUrl: undefined })
      result.direct = direct.body.content.trim()
    } catch {
      // The direct probe is informational; a failure here is not the panel's error.
    }
    return result
  }

  async describe(action) {
    if (action === 'restart') {
      await this.restart()
    }
    if (action === 'login' && this.backendState !== 'Running') {
      this.loginUrl = ''
      if (this.upChild) {
        try { this.upChild.kill() } catch {}
        this.upChild = null
      }
      await this.beginLogin()
      await sleep(1500)
      await this.refresh()
    }

    const lines = [
      `state: ${this.backendState}`,
      `proxy: ${this.proxyUrl()} ${this.proxyReady ? '(reachable)' : '(not reachable)'}`,
    ]
    if (this.external) {
      lines.push('mode: external proxy (no per-user tailscaled)')
      if (this.config.exitNode) lines.push(`exit node setting ignored in external proxy mode: ${this.config.exitNode}`)
      if (this.lastError) lines.push(`last error: ${this.lastError}`)
      return lines.join('\n')
    }
    if (this.child?.pid) lines.push(`daemon pid: ${this.child.pid}`)
    lines.push(`ipn watch: ${this.watchChild ? 'attached' : 'off'}`)
    const self = this.info?.Self
    if (self) {
      const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.join(', ') : ''
      lines.push(`node: ${self.HostName || this.nodeName()}${ips ? ` (${ips})` : ''}`)
    }
    const peers = Object.values(this.info?.Peer ?? {})
    const available = peers
      .filter((peer) => peer?.ExitNodeOption === true)
      .map((peer) => {
        const ips = Array.isArray(peer.TailscaleIPs)
          ? peer.TailscaleIPs.filter((ip) => !ip.includes(':')).join(', ')
          : ''
        return `${peer.HostName || peer.DNSName}${ips ? ` [${ips}]` : ''}`
      })
      .filter(Boolean)
    if (available.length > 0) lines.push(`available exit nodes: ${available.join(', ')}`)
    const current = this.info?.ExitNodeStatus
    if (current) {
      const peer = peers.find((entry) => entry.ID === current.ID)
      lines.push(`exit node in use: ${peer?.HostName || current.ID}${current.Online === false ? ' (offline)' : ''}`)
    } else if (this.config.exitNode) {
      lines.push(`exit node configured: ${this.config.exitNode} (not applied yet)`)
    }
    if (this.loginUrl) lines.push(`login: ${this.loginUrl}`)
    if (this.lastError) lines.push(`last error: ${this.lastError}`)
    if (this.logTail.length > 0) lines.push(`daemon log:\n${this.logTail.slice(-6).join('\n')}`)
    return lines.join('\n')
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const egress = new TailscaleEgress(config)

  ctx.effect(() => {
    egress.init().catch((error) => {
      egress.backendState = 'failed'
      egress.lastError = String(error?.message ?? error)
    })
    return () => egress.stop()
  })

  // Status route for the Web panel in client.js.
  const sendJson = (res, status, payload) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(payload))
  }
  const readJson = (req) => new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 200000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
  const handleStatusRoute = async (req, res) => {
    const pathname = (req.url || '/').split('?')[0]
    const suffix = pathname.startsWith('/api/tailtransit')
      ? pathname.slice('/api/tailtransit'.length) || '/status'
      : pathname
    try {
      if (req.method === 'GET' && suffix === '/status') {
        return sendJson(res, 200, { ok: true, status: await egress.statusPayload() })
      }
      if (req.method === 'GET' && suffix === '/diag') {
        let graph = null
        try { graph = ctx.clientModules.graph() } catch {}
        const rows = Array.isArray(graph?.entries) ? graph.entries : Array.isArray(graph?.modules) ? graph.modules : []
        const match = rows.filter((row) => JSON.stringify(row).includes('tailtransit'))
        return sendJson(res, 200, {
          ok: true,
          path: typeof ctx.clientModules.clientPath === 'function'
            ? ctx.clientModules.clientPath('dsh-tailtransit') ?? null
            : null,
          total: rows.length,
          match,
        })
      }
      if (req.method === 'POST' && suffix === '/set') {
        const target = new URL(req.url || '/', 'http://localhost')
        const query = target.searchParams
        const body = await readJson(req)
        const read = (name) => (query.has(name) ? query.get(name) : body[name])
        const asBool = (value) => value === true || value === '1' || value === 'true'
        const enabledValue = read('enabled')
        if (enabledValue !== undefined) {
          if (asBool(enabledValue)) await egress.enable()
          else await egress.disable()
        }
        const exitEnabledValue = read('exitNodeEnabled')
        if (exitEnabledValue !== undefined) {
          egress.exitNodeEnabled = asBool(exitEnabledValue)
          egress.config.exitNodeEnabled = egress.exitNodeEnabled
          await egress.saveSettings()
          const status = await egress.statusJson()
          if (status) await egress.maybeApplyExitNode(status)
        }
        const exitNodeValue = read('exitNode')
        if (typeof exitNodeValue === 'string') {
          egress.config.exitNode = exitNodeValue.trim()
          await egress.saveSettings()
          const status = await egress.statusJson()
          if (status) await egress.maybeApplyExitNode(status)
        }
        const policyValue = read('policy')
        if (policyValue === 'direct' || policyValue === 'block') {
          egress.failurePolicy = policyValue
          await egress.saveSettings()
        }
        await egress.refresh()
        return sendJson(res, 200, { ok: true, status: await egress.statusPayload() })
      }
      if (req.method === 'POST' && suffix === '/test') {
        return sendJson(res, 200, { ok: true, test: await egress.testEgress() })
      }
      if (req.method === 'POST' && suffix === '/restart') {
        await egress.restart()
        return sendJson(res, 200, { ok: true, status: await egress.statusPayload() })
      }
      if (req.method === 'POST' && suffix === '/login') {
        await egress.describe('login')
        return sendJson(res, 200, { ok: true, status: await egress.statusPayload() })
      }
      if (req.method === 'GET' && suffix === '/settings') {
        const envPath = path.join(dshHome(), '.env')
        let envApplied = false
        try {
          const text = await readFile(envPath, 'utf8')
          envApplied = /# >>> dsh-(?:tailtransit|tailscale-egress)/.test(text)
        } catch {}
        const live = await egress.statusPayload()
        let installed = true
        try {
          await access(egress.config.tailscaledPath)
          await access(egress.config.tailscalePath)
        } catch { installed = false }
        return sendJson(res, 200, {
          ok: true,
          settings: {
            stateDir: egress.stateDir,
            proxyPort: egress.port,
            hostname: live?.node?.hostName ?? '',
            envProxy: egress.config.envProxy !== false,
            onboarded: Boolean(egress.config.onboarded),
            installed,
            platform: process.platform,
            envApplied,
            envPath,
          },
        })
      }
      if (req.method === 'POST' && suffix === '/settings') {
        const target = new URL(req.url || '/', 'http://localhost')
        const body = await readJson(req)
        const query = target.searchParams
        let restarted = false
        const rawPort = body.proxyPort ?? (query.has('proxyPort') ? query.get('proxyPort') : undefined)
        if (rawPort !== undefined && rawPort !== null && rawPort !== '') {
          const port = Number(rawPort)
          if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            return sendJson(res, 400, { ok: false, error: 'port must be 1024-65535' })
          }
          egress.config.proxyPort = port
          egress.port = port
          await egress.saveSettings()
          await egress.restart()
          restarted = true
        }
        const rawEnv = body.envProxy ?? (query.has('envProxy') ? query.get('envProxy') : undefined)
        if (rawEnv !== undefined) {
          const on = rawEnv === true || rawEnv === '1' || rawEnv === 'true'
          egress.config.envProxy = on
          await egress.saveSettings()
          if (on) await egress.writeLauncherProxy()
          else await egress.clearLauncherProxy()
        }
        const rawOnboarded = body.onboarded ?? (query.has('onboarded') ? query.get('onboarded') : undefined)
        if (rawOnboarded !== undefined) {
          egress.config.onboarded = rawOnboarded === true || rawOnboarded === '1' || rawOnboarded === 'true'
          await egress.saveSettings()
        }
        const rawHostname = body.hostname ?? (query.has('hostname') ? query.get('hostname') : undefined)
        if (typeof rawHostname === 'string' && rawHostname.trim()) {
          egress.config.hostname = rawHostname.trim()
          await egress.saveSettings()
          await egress.restart()
          restarted = true
        }
        return sendJson(res, 200, {
          ok: true,
          status: restarted ? await egress.statusPayload() : undefined,
        })
      }
      if (req.method === 'POST' && suffix === '/authkey') {
        const body = await readJson(req)
        const key = String(body.key || '').trim()
        if (!key) return sendJson(res, 400, { ok: false, error: 'auth key is empty' })
        const hostname = String(body.hostname || '').trim()
        if (hostname) egress.config.hostname = hostname
        await egress.setAuthKey(key)
        await egress.saveSettings()
        await egress.restart()
        return sendJson(res, 200, { ok: true, status: await egress.statusPayload() })
      }
      if (req.method === 'POST' && suffix === '/env') {
        const body = await readJson(req)
        if (body.action === 'clear') await egress.clearLauncherProxy()
        else if (body.action === 'apply') await egress.writeLauncherProxy()
        return sendJson(res, 200, { ok: true })
      }
      return sendJson(res, 404, { ok: false, error: `unknown endpoint ${req.method} ${pathname}` })
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
    }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/tailtransit',
    handler: handleStatusRoute,
  }))

  ctx.effect(() => ctx.web.registerFetchProvider({
    id: PROVIDER_ID,
    available: () => !egress.enabled || egress.proxyReady || egress.failurePolicy === 'direct',
    fetch: async (request, signal) => {
      const options = {
        signal,
        timeoutMs: config.timeoutMs,
        maxRedirects: config.maxRedirects,
        maxBytes: config.maxResponseBytes,
        maxChars: config.maxBodyChars,
        userAgent: config.userAgent,
      }
      const wrap = (error) => {
        if (error instanceof WebError) return error
        return new WebError(error?.message ?? String(error), error?.code ?? 'WEB_PROVIDER_ERROR', { cause: error })
      }
      const fallbackable = (error) => error?.code === 'WEB_PROVIDER_ERROR' || error?.code === 'WEB_FETCH_TIMEOUT'

      if (!egress.enabled) {
        return fetchThroughProxy(request.url, { ...options, proxyUrl: undefined }).catch((error) => {
          throw wrap(error)
        })
      }

      const proxyUrl = egress.proxyReady ? egress.proxyUrl() : undefined
      if (!proxyUrl) {
        if (egress.failurePolicy === 'block') {
          throw new WebError('Tailscale egress proxy is not running', 'WEB_PROVIDER_ERROR')
        }
        return fetchThroughProxy(request.url, { ...options, proxyUrl: undefined }).catch((error) => {
          throw wrap(error)
        })
      }

      try {
        return await fetchThroughProxy(request.url, { ...options, proxyUrl })
      } catch (error) {
        if (egress.failurePolicy === 'block' || !fallbackable(error)) throw wrap(error)
        return fetchThroughProxy(request.url, { ...options, proxyUrl: undefined }).catch((directError) => {
          throw wrap(directError)
        })
      }
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'tailtransit',
    description:
      'Inspect or repair the Harness-scoped Tailscale egress proxy used by web_fetch and shell commands. '
      + 'status (default) reports the per-user userspace tailscaled state, the loopback proxy, the exit node, '
      + 'and a login URL when the node still needs authentication. login starts the browser login flow; '
      + 'restart restarts the userspace daemon. The system-wide Tailscale service is never modified.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'login', 'restart'],
          description: 'status (default) | login | restart',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      return { text: await egress.describe(args.action ?? 'status') }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Tailscale egress: ${args.action ?? 'status'}`,
      kind: 'other',
    }),
  }))
}
