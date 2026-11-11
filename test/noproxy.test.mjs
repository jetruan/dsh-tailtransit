/**
 * Standalone checks for the proxy bypass policy. Run with:
 *   node test/noproxy.test.mjs
 *
 * No Harness imports: noproxy.js is dependency-free on purpose.
 */
import assert from 'node:assert/strict'
import {
  HARNESS_VENDOR_BYPASS,
  configuredLlmEndpoints,
  effectiveNoProxy,
  endpointsFromPatchText,
  hostOfUrl,
  noProxyList,
} from '../noproxy.js'

let checks = 0
function check(name, fn) {
  fn()
  checks += 1
  console.log(`  ok  ${name}`)
}

const LOOPBACK = ['localhost', '127.0.0.1', '::1']

console.log('hostOfUrl')

check('reads the hostname of a full URL', () => {
  assert.equal(hostOfUrl('https://gateway.internal.example/v1'), 'gateway.internal.example')
})

check('accepts a bare host and drops the path', () => {
  assert.equal(hostOfUrl('api.example.com/v1'), 'api.example.com')
})

check('drops the port and lowercases', () => {
  assert.equal(hostOfUrl('https://API.Example.COM:8443/v1'), 'api.example.com')
})

check('returns empty for blank, garbage, and non-strings', () => {
  assert.equal(hostOfUrl(''), '')
  assert.equal(hostOfUrl('   '), '')
  assert.equal(hostOfUrl('http://'), '')
  assert.equal(hostOfUrl(null), '')
  assert.equal(hostOfUrl(undefined), '')
  assert.equal(hostOfUrl(42), '')
})

console.log('noProxyList')

check('always carries loopback, even with no config', () => {
  for (const host of LOOPBACK) assert.ok(noProxyList({}).includes(host))
  for (const host of LOOPBACK) assert.ok(noProxyList(undefined).includes(host))
})

check('keeps the user entries after the loopback prefix', () => {
  const list = noProxyList({ noProxy: 'corp.example.com' }).split(',')
  assert.deepEqual(list, [...LOOPBACK, 'corp.example.com'])
})

check('does not duplicate a loopback the user already wrote', () => {
  const list = noProxyList({ noProxy: 'localhost,corp.example.com' }).split(',')
  assert.equal(list.filter((item) => item === 'localhost').length, 1)
  assert.ok(list.includes('corp.example.com'))
})

console.log('effectiveNoProxy')

check('adds discovered endpoints while LLM traffic stays direct', () => {
  const list = effectiveNoProxy({ llmProxy: false }, ['gateway.internal.example']).split(',')
  assert.ok(list.includes('gateway.internal.example'))
  for (const host of LOOPBACK) assert.ok(list.includes(host))
})

check('drops discovered endpoints when the user routes LLM through the exit node', () => {
  const list = effectiveNoProxy({ llmProxy: true }, ['gateway.internal.example']).split(',')
  assert.deepEqual(list, LOOPBACK)
})

check('drops the manual list too when LLM proxy is on', () => {
  const list = effectiveNoProxy({ llmProxy: true, llmNoProxy: 'manual.example.com' }).split(',')
  assert.deepEqual(list, LOOPBACK)
})

check('still bypasses user noProxy entries when LLM proxy is on', () => {
  const list = effectiveNoProxy({ llmProxy: true, noProxy: 'corp.example.com' }).split(',')
  assert.ok(list.includes('corp.example.com'))
})

check('merges the manual llmNoProxy list with discovered hosts', () => {
  const list = effectiveNoProxy(
    { llmProxy: false, llmNoProxy: 'manual.example.com' },
    ['discovered.example.com'],
  ).split(',')
  assert.ok(list.includes('manual.example.com'))
  assert.ok(list.includes('discovered.example.com'))
})

check('de-duplicates a host named twice', () => {
  const list = effectiveNoProxy(
    { llmProxy: false, llmNoProxy: 'same.example.com' },
    ['same.example.com'],
  ).split(',')
  assert.equal(list.filter((item) => item === 'same.example.com').length, 1)
})

check('always bypasses the Harness vendor host while LLM traffic stays direct', () => {
  const list = effectiveNoProxy({ llmProxy: false }, []).split(',')
  for (const host of HARNESS_VENDOR_BYPASS) assert.ok(list.includes(host), host)
  for (const host of LOOPBACK) assert.ok(list.includes(host), host)
})

check('drops the vendor host when LLM traffic goes through the exit node', () => {
  const list = effectiveNoProxy({ llmProxy: true }, []).split(',')
  for (const host of HARNESS_VENDOR_BYPASS) assert.ok(!list.includes(host), host)
})

console.log('configuredLlmEndpoints')

const editorCtx = (rows) => ({ get: (name) => (name === 'configEditor' ? { configuration: () => rows } : undefined) })

