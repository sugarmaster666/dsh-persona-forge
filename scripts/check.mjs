/**
 * Offline self-check for dsh-persona-forge.
 *
 * Runs without a harness: it exercises the pure logic (card normalization,
 * prompt construction, output normalization, fact-check parsing, route
 * resolution) and syntax-checks the client bundle. Run with `node
 * scripts/check.mjs` from the package root.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

// Isolate the harness home BEFORE importing anything that resolves it.
//
// The card store merges the bundled cards with the user's own directory under
// $DSH_HOME, and a user card SHADOWS a bundled one of the same id. Without this
// the suite would read the developer's real ~/.dsh/persona-cards and its
// results would depend on whatever they happen to have saved — a stale seeded
// card silently replacing an improved bundled one, for instance.
const ISOLATED_HOME = await mkdtemp(join(tmpdir(), 'persona-forge-unit-'))
process.env.DSH_HOME = ISOLATED_HOME

import { normalizeCard, createCardStore } from '../lib/store.js'
import { parseYaml, dumpYaml, YamlError } from '../lib/yaml.js'
import {
  buildSystemPrompt,
  examplesFor,
  frameDraft,
  renderTemplate,
  CARD_DRAFT_SYSTEM,
  frameCardBrief,
  parseCardDraft,
} from '../lib/prompts.js'
import { normalizeOutput } from '../lib/rewrite.js'
import { compareFacts } from '../lib/preserve.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** The intensity ladder, weakest to strongest. Mirrors the client's list. */
const INTENSITY_LEVELS = ['light', 'medium', 'strong', 'zealot']

let failures = 0
let checks = 0

function check(name, condition, detail) {
  checks++
  if (condition) return
  failures++
  console.error(`FAIL  ${name}${detail !== undefined ? `\n      ${detail}` : ''}`)
}

function section(title) {
  console.log(`\n== ${title}`)
}

// ---------------------------------------------------------------------------
section('yaml parser')

{
  const eq = (name, actual, expected) => {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    check(name, a === b, `got ${a}\n      want ${b}`)
  }

  eq('simple mapping', parseYaml('a: 1\nb: two'), { a: '1', b: 'two' })
  eq('booleans and null', parseYaml('a: true\nb: false\nc: null\nd: ~'), { a: true, b: false, c: null, d: null })
  eq('comments stripped', parseYaml('a: 1 # note\n# whole line\nb: 2'), { a: '1', b: '2' })
  eq('quoted hash kept', parseYaml('a: "x # y"'), { a: 'x # y' })
  eq('quoted colon kept', parseYaml('a: "x: y"'), { a: 'x: y' })
  eq('single quotes', parseYaml("a: 'it''s'"), { a: "it's" })
  eq('double quote escapes', parseYaml('a: "line\\nbreak"'), { a: 'line\nbreak' })
  eq('nested mapping', parseYaml('a:\n  b:\n    c: deep'), { a: { b: { c: 'deep' } } })
  eq('sequence of scalars', parseYaml('a:\n  - one\n  - two'), { a: ['one', 'two'] })
  eq(
    'sequence of mappings',
    parseYaml('examples:\n  - from: x\n    to: y\n  - from: p\n    to: q'),
    { examples: [{ from: 'x', to: 'y' }, { from: 'p', to: 'q' }] },
  )
  eq('empty value is null', parseYaml('a:'), { a: null })
  eq('empty document', parseYaml(''), null)
  eq('comment-only document', parseYaml('# just a comment'), null)

  // Block scalars: the form every card uses for `style`.
  eq('literal block keeps newlines', parseYaml('a: |\n  one\n  two'), { a: 'one\ntwo\n' })
  eq('literal strip chomp', parseYaml('a: |-\n  one\n  two'), { a: 'one\ntwo' })
  eq('literal block keeps relative indent', parseYaml('a: |\n  one\n    deeper'), { a: 'one\n  deeper\n' })
  eq('literal block with blank line', parseYaml('a: |\n  one\n\n  two'), { a: 'one\n\ntwo\n' })
  eq('folded block joins lines', parseYaml('a: >\n  one\n  two'), { a: 'one two\n' })
  eq('folded block blank line', parseYaml('a: >\n  one\n\n  two'), { a: 'one\ntwo\n' })

  // The subset must refuse what it cannot read faithfully.
  const refuses = (name, text) => {
    let threw = false
    try {
      parseYaml(text)
    } catch (error) {
      threw = error instanceof YamlError
    }
    check(name, threw, `expected a YamlError for: ${JSON.stringify(text)}`)
  }
  refuses('refuses flow mapping', 'a: {b: 1}')
  refuses('refuses flow sequence', 'a: [1, 2]')
  refuses('refuses anchors', 'a: &anchor value')
  refuses('refuses aliases', 'a: *anchor')
  refuses('refuses merge keys', '<<: other')
  refuses('refuses tags', 'a: !!js process.env.X')
  refuses('refuses documents', '---\na: 1')
  refuses('refuses duplicate keys', 'a: 1\na: 2')
  refuses('refuses tab indentation', 'a:\n\tb: 1')

  // Round-trip: what the settings page writes must read back identically.
  const original = {
    id: 'round-trip',
    name: '往返测试',
    icon: '⚙️',
    description: 'has: colon, # hash and "quotes"',
    mode: 'llm',
    fidelity: 'style',
    intensity: 'medium',
    style: 'line one\nline two\n\n  indented\n',
    examples: [{ from: 'a: 1', to: 'b # 2' }, { from: 'plain', to: 'x' }],
  }
  const roundTripped = parseYaml(dumpYaml(original))
  eq('dump/parse round trip', roundTripped, original)

  const noTrailingNewline = { a: 'one\ntwo' }
  eq('round trip without trailing newline', parseYaml(dumpYaml(noTrailingNewline)), noTrailingNewline)

  const withTrailing = { a: 'one\n\ntwo\n\n' }
  eq('round trip with blank trailing lines', parseYaml(dumpYaml(withTrailing)), withTrailing)

  const unicode = { a: 'emoji 🎭 and 中文', b: 'tab\there' }
  eq('round trip unicode', parseYaml(dumpYaml(unicode)), unicode)
}

// ---------------------------------------------------------------------------
section('card normalization')

const good = normalizeCard({
  id: 'test-card',
  name: 'Test',
  mode: 'llm',
  style: 'speak like a pirate',
  examples: [{ from: 'a', to: 'b' }, { from: 'c' }, 'nonsense'],
}, { fallbackId: undefined })
check('valid llm card accepted', good.card !== undefined, JSON.stringify(good))
check('defaults applied', good.card?.fidelity === 'style' && good.card?.intensity === 'medium', JSON.stringify(good.card))
check('half examples dropped', good.card?.examples.length === 1, JSON.stringify(good.card?.examples))

const noStyle = normalizeCard({ id: 'x', name: 'X', mode: 'llm' }, { fallbackId: undefined })
check('llm card without style rejected', noStyle.error !== undefined, JSON.stringify(noStyle))

const noTemplate = normalizeCard({ id: 'x', name: 'X', mode: 'template' }, { fallbackId: undefined })
check('template card without template rejected', noTemplate.error !== undefined, JSON.stringify(noTemplate))

const badId = normalizeCard({ id: 'Bad_ID', name: 'X', style: 'y' }, { fallbackId: undefined })
check('invalid id rejected', badId.error !== undefined, JSON.stringify(badId))

const fallback = normalizeCard({ name: 'From File', style: 'y' }, { fallbackId: 'from-file' })
check('id derived from filename', fallback.card?.id === 'from-file', JSON.stringify(fallback))

const templateCard = normalizeCard(
  { id: 't', name: 'T', mode: 'template', template: 'O god, hear: {{input}}' },
  { fallbackId: undefined },
)
check('template card accepted', templateCard.card?.mode === 'template', JSON.stringify(templateCard))

// ---------------------------------------------------------------------------
section('bundled cards')

const store = createCardStore()
const builtins = []
for (const file of ['omnissiah.yml', 'muscle-crew.yml']) {
  const text = await readFile(join(root, 'cards', file), 'utf8')
  builtins.push({ id: file.replace(/\.yml$/, ''), document: parseYaml(text) })
}
store.setBuiltins(builtins)
const catalog = await store.list()
check('both bundled cards load', catalog.cards.length === 2, JSON.stringify(catalog.diagnostics))
check('no bundled diagnostics', catalog.diagnostics.length === 0, JSON.stringify(catalog.diagnostics))

