/**
 * Proxy-aware HTTP fetch used by the `tailtransit` web provider.
 *
 * Dependency-free (Node builtins only) so it can be exercised without the
 * Harness runtime. Every failure is a {@link FetchTransportError} carrying one
 * of the `WEB_*` codes the web seam expects; `index.js` re-wraps it as the
 * seam's `WebError`.
 *
 * @module dsh-tailtransit/transport
 */
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'

export class FetchTransportError extends Error {
  constructor(message, code = 'WEB_PROVIDER_ERROR', options) {
    super(message, options)
    this.name = 'FetchTransportError'
    this.code = code
  }
}

function headerOf(headers, name) {
  const value = headers?.[name]
  if (Array.isArray(value)) return value.join(', ')
  return typeof value === 'string' ? value : ''
}

export function validateUrl(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new FetchTransportError('URL is empty', 'WEB_INVALID_URL')
  }
  if (input.length > 2048) {
    throw new FetchTransportError('URL is longer than 2048 characters', 'WEB_INVALID_URL')
  }
  let url
  try {
    url = new URL(input)
  } catch (error) {
    throw new FetchTransportError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchTransportError(`unsupported URL scheme "${url.protocol}"`, 'WEB_INVALID_URL')
  }
  if (url.username || url.password) {
    throw new FetchTransportError('URL must not carry credentials', 'WEB_INVALID_URL')
  }
  return url
}

function classifyContentType(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (mime.length === 0) {
    throw new FetchTransportError('response has no Content-Type', 'WEB_UNSUPPORTED_CONTENT_TYPE')
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime.endsWith('+json') ||
    mime.endsWith('+xml')
  ) {
    return 'text'
  }
  throw new FetchTransportError(`unsupported content type "${mime}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
}

function charsetOf(contentType) {
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType || '')
  if (!match) return 'utf-8'
  const label = match[1].trim().toLowerCase()
  if (label === 'utf8') return 'utf-8'
  return label
}

function decompress(buffer, encoding) {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(buffer)
    case 'deflate': {
      try {
        return zlib.inflateSync(buffer)
      } catch {
        return zlib.inflateRawSync(buffer)
      }
    }
    case 'br':
      return zlib.brotliDecompressSync(buffer)
    case 'identity':
      return buffer
    default:
      throw new FetchTransportError(`unsupported content-encoding "${encoding}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
  }
}

function openDirect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    socket.setNoDelay(true)
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new FetchTransportError(`connection to ${host}:${port} timed out`, 'WEB_FETCH_TIMEOUT'))
    })
    socket.once('connect', () => {
      socket.setTimeout(0)
      resolve(socket)
    })
    socket.once('error', (error) => {
      reject(new FetchTransportError(`connection to ${host}:${port} failed: ${error.message}`, 'WEB_PROVIDER_ERROR'))
    })
  })
}

/**
 * Open a TCP tunnel through an HTTP proxy with CONNECT.
 * Resolves at the start of the tunnelled byte stream.
 */
