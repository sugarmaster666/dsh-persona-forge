/**
 * Character-card store: one directory under the harness home, watched for
 * changes, plus the bundled built-in cards. Dropping a `.yml` file into the
 * directory makes a card appear in the composer without a restart; the
 * bundled cards are read-only and can be overridden by a user card of the
 * same id.
 *
 * Every read is defensive: a malformed card is reported as a diagnostic row
 * and skipped, never allowed to break the catalog or a rewrite.
 * @module dsh-persona-forge/store
 */

import { readFile, readdir, mkdir, writeFile, unlink, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { homedir } from 'node:os'
import { parseYaml, dumpYaml } from './yaml.js'

/** Directory name under the harness home holding user character cards. */
export const CARD_DIR_NAME = 'persona-cards'

/** Card fields that are free text and must be strings. */
const STRING_FIELDS = ['id', 'name', 'icon', 'description', 'style', 'template']

/** Valid values of the closed enum fields. */
const ENUMS = {
  mode: new Set(['llm', 'template']),
  fidelity: new Set(['style', 'strategy']),
  intensity: new Set(['light', 'medium', 'zealot']),
}

/** Maximum characters of a single card text field; keeps a bad file from stalling assembly. */
const MAX_FIELD_CHARS = 20000

/**
 * Resolve the harness home without depending on a harness package: `$DSH_HOME`
 * wins, then `~/.dsh`. Mirrors the documented precedence of the harness.
 * @returns the absolute harness home path.
 */
export function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** The user card directory, creating it when absent. */
export async function ensureCardDir() {
  const dir = join(resolveHome(), CARD_DIR_NAME)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Absolute path of the user card directory (not necessarily existing yet). */
export function cardDirPath() {
  return join(resolveHome(), CARD_DIR_NAME)
}

/** Narrow an untrusted value into a trimmed string, or undefined when empty. */
function textOf(value, max = MAX_FIELD_CHARS) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Normalize the `examples` field: an array of `{ from, to }` conversions.
 * Entries missing either side are dropped rather than repaired, because a
 * half-example teaches the model nothing and misleads it about the format.
 * @param value - the untrusted field.
 * @returns the normalized examples (possibly empty).
 */
function examplesOf(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const from = textOf(entry.from, 4000)
    const to = textOf(entry.to, 4000)
    if (from === undefined || to === undefined) continue
    out.push({ from, to })
  }
  return out
}

/**
 * Normalize the per-intensity example map.
 * @param value - the untrusted field.
 * @returns a map of intensity → examples, omitting empty entries.
 */
function examplesByIntensityOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!ENUMS.intensity.has(key)) continue
    const examples = examplesOf(entry)
    if (examples.length > 0) out[key] = examples
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Derive a card id from a filename when the file declares none.
 * @param filename - the source file name.
 * @returns a lowercase hyphenated id, or undefined when nothing usable remains.
 */
function idFromFilename(filename) {
  const stem = basename(filename, extname(filename))
  const id = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id === '' ? undefined : id
}

/**
 * Normalize one raw card document into a PersonaCard.
 * @param raw - the parsed YAML/JSON document.
 * @param options - the id fallback and provenance for diagnostics.
 * @returns the card, or a diagnostic explaining why it was rejected.
 */