for (const card of catalog.cards) {
  // The speaker direction must be stated, or the model inverts the roles.
  check(`${card.id}: style states speaker direction`, /发言者|speaker/i.test(card.style), card.style.slice(0, 80))
  // Every intensity the ladder offers must RESOLVE to demonstrations. The flat
  // `examples` list is a RETIRED fallback: a card may still carry one (older
  // files do) and `examplesFor` still reaches for it, but a card whose rungs are
  // all populated must not need it — carrying both was two places to write the
  // same thing, with the flat one silently dead.
  check(`${card.id}: has per-intensity examples`, card.examplesByIntensity !== undefined, JSON.stringify(Object.keys(card.examplesByIntensity ?? {})))
  const resolvedByLevel = Object.fromEntries(
    INTENSITY_LEVELS.map((level) => [level, examplesFor(card, level)]),
  )
  check(
    `${card.id}: every intensity rung resolves to demonstrations`,
    INTENSITY_LEVELS.every((level) => Array.isArray(resolvedByLevel[level]) && resolvedByLevel[level].length > 0),
    JSON.stringify(Object.fromEntries(INTENSITY_LEVELS.map((level) => [level, resolvedByLevel[level].length]))),
  )
  check(
    `${card.id}: needs no flat examples fallback`,
    card.examples.length === 0,
    'a card with all four rungs populated should not also carry a dead flat list',
  )
  // The ladder must actually do something: no two rungs may resolve to the
  // same demonstrations, or the levels are decorative.
  const resolvedSets = INTENSITY_LEVELS.map((level) => JSON.stringify(resolvedByLevel[level]))
  check(
    `${card.id}: intensity levels are distinct`,
    new Set(resolvedSets).size === resolvedSets.length,
    'two rungs resolve to identical demonstrations',
  )
  // Every example must carry its technical facts through. A rewrite may
  // rephrase natural language — that is the point of a rewrite — but it may
  // never drop an identifier, a number, or the substance of the request.
  for (const [index, example] of card.examples.entries()) {
    const verdict = preservation(example.from, example.to)
    check(
      `${card.id}: example ${index + 1} preserves its technical facts`,
      verdict.ok,
      verdict.detail,
    )
  }
  // The per-intensity sets are what the four-rung ladder actually demonstrates
  // with, so they get the same treatment as the flat list.
  for (const level of INTENSITY_LEVELS) {
    for (const [index, example] of (card.examplesByIntensity?.[level] ?? []).entries()) {
      const verdict = preservation(example.from, example.to)
      check(
        `${card.id}: ${level} example ${index + 1} preserves its technical facts`,
        verdict.ok,
        verdict.detail,
      )
    }
  }
}

// ---------------------------------------------------------------------------
section('card provenance')

// The bug: every bundled card is SEEDED into the user directory as an editable
// starting point, so the tag was derived from "does a user file exist" — true
// for cards nobody had ever touched. Every bundled card was labelled 自定义,
// and the same screen's drift check called those same rows unchanged. Provenance
// has to follow CONTENT.
{
  const seeded = createCardStore()
  seeded.setBuiltins(builtins)
  await seeded.seedBuiltins()
  const { cards } = await seeded.list()
  const untouched = cards.filter((card) => card.id === 'omnissiah' || card.id === 'muscle-crew')
  check(
    'a seeded-but-untouched bundled card reports origin "builtin"',
    untouched.length === 2 && untouched.every((card) => card.origin === 'builtin'),
    JSON.stringify(untouched.map((card) => ({ id: card.id, origin: card.origin }))),
  )
  // Tag and drift check must agree by construction, not by coincidence.
  const driftedIds = (await seeded.diffFromBundled()).map((row) => row.id)
  check(
    'origin "builtin" agrees with a clean drift check',
    untouched.every((card) => card.origin !== 'builtin' || !driftedIds.includes(card.id)),
    JSON.stringify(driftedIds),
  )
  // An edited bundled card must be neither "builtin" nor plain "custom".
  const bundled = await seeded.get('omnissiah')
  await seeded.save({ ...bundled, description: 'edited by the check suite' })
  const edited = await seeded.get('omnissiah')
  check('an edited bundled card reports origin "edited"', edited.origin === 'edited', JSON.stringify(edited.origin))
  check(
    'an edited bundled card is reported by the drift check',
    (await seeded.diffFromBundled()).some((row) => row.id === 'omnissiah'),
    'the tag and the drift check disagree',
  )
  // A card the plugin never shipped is the user's own.
  const own = normalizeCard(
    { id: 'check-own-card', name: 'Own', mode: 'llm', style: 'speaks plainly', examples: [{ from: 'a', to: 'b' }] },
    { fallbackId: undefined, source: 'user' },
  )
  await seeded.save(own.card)
  const mine = await seeded.get('check-own-card')
  check('a user-authored card reports origin "custom"', mine.origin === 'custom', JSON.stringify(mine.origin))
}

/**
 * Decide whether a rewrite kept its input's technical substance.
 *
 * Two different standards, because the two carry different kinds of meaning:
 *  - ASCII tokens and numbers are technical facts. They must appear literally:
 *    `Rust`, `API`, `bug`, `40K` and every digit. A paraphrase of these is a
 *    lost requirement.
 *  - CJK runs are natural language and a rewrite legitimately rephrases them,
 *    so they are measured by bigram coverage rather than literal containment.
 *    A low ratio means the request was replaced by atmosphere.
 *
 * @param from - the example input.
 * @param to - the example output.
 * @returns the verdict plus a readable explanation when it fails.
 */
function preservation(from, to) {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'to', 'of', 'for', 'is', 'it', 'this', 'that',
  ])
  const missing = []
  for (const match of from.matchAll(/[A-Za-z_][A-Za-z0-9_.+#-]*/g)) {
    const token = match[0]
    if (token.length < 2 || stop.has(token.toLowerCase())) continue
    if (!to.includes(token)) missing.push(token)
  }
  for (const match of from.matchAll(/\d+(?:\.\d+)*/g)) {
    if (!to.includes(match[0])) missing.push(match[0])
  }

  const bigrams = []
  for (const match of from.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let index = 0; index + 2 <= run.length; index++) bigrams.push(run.slice(index, index + 2))
  }
  // A bigram counts as kept when it appears literally OR when both of its
  // characters are present somewhere in the rewrite: a rewrite legitimately
  // rephrases ("写个" → "编写一个"), and penalizing that would force the
  // examples to be word-for-word copies, which is not what a rewrite is.
  const kept = bigrams.filter((bigram) => to.includes(bigram) || [...bigram].every((char) => to.includes(char))).length
  const ratio = bigrams.length === 0 ? 1 : kept / bigrams.length

  const ok = missing.length === 0 && ratio >= 0.5
  const detail = [
    missing.length > 0 ? `dropped technical facts: ${JSON.stringify(missing)}` : '',
    ratio < 0.5 ? `CJK bigram coverage ${(ratio * 100).toFixed(0)}% (needs >=50%)` : '',
    `from: ${from}`,
    `to: ${to}`,
  ].filter((line) => line !== '').join('\n      ')
  return { ok, detail }
}

// ---------------------------------------------------------------------------
section('prompt construction')

const omnissiah = catalog.cards.find((card) => card.id === 'omnissiah')
const system = buildSystemPrompt(omnissiah, 'medium', examplesFor(omnissiah, 'medium'))
check('system states speaker direction', system.includes('USER'), system.slice(0, 200))
// The system prompt must NOT assert that the character is always the assistant.
// It did, and that is false for a card like 硬邦邦, where the USER is the
// character (the client addressing their own team). Both directions are valid;
// the prompt has to allow both and let the card's style text decide.
check(
  'system allows the character to be either side',
  system.includes('may be EITHER side') || system.includes('either side'),
  'hardcoding one direction contradicts half the possible cards',
)
check(
  'system no longer asserts the character is always the assistant',
  !system.includes('The character described above is the ASSISTANT\'s identity.'),
  'the user may be the character',
)
check(
  'system gives the assistant-side default when the card is silent',
  system.includes('safe default'),
  'an unstated direction still needs a defined behaviour',
)
check('system carries the hard rules', system.includes('Preserve the TECHNICAL content EXACTLY'))
check('system carries fidelity rule', system.includes('VOICE ONLY'))
check('system includes examples', system.includes('Conversion examples'))
check('zealot examples differ from medium', examplesFor(omnissiah, 'zealot')[0].to !== examplesFor(omnissiah, 'medium')[0].to)

