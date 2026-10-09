/**
 * Host half of dsh-persona-forge.
 *
 * Owns the character-card store (a watched directory under the harness home
 * plus the bundled cards) and the plugin's HTTP routes. The browser half,
 * declared through `dsh.client`, adds the composer control and the review
 * panel.
 *
 * The host half declares NO harness package dependency on purpose: it reaches
 * `llm`, `sessions`, `agentDefaultModel` and `webServer` through `ctx.get`
 * with explicit absence handling. That keeps the plugin loadable on harness
 * releases whose package layout differs, and keeps it from failing to
 * activate on a composition that lacks one of them.
 *
 * @module dsh-persona-forge
 */

import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createCardStore, ensureCardDir } from './store.js'
import { parseYaml } from './yaml.js'
import { registerRoutes } from './routes.js'

export const name = 'persona-forge'

/** Cordis plugin identity; every service is optional and probed at use time. */
export const inject = []

/**
 * Deployment configuration, read from the plugin row.
 *
 * Deliberately NOT exported as `Config`: the Cordis loader treats an exported
 * `Config` as a Standard-Schema and calls `.validate()` on it, so a plain
 * object would fail activation. The raw row config therefore reaches `apply`
 * untouched and is normalized by {@link resolveConfig} instead, which also
 * means the plugin needs no schema dependency to load.
 */
const DEFAULT_CONFIG = {
  /** What the composer does after a rewrite settles. */
  sendMode: 'review',
  /**
   * Run the SECOND, model-based preservation check after each rewrite.
   *
   * OFF by default. It is the only thing that can see a requirement reworded
   * weaker, or a behavioural constraint added in prose — but it doubles the
   * latency and the token cost of every single send, and the free local check
   * (lib/preserve.js) already proves the common and most damaging failure: a
   * dropped identifier, path, version or number. Paying a model call on every
   * send to re-check what a string comparison answers for nothing is a bad
   * default; turn it on when the drafts are technical enough to warrant it.
   */
  factCheck: false,
  /** Watch the card directory and reload the catalog on change. */
  watchCards: true,
}

/** Fill defaults and narrow untrusted values. */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    sendMode: source.sendMode === 'direct' ? 'direct' : 'review',
    // Only an explicit `true` enables it. Anything else — absent, null, a typo —
    // leaves the cheap default, because the cost of this check is paid on every
    // send and the local check already covers the common failure.
    factCheck: source.factCheck === true,
    watchCards: source.watchCards !== false,
  }
}

/** Read the bundled character cards shipped inside this package. */
async function loadBuiltins() {
  const here = dirname(fileURLToPath(import.meta.url))
  const cardsDir = join(here, '..', 'cards')
  let entries
  try {
    const { readdir } = await import('node:fs/promises')
    entries = await readdir(cardsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const builtins = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (ext !== '.yml' && ext !== '.yaml') continue
    const stem = entry.name.slice(0, entry.name.length - ext.length)
    try {
      const text = await readFile(join(cardsDir, entry.name), 'utf8')
      builtins.push({ id: stem, document: parseYaml(text) })
    } catch {
      // A broken bundled card is skipped; the catalog still loads.
    }
  }
  return builtins
}

/**
 * Mount the host half.
 * @param ctx - the registrant Cordis context.
 * @param config - the plugin row's configuration.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const store = createCardStore()

  // Wait for the web server before registering routes. It mounts LATER than a
  // plugin that declares no service dependencies, so reading `ctx.get('webServer')`
  // here would find nothing and silently register no routes — every request
  // would then fall through to the SPA fallback with an empty 405/404 body.
  // `ctx.inject` runs the callback when (and if) the service actually mounts,
  // so a composition without a web server still loads this plugin.
  ctx.inject(['webServer'], (webCtx) => {
    ctx.effect(() => registerRoutes(webCtx.webServer, {
      ctx,
      store,
      readConfig: () => resolved,
      ensureCardDir,
    }), 'persona-forge: routes')
  })

  // Populate the built-ins and the first catalog read, then watch the user
  // directory so a dropped file appears without a restart.
  //
  // This runs asynchronously, so the plugin can be unloaded before the watcher
  // exists. `disposed` closes that window: a watcher created after teardown is
  // closed immediately instead of being leaked for the life of the process.
  let stopWatch
  let disposed = false
  let reloadTimer
  ctx.effect(() => () => {
    disposed = true
    if (reloadTimer !== undefined) clearTimeout(reloadTimer)
    try {
      stopWatch?.close()
    } catch {
      // Already closed.
    }
  }, 'persona-forge: card watcher')

  void (async () => {
    const builtins = await loadBuiltins()
    store.setBuiltins(builtins)
    // Seed the bundled cards into the user directory so "open the card
    // directory" shows real, editable starting points instead of an empty
    // folder. An existing file is never overwritten — it is the user's edit.
    try {
      await store.seedBuiltins()
    } catch {
      // A read-only home only costs the seed; the bundled cards still serve.
    }
    await store.reload()
    if (disposed || !resolved.watchCards) return
    try {
      const dir = await ensureCardDir()
      // Debounce the reload. A single file write emits several watcher events
      // (create, modify, close) and a reader can land while the writer is only
      // halfway through, which would parse a truncated card. Coalescing the
      // burst means the reload reads settled files; a card that briefly fails
      // to parse therefore never replaces a good one with a diagnostic.
      const created = watch(dir, { persistent: false }, () => {
        if (reloadTimer !== undefined) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined
          void store.reload()
        }, 120)
        reloadTimer.unref?.()
      })
      created.on('error', () => {})
      if (disposed) {
        // Teardown happened while this was being created.
        created.close()
        return
      }
      stopWatch = created
    } catch {
      // A missing or unwatchable directory only costs live reload; the catalog
      // still loads on every request.
    }
  })()
}
