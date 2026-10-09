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
import { normalizeCard, createCardStore } from '../lib/store.js'
import { parseYaml, dumpYaml, YamlError } from '../lib/yaml.js'
import {
  buildSystemPrompt,
  examplesFor,
  frameDraft,
  parseFactCheck,
  renderTemplate,
  FACT_CHECK_SYSTEM,
} from '../lib/prompts.js'
import { normalizeOutput } from '../lib/rewrite.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

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
  // Every intensity the card offers must have its own demonstrations, or the
  // field is decorative and the model has to guess what that level means.
  check(`${card.id}: has per-intensity examples`, card.examplesByIntensity !== undefined, JSON.stringify(Object.keys(card.examplesByIntensity ?? {})))
  check(
    `${card.id}: covers light and zealot`,
    card.examplesByIntensity?.light !== undefined && card.examplesByIntensity?.zealot !== undefined,
    JSON.stringify(Object.keys(card.examplesByIntensity ?? {})),
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
for (const route of ['/cards', '/rewrite', '/cards/save', '/cards/delete', '/reveal']) {
  check(`client calls ${route}`, clientSource.includes(`\${PREFIX}${route}`), route)
}

// The control must be able to turn the rewrite OFF. A persona picker with no
// way back to "no persona" traps the user in whatever they last selected, and
// the primary action must be a visible control rather than a hidden gesture.
check('client declares an off state', clientSource.includes("const OFF = 'off'"), 'OFF constant missing')
check('the off state is the default selection', /readLocal\(cardKey\(sessionKey\)\) \?\? OFF/.test(clientSource))
check('the menu offers the off choice', clientSource.includes("pickCard(OFF)"))
check(
  'the menu carries a visible rewrite action',
  clientSource.includes("t('control.menu.run')") && clientSource.includes('pf-run'),
  'the rewrite must be reachable from the menu, not only a hidden gesture',
)
check('no hidden right-click-only trigger remains', !clientSource.includes('onContextMenu'), 'onContextMenu still present')

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

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('OK')
