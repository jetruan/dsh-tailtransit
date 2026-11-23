/**
 * End-to-end check that the plugin can own a userspace `tailscaled`.
 *
 * Unlike the transport tests this needs a real Tailscale installation: the
 * daemon is spawned, the loopback proxy is asserted to answer, and the state
 * directory is removed afterwards. Without a `tailscaled` binary the file
 * skips and exits 0, so it stays safe to run on a machine that only has the
 * GUI build. Run with:
 *   node test/daemon.test.mjs
 * Point it at a non-standard binary with:
 *   TAILTRANSIT_TAILSCALED=/path/to/tailscaled node test/daemon.test.mjs
 */
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply } from '../index.js'

const IS_WINDOWS = process.platform === 'win32'

const candidates = [
  process.env.TAILTRANSIT_TAILSCALED,
  IS_WINDOWS ? 'C:\\Program Files\\Tailscale\\tailscaled.exe' : '/opt/homebrew/bin/tailscaled',
  IS_WINDOWS ? '' : '/usr/local/bin/tailscaled',
  IS_WINDOWS ? '' : '/usr/bin/tailscaled',
].filter(Boolean)

const tailscaledPath = candidates.find((file) => existsSync(file)) ?? ''
const tailscalePath = process.env.TAILTRANSIT_TAILSCALE
  || path.join(path.dirname(tailscaledPath || '.'), IS_WINDOWS ? 'tailscale.exe' : 'tailscale')

if (!tailscaledPath) {
  console.log('daemon test skipped: no tailscaled binary found')
  console.log('  set TAILTRANSIT_TAILSCALED to a userspace-capable tailscaled to run it')
  process.exit(0)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function makeCtx() {
  const store = { tools: [], providers: [], routes: [], disposers: [] }
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') store.disposers.push(dispose)
    },
    tools: { register(tool) { store.tools.push(tool) } },
    web: { registerFetchProvider(provider) { store.providers.push(provider) } },
    webServer: { register(route) { store.routes.push(route) } },
    clientModules: { graph: () => ({ entries: [] }), clientPath: () => null },
  }
  return { ctx, store }
}

function callRoute(store, method, url) {
  const route = store.routes.find((entry) => entry.path === '/api/tailtransit')
  const handler = route.handler
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value },
      end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }) },
    }
    Promise.resolve(handler({ method, url, on() {}, destroy() {} }, res)).catch(reject)
  })
}

/** Wait until the daemon answers, or fail with whatever the plugin reported. */
async function waitForDaemon(store, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const response = await callRoute(store, 'GET', '/api/tailtransit/status')
    last = response.body.status
    if (last.proxyReady && (last.state === 'NeedsLogin' || last.state === 'Running')) return last
    if (last.state === 'failed' || last.state === 'missing-binary' || last.state === 'unsupported') break
    await sleep(500)
  }
  throw new Error(`daemon did not become ready: ${JSON.stringify(last)}`)
}

/** Port liveness works on every platform, unlike `pgrep` or `tasklist`. */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(1000, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

let checks = 0
async function check(name, fn) {
  await fn()
  checks += 1
  console.log(`  ok  ${name}`)
}

const stateDir = await mkdtemp(path.join(tmpdir(), 'tailtransit-test-'))
const port = await freePort()
const { ctx, store } = makeCtx()

console.log(`daemon (${process.platform}, tailscaled ${tailscaledPath})`)

apply(ctx, {
  tailscaledPath,
  tailscalePath,
  stateDir,
  proxyPort: port,
  // Never let a test rewrite the real launcher environment.
  envProxy: false,
  proxyShell: false,
  authKey: '',
})

try {
  const status = await waitForDaemon(store)

  await check('registers the tool, the fetch provider, and the status route', async () => {
    assert.deepEqual(store.tools.map((tool) => tool.name), ['tailtransit'])
    assert.deepEqual(store.providers.map((provider) => provider.id), ['tailtransit'])
    assert.equal(store.routes[0].kind, 'prefix')
  })

  await check('runs a loopback proxy and keeps its own daemon', async () => {
    assert.equal(status.proxyReady, true)
    assert.equal(status.proxyUrl, `http://127.0.0.1:${port}`)
    assert.equal(await portOpen(port), true)
  })

  await check('reports the platform and an installed state to the panel', async () => {
    const response = await callRoute(store, 'GET', '/api/tailtransit/settings')
    assert.equal(response.body.settings.installed, true)
    assert.equal(response.body.settings.platform, process.platform)
    assert.equal(response.body.settings.stateDir, stateDir)
  })

  await check('describes the per-user node without touching the system service', async () => {
    const described = await store.tools[0].execute({ action: 'status' })
    assert.match(described.text, /^state: /)
    assert.match(described.text, /proxy: http:\/\/127\.0\.0\.1:/)
    assert.match(described.text, /daemon pid: \d+/)
  })

  await check('ships a fetch provider that reaches a public site through the proxy', async () => {
    const provider = store.providers[0]
    const result = await provider.fetch({ url: 'https://example.com/' }, undefined)
    assert.equal(result.statusCode, 200)
    assert.ok(result.body.content.includes('Example Domain'))
  })
} finally {
  for (const dispose of store.disposers) await dispose()
  await sleep(1500)
  await check('stops the daemon when the plugin unloads', async () => {
    assert.equal(await portOpen(port), false)
  })
  await rm(stateDir, { recursive: true, force: true })
}

console.log(`\n${checks} checks passed`)