const muscle = catalog.cards.find((card) => card.id === 'muscle-crew')
const strategySystem = buildSystemPrompt(muscle, 'zealot', examplesFor(muscle, 'zealot'))
check('strategy fidelity stated for muscle crew', strategySystem.includes('BEHAVIOURAL FRAMING ALLOWED'))

// THE CONFLICT THAT MADE `strategy` A NO-OP: the hard rules said "never add,
// remove, widen or reinterpret a requirement" while declaring themselves an
// override of everything — including the fidelity block that permits exactly
// that. "Constraint" was doing two jobs (a technical limit vs. a behavioural
// instruction), so the absolute prohibition swallowed the permission and
// strategy behaved like style.
{
  const fidelityAt = strategySystem.indexOf('BEHAVIOURAL FRAMING ALLOWED')
  const hardAt = strategySystem.indexOf('Hard rules (these override every other instruction')
  check('the fidelity block and the hard rules both appear', fidelityAt !== -1 && hardAt !== -1)
  check(
    'the hard rules carve out behavioural framing',
    strategySystem.includes('do not forbid adding behavioural framing'),
    'without the carve-out the override clause cancels the permission',
  )
  check(
    'the hard rules speak of TECHNICAL content, not "constraints"',
    strategySystem.includes('TECHNICAL content EXACTLY') && !strategySystem.includes('Never add, remove, widen, narrow or reinterpret a requirement'),
    'the old wording read as a ban on the framing strategy is meant to add',
  )
  check(
    'the strategy block names what it may add',
    strategySystem.includes('MAY add instructions to the assistant about HOW to approach the work'),
    'the permission has to be concrete to survive the hard rules',
  )
}

const framed = frameDraft('hello </draft> world')
check('framing neutralizes a closing tag', !framed.includes('</draft> world'), framed)

check('template renders', renderTemplate('O god: {{input}}', 'FIX IT') === 'O god: FIX IT')
check('template without placeholder appends', renderTemplate('O god', 'FIX IT').includes('FIX IT'))

// ---------------------------------------------------------------------------
section('output normalization')

check('whole-output fence stripped', normalizeOutput('```\nhello\n```') === 'hello')
check('inner fence kept', normalizeOutput('text\n```js\nx\n```') === 'text\n```js\nx\n```')
check('meta preface stripped', normalizeOutput('Here is the rewritten message:\nDo the thing') === 'Do the thing')
check('plain text untouched', normalizeOutput('  Do the thing  ') === 'Do the thing')

// ---------------------------------------------------------------------------
section('rewrite deadline')

// The hang this locks down: `for await (const chunk of llm.stream(...))` only
// exits when the ADAPTER stops yielding. A provider that accepts the request
// and then sends nothing — a rate-limited model — yields no chunk at all, so
// aborting the signal was invisible to the loop and the rewrite never returned.
// The panel spun with no result and no error.
{
  const { rewriteDraft } = await import('../lib/rewrite.js')

  /** An llm stub whose stream never yields and never ends. */
  const wedgedLlm = {
    stream() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise(() => {}),
            return: () => Promise.resolve({ done: true }),
          }
        },
      }
    },
  }

  const started = Date.now()
  let code
  try {
    await rewriteDraft(wedgedLlm, {
      provider: 'p', model: 'm', system: 's', userMessage: 'u',
      maxTokens: 16,
      timeoutMs: 150,
    })
    code = 'NO-ERROR'
  } catch (error) {
    code = error?.code
  }
  const elapsed = Date.now() - started
  check('a wedged stream fails instead of hanging', code === 'TIMEOUT', String(code))
  check('the deadline fires promptly, not at 120s', elapsed < 2000, `${String(elapsed)}ms`)

  // A stream that yields normally is unaffected by the race.
  const okLlm = {
    stream() {
      return {
        [Symbol.asyncIterator]() {
          const chunks = [
            { type: 'text-delta', text: 'hello ' },
            { type: 'text-delta', text: 'world' },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
          let index = 0
          return { next: () => Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }) }
        },
      }
    },
  }
  const ok = await rewriteDraft(okLlm, { provider: 'p', model: 'm', system: 's', userMessage: 'u', maxTokens: 16, timeoutMs: 5000 })
  check('a healthy stream still assembles its text', ok.text === 'hello world', ok.text)

  // An adapter that reports failure through `finish` still throws.
  const failingLlm = {
    stream() {
      return {
        [Symbol.asyncIterator]() {
          const chunks = [{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } }]
          let index = 0
          return { next: () => Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }) }
        },
      }
    },
  }
  let failCode
  try {
    await rewriteDraft(failingLlm, { provider: 'p', model: 'm', system: 's', userMessage: 'u', maxTokens: 16, timeoutMs: 5000 })
    failCode = 'NO-ERROR'
  } catch (error) {
    failCode = error?.code
  }
  check('a finish/error chunk still surfaces its code', failCode === 'RATE_LIMIT', String(failCode))
}

// ---------------------------------------------------------------------------
section('AI card drafting')