function openTunnel(proxyUrl, host, port, timeoutMs) {
  const proxy = new URL(proxyUrl)
  const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80))
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: proxyPort })
    socket.setNoDelay(true)
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new FetchTransportError(`proxy ${proxy.host} did not answer CONNECT in time`, 'WEB_FETCH_TIMEOUT'))
    })

    let buffer = Buffer.alloc(0)
    const fail = (error) => {
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.destroy()
      reject(error)
    }
    const onError = (error) => fail(new FetchTransportError(`proxy connection failed: ${error.message}`, 'WEB_PROVIDER_ERROR'))
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) {
        if (buffer.length > 32768) fail(new FetchTransportError('proxy sent an oversized CONNECT response', 'WEB_PROVIDER_ERROR'))
        return
      }
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.setTimeout(0)
      const statusLine = buffer.subarray(0, buffer.indexOf('\r\n')).toString('latin1')
      const status = Number(statusLine.split(' ')[1])
      if (status !== 200) {
        fail(new FetchTransportError(`proxy CONNECT ${host}:${port} failed: ${statusLine}`, 'WEB_PROVIDER_ERROR'))
        return
      }
      const rest = buffer.subarray(end + 4)
      socket.pause()
      if (rest.length > 0) socket.unshift(rest)
      resolve(socket)
    }

    socket.on('data', onData)
    socket.on('error', onError)
    socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Connection: keep-alive\r\n\r\n`)
  })
}

function startTls(socket, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isIp = net.isIP(host) !== 0
    const secure = tls.connect({
      socket,
      host,
      servername: isIp ? undefined : host,
      ALPNProtocols: ['http/1.1'],
    })
    const timer = setTimeout(() => {
      secure.destroy()
      reject(new FetchTransportError(`TLS handshake with ${host} timed out`, 'WEB_FETCH_TIMEOUT'))
    }, timeoutMs)
    secure.once('secureConnect', () => {
      clearTimeout(timer)
      secure.setTimeout(0)
      resolve(secure)
    })
    secure.once('error', (error) => {
      clearTimeout(timer)
      reject(new FetchTransportError(`TLS handshake with ${host} failed: ${error.message}`, 'WEB_PROVIDER_ERROR'))
    })
  })
}

/** One GET over an already-open socket (direct or tunnelled). */
function requestOnce(target, options) {
  const isHttps = target.protocol === 'https:'
  const host = target.hostname.replace(/^\[|\]$/g, '')
  const port = Number(target.port || (isHttps ? 443 : 80))

  return new Promise((resolve, reject) => {
    let socket = null
    let request = null
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      try { request?.destroy() } catch {}
      try { socket?.destroy() } catch {}
      reject(error)
    }
    const onAbort = () => fail(new FetchTransportError('web fetch aborted', 'WEB_ABORTED'))
    const timer = setTimeout(
      () => fail(new FetchTransportError('web fetch timed out', 'WEB_FETCH_TIMEOUT')),
      options.timeoutMs,
    )

    if (options.signal?.aborted) {
      fail(new FetchTransportError('web fetch aborted', 'WEB_ABORTED'))
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    ;(async () => {
      try {
        const raw = options.proxyUrl
          ? await openTunnel(options.proxyUrl, host, port, options.timeoutMs)
          : await openDirect(host, port, options.timeoutMs)
        socket = isHttps ? await startTls(raw, host, options.timeoutMs) : raw
      } catch (error) {
        fail(error)
        return
      }
      if (settled) {
        socket.destroy()
        return
      }

      const agent = new http.Agent({ keepAlive: false })
      agent.createConnection = (_agentOptions, callback) => {
        callback(null, socket)
        return socket
      }

      request = http.request(
        {
          method: 'GET',
          host,
          port,
          path: (target.pathname || '/') + target.search,
          agent,
          headers: {
            host: target.host,
            'user-agent': options.userAgent,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
            'accept-encoding': 'gzip, deflate, br',
            connection: 'close',
          },
        },
        (response) => {
          const statusCode = response.statusCode || 0
          const location = headerOf(response.headers, 'location')
          if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
            response.destroy()
            succeed({ statusCode, redirect: location })
            return
          }

          const chunks = []
          let size = 0
          response.on('data', (chunk) => {
            size += chunk.length
            if (size > options.maxBytes) {
              response.destroy()
              fail(new FetchTransportError(`response is larger than ${options.maxBytes} bytes`, 'WEB_FETCH_TOO_LARGE'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => succeed({ statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
          response.on('error', (error) => fail(new FetchTransportError(`reading response failed: ${error.message}`, 'WEB_PROVIDER_ERROR')))
        },
      )
      request.on('error', (error) => {
        if (settled) return
        fail(new FetchTransportError(`request failed: ${error.message}`, 'WEB_PROVIDER_ERROR'))
      })
      request.end()
      // The tunnel socket was paused to preserve bytes already read past the
      // CONNECT response; the parser is attached by now, so let it flow.
      if (!socket.destroyed) socket.resume()
    })()
  })
}

/**
 * Fetch one URL, optionally through an HTTP proxy, following same-origin
 * redirects and returning decoded, bounded text.
 *
 * @param {string} input
 * @param {{
 *   proxyUrl?: string | undefined,
 *   signal?: AbortSignal,
 *   timeoutMs: number,
 *   maxRedirects: number,
 *   maxBytes: number,
 *   maxChars: number,
 *   userAgent: string,
 * }} options
 */
export async function fetchThroughProxy(input, options) {
  let target = validateUrl(input)
  const origin = target.origin

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const response = await requestOnce(target, options)

    if (response.redirect !== undefined) {
      let next
      try {
        next = new URL(response.redirect, target)
      } catch (error) {
        throw new FetchTransportError(`invalid redirect Location "${response.redirect}"`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
      if (next.origin !== origin) {
        throw new FetchTransportError(`cross-origin redirect to ${next.href} is blocked`, 'WEB_REDIRECT_BLOCKED')
      }
      target = next
      continue
    }

    const contentType = headerOf(response.headers, 'content-type')
    const kind = classifyContentType(contentType)
    const encoding = headerOf(response.headers, 'content-encoding').toLowerCase().trim()
    const raw = encoding ? decompress(response.body, encoding) : response.body
    const charset = charsetOf(contentType)

    let text
    try {
      text = new TextDecoder(charset).decode(raw)
    } catch (error) {
      throw new FetchTransportError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
    }

    const truncated = text.length > options.maxChars
    return {
      url: target.href,
      statusCode: response.statusCode,
      body: { kind, content: truncated ? text.slice(0, options.maxChars) : text },
      truncated,
    }
  }

  throw new FetchTransportError(`more than ${options.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
}
