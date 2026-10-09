/**
 * The plugin's host routes: card catalog, card mutation, directory reveal and
 * the rewrite call.
 *
 * Model route resolution follows the session, not a plugin setting: the
 * rewrite runs on the exact provider/model the session's own last request
 * used, falling back to the harness default only when the session has not yet
 * made a request. That keeps "one model to think about" true for the user.
 *
 * @module dsh-persona-forge/routes
 */

import { spawn } from 'node:child_process'
import {
  PREFIX,
  REWRITE_ENDPOINT,
  CARDS_ENDPOINT,
  CARD_SAVE_ENDPOINT,
  CARD_DELETE_ENDPOINT,
  CARD_RESET_ENDPOINT,
  REVEAL_ENDPOINT,
} from './shared/protocol.js'
import { isTrustedRequest } from './loopback.js'
import { readBoundedJson, writeJson } from './http.js'
import { normalizeCard } from './store.js'
import {
  buildSystemPrompt,
  examplesFor,
  frameDraft,
  frameFactCheck,
  parseFactCheck,
  renderTemplate,
  FACT_CHECK_SYSTEM,
} from './prompts.js'
import { rewriteDraft, checkPreservation } from './rewrite.js'

/** Largest accepted request body. */
const MAX_BODY_BYTES = 512 * 1024

/** Largest accepted draft, in characters. */
const MAX_DRAFT_CHARS = 40_000

/** Largest rewrite output requested from the model. */
const REWRITE_MAX_TOKENS = 4096

/** Narrow a provider/model pair out of an untrusted object. */
function routeOf(candidate) {
  if (candidate === null || candidate === undefined || typeof candidate !== 'object') return undefined
  const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/** Read one entry from a service exposing a Map-like `get`, guarding every step. */
function serviceEntry(ctx, service, key) {
  let holder
  try {
    holder = ctx.get(service)
  } catch {
    return undefined
  }
  if (holder === null || holder === undefined || typeof holder.get !== 'function') return undefined
  try {
    return holder.get(key)
  } catch {
    return undefined
  }
}

/**
 * The session's own model route: the provider/model of its last request
 * header. This is the primary source, so a rewrite always runs on the model
 * the user is actually talking to.
 * @returns the route, or undefined when the session has no header yet.
 */
export function sessionRouteOf(ctx, sessionId) {
  if (sessionId === undefined || sessionId === '') return undefined
  const session = serviceEntry(ctx, 'sessions', sessionId)
  if (session === null || session === undefined) return undefined
  let header
  try {
    header = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
  } catch {
    return undefined
  }
  return routeOf(header?.config)
}

/**
 * The harness-wide default route, used only before a session has made its
 * first request. Reached defensively because the service name and shape have
 * moved between harness releases.
 * @returns the route, or undefined.
 */
export function defaultRouteOf(ctx) {
  let service
  try {
    service = ctx.get('agentDefaultModel')
  } catch {
    return undefined
  }
  if (service === null || service === undefined || typeof service.currentSelection !== 'function') return undefined
  try {
    return routeOf(service.currentSelection())
  } catch {
    return undefined
  }
}

/**
 * Resolve the route one rewrite should use: the session's own route first, so
 * the rewrite follows the model the user selected.
 * @param ctx - the host context.
 * @param sessionId - the calling session, when known.
 * @returns the route, or undefined when nothing resolves one.
 */
export function resolveRoute(ctx, sessionId) {
  return sessionRouteOf(ctx, sessionId) ?? defaultRouteOf(ctx)
}

/** Map a provider failure onto a stable, user-actionable code. */
function errorCodeOf(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === 'TIMEOUT') return 'timeout'
  if (code === 'MAX_TOKENS') return 'upstream'
  if (code === 'EMPTY_RESPONSE') return 'upstream'
  if (code === 'NO_ADAPTER') return 'unconfigured'
  if (code === 'AUTH' || code === 'INVALID_CREDENTIAL') return 'upstream'
  if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') return 'upstream'
  return 'internal'
}