const wellFormed = JSON.stringify({
  id: 'lighthouse-keeper',
  name: '灯塔守夜人',
  icon: '🕯️',
  description: '暴躁但可靠的老守夜人',
  style: '以守夜人的口吻说话，发言者方向：角色是助手身份，改写用用户的语气向角色说话。',
  intensity: 'strong',
  examplesByIntensity: {
    light: [{ from: '修 a.js 的 bug', to: '修一下 a.js 的 bug 吧。' }],
    medium: [{ from: '修 a.js 的 bug', to: '守夜人，修 a.js 的 bug。' }],
    strong: [{ from: '修 a.js 的 bug', to: '守夜人，趁潮水未退，修了 a.js 的 bug。' }],
    zealot: [{ from: '修 a.js 的 bug', to: '灯塔在上，愿您清除 a.js 的 bug。' }],
  },
})
{
  const parsed = parseCardDraft(wellFormed)
  check('a well-formed card parses', parsed.error === undefined && parsed.document.id === 'lighthouse-keeper', parsed.error ?? '')
  // Fidelity is the user's decision, never the model's: a generated card must
  // not quietly acquire the power to add behavioural constraints.
  check('a generated card is forced to voice-only fidelity', parsed.document.fidelity === 'style', JSON.stringify(parsed.document.fidelity))
  check(
    'a generated card carries all four intensity sets',
    ['light', 'medium', 'strong', 'zealot'].every((level) => parsed.document.examplesByIntensity?.[level]?.length > 0),
    JSON.stringify(Object.keys(parsed.document.examplesByIntensity ?? {})),
  )
  // The generated document must pass the SAME validator the save path uses, or
  // the route could hand the form a card that cannot be saved.
  const normalized = normalizeCard(parsed.document, { fallbackId: undefined, source: 'user' })
  check('a generated card passes the save validator', normalized.error === undefined, normalized.error ?? '')

  // Models wrap JSON in fences or bracket it with prose; both must survive.
  const messy = `Sure!\n\`\`\`json\n${wellFormed}\n\`\`\`\nHope that helps.`
  check('a fenced answer with prose still parses', parseCardDraft(messy).document?.id === 'lighthouse-keeper', JSON.stringify(parseCardDraft(messy).error))
  // THE REPORTED FAILURE: clean JSON with a sentence AFTER it. The recovery step
  // used to run only when the text did not START with `{`, so this exact shape
  // skipped recovery and blew up with "Unexpected non-whitespace character after
  // JSON". A trailing sentence is one of the most common model habits.
  const trailing = `${wellFormed}\nThis card captures the lighthouse keeper's voice.`
  check(
    'clean JSON with a trailing sentence still parses',
    parseCardDraft(trailing).document?.id === 'lighthouse-keeper',
    JSON.stringify(parseCardDraft(trailing).error),
  )
  check(
    'a fenced answer with a trailing sentence still parses',
    parseCardDraft(`\`\`\`json\n${wellFormed}\n\`\`\`\nEnjoy!`).document?.id === 'lighthouse-keeper',
    JSON.stringify(parseCardDraft(`\`\`\`json\n${wellFormed}\n\`\`\`\nEnjoy!`).error),
  )
  check(
    'a trailing blank line does not break parsing',
    parseCardDraft(`${wellFormed}\n\n`).document?.id === 'lighthouse-keeper',
    JSON.stringify(parseCardDraft(`${wellFormed}\n\n`).error),
  )
  check('bare prose is rejected', parseCardDraft('I cannot do that').error !== undefined)
  check('an empty answer is rejected', parseCardDraft('   ').error !== undefined)
  check('malformed JSON is rejected', parseCardDraft('{ "id": ').error !== undefined)
  check('a JSON array is rejected', parseCardDraft('[1,2,3]').error !== undefined)
  // Recovery must not invent an object out of unrelated text.
  check('prose with no object is rejected', parseCardDraft('Sorry, I cannot help with that.').error !== undefined)
  // A malformed example is dropped, not turned into a half-example that would
  // teach the model a broken format. The legacy flat list is still read.
  const withJunkExample = parseCardDraft(JSON.stringify({
    id: 'x-card', name: 'X', style: 'Speak plainly.',
    examples: [{ from: 'a', to: 'b' }, { from: '', to: 'c' }, 'nonsense'],
    examplesByIntensity: {
      light: [{ from: 'a', to: 'b' }],
      medium: [{ from: 'a', to: 'b' }],
      strong: [{ from: 'a', to: 'b' }],
      zealot: [{ from: 'a', to: 'b' }],
    },
  }))
  check('a malformed example is dropped, not repaired', withJunkExample.document?.examples?.length === 1, JSON.stringify(withJunkExample.document?.examples))

  // A card must carry ALL FOUR intensity sets. This is what a truncated
  // generation looks like: the model runs out of output budget part-way through
  // `examplesByIntensity`, the longest field and the one written last. Accepting
  // the partial card produced a form that looked fine and a card whose voice
  // silently vanished on two of four settings.
  const twoRungs = JSON.stringify({
    id: 'x-card', name: 'X', style: 'Speak plainly.',
    examplesByIntensity: { light: [{ from: 'a', to: 'b' }], medium: [{ from: 'a', to: 'b' }] },
  })
  const partial = parseCardDraft(twoRungs)
  check('a card missing intensity sets is refused', partial.error !== undefined, JSON.stringify(partial.document?.examplesByIntensity))
  check(
    'the refusal names the missing levels',
    typeof partial.error === 'string' && partial.error.includes('strong') && partial.error.includes('zealot'),
    String(partial.error),
  )
  check('a card with no intensity sets at all is refused', parseCardDraft(JSON.stringify({ id: 'x-card', name: 'X', style: 'S' })).error !== undefined)
}
check('the draft prompt states the speaker direction', CARD_DRAFT_SYSTEM.includes('speaker direction'))
// The generator must not hardcode the direction either: it has to take it from
// the idea it is given, and only fall back when the idea is silent.
check(
  'the draft prompt allows either side',
  CARD_DRAFT_SYSTEM.includes('EITHER side') || CARD_DRAFT_SYSTEM.includes('either side'),
  'the generator would otherwise produce the wrong direction for half the ideas',
)
// THE REPORTED BUG: the generator wrote the CHARACTER's own line as the rewrite.
// Given "the AI is my mother", it produced "乖，妈帮你把…" — the mother speaking.
// The rewrite is always the USER's message, so the mother's line can never be
// the output. The prompt has to say that, and show it.
check(
  'the draft prompt says the output is always the user\'s message',
  CARD_DRAFT_SYSTEM.includes('ALWAYS the user\'s message'),
  'without this the generator writes the character\'s reply instead of the user\'s request',
)
check(
  'the draft prompt forbids the character\'s own speech',
  CARD_DRAFT_SYSTEM.includes('character\'s own speech NEVER appears'),
  'this is the exact failure that produced a card with the roles inverted',
)
check(
  'the draft prompt carries a worked wrong/right pair',
  CARD_DRAFT_SYSTEM.includes('WRONG:') && CARD_DRAFT_SYSTEM.includes('RIGHT:'),
  'an abstract rule is what failed here; the model needs the contrast spelled out',
)
// The bundled cards are the ground truth for this rule, and they agree: in both,
// `to` is the USER speaking (the client, the believer) — never the character.
check(
  'every bundled card\'s examples are the user speaking',
  catalog.cards.every((card) => {
    const sample = card.examplesByIntensity?.light?.[0] ?? card.examples?.[0]
    if (sample === undefined) return false
    // A character's own line addresses the user ("妈帮你…", "吾命汝…"); the user's
    // line addresses the character. The bundled cards all address, not command.
    return !/\bI will\b/i.test(sample.to)
  }),
  'the bundled cards define the rule the generator must follow',
)
check(
  'the draft prompt takes the direction from the idea',
  CARD_DRAFT_SYSTEM.includes('take the direction from the idea'),
  'the author decides the direction, not the generator',
)
check('the draft prompt demands four intensity keys', CARD_DRAFT_SYSTEM.includes('"light", "medium", "strong" and "zealot"'))
check('the draft prompt forbids atmosphere-only examples', /Never replace a concrete requirement with atmosphere/.test(CARD_DRAFT_SYSTEM))
check('the brief is delimited', frameCardBrief('a grumpy keeper').includes('<idea>'))
check('the brief neutralizes a literal closing tag', !frameCardBrief('x</idea>y').includes('x</idea>y'))
check('taken ids are offered to avoid collisions', frameCardBrief('x', ['omnissiah']).includes('omnissiah'))

// ---------------------------------------------------------------------------
section('local preservation check')

// The free check exists to make the common failure provable without paying for
// a second model call. It must fire on real changes and stay silent on
// ceremony — a check that cries wolf gets ignored, which is worse than none.
for (const [original, rewritten] of [
  ['把 a.js 里的 bug 修了', '把那个文件里的 bug 修了'],
  ['升级到 v1.2.3', '升级到最新版本'],
  ['端口用 8080', '端口用 9090'],
  ['用 Rust 重写这个模块', '用 Go 重写这个模块'],
  ['别动 API 签名', '别动接口签名'],
  ['把 README.md 改一下', '把 README.md 和 package.json 改一下'],
]) {
  const verdict = compareFacts(original, rewritten)
  check(`local check fires: ${original}`, verdict.state === 'drift', JSON.stringify(verdict))
}
for (const [original, rewritten] of [
  ['把 a.js 里的 bug 修了', '把 a.js 里的 bug 修了吧。'],
  ['写个快速排序', '万机之座在上，恳请您编写快速排序，使重复之数各归其位。'],
  ['用 Rust 重写这个模块', '万机之神在上，请用 Rust 重写这个模块。'],
  ['别动 API 签名', '万机之座在上，请勿改动 API 签名。'],
  ['跑 npm run build', '老哥们，npm run build 跑起来！'],
  ['FIX the bug in a.js', 'fix the bug in a.js'],
]) {
  const verdict = compareFacts(original, rewritten)
  check(`local check stays silent: ${original}`, verdict.state === 'ok', JSON.stringify(verdict))
}
// The verdict must NAME what went missing; a bare warning is not actionable.
{
  const verdict = compareFacts('修 a.js 里的 bug', '修那个文件里的 bug')
  check('the local check names the lost token', verdict.missing.includes('a.js'), JSON.stringify(verdict))
}
// Ceremony must never be reported as an ADDED fact — the whole point of a
// persona is that it adds words the draft never had.
{
  const verdict = compareFacts('写个快速排序', '伟大而不朽的万机之神，恳请您赐予我们快速排序的奥义。')
  check('ceremony is not reported as an invented fact', verdict.added.length === 0, JSON.stringify(verdict))
}

// ---------------------------------------------------------------------------
section('route resolution order')