check('reads baseURL through the live effective config', () => {
  const ctx = editorCtx([
    { entry: { fiber: { effectiveConfig: { providers: { a: { baseURL: 'https://llm.corp.example.com/v1' } } } } } },
  ])
  assert.deepEqual(configuredLlmEndpoints(ctx), [
    { baseURL: 'https://llm.corp.example.com/v1', host: 'llm.corp.example.com' },
  ])
})

check('falls back to the composed layers when the fiber has not settled', () => {
  const ctx = editorCtx([
    { inherited: { providers: { a: { baseURL: 'https://inherited.example.com/v1' } } }, override: {} },
    { inherited: {}, override: { providers: { b: { baseURL: 'https://override.example.com/v1' } } } },
  ])
  const hosts = configuredLlmEndpoints(ctx).map((item) => item.host)
  assert.deepEqual(hosts, ['inherited.example.com', 'override.example.com'])
})

check('collects several providers and de-duplicates repeated hosts', () => {
  const ctx = editorCtx([
    {
      entry: {
        fiber: {
          effectiveConfig: {
            providers: {
              one: { baseURL: 'https://shared.example.com/v1' },
              two: { baseURL: 'https://shared.example.com/v1/other' },
              three: { baseURL: 'https://third.example.com' },
            },
          },
        },
      },
    },
  ])
  assert.deepEqual(configuredLlmEndpoints(ctx).map((item) => item.host), [
    'shared.example.com',
    'third.example.com',
  ])
})

check('skips providers without a baseURL', () => {
  const ctx = editorCtx([
    { entry: { fiber: { effectiveConfig: { providers: { a: { apiKeyEnv: 'X' }, b: { baseURL: '' } } } } } },
  ])
  assert.deepEqual(configuredLlmEndpoints(ctx), [])
})

check('skips malformed base URLs instead of throwing', () => {
  const ctx = editorCtx([{ entry: { fiber: { effectiveConfig: { providers: { a: { baseURL: 'http://' } } } } } }])
  assert.deepEqual(configuredLlmEndpoints(ctx), [])
})

check('returns empty when the configuration service is absent', () => {
  assert.deepEqual(configuredLlmEndpoints(undefined), [])
  assert.deepEqual(configuredLlmEndpoints({}), [])
  assert.deepEqual(configuredLlmEndpoints({ get: () => undefined }), [])
  assert.deepEqual(configuredLlmEndpoints({ get: () => ({}) }), [])
})

check('returns empty when the service throws', () => {
  const ctx = { get: () => ({ configuration: () => { throw new Error('boom') } }) }
  assert.deepEqual(configuredLlmEndpoints(ctx), [])
})

check('ignores entries that carry no providers object', () => {
  const ctx = editorCtx([
    { entry: { fiber: { effectiveConfig: { someOtherPlugin: true } } } },
    { entry: { fiber: { effectiveConfig: { providers: { a: { baseURL: 'https://kept.example.com' } } } } } },
  ])
  assert.deepEqual(configuredLlmEndpoints(ctx).map((item) => item.host), ['kept.example.com'])
})

console.log('endpointsFromPatchText')

check('finds the baseURL declared under providers', () => {
  const text = [
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      internal-api:',
    '        api: openai-responses',
    '        baseURL: https://gateway.internal.example/v1',
    '        models:',
    '          - id: some-model',
    '            name: some-model',
  ].join('\n')
  assert.deepEqual(endpointsFromPatchText(text), [
    { baseURL: 'https://gateway.internal.example/v1', host: 'gateway.internal.example' },
  ])
})

check('stops at the first line indented no deeper than providers', () => {
  const text = [
    '    providers:',
    '      a:',
    '        baseURL: https://inside.example.com',
    '- id: another-row',
    '  config:',
    '    baseURL: https://outside.example.com',
  ].join('\n')
  assert.deepEqual(endpointsFromPatchText(text).map((item) => item.host), ['inside.example.com'])
})

check('ignores a baseURL that appears before any providers block', () => {
  const text = ['- id: web', '  config:', '    baseURL: https://not-a-provider.example.com'].join('\n')
  assert.deepEqual(endpointsFromPatchText(text), [])
})

check('unquotes a quoted baseURL', () => {
  const text = ['  providers:', '    a:', '      baseURL: "https://quoted.example.com/v1"'].join('\n')
  assert.deepEqual(endpointsFromPatchText(text).map((item) => item.host), ['quoted.example.com'])
})

check('collects several providers and skips duplicates', () => {
  const text = [
    '  providers:',
    '    a:',
    '      baseURL: https://one.example.com/v1',
    '    b:',
    '      baseURL: https://one.example.com/v1/other',
    '    c:',
    '      baseURL: https://two.example.com',
  ].join('\n')
  assert.deepEqual(endpointsFromPatchText(text).map((item) => item.host), [
    'one.example.com',
    'two.example.com',
  ])
})

check('returns nothing for empty or unrelated text', () => {
  assert.deepEqual(endpointsFromPatchText(''), [])
  assert.deepEqual(endpointsFromPatchText(undefined), [])
  assert.deepEqual(endpointsFromPatchText('providers:\n'), [])
})

console.log(`\n${checks} checks passed`)