#!/usr/bin/env node
/**
 * Privacy gate for dsh-tailtransit.
 *
 * Blocks IP addresses, personal identifiers, credentials and internal host
 * names from entering the repository. Dependency-free on purpose: a hook must
 * work on a fresh clone before `npm install`, and CI must not need a scanner
 * binary.
 *
 * Modes:
 *   --staged            files in the index (default; used by the pre-commit hook)
 *   --range A..B        files and commit messages added between two revisions
 *   --all               every tracked file in the working tree
 *   --history           every blob reachable from any ref (audit only)
 *   --message <file>    one commit-message file (used by commit-msg)
 *   --hash <value>      print the SHA-256 used by denyHashes
 *
 * Exit codes: 0 clean, 1 findings, 2 usage or git error.
 *
 * @module dsh-tailtransit/privacy-gate
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const CONFIG_FILE = '.sensitive-gate.json'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_REPORTED = 200

const EMPTY_CONFIG = { allow: [], denyHashes: new Set() }

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

const IPV4_RE = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g
const IPV6_RE = /(?<![0-9A-Za-z:])((?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4})(?![0-9A-Za-z:])/g
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}\b/g
const FQDN_RE = /\b((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63})\b/g
const WINDOWS_USER_PATH_RE = /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'<>|]+)/gi
const POSIX_USER_PATH_RE = /(?<![\w.-])\/(?:home|Users)\/([A-Za-z0-9._-]+)/g
const TOKEN_RE = /(?<![A-Za-z0-9._-])([A-Za-z0-9][A-Za-z0-9._-]{2,126})(?![A-Za-z0-9._-])/g
const ASSIGN_RE = /\b(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|auth[_-]?key|authkey|password|passwd)\b\s*[:=]\s*(['"])([^'"\r\n]{8,200})\2/gi

const INTERNAL_TLD_RE = /\.(?:internal|intranet|local|localdomain|lan|corp|home\.arpa)$/i

const SECRET_PATTERNS = [
  { rule: 'tailscale-key', pattern: /\btskey-[a-z0-9]+-[A-Za-z0-9]{8,}\b/g },
  { rule: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: 'cloud-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: 'token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { rule: 'token', pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },
  { rule: 'token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { rule: 'token', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}\b/g },
  { rule: 'token', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { rule: 'token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
]

const SAFE_WINDOWS_SEGMENTS = new Set([
  'public', 'default', 'default user', 'all users', 'user', 'username',
  'runner', 'administrator', '<user>', '%username%', 'yourname',
])

const SAFE_POSIX_SEGMENTS = new Set([
  'user', 'username', 'runner', 'shared', 'example', '<user>', 'yourname',
])

/** Leading/trailing punctuation that is not part of a host or identifier. */
function trimToken(value) {
  return value.replace(/^[._-]+|[._-]+$/g, '')
}

/**
 * Classify a dotted-quad IPv4 address.
 *
 * @returns one of `private`, `cgnat`, `public`, `loopback`, `link-local`,
 *   `documentation`, `benchmark`, `reserved`, `unspecified`, or null when the
 *   string is not a well-formed address.
 */
export function classifyIpv4(value) {
  const parts = String(value).split('.')
  if (parts.length !== 4) return null
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part[0] === '0') return null
  }
  const [a, b, c] = parts.map(Number)
  if ([a, b, c, Number(parts[3])].some((part) => part > 255)) return null
  if (a === 0) return 'unspecified'
  if (a === 10) return 'private'
  if (a === 127) return 'loopback'
  if (a === 169 && b === 254) return 'link-local'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat'
  if (a === 192 && b === 0 && c === 2) return 'documentation'
  if (a === 198 && b === 51 && c === 100) return 'documentation'
  if (a === 203 && b === 0 && c === 113) return 'documentation'
  if (a === 198 && (b === 18 || b === 19)) return 'benchmark'
  if (a >= 224) return 'reserved'
  return 'public'
}