export function normalizeCard(raw, options) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'card must be a YAML mapping' }
  }
  const id = textOf(raw.id, 128) ?? options.fallbackId
  if (id === undefined) return { error: 'card has no id and the filename yields none' }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { error: `id "${id}" must be lowercase letters, digits and hyphens` }
  }
  const name = textOf(raw.name, 200)
  if (name === undefined) return { error: 'card has no name' }

  const mode = ENUMS.mode.has(raw.mode) ? raw.mode : 'llm'
  const fidelity = ENUMS.fidelity.has(raw.fidelity) ? raw.fidelity : 'style'
  const intensity = ENUMS.intensity.has(raw.intensity) ? raw.intensity : 'medium'

  const style = textOf(raw.style)
  const template = textOf(raw.template)
  // The style text is what makes an llm card a card; a template card needs its
  // template. Refusing here is better than silently rewriting into a voice the
  // card never described.
  if (mode === 'llm' && style === undefined) return { error: 'mode "llm" requires a non-empty "style"' }
  if (mode === 'template' && template === undefined) return { error: 'mode "template" requires a non-empty "template"' }

  const card = {
    id,
    name,
    mode,
    fidelity,
    intensity,
    style: style ?? '',
    examples: examplesOf(raw.examples),
    builtin: options.builtin === true,
  }
  const icon = textOf(raw.icon, 16)
  if (icon !== undefined) card.icon = icon
  const description = textOf(raw.description, 500)
  if (description !== undefined) card.description = description
  if (template !== undefined) card.template = template
  const byIntensity = examplesByIntensityOf(raw.examplesByIntensity)
  if (byIntensity !== undefined) card.examplesByIntensity = byIntensity
  if (options.source !== undefined) card.source = options.source
  return { card }
}

