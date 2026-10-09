/**
 * Minimal JSON body reader and response writer for this plugin's host routes.
 * @module dsh-persona-forge/http
 */

/**
 * Read a request body of at most `maxBytes` and parse it as JSON. On overflow
 * the reader stops consuming and throws WITHOUT destroying the request, so the
 * route still owes the client a deliverable 413.
 * @throws 'body too large' past the cap, or the JSON.parse error otherwise.
 */
export async function readBoundedJson(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Write one JSON response. Results are per-request and must never be cached. */
export function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
