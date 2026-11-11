#!/usr/bin/env node
/**
 * Checks for the privacy gate. Run with:
 *   node test/sensitive-gate.test.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import {
  classifyIpv4,
  classifyIpv6,
  detectFindings,
  hashIdentifier,
  loadGateConfig,
} from '../scripts/check-sensitive.mjs'

let checks = 0
function check(name, fn) {
  fn()
  checks += 1
  console.log(`  ok  ${name}`)
}

const config = { allow: [], denyHashes: new Set() }
const rules = (text, options = {}) => detectFindings(text, { config, ...options }).map((item) => item.rule)
const values = (text, options = {}) => detectFindings(text, { config, ...options }).map((item) => item.value)

console.log('IPv4 classification')

check('separates private, CGNAT, documentation and loopback', () => {
  assert.equal(classifyIpv4('10.1.2.3'), 'private')
  assert.equal(classifyIpv4('172.16.0.1'), 'private')
  assert.equal(classifyIpv4('192.168.1.1'), 'private')
  assert.equal(classifyIpv4('100.64.0.1'), 'cgnat')
  assert.equal(classifyIpv4('127.0.0.1'), 'loopback')
  assert.equal(classifyIpv4('192.0.2.10'), 'documentation')
  assert.equal(classifyIpv4('198.51.100.7'), 'documentation')
  assert.equal(classifyIpv4('203.0.113.42'), 'documentation')
  assert.equal(classifyIpv4('8.8.8.8'), 'public')
})

check('rejects malformed and leading-zero quads', () => {
  assert.equal(classifyIpv4('999.1.1.1'), null)
  assert.equal(classifyIpv4('1.001.782.392'), null)
  assert.equal(classifyIpv4('1.2.3'), null)
})

check('blocks private and public addresses but not loopback or docs', () => {
  assert.deepEqual(rules('host 10.1.2.3'), ['private-ipv4'])
  assert.deepEqual(rules('host 8.8.8.8'), ['public-ipv4'])
  assert.deepEqual(rules('host 100.64.1.2'), ['private-ipv4'])
  assert.deepEqual(rules('host 127.0.0.1 192.0.2.1 203.0.113.42'), [])
})

console.log('IPv6 classification')

check('blocks unique-local and global addresses', () => {
  assert.equal(classifyIpv6('fd00::1'), 'private')
  assert.equal(classifyIpv6('2001:4860:4860::8888'), 'public')
  assert.equal(classifyIpv6('::1'), 'loopback')
  assert.equal(classifyIpv6('2001:db8::1'), 'documentation')
  assert.deepEqual(rules('host fd00::1'), ['private-ipv6'])
  assert.deepEqual(rules('host 2001:db8::1 ::1'), [])
})

console.log('identifiers')

check('blocks emails but not documentation addresses', () => {
  assert.deepEqual(rules('mail someone@corp-mail.com'), ['email'])
  assert.deepEqual(rules('mail user@example.com git@github.com'), [])
})

check('blocks internal and tailnet hostnames but not reserved examples', () => {
  assert.deepEqual(rules('gateway.internal'), ['internal-host'])
  assert.deepEqual(rules('gateway.internal.example'), [])
  assert.deepEqual(rules('node.tailnet.ts.net'), ['tailnet-dns'])
})

check('blocks absolute paths that carry a username', () => {
  assert.deepEqual(rules('C:\\Users\\alice\\project'), ['user-path'])
  assert.deepEqual(rules('/home/alice/project'), ['user-path'])
  assert.deepEqual(rules('C:\\Users\\Public\\project /home/runner/work /Users/Shared'), [])
})

check('blocks credentials and high-entropy assignments', () => {
  assert.deepEqual(rules('tskey-auth-abcdefgh12345678'), ['tailscale-key'])
  assert.deepEqual(rules('-----BEGIN OPENSSH PRIVATE KEY-----'), ['private-key'])
  assert.deepEqual(rules('apiKey = "A1b2C3d4E5f6G7h8J9k0"'), ['secret-assignment'])
  assert.deepEqual(rules('authKey: ""'), [])
  assert.deepEqual(rules('password = "changeme"'), [])
})

console.log('deny hashes')

check('matches a blocked identifier without storing its text', () => {
  const denied = { allow: [], denyHashes: new Set([hashIdentifier('blocked-node-name')]) }
  assert.deepEqual(
    detectFindings('exit node blocked-node-name', { config: denied }).map((item) => item.rule),
    ['denied-identifier'],
  )
  assert.deepEqual(
    detectFindings('exit node other-server', { config: denied }),
    [],
  )
})

check('matches a subdomain of a blocked registrable domain', () => {
  const denied = { allow: [], denyHashes: new Set([hashIdentifier('blocked-vendor.example')]) }
  assert.deepEqual(
    detectFindings('https://api.blocked-vendor.example/v1', { config: denied }).map((item) => item.rule),
    ['denied-identifier'],
  )
})

console.log('allowlist')

check('suppresses an explicit exception for one file', () => {
  const allow = {
    allow: [{ rule: 'private-ipv4', file: 'noproxy.js', value: '10.0.0.0' }],
    denyHashes: new Set(),
  }
  assert.deepEqual(
    detectFindings('10.0.0.0/8', { file: 'noproxy.js', config: allow }),
    [],
  )
  assert.deepEqual(
    detectFindings('10.0.0.0/8', { file: 'index.js', config: allow }).map((item) => item.rule),
    ['private-ipv4'],
  )
})

check('wildcard file globs match nested paths', () => {
  const allow = {
    allow: [{ rule: 'email', file: 'test/**', value: 'fixture@corp-mail.com' }],
    denyHashes: new Set(),
  }
  assert.deepEqual(
    detectFindings('fixture@corp-mail.com', { file: 'test/deep/case.mjs', config: allow }),
    [],
  )
})

console.log('repository config')

check('loads the committed config and its deny categories', () => {
  const loaded = loadGateConfig(fileURLToPath(new URL('..', import.meta.url)))
  assert.ok(loaded.denyHashes.size >= 1)
  assert.ok(loaded.denyCategories['company-domain']?.length >= 1)
  assert.ok(loaded.denyCategories['device-name']?.length >= 1)
  assert.ok(loaded.allow.some((entry) => entry.value === '10.0.0.0'))
})

check('finds no private value in the current source tree', () => {
  assert.deepEqual(values('const proxy = "http://127.0.0.1:18888"'), [])
})

console.log(`\n${checks} checks passed`)