// The bug this locks down: the rewrite read only the session's last REQUEST
// header, so switching models in the dropdown and then rewriting ran on the
// PREVIOUS model. Observed live as a rewrite stuck forever on a rate-limited
// stale route while the composer showed the newly picked one.
{
  const { sessionRouteOf, pendingRouteOf, defaultRouteOf, resolveRoute } = await import('../lib/routes.js')

  /** A context with a sessions service and an optional modelSelection projection. */
  const makeCtx = ({ header, pending, hasProjection = true }) => {
    const session = { requestHeader: () => header }
    const services = {
      sessions: { get: (id) => (id === 'session-1' ? session : undefined) },
      agentDefaultModel: { currentSelection: () => ({ provider: 'default-p', model: 'default-m' }) },
    }
    if (hasProjection) {
      services.sessionProjections = { stateOf: (s, key) => (key === 'modelSelection' ? { lastUsed: null, pending } : undefined) }
    }
    return { get: (name) => services[name] }
  }

  // The pending pick WINS over the stale header: this is the whole fix.
  const both = makeCtx({
    header: { config: { provider: 'stale-p', model: 'stale-m' } },
    pending: { provider: 'picked-p', model: 'picked-m' },
  })
  check(
    'a pending selection beats the stale request header',
    JSON.stringify(sessionRouteOf(both, 'session-1')) === JSON.stringify({ provider: 'picked-p', model: 'picked-m' }),
    JSON.stringify(sessionRouteOf(both, 'session-1')),
  )

  // No pending pick: the header is still the right answer, as before.
  const headerOnly = makeCtx({
    header: { config: { provider: 'stale-p', model: 'stale-m' } },
    pending: null,
  })
  check(
    'without a pending pick the header is used',
    JSON.stringify(sessionRouteOf(headerOnly, 'session-1')) === JSON.stringify({ provider: 'stale-p', model: 'stale-m' }),
    JSON.stringify(sessionRouteOf(headerOnly, 'session-1')),
  )

  // Every projection step is optional; a missing service must not throw.
  const noProjection = makeCtx({
    header: { config: { provider: 'hdr-p', model: 'hdr-m' } },
    pending: { provider: 'ignored-p', model: 'ignored-m' },
    hasProjection: false,
  })
  check(
    'a harness without the projection falls back to the header',
    JSON.stringify(sessionRouteOf(noProjection, 'session-1')) === JSON.stringify({ provider: 'hdr-p', model: 'hdr-m' }),
    JSON.stringify(sessionRouteOf(noProjection, 'session-1')),
  )

  // A malformed pending value must not win: it falls through to the header.
  const junkPending = makeCtx({
    header: { config: { provider: 'hdr-p', model: 'hdr-m' } },
    pending: { provider: '', model: '' },
  })
  check(
    'an empty pending selection does not win',
    JSON.stringify(sessionRouteOf(junkPending, 'session-1')) === JSON.stringify({ provider: 'hdr-p', model: 'hdr-m' }),
    JSON.stringify(sessionRouteOf(junkPending, 'session-1')),
  )

  // The default is the LAST resort, not the first. `sessionRouteOf` reports
  // "this session named nothing"; composing the default is `resolveRoute`'s job.
  const nothing = makeCtx({ header: undefined, pending: null })
  check('a session with no header names no route of its own', sessionRouteOf(nothing, 'session-1') === undefined, JSON.stringify(sessionRouteOf(nothing, 'session-1')))
  check(
    'resolveRoute falls back to the harness default',
    JSON.stringify(resolveRoute(nothing, 'session-1')) === JSON.stringify({ provider: 'default-p', model: 'default-m' }),
    JSON.stringify(resolveRoute(nothing, 'session-1')),
  )
  check('an unknown session resolves no route', sessionRouteOf(nothing, 'nope') === undefined)
  check('an empty session id resolves no route', sessionRouteOf(nothing, '') === undefined)
  check('pendingRouteOf tolerates a missing session', pendingRouteOf(nothing, undefined) === undefined)
  check(
    'defaultRouteOf reads the harness default',
    JSON.stringify(defaultRouteOf(nothing)) === JSON.stringify({ provider: 'default-p', model: 'default-m' }),
    JSON.stringify(defaultRouteOf(nothing)),
  )
}

// ---------------------------------------------------------------------------
section('docs')

// The READMEs are the plugin's front door, and two things in them rot silently:
// the status line drifts behind the actual version, and the inspiration link
// disappears in a rewrite that did not know it mattered.
{
  const { readFile: readDoc } = await import('node:fs/promises')
  const { version } = JSON.parse(await readDoc(join(root, 'package.json'), 'utf8'))
  const minor = `${version.split('.').slice(0, 2).join('.')}.x`
  for (const file of ['README.md', 'README.en.md']) {
    const doc = await readDoc(join(root, file), 'utf8')
    check(`${file} states the current minor version`, doc.includes(`\`${minor}\``), `want ${minor}`)
    check(
      `${file} credits the inspiration`,
      doc.includes('BV1Ata26pE92') && doc.includes('身居幻想乡の长乐安生'),
      'the video is where this project came from; losing the link loses the point',
    )
    check(
      `${file} names the target model`,
      /DeepSeek Flash|deepseek flash/i.test(doc),
      'this is tuned for Flash, and saying so sets the expectation',
    )
  }
}

// ---------------------------------------------------------------------------
section('client bundle syntax')

const clientSource = await readFile(join(root, 'lib', 'client.js'), 'utf8')
check('client registers with the module loader', clientSource.includes("window.__ModuleLoader__.load"))
// Compile without executing: catches a syntax error the shell would otherwise
// report only as a blank slot.
try {
  new Function(clientSource)
  check('client bundle compiles', true)
} catch (error) {
  check('client bundle compiles', false, error.message)
}
check('client imports no harness client package', !/require\(['"]@deepseek-ai/.test(clientSource))

// ---------------------------------------------------------------------------
section('client/host contract')

// The browser half is plain CommonJS and cannot import the host's ESM module,
// so it repeats the route prefix. Assert the two agree: this is the one
// duplication in the package, and it must not drift.
const { PREFIX } = await import('../lib/shared/protocol.js')
check(
  'client and host agree on the route prefix',
  clientSource.includes(`const PREFIX = '${PREFIX}'`),
  `host PREFIX=${PREFIX}; client does not declare it identically`,
)
for (const route of ['/cards', '/rewrite', '/cards/save', '/cards/delete', '/cards/reset', '/cards/diff', '/cards/draft', '/reveal']) {
  check(`client calls ${route}`, clientSource.includes(`\${PREFIX}${route}`), route)
}

// AI 代填 may only PREFILL the form. If it ever wrote to disk directly, a bad
// generation would enter the card catalog with no review step — the opposite of
// what the rewrite panel enforces.
check(
  'the AI draft only fills the form',
  clientSource.includes('draftCard(') && /setForm\(toForm\(value\?\.card/.test(clientSource),
  'the generated card must land in the form, not on disk',
)
check(
  'the AI draft has its own explicit action',
  clientSource.includes("t('settings.ai.generate')"),
  'generation must be a user action, never automatic',
)
// The description must name the FIELDS the generator actually fills, and the
// one it deliberately refuses to. The copy said "按同一套规范" — a phrase that
// told the user nothing, because "the spec" was an internal quality standard
// rather than anything they could see on the form.
{
  const desc = /'settings\.ai\.desc': '([^']*)'/.exec(clientSource)?.[1] ?? ''
  check(
    'the AI draft description names the card fields',
    ['名字', '图标', '简介', '风格'].every((field) => desc.includes(field)),
    `the user cannot see what "the spec" means: ${desc}`,
  )
  check(
    'the AI draft description no longer says "同一套规范"',
    !desc.includes('规范'),
    'an internal standard is not something the user can act on',
  )
  // The speaker direction is this plugin's number-one failure mode, and the
  // BRIEF is where it gets decided. It is carried by the PLACEHOLDER alone:
  // the example is the strongest teaching signal in the box, and saying it
  // again in prose above the button was the same instruction three times over.
  const placeholder = /'settings\.ai\.briefPlaceholder': '([^']*)'/.exec(clientSource)?.[1] ?? ''
  check(
    'the brief placeholder demonstrates the speaker direction',
    placeholder.includes('AI 扮演') || placeholder.includes('AI plays'),
    'the example is the strongest teaching signal in the box',
  )
  check(
    'the brief placeholder names the user\'s own role',
    placeholder.includes('我是') || placeholder.includes('I am'),
    'the direction is only complete when both sides are named',
  )
  // No separate direction paragraph. The prompt layer enforces the direction
  // and the placeholder demonstrates it, so a third telling is noise.
  check(
    'the direction is not restated as a separate paragraph',
    !clientSource.includes("t('settings.ai.direction')") && !/'settings\.ai\.direction'/.test(clientSource),
    'the same instruction three times is what made the box unreadable',
  )
  check(
    'the description does not repeat the placeholder',
    !desc.includes('AI 扮演') && !desc.includes('你是谁'),
    'the placeholder already shows the shape of an idea',
  )
}
// A generated card never acquires the power to add behavioural constraints:
// that is the user's decision, so the copy must say the fidelity is fixed.
check(
  'the generated card is pinned to voice-only fidelity',
  /fidelity: 'style',\s*\n\s*mode: 'llm'/.test((await readFile(join(root, 'lib', 'prompts.js'), 'utf8'))),
  'a generated card must not quietly acquire constraint-adding power',
)
check(
  'the copy states the generated fidelity is fixed',
  /'settings\.ai\.hint': '[^']*只改语气/.test(clientSource),
  'a fixed default the user is not told about is a surprise later',
)

