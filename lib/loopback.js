/**
 * Loopback trust fence for this plugin's host routes. The rewrite route
 * forwards the user's draft to a configured model provider and the card
 * routes read and write files under the harness home, so untrusted callers
 * must be turned away regardless of method or content type.
 * @module dsh-persona-forge/loopback
 */

/** Hostnames a browser or local process may use to reach the loopback server. */
const TRUSTED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

/** Whether the request arrived on a loopback socket address. */
export function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Strip the port (and IPv6 brackets) from a Host header value. */
function hostnameOf(hostHeader) {
  const trimmed = hostHeader.trim().toLowerCase()
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    return end === -1 ? trimmed : trimmed.slice(1, end)
  }
  const colon = trimmed.lastIndexOf(':')
  return colon === -1 ? trimmed : trimmed.slice(0, colon)
}

/** Origins a same-app page may come from to call the loopback server. */
function isTrustedOrigin(origin) {
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && TRUSTED_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * Full trust check: the socket must be loopback, the Host header must name a
 * loopback host (this defeats DNS rebinding), and no proxy-forwarding header
 * may be present. A missing Host header stays allowed because the socket
 * check already bounds the caller to local processes.
 * @param req - the incoming request.
 * @returns whether the request may reach a mutating or model-calling route.
 */
export function isTrustedRequest(req) {
  if (req.headers['x-forwarded-for'] !== undefined || req.headers.forwarded !== undefined) return false
  if (!isLoopbackRequest(req)) return false
  const host = req.headers.host
  if (typeof host !== 'string' || host.trim() === '') return true
  if (!TRUSTED_HOSTNAMES.has(hostnameOf(host))) return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.trim() !== '' && !isTrustedOrigin(origin)) return false
  return true
}