/** Classify an IPv6 address accepted by {@link net.isIP}. */
export function classifyIpv6(value) {
  const lower = String(value).toLowerCase()
  if (lower === '::') return 'unspecified'
  if (lower === '::1') return 'loopback'
  if (/^fe[89ab]/.test(lower)) return 'link-local'
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private'
  if (lower.startsWith('2001:db8:') || lower === '2001:db8') return 'documentation'
  if (/^ff/.test(lower)) return 'reserved'
  return 'public'
}

/** SHA-256 of a lowercased identifier; the only form stored in the config. */
export function hashIdentifier(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex')
}

/** RFC 2606 / RFC 6761 names that are documentation, never personal. */
function isReservedHost(host) {
  return (
    host === 'localhost'
    || /(?:^|\.)(?:example|test|invalid|localhost)$/i.test(host)
    || /\.(?:example|test|invalid|localhost)$/i.test(host)
  )
}

function isAllowedEmail(value) {
  const lower = value.toLowerCase()
  if (lower === 'git@github.com' || lower === 'noreply@github.com' || lower === 'actions@github.com') return true
  return /@(?:example\.(?:com|org|net|test)|localhost|users\.noreply\.github\.com|noreply\.github\.com)$/i.test(lower)
}

function looksLikePlaceholder(value) {
  if (value.length < 8) return true
  if (/\s/.test(value)) return true
  return /^(?:<|%|\$\{|process\.env|env\.|your[-_ ]|example|placeholder|changeme|change-me|redacted|none|null|undefined|true|false|xxx|\*{3,}|\.{3}|\u2026)/i.test(value)
}

function looksLikeSecret(value) {
  if (value.length < 12) return false
  if (new Set(value).size < 8) return false
  return /[A-Za-z0-9]/.test(value)
}

/** Path glob to RegExp: `**` spans directories, `*` and `?` do not. */
function globToRegExp(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[\\^$.[\]{}()+|]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

function isAllowed(finding, file, config) {
  for (const entry of config.allow) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.rule && entry.rule !== '*' && entry.rule !== finding.rule) continue
    if (entry.file) {
      const normalized = file.replace(/\\/g, '/')
      if (!globToRegExp(entry.file).test(normalized)) continue
    }
    if (entry.value !== undefined) {
      const values = Array.isArray(entry.value) ? entry.value : [entry.value]
      if (!values.includes(finding.value)) continue
    }
    return true
  }
  return false
}

/**
 * Scan one string and return findings. Exported for the unit tests.
 *
 * @param text - decoded file content.
 * @param options - `{ file, config }`; config is {@link loadGateConfig}'s result.
 */
