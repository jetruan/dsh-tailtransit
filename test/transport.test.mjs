/**
 * Standalone checks for the proxy transport. Run with:
 *   node test/transport.test.mjs
 *
 * No Harness imports: transport.js is dependency-free on purpose.
 */
import http from 'node:http'
import net from 'node:net'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'
import { fetchThroughProxy, FetchTransportError } from '../transport.js'

const BIG = Buffer.alloc(6 * 1024 * 1024, 0x61)

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

const origin = http.createServer((req, res) => {
  if (req.url === '/html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<h1>hello</h1>')
    return
  }
  if (req.url === '/json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (req.url === '/gzip') {
    const body = zlib.gzipSync(Buffer.from('compressed payload'))
    res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
    res.end(body)
    return
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/html' })
    res.end()
    return
  }
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(BIG)
    return
  }
  if (req.url === '/binary') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.from([0, 1, 2]))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('nope')
})
const originPort = await listen(origin)

const proxy = http.createServer((_req, res) => {
  res.writeHead(400, { 'content-type': 'text/plain' })
  res.end('CONNECT only')
})
proxy.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':')
  const upstream = net.connect(Number(port), host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})
const proxyPort = await listen(proxy)
const proxyUrl = `http://127.0.0.1:${proxyPort}`

const base = {
  timeoutMs: 10000,
  maxRedirects: 5,
  maxBytes: 5_000_000,
  maxChars: 100_000,
  userAgent: 'test/1.0',
}

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}: ${error?.stack ?? error}`)
  }
}

await check('http through CONNECT proxy', async () => {
  const result = await fetchThroughProxy(`http://127.0.0.1:${originPort}/html`, { ...base, proxyUrl })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'html')
  assert.match(result.body.content, /hello/)
})

await check('direct (no proxy)', async () => {
  const result = await fetchThroughProxy(`http://127.0.0.1:${originPort}/json`, base)
  assert.equal(result.body.kind, 'text')
  assert.deepEqual(JSON.parse(result.body.content), { ok: true })
})

await check('gzip decoded', async () => {
  const result = await fetchThroughProxy(`http://127.0.0.1:${originPort}/gzip`, { ...base, proxyUrl })
  assert.equal(result.body.content, 'compressed payload')
})

await check('same-origin redirect followed', async () => {
  const result = await fetchThroughProxy(`http://127.0.0.1:${originPort}/redirect`, { ...base, proxyUrl })
  assert.match(result.body.content, /hello/)
  assert.match(result.url, /\/html$/)
})

await check('oversize rejected', async () => {
  await assert.rejects(
    fetchThroughProxy(`http://127.0.0.1:${originPort}/big`, { ...base, proxyUrl }),
    (error) => error instanceof FetchTransportError && error.code === 'WEB_FETCH_TOO_LARGE',
  )
})

await check('binary rejected', async () => {
  await assert.rejects(
    fetchThroughProxy(`http://127.0.0.1:${originPort}/binary`, { ...base, proxyUrl }),
    (error) => error instanceof FetchTransportError && error.code === 'WEB_UNSUPPORTED_CONTENT_TYPE',
  )
})

await check('cross-origin redirect blocked', async () => {
  const other = http.createServer((_req, res) => {
    res.writeHead(302, { location: 'http://127.0.0.1:1/html' })
    res.end()
  })
  const otherPort = await listen(other)
  await assert.rejects(
    fetchThroughProxy(`http://127.0.0.1:${otherPort}/x`, { ...base, proxyUrl }),
    (error) => error instanceof FetchTransportError && error.code === 'WEB_REDIRECT_BLOCKED',
  )
  other.close()
})

await check('https through CONNECT proxy (public site)', async () => {
  const result = await fetchThroughProxy('https://example.com/', { ...base, proxyUrl, timeoutMs: 20000 })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'html')
  assert.match(result.body.content, /Example Domain/i)
})

origin.close()
proxy.close()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
