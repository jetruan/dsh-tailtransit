/**
 * Proxy bypass policy for dsh-tailtransit.
 *
 * The Harness launcher and `dsh-subprocess` turn the proxy variables this
 * plugin publishes into a per-origin routing decision, and their matcher reads
 * `NO_PROXY` as a list of host suffixes. Two consequences shape everything
 * here:
 *
 *   - CIDR and bare-IP entries never match, because matching is on the request
 *     URL's hostname, not on the address it resolves to. `10.0.0.0/8` is
 *     silently ignored, so an intranet has to be named by hostname.
 *   - A domain entry covers every subdomain under it, so one root entry is
 *     enough for a family of endpoints.
 *
 * Because the intranet hostnames differ for every deployment, this module
 * derives them from the provider configuration the user filled in instead of
 * shipping a fixed vendor list. Every read is defensive: a missing service or
 * a malformed value yields no entry rather than an exception, so a failed
 * discovery falls back to the manual list instead of breaking the plugin.
 *
 * Dependency-free on purpose, so it stays testable without a Harness.
 *
 * @module dsh-tailtransit/noproxy
 */

/** Loopback entries a proxy must never carry: the proxy itself listens there. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1']

/**
 * Hosts of the Harness vendor's own service, bypassed whenever LLM traffic
 * stays direct.
 *
 * This is not a customer domain and not a guess about the user's setup: it is
 * the vendor's account and quota service, which the provider configuration
 * never mentions — a provider `baseURL` covers the model endpoint, not the
 * account one — so nothing could discover it. Everything user-specific comes
 * from {@link configuredLlmEndpoints} instead.
 */
export const HARNESS_VENDOR_BYPASS = ['deepseek.com', 'deepseeksvc.com']

/** Split a comma-separated list, trimming blanks. */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * The user's own bypass entries with loopback guaranteed present.
 *
 * @param config - the resolved plugin config (`noProxy` holds the user list).
 * @returns the comma-separated base list.
 */
export function noProxyList(config) {
  const list = splitList(config?.noProxy)
  // Prepend the missing loopback entries as one block so the published list
  // keeps the declared order instead of coming out reversed entry by entry.
  const missing = LOOPBACK_HOSTS.filter((base) => !list.includes(base))
  return [...missing, ...list].join(',')
}

/**
 * The bypass list every consumer must agree on: loopback, the user's entries,
 * and — unless LLM traffic is explicitly routed through the exit node — the
 * LLM endpoints this profile is configured against.
 *
 * `discovered` holds hostnames read from the provider configuration (see
 * {@link configuredLlmEndpoints}). It takes the place of any hard-coded vendor
 * domain, so a user who points the Harness at an intranet gateway gets that
 * gateway bypassed without editing anything. When `llmProxy` is on the model
 * endpoints are deliberately absent: the user asked for them to leave through
 * the exit node, and no automatic rule may override an explicit choice.
 *
 * @param config - the resolved plugin config.
 * @param discovered - hostnames of configured LLM endpoints, may be empty.
 * @returns the comma-separated bypass list.
 */
export function effectiveNoProxy(config, discovered = []) {
  const list = noProxyList(config).split(',')
  if (config?.llmProxy === true) return list.join(',')
  const merge = [...HARNESS_VENDOR_BYPASS, ...(discovered ?? []), ...splitList(config?.llmNoProxy)]
  for (const item of merge) {
    if (item && !list.includes(item)) list.push(item)
  }
  return list.join(',')
}

/**
 * Lowercased hostname of a base URL, or '' when the value carries none.
 *
 * A bare host is accepted (`api.example.com/v1`) because provider
 * configuration is hand-typed and the scheme is frequently omitted.
 *
 * @param value - a base URL or bare host.
 * @returns the hostname, or ''.
 */
export function hostOfUrl(value) {
  // Only strings are meaningful here. Coercing anything else is actively
  // harmful: `new URL('https://42')` yields 0.0.0.42, a host nobody configured.
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Endpoints declared under `providers:` in a profile patch document.
 *
 * A deliberately small reader rather than a YAML dependency: the profile patch
 * is machine-written with one key per line, and a plugin that shipped a parser
 * would be pinned to one YAML flavour across Harness versions. The block ends
 * at the first line indented no deeper than `providers:` itself, which is
 * enough to skip every nested `models:`/`input:` list underneath.
 *
 * @param text - the patch document.
 * @returns one `{ baseURL, host }` entry per declared `baseURL`.
 */
export function endpointsFromPatchText(text) {
  const found = []
  let inProviders = false
  let providersIndent = -1
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (/^providers:\s*$/.test(trimmed)) {
      inProviders = true
      providersIndent = indent
      continue
    }
    if (!inProviders) continue
    if (indent <= providersIndent) {
      inProviders = false
      continue
    }
    const match = /^baseURL:\s*(.+)$/.exec(trimmed)
    if (!match) continue
    const baseURL = match[1].trim().replace(/^['"]|['"]$/g, '')
    const host = hostOfUrl(baseURL)
    if (host && !found.some((item) => item.host === host)) found.push({ baseURL, host })
  }
  return found
}

/**
 * LLM endpoints named by the provider configuration the user filled in, read
 * through the loader's configuration service rather than from a fixed list.
 *
 * The service is looked up optionally: plugin load order and future Harness
 * versions may not expose `configEditor`, and a plugin must not fail to start
 * because an optional integration is missing.
 *
 * @param ctx - the plugin context, used to reach the configuration service.
 * @returns one `{ baseURL, host }` entry per configured provider endpoint.
 */
export function configuredLlmEndpoints(ctx) {
  const found = []
  try {
    // The service is reached three ways on purpose: as a plain context
    // property, through `get`, and through the root context. Plugin load order
    // and future Harness builds differ in which one answers, and a miss must
    // degrade to "no discovery" rather than to an exception.
    const editor = (() => {
      try { if (ctx?.configEditor) return ctx.configEditor } catch {}
      try { if (typeof ctx?.get === 'function') return ctx.get('configEditor') } catch {}
      try { if (typeof ctx?.root?.get === 'function') return ctx.root.get('configEditor') } catch {}
      return undefined
    })()
    if (typeof editor?.configuration !== 'function') return found
    for (const row of editor.configuration()) {
      const entry = row?.entry
      // The live effective config is preferred; the composed layers are the
      // fallback for entries whose fiber has not settled yet.
      const config = entry?.fiber?.effectiveConfig
        ?? { ...(row?.inherited ?? {}), ...(row?.override ?? {}) }
      const providers = config?.providers
      if (!providers || typeof providers !== 'object') continue
      for (const provider of Object.values(providers)) {
        const baseURL = typeof provider?.baseURL === 'string' ? provider.baseURL.trim() : ''
        const host = hostOfUrl(baseURL)
        if (host && !found.some((item) => item.host === host)) found.push({ baseURL, host })
      }
    }
  } catch {}
  return found
}