export function detectFindings(text, options = {}) {
  const file = options.file ?? ''
  const config = options.config ?? EMPTY_CONFIG
  const findings = []
  const seen = new Set()

  const push = (rule, value, index) => {
    if (!value || value.length < 2) return
    if (isAllowed({ rule, value }, file, config)) return
    const key = `${rule}\u0000${value}\u0000${index}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ rule, value, index })
  }

  for (const match of text.matchAll(IPV4_RE)) {
    const kind = classifyIpv4(match[1])
    if (kind === 'private' || kind === 'cgnat') push('private-ipv4', match[1], match.index)
    else if (kind === 'public') push('public-ipv4', match[1], match.index)
  }

  for (const match of text.matchAll(IPV6_RE)) {
    const candidate = match[1]
    if (net.isIP(candidate) !== 6) continue
    // `E::` and `::e` are valid IPv6 but far more often fragments of CSS,
    // minified code or binary noise. A real compressed address carries at
    // least two hex digits, or it is the loopback that is ignored anyway.
    if (candidate.includes('::') && candidate.replace(/[^0-9A-Fa-f]/g, '').length < 2) continue
    const kind = classifyIpv6(candidate)
    if (kind === 'private') push('private-ipv6', candidate, match.index)
    else if (kind === 'public') push('public-ipv6', candidate, match.index)
  }

  for (const match of text.matchAll(EMAIL_RE)) {
    if (!isAllowedEmail(match[0])) push('email', match[0], match.index)
  }

  for (const match of text.matchAll(FQDN_RE)) {
    const host = match[1].toLowerCase()
    if (isReservedHost(host)) continue
    if (/(?:^|\.)ts\.net$/i.test(host)) push('tailnet-dns', host, match.index)
    else if (INTERNAL_TLD_RE.test(host)) push('internal-host', host, match.index)
  }

  for (const match of text.matchAll(WINDOWS_USER_PATH_RE)) {
    const segment = match[1].toLowerCase()
    if (SAFE_WINDOWS_SEGMENTS.has(segment)) continue
    if (/[%<>$]/.test(segment)) continue
    push('user-path', match[0], match.index)
  }

  for (const match of text.matchAll(POSIX_USER_PATH_RE)) {
    const segment = match[1].toLowerCase()
    if (SAFE_POSIX_SEGMENTS.has(segment)) continue
    push('user-path', match[0], match.index)
  }

  for (const { rule, pattern } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) push(rule, match[0], match.index)
  }

  for (const match of text.matchAll(ASSIGN_RE)) {
    const value = match[3]
    if (looksLikePlaceholder(value) || !looksLikeSecret(value)) continue
    push('secret-assignment', value, match.index)
  }

  if (config.denyHashes.size > 0) {
    const checked = new Set()
    for (const match of text.matchAll(TOKEN_RE)) {
      const token = trimToken(match[1]).toLowerCase()
      if (token.length < 3 || checked.has(token)) continue
      checked.add(token)
      const labels = token.split('.')
      let denied = false
      for (let index = 0; index < labels.length; index += 1) {
        const candidate = labels.slice(index).join('.')
        if (candidate.length >= 3 && config.denyHashes.has(hashIdentifier(candidate))) {
          denied = true
          break
        }
      }
      if (denied) push('denied-identifier', token, match.index)
    }
  }

  return findings
}

/* ------------------------------------------------------------------ */
/* File scanning                                                       */
/* ------------------------------------------------------------------ */

function lineAt(text, index) {
  let line = 1
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) line += 1
  }
  return line
}

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0)
}

function isPng(buffer) {
  return buffer.length > 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
}

/** Text chunks baked into a PNG (tEXt/zTXt/iTXt), a common metadata leak. */
function pngTextChunks(buffer) {
  const chunks = []
  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > buffer.length) break
    const data = buffer.subarray(start, end)
    try {
      if (type === 'tEXt') {
        const separator = data.indexOf(0)
        if (separator > 0) chunks.push({ label: 'tEXt', text: data.subarray(separator + 1).toString('latin1') })
      } else if (type === 'zTXt') {
        const separator = data.indexOf(0)
        if (separator > 0) {
          chunks.push({
            label: 'zTXt',
            text: zlib.inflateSync(data.subarray(separator + 2)).toString('latin1'),
          })
        }
      } else if (type === 'iTXt') {
        const keywordEnd = data.indexOf(0)
        if (keywordEnd > 0) {
          const compressed = data[keywordEnd + 1] === 1
          let cursor = keywordEnd + 3
          const languageEnd = data.indexOf(0, cursor)
          if (languageEnd === -1) throw new Error('malformed iTXt')
          cursor = languageEnd + 1
          const translatedEnd = data.indexOf(0, cursor)
          if (translatedEnd === -1) throw new Error('malformed iTXt')
          cursor = translatedEnd + 1
          const payload = data.subarray(cursor)
          const text = compressed
            ? zlib.inflateSync(payload).toString('utf8')
            : payload.toString('utf8')
          chunks.push({ label: 'iTXt', text })
        }
      }
    } catch {
      // A malformed metadata chunk is not a reason to fail the gate.
    }
    if (type === 'IEND') break
    offset = end + 4
  }
  return chunks
}

function withLocations(text, file, config, binary = false) {
  return detectFindings(text, { file, config }).map((finding) => ({
    ...finding,
    file,
    line: binary ? 0 : lineAt(text, finding.index),
    offset: finding.index,
    binary,
  }))
}

/** Printable ASCII runs are the only part of a binary worth pattern-matching. */
function printableStrings(buffer) {
  const strings = []
  let start = -1
  for (let index = 0; index <= buffer.length; index += 1) {
    const byte = index < buffer.length ? buffer[index] : 0
    const printable = byte >= 0x20 && byte <= 0x7e
    if (printable && start === -1) start = index
    if (!printable && start !== -1) {
      if (index - start >= 4) {
        strings.push({ text: buffer.toString('latin1', start, index), offset: start })
      }
      start = -1
    }
  }
  return strings
}

/** Scan a buffer, whether text, a PNG with metadata, or another binary. */
export function scanBuffer(buffer, file, config = EMPTY_CONFIG) {
  let content = buffer
  if (content.length > MAX_BYTES) content = content.subarray(0, MAX_BYTES)

  if (!isBinary(content)) {
    return withLocations(content.toString('utf8'), file, config)
  }

  const findings = []
  for (const chunk of printableStrings(content)) {
    for (const finding of detectFindings(chunk.text, { file, config })) {
      // Random printable runs in compressed image data produce too many
      // address-shaped false positives. PNG text chunks are scanned below with
      // the full detector set, so metadata still gets checked.
      if (finding.rule.endsWith('-ipv4') || finding.rule.endsWith('-ipv6')) continue
      findings.push({
        ...finding,
        file,
        line: 0,
        offset: chunk.offset + finding.index,
        binary: true,
      })
    }
  }
  if (isPng(content)) {
    for (const chunk of pngTextChunks(content)) {
      findings.push(...withLocations(chunk.text, `${file}#${chunk.label}`, config, true))
    }
  }

  const seen = new Set()
  return findings.filter((finding) => {
    const key = `${finding.rule}\u0000${finding.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Read `.sensitive-gate.json`. A malformed config fails closed: the caller
 * turns the thrown error into exit code 2 rather than silently skipping rules.
 */
export function loadGateConfig(root = process.cwd()) {
  const file = path.join(root, CONFIG_FILE)
  if (!existsSync(file)) return { ...EMPTY_CONFIG, denyCategories: {} }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`)
  }

  const normalize = (value) => String(value).replace(/^sha256:/i, '').trim().toLowerCase()
  const isHash = (value) => /^[0-9a-f]{64}$/.test(value)
  const hashes = []
  const denyCategories = {}

  if (Array.isArray(raw?.denyHashes)) {
    hashes.push(...raw.denyHashes.map(normalize).filter(isHash))
  }
  if (raw?.denyCategories && typeof raw.denyCategories === 'object' && !Array.isArray(raw.denyCategories)) {
    for (const [category, values] of Object.entries(raw.denyCategories)) {
      if (!Array.isArray(values)) continue
      const normalized = values.map(normalize).filter(isHash)
      denyCategories[category] = normalized
      hashes.push(...normalized)
    }
  }

  return {
    allow: Array.isArray(raw?.allow) ? raw.allow : [],
    denyHashes: new Set(hashes),
    denyCategories,
  }
}

