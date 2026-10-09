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
  parseFactCheck,
  renderTemplate,
  FACT_CHECK_SYSTEM,
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
  check(`${card.id}: has examples`, card.examples.length > 0)
  // Every intensity the ladder offers must RESOLVE to demonstrations. A level
  // with no per-intensity set falls back to the card's flat `examples`, which
  // is the documented behaviour — so the assertion is on the resolved set, not
  // on the raw map.
  check(`${card.id}: has per-intensity examples`, card.examplesByIntensity !== undefined, JSON.stringify(Object.keys(card.examplesByIntensity ?? {})))
  const resolvedByLevel = Object.fromEntries(
    INTENSITY_LEVELS.map((level) => [level, examplesFor(card, level)]),
  )
  check(
    `${card.id}: every intensity rung resolves to demonstrations`,
    INTENSITY_LEVELS.every((level) => Array.isArray(resolvedByLevel[level]) && resolvedByLevel[level].length > 0),
    JSON.stringify(Object.fromEntries(INTENSITY_LEVELS.map((level) => [level, resolvedByLevel[level].length]))),
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
check('system carries the hard rules', system.includes('Preserve the technical content EXACTLY'))
check('system carries fidelity rule', system.includes('STYLE ONLY'))
check('system includes examples', system.includes('Conversion examples'))
check('zealot examples differ from medium', examplesFor(omnissiah, 'zealot')[0].to !== examplesFor(omnissiah, 'medium')[0].to)

const muscle = catalog.cards.find((card) => card.id === 'muscle-crew')
const strategySystem = buildSystemPrompt(muscle, 'zealot', examplesFor(muscle, 'zealot'))
check('strategy fidelity stated for muscle crew', strategySystem.includes('STRATEGY ALLOWED'))

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
section('fact check parsing')

check('OK parsed', parseFactCheck('OK').state === 'ok')
check('OK with trailing text parsed', parseFactCheck('OK - voice only').state === 'ok')
const drift = parseFactCheck('DRIFT: dropped the Rust requirement')
check('DRIFT parsed', drift.state === 'drift' && drift.reason.includes('Rust'), JSON.stringify(drift))
check('garbage is unavailable, never ok', parseFactCheck('maybe?').state === 'unavailable')
check('empty is unavailable', parseFactCheck('').state === 'unavailable')
check('fact check prompt demands one line', FACT_CHECK_SYSTEM.includes('exactly one line'))

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
  check('bare prose is rejected', parseCardDraft('I cannot do that').error !== undefined)
  check('an empty answer is rejected', parseCardDraft('   ').error !== undefined)
  check('malformed JSON is rejected', parseCardDraft('{ "id": ').error !== undefined)
  check('a JSON array is rejected', parseCardDraft('[1,2,3]').error !== undefined)
  // A malformed example is dropped, not turned into a half-example that would
  // teach the model a broken format.
  const withJunkExample = parseCardDraft(JSON.stringify({ id: 'x-card', name: 'X', style: 'Speak plainly.', examples: [{ from: 'a', to: 'b' }, { from: '', to: 'c' }, 'nonsense'] }))
  check('a malformed example is dropped, not repaired', withJunkExample.document?.examples?.length === 1, JSON.stringify(withJunkExample.document?.examples))
}
check('the draft prompt states the speaker direction', CARD_DRAFT_SYSTEM.includes('speaker direction'))
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

// Restoring the original must REWIND the "already rewritten" memory, not keep
// it. Otherwise a rewrite the user cancelled can never be retried: the next
// send on the restored draft matches `previous.original === text` and the
// plugin silently lets the raw text through.
check(
  'restoring the original forgets the rewrite',
  /lastRewrite\.delete\(sessionKey\)/.test(clientSource),
  'a cancelled rewrite would be impossible to retry',
)
check(
  'the forget only fires when the ORIGINAL is put back',
  /if \(text === panel\.original\) lastRewrite\.delete\(sessionKey\)/.test(clientSource),
  'sending the rewrite itself must still be recognised as already rewritten',
)

// The composer menu is a CHARACTER PICKER first. Per-session overrides of a
// card's own declaration are set once and then forgotten, so they must not sit
// flat beside the picker giving it five equal-weight rows and 248 characters of
// permanent explanation.
check(
  'advanced settings are folded away',
  clientSource.includes('pf-more') && clientSource.includes('setAdvancedOpen'),
  'the menu should not present overrides as equal-weight controls',
)
check(
  'the fold starts closed',
  /const \[advancedOpen, setAdvancedOpen\] = useState\(false\)/.test(clientSource),
  'an open fold by default defeats the point',
)
check(
  'the folded row still reports what is overridden',
  clientSource.includes('control.more.custom') && clientSource.includes('advancedSummary'),
  'a folded-away choice the user forgot about is a surprise waiting to happen',
)
// A control that cannot do anything should not be on screen. On a voice-only
// card both fidelity options resolve identically, so the row is only rendered
// for cards that actually have something to narrow.
check(
  'fidelity is only offered when the card may add constraints',
  /selected\?\.fidelity === 'strategy'\s*\n\s*\? \[/.test(clientSource),
  'on a style card both options are the same thing — that row is a fake choice',
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
// The model check is a one-time cost decision, so it belongs in the settings
// page as a global preference — not re-decided on the way to every send.
check(
  'the model check is a global preference, not per session',
  clientSource.includes('writeModelCheckPref') && !clientSource.includes('modelCheckKey'),
  'a per-session switch asks the same question on every send',
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
  clientSource.includes("card.addEventListener('click', onClickCapture, true)"),
  'no send interception attached',
)
check(
  'client scopes the interception to the composer card',
  clientSource.includes("own.closest('[data-composer-card]')"),
  'the listener must be scoped to the composer card, not the document',
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
check(
  'an in-flight rewrite swallows the send click',
  /snapshot\.busy === true[\s\S]{0,260}preventDefault\(\)/.test(clientSource),
  'sending during a rewrite would send the un-rewritten draft',
)
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
