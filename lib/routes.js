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
  CARD_DIFF_ENDPOINT,
  REVEAL_ENDPOINT,
  CARD_DRAFT_ENDPOINT,
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
  CARD_DRAFT_SYSTEM,
  frameCardBrief,
  parseCardDraft,
} from './prompts.js'
import { rewriteDraft, checkPreservation } from './rewrite.js'
import { compareFacts } from './preserve.js'

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
    case CARD_DIFF_ENDPOINT:
      await serveCardDiff(deps, res)
      return
    case CARD_DRAFT_ENDPOINT:
      await serveCardDraft(deps, body, req, res)
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
    // Tell the client which model an AI draft would run on, so the settings
    // page can SHOW it instead of the user having to guess. The settings slot
    // receives no session id from the shell, so this is the harness default —
    // reported honestly rather than described as "the session's model".
    const draftRoute = resolveRoute(deps.ctx, undefined)
    writeJson(res, 200, {
      ok: true,
      value: {
        cards: catalog.cards,
        diagnostics: catalog.diagnostics,
        directory: catalog.directory,
        sendMode: deps.readConfig().sendMode,
        factCheck: deps.readConfig().factCheck,
        draftModel: draftRoute === undefined ? null : { provider: draftRoute.provider, model: draftRoute.model },
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

/** Report user cards that differ from the bundled card of the same id. */
async function serveCardDiff(deps, res) {
  try {
    const rows = await deps.store.diffFromBundled()
    writeJson(res, 200, { ok: true, value: { rows } })
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

/** Largest accepted character brief, in characters. */
const MAX_BRIEF_CHARS = 4_000

/** Largest output requested when generating a card. */
const DRAFT_MAX_TOKENS = 2_048

/**
 * Turn a rough character idea into a filled-in card on the session's own model.
 *
 * This is a PREFILL, never a write: the candidate card travels back to the
 * browser, which drops it into the card form for the user to review, edit and
 * save through the ordinary save route. Nothing here touches the card
 * directory, so a bad generation cannot damage the catalog.
 *
 * The generated document is put through the SAME `normalizeCard` the save path
 * uses, so a card this route produces can never be one the save path would
 * reject — and the browser receives a fully normalized card rather than raw
 * model output.
 */
async function serveCardDraft(deps, body, req, res) {
  const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
  const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
  if (brief === '') {
    writeJson(res, 422, { ok: false, error: { code: 'rejected', message: 'the character idea is empty' } })
    return
  }
  if (brief.length > MAX_BRIEF_CHARS) {
    writeJson(res, 422, {
      ok: false,
      error: { code: 'rejected', message: `the character idea exceeds ${MAX_BRIEF_CHARS} characters`, params: { max: MAX_BRIEF_CHARS } },
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

  // Cancel the model call when the browser goes away mid-flight.
  const callerAbort = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) callerAbort.abort()
  }
  res.on('close', onClose)
  try {
    let takenIds = []
    try {
      takenIds = (await deps.store.list()).cards.map((card) => card.id)
    } catch {
      // A catalog that cannot be read only costs the collision hint.
    }
    const result = await rewriteDraft(llm, {
      provider: route.provider,
      model: route.model,
      system: CARD_DRAFT_SYSTEM,
      userMessage: frameCardBrief(brief, takenIds),
      maxTokens: DRAFT_MAX_TOKENS,
      signal: callerAbort.signal,
    })
    const parsed = parseCardDraft(result.text)
    if (parsed.error !== undefined) {
      writeJson(res, 502, { ok: false, error: { code: 'upstream', message: parsed.error } })
      return
    }
    const normalized = normalizeCard(parsed.document, { fallbackId: undefined, source: 'user' })
    if (normalized.error !== undefined) {
      writeJson(res, 502, {
        ok: false,
        error: { code: 'upstream', message: `the model produced an unusable card: ${normalized.error}` },
      })
      return
    }
    writeJson(res, 200, {
      ok: true,
      value: {
        card: normalized.card,
        provider: route.provider,
        model: route.model,
        elapsedMs: result.elapsedMs,
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

  // Mode: the card's own, unless the caller asks for the other one AND the card
  // can actually honour it. A template card with no `style` cannot be rewritten
  // by a model, and an llm card with no `template` has nothing to substitute —
  // so an override the card cannot satisfy falls back to the card's own mode
  // rather than failing the request.
  const canTemplate = typeof card.template === 'string' && card.template.trim() !== ''
  const canRewrite = typeof card.style === 'string' && card.style.trim() !== ''
  const mode = body.mode === 'template' && canTemplate
    ? 'template'
    : body.mode === 'llm' && canRewrite
      ? 'llm'
      : card.mode

  // Fidelity may be NARROWED per message, never widened.
  //
  // A `strategy` card may be asked to behave as voice-only for one message:
  // that only ever removes the extra behavioural constraints, so it is strictly
  // safer than the card's own default. The reverse is refused — a `style` card
  // can never be told to start adding behavioural constraints, because that
  // changes the request beyond what the card's author allowed, and a per-message
  // toggle is exactly the wrong place to grant that power.
  const fidelity = card.fidelity === 'strategy' && body.fidelity === 'style' ? 'style' : card.fidelity

  // Cancel the model call when the browser goes away mid-flight.
  const callerAbort = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) callerAbort.abort()
  }
  res.on('close', onClose)
  try {
    if (mode === 'template') {
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
          // No model ran, so there is nothing a preservation check could
          // disagree with: the draft is inserted verbatim.
          facts: { state: 'ok', missing: [], added: [] },
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

    const system = buildSystemPrompt(card, intensity, examplesFor(card, intensity), fidelity)
    const result = await rewriteDraft(llm, {
      provider: route.provider,
      model: route.model,
      system,
      userMessage: frameDraft(text),
      maxTokens: REWRITE_MAX_TOKENS,
      signal: callerAbort.signal,
    })

    // Two layers of preservation checking, deliberately split:
    //
    //  - `facts` runs ALWAYS. It is a token comparison in this process: no
    //    tokens, no latency, and it proves the common failure outright (a
    //    dropped identifier, path, version or number).
    //  - `factCheck` is the optional second model call, for what a token
    //    comparison cannot see at all — a requirement reworded weaker, or a
    //    behavioural constraint invented in prose.
    //
    // The caller may switch the model check per request; the plugin config is
    // the default. An explicit boolean from the client wins, so the settings
    // toggle is authoritative for the person using it.
    const facts = compareFacts(text, result.text)

    const wantModelCheck = typeof body.modelCheck === 'boolean' ? body.modelCheck : config.factCheck
    let factCheck = { state: 'skipped', reason: 'disabled in settings' }
    if (wantModelCheck) {
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
        facts,
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
