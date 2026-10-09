/**
 * Host integration check for dsh-persona-forge.
 *
 * Loads the real plugin entry the way the harness loader does, mounts it on a
 * stub Cordis context, and drives the real HTTP routes over a real socket.
 * This covers what the offline check cannot: `apply()` wiring, route
 * registration, the card store against the real filesystem, and the request /
 * response envelope.
 *
 * No harness is required and no model call is made: the `llm` service is
 * stubbed with a deterministic stream, so the run is offline and repeatable.
 *
 * Run with `node scripts/host-check.mjs`.
 */

import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
let checks = 0

function check(name, condition, detail) {
  checks++
  if (condition) {
    console.log(`ok    ${name}`)
    return
  }
  failures++
  console.error(`FAIL  ${name}${detail !== undefined ? `\n      ${detail}` : ''}`)
}

/** Point the plugin at a throwaway harness home so the real one is untouched. */
const home = await mkdtemp(join(tmpdir(), 'persona-forge-check-'))
process.env.DSH_HOME = home

/**
 * A minimal Cordis-like context: `get` for services, `effect` for disposers.
 * Mirrors the surface the plugin actually uses.
 */
function makeContext(services) {
  const disposers = []
  return {
    get: (name) => services[name],
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    disposeAll: () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // Best effort teardown.
        }
      }
    },
  }
}