/** Open a directory in the OS file manager, best effort. */
function revealDirectory(dir) {
  const command = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * Serve one request under the plugin prefix.
 * @param deps - the store, context and config readers.
 */
async function serve(deps, req, res) {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (!isTrustedRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'loopback-only' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'method', message: 'only POST is allowed' } })
    return
  }
  let body
  try {
    body = await readBoundedJson(req, MAX_BODY_BYTES)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body too large'
    writeJson(res, tooLarge ? 413 : 422, {
      ok: false,
      error: { code: 'rejected', message: tooLarge ? 'request body is too large' : 'request body is not valid JSON' },
    })
    return
  }
  if (body === null || typeof body !== 'object') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'request body must be a JSON object' } })
    return
  }

  switch (pathname) {
    case CARDS_ENDPOINT:
      await serveCards(deps, res)
      return
    case CARD_SAVE_ENDPOINT:
      await serveCardSave(deps, body, res)
      return
    case CARD_DELETE_ENDPOINT:
      await serveCardDelete(deps, body, res)
      return
    case CARD_RESET_ENDPOINT:
      await serveCardReset(deps, body, res)
      return
    case REVEAL_ENDPOINT:
      await serveReveal(deps, res)
      return
    case REWRITE_ENDPOINT:
      await serveRewrite(deps, body, req, res)
      return
    default:
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown persona-forge route' } })
  }
}

/** The card catalog plus loader diagnostics. */
async function serveCards(deps, res) {
  try {
    const catalog = await deps.store.list()
    writeJson(res, 200, {
      ok: true,
      value: {
        cards: catalog.cards,
        diagnostics: catalog.diagnostics,
        directory: catalog.directory,
        sendMode: deps.readConfig().sendMode,
        factCheck: deps.readConfig().factCheck,
      },
    })
  } catch (error) {
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Persist one edited card. */
async function serveCardSave(deps, body, res) {
  const result = normalizeCard(body.card, { fallbackId: undefined, source: 'user' })
  if (result.error !== undefined) {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: result.error } })
    return
  }
  try {
    const path = await deps.store.save(result.card)
    writeJson(res, 200, { ok: true, value: { id: result.card.id, path } })
  } catch (error) {
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Delete one user card file (or the override of a built-in id). */
async function serveCardDelete(deps, body, res) {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'id is required' } })
    return
  }
  try {
    const removed = await deps.store.remove(id)
    writeJson(res, 200, { ok: true, value: { removed } })
  } catch (error) {
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Replace one user card with the bundled card of the same id. */
async function serveCardReset(deps, body, res) {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'id is required' } })
    return
  }
  try {
    const reset = await deps.store.resetToBundled(id)
    writeJson(res, reset ? 200 : 404, reset
      ? { ok: true, value: { id } }
      : { ok: false, error: { code: 'no-card', message: `no bundled card with id "${id}"` } })
  } catch (error) {
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** Create the card directory and open it in the OS file manager. */
async function serveReveal(deps, res) {
  try {
    const dir = await deps.ensureCardDir()
    const opened = revealDirectory(dir)
    writeJson(res, 200, { ok: true, value: { directory: dir, opened } })
  } catch (error) {
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } })
  }
}

