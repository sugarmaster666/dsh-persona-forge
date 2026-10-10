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
    // `reasoningEffort` is intentionally NOT passed, and this must stay absent
    // rather than becoming a value that means "default".
    //
    // The harness validates the field before it ever reaches a provider:
    //
    //     const reasoning = info.reasoning
    //     if (reasoning === undefined) {
    //       if (requested !== undefined) throw ... UNSUPPORTED_REASONING_EFFORT
    //     } else {
    //       const effective = requested ?? reasoning.defaultEffort
    //       ...
    //     }
    //
    // A route whose model declares NO reasoning metadata takes the first
    // branch, and there ANY present value throws — including the empty
    // string, which is what the host's own "Provider default" sentinel
    // (`PROVIDER_DEFAULT_REASONING_VALUE = ""`) uses. That sentinel lives in
    // the ACP session-config layer, not in `llm.stream()`; here it would be
    // just another unsupported value. Pinning `'low'` once broke exactly this
    // way: `workbuddy-xdpool` / `hy4-preview` rejected it outright.
    //
    // So absence is the only portable way to say "use the route's default",
    // and it is also the correct ask: the rewrite follows the session's
    // provider/model, and reasoning depth is a property of the TASK rather
    // than of the conversation. Leaving it out costs a slow model its thinking
    // time, but there is no value we can safely name across every route.
  }
  let text = ''
  let failure

  // The deadline must be able to END this loop, not merely ask the adapter to.
  //
  // `for await (const chunk of llm.stream(generate))` only exits when the
  // adapter stops yielding. An adapter that ignores the abort signal — or a
  // provider that has accepted the request and then sends nothing at all —
  // yields no chunk, so the loop never re-checks anything and the `abort()`
  // from the deadline timer is invisible here. The route then hangs forever
  // and the panel spins with no result, which is what a rate-limited model
  // looked like: 120s elapsed, nothing happened, no error.
  //
  // So race every pull against one shared abort promise and leave the loop
  // ourselves. One promise, created once: racing a fresh promise per chunk
  // would leak a listener per token.
  const signal = options.signal
  const ABORTED = Symbol('aborted')
  let fireAbort
  const abortPromise = new Promise((resolve) => {
    fireAbort = resolve
  })
  const onAbort = () => fireAbort(ABORTED)
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  const stream = llm.stream(generate)
  const iterator = typeof stream?.[Symbol.asyncIterator] === 'function' ? stream[Symbol.asyncIterator]() : undefined
  try {
    if (iterator === undefined) {
      const error = new Error('the llm service returned no async stream')
      error.code = 'NO_STREAM'
      throw error
    }
    while (true) {
      const step = await Promise.race([iterator.next(), abortPromise])
      if (step === ABORTED) {
        // Stop pulling. The stream is abandoned, not drained: a provider that
        // is sending nothing has nothing to drain, and waiting on it is the
        // hang this guards against.
        const error = new Error('the model call was aborted')
        error.code = 'ABORTED'
        throw error
      }
      if (step.done === true) break
      const chunk = step.value
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
  } finally {
    if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    // Best effort, and deliberately NOT awaited: releasing a stream that is
    // already wedged is exactly the operation that would hang here.
    if (iterator !== undefined && typeof iterator.return === 'function') {
      try {
        void iterator.return()
      } catch {
        // Nothing to salvage.
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