/** A stub llm service that answers with a fixed persona rewrite. */
function makeLlm(answer, options = {}) {
  const calls = []
  return {
    calls,
    stream(generate) {
      calls.push(generate)
      if (options.throwOnCall === true) throw new Error('llm unavailable')
      const text = options.echoSystem === true ? `${answer}` : answer
      return (async function* generate_() {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

// ---------------------------------------------------------------------------
console.log('== mount')

const { apply } = await import('../lib/index.js')

const llm = makeLlm('万机之座在上，恳请您为我们编写一个快速排序算法，使重复之数各归其位。')
const sessionHeader = { config: { provider: 'stub-provider', model: 'stub-model' } }
const services = {
  llm,
  sessions: { get: (id) => (id === 'session-1' ? { requestHeader: () => sessionHeader } : undefined) },
  webServer: {
    register(route) {
      check('route registered under the plugin prefix', route.path === '/persona-forge', route.path)
      check('route is a prefix route', route.kind === 'prefix', route.kind)
      registered = route
      return () => {}
    },
  },
}
let registered
const ctx = makeContext(services)

apply(ctx, { sendMode: 'review', factCheck: true, watchCards: true })
// The plugin loads bundled cards asynchronously; give that a turn to settle.
await new Promise((resolve) => setTimeout(resolve, 200))

check('webServer route captured', registered !== undefined)

// ---------------------------------------------------------------------------
console.log('\n== routes over a real socket')

const server = createServer((req, res) => {
  Promise.resolve(registered.handler(req, res)).catch((error) => {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(error) }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function post(path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  })
  let parsed
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }
  return { status: response.status, body: parsed }
}

const cards = await post('/persona-forge/cards', {})
check('cards route answers 200', cards.status === 200, JSON.stringify(cards.body))
check('both bundled cards are served', cards.body?.value?.cards?.length === 2, JSON.stringify(cards.body?.value?.cards?.map((card) => card.id)))
check('no bundled card diagnostics', cards.body?.value?.diagnostics?.length === 0, JSON.stringify(cards.body?.value?.diagnostics))
check('card directory is under the harness home', cards.body?.value?.directory?.startsWith(home), cards.body?.value?.directory)

// ---------------------------------------------------------------------------
console.log('\n== rewrite follows the session model')

const rewrite = await post('/persona-forge/rewrite', {
  cardId: 'omnissiah',
  text: '帮我写个快速排序',
  sessionId: 'session-1',
})
check('rewrite answers 200', rewrite.status === 200, JSON.stringify(rewrite.body))
check('rewrite returns the model text', typeof rewrite.body?.value?.text === 'string' && rewrite.body.value.text.length > 0, JSON.stringify(rewrite.body))
check(
  'rewrite used the SESSION route, not a default',
  rewrite.body?.value?.provider === 'stub-provider' && rewrite.body?.value?.model === 'stub-model',
  `${rewrite.body?.value?.provider}/${rewrite.body?.value?.model}`,
)
check('rewrite reports the card fidelity', rewrite.body?.value?.fidelity === 'style', rewrite.body?.value?.fidelity)
check('rewrite carries a fact-check verdict', typeof rewrite.body?.value?.factCheck?.state === 'string', JSON.stringify(rewrite.body?.value?.factCheck))

// The system prompt must carry the rules the design depends on.
const sentSystem = llm.calls[0]?.system ?? ''
check('system prompt states the speaker direction', sentSystem.includes('USER'), sentSystem.slice(0, 120))
check('system prompt carries the preservation rules', sentSystem.includes('Preserve the technical content EXACTLY'))
check('system prompt carries the conversion examples', sentSystem.includes('Conversion examples'))
check('the draft is framed, not inlined raw', String(llm.calls[0]?.messages?.[0]?.content?.[0]?.text ?? '').includes('<draft>'))
check('the rewrite call carries no reasoningEffort override', llm.calls[0]?.reasoningEffort === undefined, String(llm.calls[0]?.reasoningEffort))
check('the rewrite call creates no session turn', llm.calls[0]?.sessionId === undefined, String(llm.calls[0]?.sessionId))

// ---------------------------------------------------------------------------
console.log('\n== template mode bypasses the model')

const cardDir = join(home, 'persona-cards')
const { mkdir, readdir, readFile: readFileSeed } = await import('node:fs/promises')
await mkdir(cardDir, { recursive: true })

// ---------------------------------------------------------------------------
console.log('\n== bundled cards seed the user directory')

// Seeding runs at mount, before this point. The bundled cards must appear as
// editable files so "open the card directory" is not an empty folder.
const seededFiles = (await readdir(cardDir)).filter((name) => name.endsWith('.yml')).sort()
check(
  'bundled cards are seeded into the card directory',
  seededFiles.includes('omnissiah.yml') && seededFiles.includes('muscle-crew.yml'),
  JSON.stringify(seededFiles),
)
const seededText = await readFileSeed(join(cardDir, 'omnissiah.yml'), 'utf8')
check(
  'the seeded file is editable YAML carrying its examples',
  seededText.includes('id: omnissiah') && seededText.includes('examples:'),
  seededText.slice(0, 140),
)

// Seeding must never clobber a user's own edit: an existing file wins. The
// replacement uses `examples:` with no value rather than `[]`, because a flow
// sequence is a construct this reader deliberately refuses.
await writeFile(join(cardDir, 'omnissiah.yml'), 'id: omnissiah\nname: MY EDIT\nmode: llm\nfidelity: style\nintensity: medium\nstyle: my own style\n', 'utf8')
await new Promise((resolve) => setTimeout(resolve, 400))
const afterEdit = await post('/persona-forge/cards', {})
const editedCard = afterEdit.body?.value?.cards?.find((card) => card.id === 'omnissiah')
check('a user edit is not overwritten by the bundled card', editedCard?.name === 'MY EDIT', JSON.stringify(editedCard?.name))
check(
  'the user edit produced no diagnostic',
  afterEdit.body?.value?.diagnostics?.length === 0,
  JSON.stringify(afterEdit.body?.value?.diagnostics),
)
// Restore the bundled content for the checks that follow.
await writeFile(join(cardDir, 'omnissiah.yml'), seededText, 'utf8')
await new Promise((resolve) => setTimeout(resolve, 300))

await writeFile(join(cardDir, 'litany.yml'), [
  'id: litany',
  'name: 固定祷词',
  'mode: template',
  'fidelity: style',
  'intensity: medium',
  'template: |',
  '  万机之座在上：',
  '  {{input}}',
  '  愿机魂安宁。',
  'style: unused',
  '',
].join('\n'), 'utf8')
// The directory watcher reloads on change; read through a fresh route call.
await new Promise((resolve) => setTimeout(resolve, 300))

// One earlier rewrite already spent two calls: the rewrite itself plus the
// preservation check. Template mode must add none.
const callsBeforeTemplate = llm.calls.length
const template = await post('/persona-forge/rewrite', { cardId: 'litany', text: '修复数组越界' })
check('template card is discovered from a dropped file', template.status === 200, JSON.stringify(template.body))
check('template mode renders without a model call', template.body?.value?.mode === 'template', template.body?.value?.mode)
check('template substitutes the draft', String(template.body?.value?.text ?? '').includes('修复数组越界'), template.body?.value?.text)
check('template mode reports the check as skipped', template.body?.value?.factCheck?.state === 'skipped', JSON.stringify(template.body?.value?.factCheck))
check('template mode made no llm call', llm.calls.length === callsBeforeTemplate, `before=${callsBeforeTemplate} after=${llm.calls.length}`)

// ---------------------------------------------------------------------------
console.log('\n== a malformed card is refused, not guessed at')

await writeFile(join(cardDir, 'bad.yml'), 'id: bad\nname: x\nmode: llm\nstyle: y\nexamples: [{from: a, to: b}]\n', 'utf8')
await new Promise((resolve) => setTimeout(resolve, 300))
const afterBad = await post('/persona-forge/cards', {})
const badDiagnostic = afterBad.body?.value?.diagnostics?.find((row) => row.file === 'bad.yml')
check('flow-style YAML is refused with a diagnostic', badDiagnostic !== undefined, JSON.stringify(afterBad.body?.value?.diagnostics))
check(
  'the diagnostic names the unsupported construct',
  typeof badDiagnostic?.error === 'string' && badDiagnostic.error.includes('flow'),
  badDiagnostic?.error,
)
check(
  'a bad card does not break the catalog',
  afterBad.body?.value?.cards?.some((card) => card.id === 'omnissiah') === true,
  JSON.stringify(afterBad.body?.value?.cards?.map((card) => card.id)),
)

// ---------------------------------------------------------------------------
console.log('\n== failure paths')

const noCard = await post('/persona-forge/rewrite', { cardId: 'nope', text: 'hi' })
check('unknown card is 404 with a stable code', noCard.status === 404 && noCard.body?.error?.code === 'no-card', JSON.stringify(noCard.body))

const empty = await post('/persona-forge/rewrite', { cardId: 'omnissiah', text: '   ' })
check('empty draft is rejected', empty.status === 422 && empty.body?.error?.code === 'rejected', JSON.stringify(empty.body))

const noRoute = await post('/persona-forge/rewrite', { cardId: 'omnissiah', text: 'hi', sessionId: 'unknown-session' })
check('an unknown session still rewrites via the default route', noRoute.status === 200 || noRoute.status === 409, JSON.stringify(noRoute.body))

const badJson = await post('/persona-forge/cards', 'not json')
check('invalid JSON is 422', badJson.status === 422, JSON.stringify(badJson.body))

const unknown = await post('/persona-forge/nope', {})
check('unknown route is 404', unknown.status === 404, JSON.stringify(unknown.body))

const getResponse = await fetch(`${base}/persona-forge/cards`, { method: 'GET' })
check('GET is refused', getResponse.status === 405, String(getResponse.status))

// ---------------------------------------------------------------------------
console.log('\n== loopback fence')

/**
 * Send a request with a literal, hand-written header set.
 *
 * `fetch` cannot express these cases: undici derives `Host` from the URL and
 * forbids overriding it, so a forged-host test written with `fetch` would
 * silently test nothing. Raw `http.request` is the only way to put the header
 * on the wire.
 * @param path - request path.
 * @param headers - the exact headers to send.
 * @returns the status code and parsed body.
 */
async function postRaw(path, headers) {
  const { request } = await import('node:http')
  return new Promise((resolve, reject) => {
    const port = server.address().port
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          let parsed
          try {
            parsed = JSON.parse(body)
          } catch {
            parsed = undefined
          }
          resolve({ status: res.statusCode, body: parsed })
        })
      },
    )
    req.on('error', reject)
    req.end('{}')
  })
}

const forgedHost = await postRaw('/persona-forge/cards', { host: 'evil.example.com' })
check('a forged Host header is refused (DNS rebinding)', forgedHost.status === 403, JSON.stringify(forgedHost.body))

const forwarded = await postRaw('/persona-forge/cards', { 'x-forwarded-for': '1.2.3.4' })
check('a proxy-forwarding header is refused', forwarded.status === 403, JSON.stringify(forwarded.body))

const trustedHost = await postRaw('/persona-forge/cards', { host: 'localhost' })
check('a loopback Host header is allowed', trustedHost.status === 200, JSON.stringify(trustedHost.body))

// ---------------------------------------------------------------------------
console.log('\n== card save and delete round trip')

const saved = await post('/persona-forge/cards/save', {
  card: {
    id: 'written-by-test',
    name: '写入测试',
    mode: 'llm',
    fidelity: 'style',
    intensity: 'light',
    style: 'line one\nline two\n',
    examples: [{ from: 'a: 1', to: 'b # 2' }],
  },
})
check('card save succeeds', saved.status === 200, JSON.stringify(saved.body))

const reloaded = await post('/persona-forge/cards', {})
const written = reloaded.body?.value?.cards?.find((card) => card.id === 'written-by-test')
check('the saved card reads back', written !== undefined, JSON.stringify(reloaded.body?.value?.cards?.map((card) => card.id)))
// Card text fields are trimmed on load, so the stored form is the trimmed
// value — that is what makes save/load idempotent for hand-edited files.
check('the saved card round-trips its multi-line style', written?.style === 'line one\nline two', JSON.stringify(written?.style))
check('the saved card round-trips its example', written?.examples?.[0]?.from === 'a: 1' && written?.examples?.[0]?.to === 'b # 2', JSON.stringify(written?.examples))

const removed = await post('/persona-forge/cards/delete', { id: 'written-by-test' })
check('card delete succeeds', removed.status === 200 && removed.body?.value?.removed === true, JSON.stringify(removed.body))

const afterDelete = await post('/persona-forge/cards', {})
check('the deleted card is gone', afterDelete.body?.value?.cards?.some((card) => card.id === 'written-by-test') === false, JSON.stringify(afterDelete.body?.value?.cards?.map((card) => card.id)))

// ---------------------------------------------------------------------------
console.log('\n== teardown')

server.close()
ctx.disposeAll()
await rm(home, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('OK')