/** One rewrite, plus the optional preservation check. */
async function serveRewrite(deps, body, req, res) {
  const text = typeof body.text === 'string' ? body.text : ''
  const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : ''
  const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
  if (text.trim() === '') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'the draft is empty' } })
    return
  }
  if (text.length > MAX_DRAFT_CHARS) {
    writeJson(res, 422, {
      ok: false,
      error: { code: 'rejected', message: `the draft exceeds ${MAX_DRAFT_CHARS} characters`, params: { max: MAX_DRAFT_CHARS } },
    })
    return
  }
  if (cardId === '') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'cardId is required' } })
    return
  }
  const card = await deps.store.get(cardId)
  if (card === undefined) {
    writeJson(res, 404, { ok: false, error: { code: 'no-card', message: `no character card with id "${cardId}"` } })
    return
  }
  const config = deps.readConfig()
  const intensity = typeof body.intensity === 'string' && ['light', 'medium', 'strong', 'zealot'].includes(body.intensity)
    ? body.intensity
    : card.intensity
  // A caller may not widen fidelity beyond what the card declares: strategy
  // rewriting can add behavioural constraints, which is the card author's
  // decision, not a per-message toggle.
  const fidelity = card.fidelity

  // Cancel the model call when the browser goes away mid-flight.
  const callerAbort = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) callerAbort.abort()
  }
  res.on('close', onClose)
  try {
    if (card.mode === 'template') {
      const rendered = renderTemplate(card.template ?? '', text)
      writeJson(res, 200, {
        ok: true,
        value: {
          text: rendered,
          provider: '',
          model: '',
          mode: 'template',
          cardId: card.id,
          fidelity,
          intensity,
          elapsedMs: 0,
          factCheck: { state: 'skipped', reason: 'template mode replaces the draft verbatim' },
        },
      })
      return
    }

    const route = resolveRoute(deps.ctx, sessionId)
    if (route === undefined) {
      writeJson(res, 409, {
        ok: false,
        error: {
          code: 'unconfigured',
          message: 'no model route resolved: send one message in this session first, or set a default model',
        },
      })
      return
    }
    let llm
    try {
      llm = deps.ctx.get('llm')
    } catch {
      llm = undefined
    }
    if (llm === undefined || typeof llm.stream !== 'function') {
      writeJson(res, 500, { ok: false, error: { code: 'internal', message: 'the llm service is unavailable' } })
      return
    }

    const system = buildSystemPrompt(card, intensity, examplesFor(card, intensity))
    const result = await rewriteDraft(llm, {
      provider: route.provider,
      model: route.model,
      system,
      userMessage: frameDraft(text),
      maxTokens: REWRITE_MAX_TOKENS,
      signal: callerAbort.signal,
    })

    // The preservation check is advisory: it never blocks a rewrite, it only
    // annotates it so the review panel can warn before the user sends.
    let factCheck = { state: 'skipped', reason: 'disabled in settings' }
    if (config.factCheck) {
      const verdict = await checkPreservation(llm, {
        provider: route.provider,
        model: route.model,
        system: FACT_CHECK_SYSTEM,
        userMessage: frameFactCheck(text, result.text),
        signal: callerAbort.signal,
        parse: parseFactCheck,
      })
      factCheck = verdict
    }

    writeJson(res, 200, {
      ok: true,
      value: {
        text: result.text,
        provider: route.provider,
        model: route.model,
        mode: 'llm',
        cardId: card.id,
        fidelity,
        intensity,
        elapsedMs: result.elapsedMs,
        factCheck,
      },
    })
  } catch (error) {
    const code = errorCodeOf(error)
    writeJson(res, code === 'timeout' ? 504 : code === 'unconfigured' ? 409 : 502, {
      ok: false,
      error: { code, message: error instanceof Error ? error.message : String(error) },
    })
  } finally {
    res.off('close', onClose)
  }
}

/**
 * Register every route on the shared web server.
 *
 * The web server is PASSED IN rather than read from the context here. It
 * mounts later than a plugin that declares no service dependencies, so reading
 * it during `apply()` found nothing and silently registered no routes at all —
 * every request then fell through to the SPA fallback (405/404 with an empty
 * body). The caller waits for the service with `ctx.inject(['webServer'], …)`
 * and passes it in.
 * @param webServer - the mounted web server service.
 * @param deps - the store, context, config reader and directory helper.
 * @returns the route disposer, or a no-op when no web server is present.
 */
export function registerRoutes(webServer, deps) {
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
    return () => {}
  }
  return webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => serve(deps, req, res),
  })
}