// The form must carry the per-intensity examples. Leaving them out silently
// dropped them on the next save: editing a bundled card discarded all four
// intensity example sets and the card fell back to the flat list.
check(
  'the form carries the per-intensity examples',
  clientSource.includes('byIntensityText') && /examplesByIntensity/.test(clientSource),
  'editing a card must not discard its intensity demonstration sets',
)
// Delete is meaningless on a card whose content still matches the bundle: the
// file is a seed copy that the next start writes back.
check(
  'delete is hidden for an untouched bundled card',
  /card\.origin === 'builtin'[\s\S]{0,120}null/.test(clientSource),
  'a delete that the next start undoes must not be offered',
)
check(
  'the row tag is driven by provenance, not by the presence of a file',
  clientSource.includes("t(`settings.origin.${card.origin ?? 'custom'}`)")
    && !clientSource.includes("card.builtin === true ? t('settings.builtin')"),
  'tagging on "a user file exists" labelled every seeded card as custom',
)
for (const origin of ['builtin', 'edited', 'custom']) {
  check(`client labels origin "${origin}"`, clientSource.includes(`'settings.origin.${origin}'`), origin)
}

// The drift check is an explicit action, and the restore button follows its
// result — never a bare per-card flag, which would put a restore action on
// every seeded row and make a long card list unusable.
check(
  'the client has an explicit drift check',
  clientSource.includes('diffCards()') && clientSource.includes("t('settings.check')"),
  'the check must be a user action',
)
check(
  'restore is gated on the drift result',
  clientSource.includes('driftedIds.has(card.id)') && !clientSource.includes('card.shadowsBuiltin === true'),
  'a permanent per-row restore button is the noise the check exists to avoid',
)

// The rewrite is triggered by the composer's OWN send gesture (button or
// Enter), so the menu carries no separate run action. What the menu must
// provide is a way to turn the persona off and to see the current choice.
check('client declares an off state', clientSource.includes("const OFF = 'off'"), 'OFF constant missing')
check('the off state is the default selection', /readLocal\(cardKey\(sessionKey\)\) \?\? OFF/.test(clientSource))
check('the menu offers the off choice', clientSource.includes("pickCard(OFF)"))
check(
  'the menu no longer duplicates the send action',
  !clientSource.includes('pf-run'),
  'the send gesture is the trigger; a second run button would duplicate it',
)
check('no hidden right-click-only trigger remains', !clientSource.includes('onContextMenu'), 'onContextMenu still present')

// ---------------------------------------------------------------------------
section('per-card settings')