/* ------------------------------------------------------------------ */
/* Git plumbing                                                        */
/* ------------------------------------------------------------------ */

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.buffer ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function splitPaths(output) {
  return output.split('\0').map((item) => item.trim()).filter(Boolean)
}

function collectStaged(root) {
  const files = splitPaths(git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
  return files.map((file) => ({ file, buffer: git(root, ['show', `:${file}`], { buffer: true }) }))
}

function collectAll(root) {
  const files = splitPaths(git(root, ['ls-files', '-z']))
  return files.map((file) => ({ file, buffer: readFileSync(path.join(root, file)) }))
}

function collectRange(root, spec) {
  if (!spec || !spec.includes('..')) throw new Error('--range needs a git revision range such as origin/main..HEAD')
  const commits = git(root, ['rev-list', '--reverse', spec]).split(/\r?\n/).filter(Boolean)
  const seenBlobs = new Set()
  const units = []
  for (const commit of commits) {
    // Scan what each commit introduced, not only the final tree: a secret
    // added in one commit and deleted in the next is still in the history
    // that this push publishes.
    const raw = git(root, [
      'diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-abbrev',
      '--diff-filter=AM', commit,
    ])
    const tokens = raw.split('\0')
    for (let index = 0; index + 1 < tokens.length; index += 2) {
      const header = tokens[index]
      const file = tokens[index + 1]
      const match = /^:\d{6} (\d{6}) [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*$/.exec(header)
      if (!match) continue
      const [, mode, blob] = match
      if (mode !== '100644' && mode !== '100755') continue
      if (/^0+$/.test(blob) || seenBlobs.has(blob)) continue
      seenBlobs.add(blob)
      units.push({
        file,
        commit: commit.slice(0, 7),
        buffer: git(root, ['cat-file', 'blob', blob], { buffer: true }),
      })
    }
  }
  const messages = git(root, ['log', '--format=%B%x00', spec])
    .split('\0')
    .map((message) => message.trim())
    .filter(Boolean)
  return { units, messages }
}

function collectHistory(root) {
  const commits = git(root, ['rev-list', '--all']).split(/\r?\n/).filter(Boolean)
  const seenBlobs = new Set()
  const units = []
  for (const commit of commits) {
    const entries = git(root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)
    for (const entry of entries) {
      const tab = entry.indexOf('\t')
      if (tab === -1) continue
      const [mode, type, sha] = entry.slice(0, tab).split(' ')
      const file = entry.slice(tab + 1)
      if (mode !== '100644' && mode !== '100755') continue
      if (type !== 'blob' || seenBlobs.has(sha)) continue
      seenBlobs.add(sha)
      units.push({
        file,
        commit: commit.slice(0, 7),
        buffer: git(root, ['cat-file', 'blob', sha], { buffer: true }),
      })
    }
  }
  return { units, messages: [] }
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

function maskValue(finding) {
  const value = finding.value
  switch (finding.rule) {
    case 'private-ipv4':
    case 'cgnat': {
      const parts = value.split('.')
      return `${parts[0]}.${parts[1]}.*.*`
    }
    case 'public-ipv4': {
      return `${value.split('.')[0]}.*.*.*`
    }
    case 'private-ipv6':
    case 'public-ipv6':
      return `${value.slice(0, 4)}:…`
    case 'email':
      return `${value[0]}***@***`
    case 'user-path':
      return value.replace(/[^\\/]+$/, '***')
    case 'tailnet-dns':
    case 'internal-host':
      return value.replace(/^[^.]+/, '***')
    case 'denied-identifier':
      return '<blocked identifier>'
    default:
      return value.length <= 6 ? '***' : `${value.slice(0, 4)}…(${value.length})`
  }
}

function formatFinding(finding, show) {
  const location = finding.binary ? `${finding.file} (binary)` : `${finding.file}:${finding.line}`
  return `${location}  [${finding.rule}]  ${show ? finding.value : maskValue(finding)}`
}

function report(findings, options = {}) {
  const show = options.show === true
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR
  const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)

  if (findings.length === 0) {
    console.log(paint('32', 'privacy gate: clean'))
    return 0
  }

  const sorted = findings.slice().sort((left, right) => (
    left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule)
  ))
  for (const finding of sorted.slice(0, MAX_REPORTED)) {
    console.log(`  ${paint('31', 'BLOCK')}  ${formatFinding(finding, show)}`)
  }
  if (sorted.length > MAX_REPORTED) {
    console.log(`  … ${sorted.length - MAX_REPORTED} more finding(s)`)
  }

  const counts = new Map()
  for (const finding of sorted) counts.set(finding.rule, (counts.get(finding.rule) ?? 0) + 1)
  const summary = [...counts.entries()].sort((left, right) => right[1] - left[1])
    .map(([rule, count]) => `${rule}×${count}`)
    .join(', ')

  console.log('')
  console.log(paint('31', `privacy gate: ${sorted.length} issue(s) blocked (${summary})`))
  console.log(`Remove the value, or add a justified exception to ${CONFIG_FILE}.`)
  console.log('Run with --show to print the full value locally. Never paste that output into an issue.')
  if (sorted.some((finding) => finding.binary)) {
    console.log('Note: text baked into screenshot pixels is not detectable; redact screenshots by hand.')
  }
  return 1
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = { mode: 'staged', range: '', message: '', hash: '', show: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--staged': options.mode = 'staged'; break
      case '--all': options.mode = 'all'; break
      case '--history': options.mode = 'history'; break
      case '--range':
        options.mode = 'range'
        options.range = argv[++index] ?? ''
        break
      case '--message':
        options.mode = 'message'
        options.message = argv[++index] ?? ''
        break
      case '--hash':
        options.mode = 'hash'
        options.hash = argv[++index] ?? ''
        break
      case '--show': options.show = true; break
      case '--json': options.json = true; break
      case '--help':
      case '-h':
        options.mode = 'help'
        break
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

function printHelp() {
  console.log(`Usage: node scripts/check-sensitive.mjs [mode] [options]

Modes:
  --staged          scan files staged for commit (default)
  --range A..B      scan files and commit messages added in a revision range
  --all             scan every tracked file in the working tree
  --history         scan every blob reachable from any ref (audit only)
  --message <file>  scan one commit-message file
  --hash <value>    print the SHA-256 used in denyHashes

Options:
  --show            print full values instead of masked ones (local only)
  --json            print machine-readable findings (values masked)
  --help            show this help`)
}

/**
 * Run the gate and return an exit code. Exported so the unit tests and a
 * future programmatic caller do not spawn a second node process.
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.mode === 'help') {
    printHelp()
    return 0
  }
  if (options.mode === 'hash') {
    if (!options.hash) throw new Error('--hash needs a value')
    console.log(hashIdentifier(options.hash))
    return 0
  }

  const root = repoRoot()
  const config = loadGateConfig(root)
  const findings = []
  let scanned = 0

  const scanUnits = (units) => {
    for (const unit of units) {
      scanned += 1
      const found = scanBuffer(unit.buffer, unit.file, config)
      if (unit.commit) {
        for (const finding of found) finding.file = `${unit.file} @${unit.commit}`
      }
      findings.push(...found)
    }
  }

  if (options.mode === 'staged') {
    scanUnits(collectStaged(root))
  } else if (options.mode === 'all') {
    scanUnits(collectAll(root))
  } else if (options.mode === 'range') {
    const { units, messages } = collectRange(root, options.range)
    scanUnits(units)
    for (const message of messages) {
      scanned += 1
      findings.push(...withLocations(message, 'commit message', config))
    }
  } else if (options.mode === 'history') {
    const { units } = collectHistory(root)
    scanUnits(units)
  } else if (options.mode === 'message') {
    if (!options.message || !existsSync(options.message)) throw new Error('--message needs a readable file')
    scanned += 1
    findings.push(...withLocations(readFileSync(options.message, 'utf8'), 'commit message', config))
  } else {
    throw new Error(`unknown mode: ${options.mode}`)
  }

  if (options.json) {
    const payload = {
      ok: findings.length === 0,
      scanned,
      findings: findings.map((finding) => ({
        file: finding.file,
        line: finding.line,
        rule: finding.rule,
        value: options.show ? finding.value : maskValue(finding),
      })),
    }
    console.log(JSON.stringify(payload, null, 2))
    return findings.length === 0 ? 0 : 1
  }

  console.log(`privacy gate: scanned ${scanned} file(s) in ${options.mode} mode`)
  return report(findings, options)
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  main().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    console.error(`privacy gate: ${error?.message ?? error}`)
    process.exitCode = 2
  })
}
