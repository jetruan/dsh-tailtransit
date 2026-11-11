/**
 * Standalone checks for the reachability probe. Run with:
 *   node test/probe.test.mjs
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { probeOrigin } from '../transport.js'

const server = http.createServer((_req, res) => {
  res.writeHead(401, { 'content-type': 'text/plain' })
  res.end('unauthorized')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

const closed = http.createServer(() => {})
await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
const closedPort = closed.address().port
await new Promise((resolve) => closed.close(resolve))

let checks = 0
async function check(name, fn) {
  await fn()
  checks += 1
  console.log(`  ok  ${name}`)
}

console.log('probeOrigin')

await check('reports a reachable origin even when it answers 401', async () => {
  const result = await probeOrigin(`http://127.0.0.1:${port}/v1`, { timeoutMs: 5000 })
  assert.deepEqual(result, { ok: true })
})

await check('reports an unreachable port instead of throwing', async () => {
  const result = await probeOrigin(`http://127.0.0.1:${closedPort}/v1`, { timeoutMs: 3000 })
  assert.equal(result.ok, false)
  assert.equal(typeof result.error, 'string')
})

await check('rejects an unsupported scheme without throwing', async () => {
  const result = await probeOrigin('ftp://example.com/v1', { timeoutMs: 3000 })
  assert.equal(result.ok, false)
})

await check('rejects a malformed URL without throwing', async () => {
  const result = await probeOrigin('http://', { timeoutMs: 3000 })
  assert.equal(result.ok, false)
})

await new Promise((resolve) => server.close(resolve))
console.log(`\n${checks} checks passed`)