// Intensity and send mode belong to the CHARACTER, not to the session and not
// to the menu as a whole. Keyed by session, switching character carried the
// previous card's settings over silently; shown as one shared block above the
// list, they read as global switches.
check(
  'intensity is keyed by card',
  /const intensityKey = \(card\) => `persona-forge:intensity:\$\{card\}`/.test(clientSource),
  'a per-session key is what made the setting follow the wrong thing',
)
check(
  'send mode is keyed by card',
  /const sendModeKey = \(card\) => `persona-forge:sendMode:\$\{card\}`/.test(clientSource),
  'send mode is a property of the character too',
)
check(
  'writing intensity targets the selected card',
  /writeLocal\(intensityKey\(cardId\), level\)/.test(clientSource),
  'writing to the session key would persist it in the wrong place',
)
check(
  'writing send mode targets the selected card',
  /writeLocal\(sendModeKey\(cardId\), mode\)/.test(clientSource),
  'writing to the session key would persist it in the wrong place',
)
// Switching character must RE-READ that card's settings, or the previous
// card's values stay on screen and get written to the new card's key. All four
// settings are per card now, so all four must be re-read.
check(
  'switching card re-reads that card\'s settings',
  (() => {
    const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[cardId\]\)/.exec(clientSource)
    if (effect === null) return false
    const body = effect[1]
    return ['sendModeKey', 'intensityKey', 'modeKey', 'fidelityKey'].every((key) => body.includes(`readLocal(${key}(cardId))`))
  })(),
  'without this the previous card settings carry over and get re-saved',
)
// Picking a card must NOT close the menu: choosing a character and configuring
// it are one act, and closing forced a reopen to touch intensity at all.
check(
  'picking a card keeps the menu open',
  !/const pickCard = useCallback\(\(id\) => \{[\s\S]{0,200}setOpen\(false\)/.test(clientSource),
  'closing on pick hides the settings the pick was meant to configure',
)
// The selected card's settings fold under its own row.
check(
  'the selected card has its own settings fold',
  clientSource.includes('pf-card-cfg') && clientSource.includes("t('control.cardCfg'"),
  'a shared block above the list reads as a global switch',
)
// The card directory has exactly ONE entry point, and it is the settings page.
// It was also a menu row, which put a one-time housekeeping action in the path
// of the common one — and a second door to the same room.
check(
  'the menu no longer carries a directory action',
  !clientSource.includes("t('control.menu.reveal')") && !clientSource.includes("t('control.more')"),
  'the settings page already opens the directory',
)
check(
  'the settings page still opens the directory',
  clientSource.includes("t('settings.reveal')") && clientSource.includes('revealDir()'),
  'removing the menu row must not remove the only way in',
)

// Restoring the original must REWIND the "already rewritten" memory, not keep
// it. Otherwise a rewrite the user cancelled can never be retried: the next
// send on the restored draft matches the recorded result and the plugin
// silently lets the raw text through.
check(
  'restoring the original forgets the rewrite',
  /lastRewrite\.delete\(sessionKey\)/.test(clientSource),
  'a cancelled rewrite would be impossible to retry',
)
// Anything else is a SETTLED result — the model's rewrite, or the user's own
// edit of it in the now-editable result column — and must be recorded so that
// sending it from the composer does not rewrite it a second time.
check(
  'a settled result is recorded as already rewritten',
  /lastRewrite\.set\(sessionKey, \{ result: text, original: panel\.original \}\)/.test(clientSource),
  'an edited result would come back as a fresh rewrite of the user own edit',
)
check(
  'the rewind and the record are mutually exclusive',
  /if \(text === panel\.original\) \{[\s\S]*?lastRewrite\.delete\(sessionKey\)[\s\S]*?\} else \{[\s\S]*?lastRewrite\.set\(sessionKey/.test(clientSource),
  'restoring must not also record itself as a result',
)

// The "one wedged rewrite poisons every later one" bug.
//
// The panel is a single shared surface, but the guards around it must be
// PER SESSION. `start()` and `runRewrite()` used the global panel state, so a
// rewrite stuck at `loading` in one session silently swallowed every later
// rewrite in every session: no error, no rewrite, and — because the send
// gesture was still intercepted — no send either. The user sees the plugin
// stop working entirely, which is what "it just sends my text now" was.
//
// These are structural guards, not behavioural ones: the client half is a
// browser bundle with no build step, so it cannot be imported and driven from
// this suite. The host half carries the behavioural tests.
check(
  'runRewrite refuses only a concurrent run for the SAME session',
  /if \(inFlight !== null && inFlight\.phase === 'loading' && inFlight\.sessionKey === options\.sessionKey\) return/.test(clientSource),
  'a global loading guard lets one wedged session block all others',
)
check(
  'start() guards on the per-session busy, not the shared panel',
  /if \(busyHere\) return/.test(clientSource) && !/const start = useCallback\(\(\) => \{\s*\n\s*if \(busy\) return/.test(clientSource),
  'the global `busy` here is the silent swallow that killed later rewrites',
)
check(
  'the send interceptor and start() agree on which busy they mean',
  /if \(snapshot\.busy === true\)/.test(clientSource) && /busy: busyHere/.test(clientSource),
  'intercepting on a per-session busy while start() refuses on a global one loses the gesture',
)
// A panel that never leaves `loading` blocks that session forever, so the
// client must not depend on the host answering to become usable again.
check(
  'a rewrite watchdog settles the panel without the host',
  /CLIENT_REWRITE_WATCHDOG_MS/.test(clientSource) && /window\.setTimeout\(\(\) => \{/.test(clientSource),
  'if the host never answers, the panel must still leave loading',
)
check(
  'the watchdog is cleared on both settle paths',
  (clientSource.match(/window\.clearTimeout\(watchdog\)/g) ?? []).length === 2,
  'a leaked watchdog would overwrite a settled panel with a bogus timeout error',
)
check(
  'the watchdog timeout has copy in both locales',
  (clientSource.match(/'error\.timeout':/g) ?? []).length >= 4,
  'a raw code would reach the panel',
)

// The composer menu is a CHARACTER PICKER first, so everything that configures
// a character lives in ONE fold under the character it configures — rather than
// a shared block above the list (which read as a global switch) or a second,
// separate "more settings" fold (which split one idea across two places).
check(
  'character settings are folded away',
  clientSource.includes('pf-card-cfg') && clientSource.includes('setCardCfgOpen'),
  'the menu should not present overrides as equal-weight controls',
)
check(
  'the fold starts closed',
  /const \[cardCfgOpen, setCardCfgOpen\] = useState\(false\)/.test(clientSource),
  'an open fold by default defeats the point',
)
check(
  'there is no second settings fold',
  !clientSource.includes('setAdvancedOpen') && !clientSource.includes('advancedSummary'),
  'two folds for one idea is how the settings drifted apart before',
)
check(
  'the folded row still reports the current settings',
  /className: 'pf-item-desc'[\s\S]{0,400}control\.intensity\.\$\{effectiveIntensity\}/.test(clientSource),
  'a folded-away choice the user forgot about is a surprise waiting to happen',
)
// Rewrite mode belongs with the character, not in a separate fold — and each
// option says what it does, because the row alone named three and explained none.
check(
  'rewrite mode is configured per character',
  clientSource.indexOf("t('control.mode')") > clientSource.indexOf('cardCfgOpen'),
  'rewrite mode is a property of the character',
)
// Each mode's description is its TOOLTIP, not a paragraph under the row: the
// fold was drowning in prose, and a control you have already chosen does not
// need its explanation on screen permanently.
check(
  'every rewrite mode carries a tooltip description',
  ['card', 'llm', 'template'].every((mode) => clientSource.includes(`'control.mode.desc.${mode}'`))
    && clientSource.includes("title: t(`control.mode.desc."),
  'naming three options without explaining them is a guessing game',
)
// Fidelity is offered on EVERY card, in both directions. It used to appear only
// on a strategy card and only ever narrow, which made a choice the settings page
// has always allowed invisible where the work actually happens.
check(
  'fidelity is offered on every card',
  !/selected\?\.fidelity === 'strategy'\s*\n\s*\? \[/.test(clientSource),
  'hiding the control did not remove the capability, only the discoverability',
)
check(
  'fidelity can be set in both directions',
  clientSource.includes("['style', t('control.fidelity.style')]") && clientSource.includes("['strategy', t('control.fidelity.strategy')]"),
  'one-way narrowing is what made widening unreachable',
)
// Every fidelity option explains itself, and the label carries the tooltip.
check(
  'every fidelity option carries a tooltip',
  ['card', 'style', 'strategy'].every((value) => clientSource.includes(`'control.fidelity.hint.${value}'`))
    && clientSource.includes("title: t(`control.fidelity.hint."),
  'a control whose consequence is invisible is a trap',
)
// "No persona" is an exit action; listing it first made it the first thing read
// in a menu whose whole point is choosing a character.
check(
  '"no persona" is last, after the cards',
  clientSource.indexOf('onClick: () => pickCard(OFF)') > clientSource.indexOf('onClick: () => pickCard(card.id)'),
  'an exit action should not precede the choices',
)
// Dead dictionary keys are unfinished intent: they promise an entry the UI does
// not render.
check(
  'no dead "manage cards" key remains',
  !clientSource.includes("'control.menu.manage'"),
  'that slot cannot open settings, so the key only pretends there is a path',
)
// The model-based second pass is GONE, not hidden. It doubled the latency and
// the token cost of every send to re-check what the free token comparison
// answers for nothing, and the settings page never offered a working control
// for it — a documented feature with no reachable switch. Its prompt, its
// parser and every wire field must be gone, not merely unreferenced.
check(
  'the retired model check leaves no client-side trace',
  !clientSource.includes('factCheck') && !clientSource.includes('modelCheck'),
  'a dead wire field or a stale toggle is a second source of truth',
)
check(
  'the retired model check leaves no verdict copy',
  !clientSource.includes("'panel.drift'") && !clientSource.includes("'panel.checkOk'"),
  'copy for a check that cannot run is a lie on screen',
)
// The waiting panel must show progress. A "改写中" with no sense of time reads
// as FROZEN -- the user cannot tell "working" from "hung".
check(
  'the waiting panel shows elapsed seconds',
  clientSource.includes('panel.startedAt') && clientSource.includes('pf-elapsed'),
  'a rewrite waiting on a slow model must not read as frozen',
)

// Four intensity rungs. A jump from medium straight to zealot left no way to
// ask for a strong voice that is not yet full ritual.
check(
  'the intensity ladder has four rungs',
  /INTENSITY_LEVELS = \['light', 'medium', 'strong', 'zealot'\]/.test(clientSource),
  'expected light/medium/strong/zealot',
)
check(
  'every rung is labelled',
  ['light', 'medium', 'strong', 'zealot'].every((level) => clientSource.includes(`'control.intensity.${level}'`)),
  'a rung without a label renders a raw key',
)

// The composer's native send action starts a rewrite. There is no plugin hook
// for it, so the client intercepts the click on the composer card and
// identifies the button by its accessible name from the shell's own
// `conversation` locale namespace. Every guard must fail toward letting the
// native send happen.
check(
  'client binds the shell conversation namespace for send labels',
  clientSource.includes("locale.bind('conversation')"),
  'send-button identification relies on the conversation namespace',
)
check(
  'client intercepts the composer send click',
  clientSource.includes("window.addEventListener('click', onClickCapture, true)"),
  'no send interception attached',
)
// The listener lives on `window`, and the guard scopes each event to the
// composer card it actually belongs to. Binding the listener to the card
// instead meant an un-found card silently disarmed interception entirely — the
// plugin looked dead, with no error to explain it.
check(
  'client scopes the interception to the composer card',
  clientSource.includes('composerCardOf(') && clientSource.includes("closest('[data-composer-card]')"),
  'the guard must scope each event to a composer card',
)
check(
  'interception reads the send labels rather than a CSS class',
  clientSource.includes('sendLabels()') && !clientSource.includes('RlGAzG'),
  'identifying the button by a hashed class would break on any restyle',
)
check(
  'a rewrite is never rewritten twice',
  clientSource.includes('lastRewrite'),
  'the send gesture must not loop rewriting its own output',
)

// Direct mode must CLOSE its panel once the message is sent.
//
// A settled panel sets `panelOpen`, and `decideSend` swallows the composer's
// send gesture while that is true. Leaving the panel up after an auto-send
// therefore blocked the NEXT message: the rewrite went out, and then nothing
// could be sent until the panel was dismissed by hand. Reported as "direct send
// works, but the review card still shows up".
check(
  'direct mode closes its panel after sending',
  /owned\.sendMode !== 'direct'[\s\S]{0,900}closePanel\(\)\s*\n\s*\}, 60\)/.test(clientSource),
  'a lingering panel swallows the composer send arrow for the next message',
)
check(
  'the panel closes only after a successful submit',
  /try \{\s*\n\s*submit\(\)\s*\n\s*\} catch \{[\s\S]{0,200}return\s*\n\s*\}\s*\n\s*closePanel\(\)\s*\n\s*\}, 60\)/.test(clientSource),
  'a refused submit must leave the panel up so the user can send by hand',
)
// Review mode must KEEP its panel: that panel is the decision point.
check(
  'review mode does not auto-close its panel',
  !/owned\.sendMode !== 'review'[\s\S]{0,200}closePanel\(\)/.test(clientSource),
  'closing the review panel would remove the confirmation step',
)

// ---------------------------------------------------------------------------
section('send-gesture decision')

// The decision that says whether one send becomes a rewrite is a PURE function,
// so it can be driven here. It fails silently in both directions — swallow a
// gesture that should have been sent and the message vanishes; let one through
// that should have been rewritten and the persona quietly does nothing — and
// neither throws. That is why it is extracted and tested rather than left
// inline in a component no offline check can reach.
{
  // Boot the REAL client bundle with a window stub, exactly as the shell does,
  // and reach the decision through the module's own test seam. This is what
  // makes the check behavioural rather than a source-text shape match.
  const { decideSend } = await (async () => {
    const previousWindow = globalThis.window
    let registered = null
    globalThis.window = {
      __ModuleLoader__: { load: (module) => { registered = module } },
    }
    try {
      await import(`../lib/client.js?probe=${String(Date.now())}`)
      if (registered === null) throw new Error('the client bundle did not register with the module loader')
      const factory = registered.factory
      const stubReact = {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useRef: () => ({ current: null }),
        useSyncExternalStore: () => ({}),
      }
      const module = factory(() => stubReact)
      return module.__internals
    } finally {
      globalThis.window = previousWindow
    }
  })()

  check('the client exposes its send-gesture decision for testing', typeof decideSend === 'function')

  /** A plain composer snapshot, with overrides. */
  const snap = (over = {}) => ({
    sessionKey: 's1', cardId: 'omnissiah', busy: false, draft: '讲个笑话', phase: 'plain', ...over,
  })

  check('a plain draft is rewritten', decideSend(snap(), undefined).action === 'rewrite')
  check('persona off sends as typed', decideSend(snap({ cardId: 'off' }), undefined).action === 'send')
  check('a missing card id sends as typed', decideSend(snap({ cardId: undefined }), undefined).action === 'send')
  check('an empty draft is sent', decideSend(snap({ draft: '   ' }), undefined).action === 'send')
  check('a non-string draft is sent', decideSend(snap({ draft: undefined }), undefined).action === 'send')
  check('a busy input box is left alone', decideSend(snap({ phase: 'submitting' }), undefined).action === 'send')
  check('no state at all is sent', decideSend(null, undefined).action === 'send')

  // An in-flight rewrite for THIS session swallows the gesture, so the raw
  // draft is never sent while the panel says "rewriting".
  check('an in-flight rewrite swallows the gesture', decideSend(snap({ busy: true }), undefined).action === 'swallow')

  // A settled review panel makes the composer's send arrow inert. The panel is
  // the decision point; letting the arrow through would either send the raw
  // draft past the review or start a SECOND rewrite of it — the duplicate the
  // user reported after the panel appeared.
  check(
    'an open review panel swallows the send gesture',
    decideSend(snap({ panelOpen: true }), undefined).action === 'swallow',
    'the composer arrow must be inert while the panel is up, or the send duplicates',
  )
  check(
    'the panel guard outranks a non-empty draft',
    decideSend(snap({ panelOpen: true, draft: 'something new' }), undefined).action === 'swallow',
  )
  check(
    'closing the panel re-arms the composer',
    decideSend(snap({ panelOpen: false }), undefined).action === 'rewrite',
  )

  // "Fill only" is gone from the normal flow: the result column is editable, so
  // writing the text into the composer without sending is the same act as
  // reviewing it. It survives ONLY as the fallback for a shell with no submit,
  // where it is the sole way to get the text out.
  check(
    'the fill fallback is offered only without a submit action',
    /submit === null\s*\n\s*\?\s*h\('button'[\s\S]{0,200}panel\.fill/.test(clientSource),
    'the fill button must not compete with Send',
  )
  // The result column is an editable control, and what Send/Fill carry is the
  // EDITED text — not the model's original output.
  check(
    'the result column is editable',
    /'textarea',\s*\{[\s\S]{0,300}onChange:/.test(clientSource),
    'a read-only result forces a round trip to fix one word',
  )
  check(
    'the actions carry the edited text',
    /const text = edited !== null && edited\.seed === editSeed \? edited\.text : generated/.test(clientSource),
    'Send/Fill must use what the user sees, not the raw model output',
  )
  check(
    'an edited result is called out',
    clientSource.includes("t('panel.edited')") && /is-edited/.test(clientSource),
    'silently sending edited text is a surprise',
  )

  // Sending the rewrite itself must not rewrite it again.
  check(
    'the rewrite output is sent as-is',
    decideSend(snap({ draft: 'REWRITTEN' }), { result: 'REWRITTEN', original: '讲个笑话' }).action === 'send',
  )

  // THE REPORTED BUG: typing the same sentence again was sent un-rewritten,
  // because the guard also matched `previous.original`. Restoring the original
  // already clears this memory, so matching it bought nothing and silently
  // disabled the persona for any repeated draft.
  check(
    'the same draft typed again is rewritten',
    decideSend(snap({ draft: '讲个笑话' }), { result: 'REWRITTEN', original: '讲个笑话' }).action === 'rewrite',
    'matching previous.original silently disabled the persona on a repeated draft',
  )
  check(
    'an edited draft is rewritten',
    decideSend(snap({ draft: '讲个笑话2' }), { result: 'REWRITTEN', original: '讲个笑话' }).action === 'rewrite',
  )
  // A stale entry from another draft must not block this one.
  check(
    'an unrelated memory does not block a new draft',
    decideSend(snap({ draft: 'new text' }), { result: 'x', original: 'y' }).action === 'rewrite',
  )
  // Every reason is a non-empty string: these are the diagnostics that make a
  // silent failure visible in a real browser.
  check(
    'every decision carries a reason',
    [decideSend(snap(), undefined), decideSend(snap({ busy: true }), undefined), decideSend(null, undefined)]
      .every((decision) => typeof decision.reason === 'string' && decision.reason !== ''),
  )
}

// ---------------------------------------------------------------------------
section('the composer button is per session')

// The panel is one shared surface, so its phase is global — but the BUTTON must
// read it per session. Reading the global phase made every open composer render
// "改写中…" while any single session was rewriting, which reads as "the plugin
// is stuck" in sessions doing nothing at all. Reported exactly that way.
{
  // The button's busy flag is derived from `panelOwned`, which is filtered by
  // sessionKey. The two must stay wired together: a `busy` that ignores
  // `panelOwned` is the global read this guards against.
  check(
    'the composer button derives busy from the session-scoped panel',
    /const panelOwned = shared\.panel !== null && shared\.panel\.sessionKey === sessionKey \? shared\.panel : null[\s\S]{0,400}const busy = panelOwned !== null && panelOwned\.phase === 'loading'/.test(clientSource),
    'a global busy flag makes every other session look stuck',
  )
  // `busy` is still what the button renders, and `busyHere` what the guards use.
  check(
    'the button renders the session-scoped busy',
    /busy \? t\('control\.busy'\) : label/.test(clientSource),
    'the label must follow the same flag the guard uses',
  )
  check(
    'there is exactly one busy derivation',
    (clientSource.match(/shared\.panel !== null && shared\.panel\.phase === 'loading'/g) ?? []).length === 0,
    'a second, global derivation is how the two drifted apart before',
  )
}
// Enter is the primary send gesture and does not go through the button, so the
// keydown path must be intercepted too — while leaving Shift+Enter, IME
// composition and the modifier chords alone.
check(
  'client intercepts the Enter send gesture',
  clientSource.includes('onKeyDownCapture') && clientSource.includes("event.key !== 'Enter'"),
  'Enter sends without the button, so it needs its own listener',
)
check(
  'Enter interception ignores newline and composition',
  /shiftKey \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey/.test(clientSource)
    && clientSource.includes('event.isComposing'),
  'Shift+Enter must insert a newline and an IME commit must not send',
)
check(
  'Enter interception is scoped to the composer text field',
  clientSource.includes("target.closest('[data-composer-input]')"),
  'intercepting Enter globally would break every other input',
)
check(
  'both send paths share one decision function',
  clientSource.includes('interceptSend(event)') && clientSource.includes('const interceptSend = (event)'),
  'the click and Enter paths must not drift apart',
)

// ---------------------------------------------------------------------------
section('host halves')

for (const file of ['index.js', 'routes.js', 'store.js', 'rewrite.js', 'prompts.js', 'http.js', 'loopback.js', 'shared/protocol.js']) {
  const source = await readFile(join(root, 'lib', file), 'utf8')
  try {
    await import(new URL(`../lib/${file}`, import.meta.url).href)
    check(`${file} imports`, true)
  } catch (error) {
    check(`${file} imports`, false, error.message)
  }
  check(`${file} has no harness runtime import`, !/^import .*from ['"]@deepseek-ai/m.test(source), file)
}

// ---------------------------------------------------------------------------
section('result')

await rm(ISOLATED_HOME, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('OK')