/** Parse one card file body. */
function parseCardText(text, options) {
  let raw
  try {
    raw = parseYaml(text)
  } catch (error) {
    return { error: `YAML parse failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return normalizeCard(raw, options)
}

/**
 * Create a card store over one directory plus a set of built-in documents.
 * @param options - built-in card documents and the optional watch target.
 * @returns the store handle.
 */
export function createCardStore(options = {}) {
  /** @type {Map<string, object>} */
  const builtins = new Map()

  /**
   * Replace the built-in card set. Called once the bundled documents have
   * been read; the store handle stays the same object so route closures keep
   * working.
   * @param entries - `{ id, document }` pairs from the package's `cards/` dir.
   */
  function setBuiltins(entries) {
    builtins.clear()
    for (const entry of entries ?? []) {
      const result = normalizeCard(entry.document, { builtin: true, source: 'builtin', fallbackId: entry.id })
      if (result.card !== undefined) builtins.set(result.card.id, result.card)
    }
    // Force the next read to rebuild the merged catalog.
    loaded = false
  }

  if (options.builtins !== undefined) setBuiltins(options.builtins)

  /** @type {Map<string, object>} */
  let userCards = new Map()
  /** @type {Array<{file: string, error: string}>} */
  let diagnostics = []
  let loaded = false

  /** Read every `*.yml` / `*.yaml` / `*.json` card file in the directory. */
  async function load() {
    const dir = cardDirPath()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // A missing directory is the normal first-run state, not a failure.
      if (error?.code === 'ENOENT') {
        userCards = new Map()
        diagnostics = []
        loaded = true
        return
      }
      diagnostics = [{ file: dir, error: `cannot read card directory: ${error instanceof Error ? error.message : String(error)}` }]
      loaded = true
      return
    }
    const next = new Map()
    const problems = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') continue
      const path = join(dir, entry.name)
      let text
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        problems.push({ file: entry.name, error: `cannot read: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      const result = ext === '.json'
        ? (() => {
            try {
              return normalizeCard(JSON.parse(text), { source: 'user', fallbackId: idFromFilename(entry.name) })
            } catch (error) {
              return { error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}` }
            }
          })()
        : parseCardText(text, { source: 'user', fallbackId: idFromFilename(entry.name) })
      if (result.error !== undefined) {
        problems.push({ file: entry.name, error: result.error })
        continue
      }
      // A later file with a duplicate id wins; report the collision so the
      // user can see why one card is not the one they expected.
      if (next.has(result.card.id)) {
        problems.push({ file: entry.name, error: `duplicate id "${result.card.id}" overrides an earlier file` })
      }
      next.set(result.card.id, result.card)
    }
    userCards = next
    diagnostics = problems
    loaded = true
  }

  /** Read the catalog, loading on first use. */
  async function list() {
    if (!loaded) await load()
    // Built-ins first (stable, ordered by their declared order), then user
    // cards; a user card with a built-in id replaces the built-in in place.
    const merged = new Map()
    for (const [id, card] of builtins) merged.set(id, card)
    for (const [id, card] of userCards) merged.set(id, card)
    return {
      cards: [...merged.values()],
      diagnostics: [...diagnostics],
      directory: cardDirPath(),
    }
  }

  /** Find one card by id. */
  async function get(id) {
    const { cards } = await list()
    return cards.find((card) => card.id === id)
  }

  /**
   * Write every bundled card that has no user file yet, so the card directory
   * is a usable starting point instead of an empty folder.
   *
   * The bundled copies stay read-only inside the package; this only seeds the
   * user directory, and only for ids the user has not written themselves — an
   * existing file is never overwritten, because it is the user's edit.
   * @returns the ids that were seeded.
   */
  async function seedBuiltins() {
    const dir = await ensureCardDir()
    const seeded = []
    for (const card of builtins.values()) {
      const path = join(dir, `${card.id}.yml`)
      try {
        // `wx` fails when the file exists, which makes "never overwrite the
        // user's edit" atomic. A stat-then-write pair would leave a window in
        // which a card created by the user — or by a second seeding pass — is
        // clobbered.
        await writeFile(path, dumpYaml({
          id: card.id,
          name: card.name,
          ...card.icon !== undefined ? { icon: card.icon } : {},
          ...card.description !== undefined ? { description: card.description } : {},
          mode: card.mode,
          fidelity: card.fidelity,
          intensity: card.intensity,
          style: card.style,
          ...card.examples.length > 0 ? { examples: card.examples } : {},
          ...card.examplesByIntensity !== undefined ? { examplesByIntensity: card.examplesByIntensity } : {},
        }), { encoding: 'utf8', flag: 'wx' })
        seeded.push(card.id)
      } catch (error) {
        // EEXIST is the normal "the user already has this card" case. Any
        // other failure (a read-only or full directory) only costs the seed;
        // the catalog still serves the bundled cards from the package.
        void error
      }
    }
    if (seeded.length > 0) await load()
    return seeded
  }

  /**
   * Write one user card file, replacing an existing file of the same id.
   * Built-in ids are writable: the user file shadows the built-in, which is
   * how a bundled card is customized without editing the package.
   * @param card - the already-normalized card to persist.
   * @returns the written path.
   */
  async function save(card) {
    const dir = await ensureCardDir()
    const path = join(dir, `${card.id}.yml`)
    const document = {
      id: card.id,
      name: card.name,
      ...card.icon !== undefined ? { icon: card.icon } : {},
      ...card.description !== undefined ? { description: card.description } : {},
      mode: card.mode,
      fidelity: card.fidelity,
      intensity: card.intensity,
      style: card.style,
      ...card.template !== undefined ? { template: card.template } : {},
      ...card.examples.length > 0 ? { examples: card.examples } : {},
      ...card.examplesByIntensity !== undefined ? { examplesByIntensity: card.examplesByIntensity } : {},
    }
    await writeFile(path, dumpYaml(document), 'utf8')
    await load()
    return path
  }

  /**
   * Delete one user card file. A built-in card has no file, so deleting its
   * shadow removes only the override; when no user file exists the call
   * reports that rather than pretending to delete a bundled card.
   * @param id - the card id.
   * @returns whether a file was removed.
   */
  async function remove(id) {
    const dir = cardDirPath()
    for (const ext of ['.yml', '.yaml', '.json']) {
      const path = join(dir, `${id}${ext}`)
      try {
        await stat(path)
      } catch {
        continue
      }
      await unlink(path)
      await load()
      return true
    }
    return false
  }

  /** Reload from disk (used by the directory watcher). */
  async function reload() {
    loaded = false
    await load()
  }

  return { list, get, save, remove, reload, setBuiltins, seedBuiltins, cardDirPath }
}
