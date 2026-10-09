/**
 * The rewrite engine: one auxiliary model call through the harness `llm`
 * service, plus the optional technical-fact preservation check.
 *
 * The call deliberately does NOT go through the agent loop. It is a
 * standalone `llm.stream()` invocation, so it produces no turn, cannot call
 * tools, and never enters the session history. The user's draft reaches the
 * model only as this call's input; what the session records is the text the
 * user actually sent.
 *
 * @module dsh-persona-forge/rewrite
 */

/** How long one rewrite may take end to end. */
const REWRITE_TIMEOUT_MS = 120_000

/** How long the fact check may take. */
const CHECK_TIMEOUT_MS = 60_000

/** Upper bound on the fact check's own output; the verdict is one line. */
const CHECK_MAX_TOKENS = 256

/**
 * Assemble the assistant text out of a raw chunk stream.
 *
 * The stream yields token deltas plus block boundaries; only `text-delta`
 * contributes to the message body. A `finish` chunk carrying an error or an
 * abort ends the call as a failure so a truncated rewrite is never applied.
 * @param llm - the `ctx.llm` service (or a structural stub).
 * @param options - provider, model, system prompt, user message, limits.
 * @returns the assembled text plus the terminal reason.
 */
async function callModel(llm, options) {
  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: options.userMessage }],
  }]
  const generate = {
    provider: options.provider,
    model: options.model,
    system: options.system,
    messages,
    maxTokens: options.maxTokens,
    signal: options.signal,
    // Note: `reasoningEffort` is intentionally NOT passed. The adapter then
    // materializes the route's own default, which is the same effort the
    // session's own calls use — matching the session's model behaviour rather
    // than silently downgrading it.
  }
  let text = ''
  let failure
  for await (const chunk of llm.stream(generate)) {
    if (chunk === null || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
      continue
    }
    if (chunk.type === 'finish') {
      const reason = chunk.reason
      if (reason !== undefined && reason !== null && typeof reason === 'object') {
        if (reason.kind === 'error' || reason.kind === 'aborted') {
          failure = reason.failure ?? { code: 'UNKNOWN', message: `model call ended: ${reason.kind}` }
        } else if (reason.kind === 'max-tokens') {
          failure = { code: 'MAX_TOKENS', message: 'the model hit its output limit' }
        }
      }
    }
  }
  if (failure !== undefined) {
    const error = new Error(failure.message ?? failure.code ?? 'model call failed')
    error.code = failure.code
    throw error
  }
  return text
}

/**
 * Strip an accidental whole-output code fence and trim. Models occasionally
 * wrap the entire rewrite in ``` despite being told not to; that fence is
 * presentation, not content, so removing it is safe. Fences INSIDE the body
 * (a real code block the user asked about) are left alone.
 * @param text - the raw model output.
 * @returns the normalized body.
 */
export function normalizeOutput(text) {
  let out = (text ?? '').trim()
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(out)
  if (fence !== null) out = (fence[1] ?? '').trim()
  // A leading meta line such as "Here is the rewritten message:" is common and
  // never part of the rewrite; drop a single short preface ending in a colon.
  out = out.replace(/^(?:here is|以下是|这是)[^\n]{0,60}[:：]\s*\n+/i, '')
  return out.trim()
}

/** Compose a caller signal with a deadline. */
function deadlineSignal(timeoutMs, callerSignal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      if (callerSignal !== undefined) callerSignal.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Rewrite one draft into a persona voice.
 * @param llm - the `ctx.llm` service.
 * @param options - the route, prompts, limits and cancellation.
 * @returns the rewritten body and its duration.
 */
export async function rewriteDraft(llm, options) {
  const deadline = deadlineSignal(options.timeoutMs ?? REWRITE_TIMEOUT_MS, options.signal)
  const started = Date.now()
  try {
    const raw = await callModel(llm, {
      provider: options.provider,
      model: options.model,
      system: options.system,
      userMessage: options.userMessage,
      maxTokens: options.maxTokens,
      signal: deadline.signal,
    })
    const text = normalizeOutput(raw)
    if (text === '') {
      const error = new Error('the model returned an empty rewrite')
      error.code = 'EMPTY_RESPONSE'
      throw error
    }
    return { text, elapsedMs: Date.now() - started }
  } catch (error) {
    if (deadline.didTimeOut()) {
      const timeout = new Error(`rewrite timed out after ${Math.ceil((options.timeoutMs ?? REWRITE_TIMEOUT_MS) / 1000)}s`)
      timeout.code = 'TIMEOUT'
      throw timeout
    }
    throw error
  } finally {
    deadline.dispose()
  }
}

/**
 * Compare a rewrite against the original for lost or invented technical
 * substance. This is a second model call on the same route, so it inherits
 * the session's model exactly like the rewrite does.
 *
 * Every failure mode degrades to `unavailable`: a check that could not run
 * must never read as approval.
 * @param llm - the `ctx.llm` service.
 * @param options - route, texts and cancellation.
 * @returns the verdict.
 */
export async function checkPreservation(llm, options) {
  const deadline = deadlineSignal(CHECK_TIMEOUT_MS, options.signal)
  try {
    const raw = await callModel(llm, {
      provider: options.provider,
      model: options.model,
      system: options.system,
      userMessage: options.userMessage,
      maxTokens: CHECK_MAX_TOKENS,
      signal: deadline.signal,
    })
    return options.parse(raw)
  } catch (error) {
    return {
      state: 'unavailable',
      reason: deadline.didTimeOut()
        ? 'the preservation check timed out'
        : error instanceof Error ? error.message : String(error),
    }
  } finally {
    deadline.dispose()
  }
}
