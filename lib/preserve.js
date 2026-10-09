/**
 * The deterministic half of the preservation check.
 *
 * The plugin has two ways to notice that a rewrite changed the request rather
 * than its voice:
 *
 *  1. This module — free, instant, provable. It compares the technical tokens
 *     of the draft against the rewrite: identifiers, file paths, versions,
 *     numbers, flags, and named technologies.
 *  2. An optional second model call — costs tokens and latency, but is the only
 *     thing that can see a *semantic* change (a requirement quietly weakened,
 *     a constraint invented in prose).
 *
 * They are complementary, and the split is deliberate: the most common and most
 * damaging failure is a dropped identifier, path or number, and that is exactly
 * what a token comparison proves for free. Paying a second model call on every
 * send to catch it would be wasteful, so this check always runs and the model
 * call is opt-in.
 *
 * WHAT THIS CANNOT SEE, and must never be presented as covering:
 *  - a requirement reworded into something weaker while keeping every token;
 *  - a behavioural constraint added in ordinary prose;
 *  - a quantity expressed in Chinese words (「两次」) rather than digits;
 *  - a bare lowercase English word that is not a path, flag or identifier.
 * The optional model check exists for exactly those.
 *
 * @module dsh-persona-forge/preserve
 */

/** Words that carry no technical meaning, so their absence proves nothing. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'in',
  'on', 'at', 'by', 'with', 'from', 'as', 'if', 'then', 'than', 'so', 'not',
  'no', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'shall', 'may', 'might', 'must', 'i', 'you', 'we', 'they', 'he', 'she', 'my',
  'your', 'our', 'their', 'me', 'us', 'them', 'here', 'there', 'when', 'where',
  'which', 'who', 'what', 'how', 'why', 'all', 'any', 'some', 'each', 'every',
  'but', 'also', 'just', 'please', 'thanks', 'thank', 'need', 'want', 'make',
  'use', 'get', 'set', 'let', 'say', 'write', 'read', 'run', 'fix', 'add',
  'new', 'old', 'one', 'two', 'first', 'last', 'next', 'then', 'now',
])

/**
 * One ordered alternation, so a token is matched exactly once and no fact is
 * double-counted. Order is specificity: a code span before a version, a version
 * before a bare number.
 *
 * A capitalised word is included because named technologies (`Rust`, `Python`,
 * `Docker`) are technical facts; matching is case-insensitive downstream, so
 * sentence-initial prose (`Write …`) cannot be reported as lost when the
 * rewrite lowercases it.
 * @type {RegExp}
 */
const TOKEN = new RegExp([
  '`[^`\\n]{1,80}`', // an inline code span, spaces and all
  'v?\\d+(?:\\.\\d+)+(?:[-+][A-Za-z0-9.]+)?', // a version: v1.2.3, 1.2.3-beta
  '[A-Za-z_][A-Za-z0-9_-]*(?:[./][A-Za-z0-9_-]+)+', // a path or dotted name: a.js, src/main.rs
  '[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]+', // snake_case
  '[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*', // camelCase
  '[A-Z][A-Z0-9]{1,}', // an acronym: API, HTTP, README
  '--[A-Za-z][A-Za-z0-9-]*', // a long flag: --watch
  '[A-Z][a-z]{2,}', // a capitalised word: Rust, Docker
  '\\d+(?:\\.\\d+)*', // a bare number
].join('|'), 'g')

/**
 * Collect the technical facts a text asserts, as a case-insensitive multiset.
 *
 * A multiset, not a set: a draft mentioning `8080` twice and a rewrite
 * mentioning it once has lost a fact, and counting occurrences is what catches
 * that.
 * @param {string} text - the draft or the rewrite.
 * @returns {Map<string, number>} lowercased token to occurrence count.
 */
export function factsIn(text) {
  const counts = new Map()
  for (const match of String(text ?? '').matchAll(TOKEN)) {
    // A code span keeps its inner text; the backticks are punctuation.
    const token = match[0].replace(/^`|`$/g, '').trim().toLowerCase()
    if (token === '') continue
    if (STOP_WORDS.has(token)) continue
    // A single letter or digit carries no meaning worth comparing.
    if (token.replace(/[^a-z0-9]/g, '').length < 2) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/**
 * Whether a token is structurally unmistakable — a path, version, number, flag
 * or code span — as opposed to a bare word.
 *
 * Only these may be reported as INVENTED. A bear word can legitimately appear
 * in a rewrite as ceremony: the persona's own name ("Omnissiah"), a form of
 * address, a flourish. Reporting those as "you added a fact" would fire on
 * every successful zealot rewrite, which is precisely the check's job to allow.
 * @param {string} token - a lowercased token.
 * @returns whether it is structural.
 */
function isStructural(token) {
  if (/[0-9]/.test(token)) return true
  if (/[./_@-]/.test(token)) return true
  return false
}

/**
 * Compare a rewrite against its draft for lost or invented technical facts.
 *
 * Reports `drift` only for things a token comparison can actually prove, and
 * names them, so the panel can show exactly what went missing instead of a
 * vague warning. Everything it cannot prove is `ok` — never a false alarm.
 * @param {string} original - the user's draft.
 * @param {string} rewritten - the rewrite under review.
 * @returns {{state: 'ok'|'drift', missing: string[], added: string[]}} the verdict.
 */
export function compareFacts(original, rewritten) {
  const before = factsIn(original)
  const after = factsIn(rewritten)
  const missing = []
  const added = []
  for (const [token, count] of before) {
    // Case-insensitive, already: a rewrite may legitimately recase a word.
    const kept = after.get(token) ?? 0
    if (kept < count) missing.push(token)
  }
  for (const token of after.keys()) {
    if (!before.has(token) && isStructural(token)) added.push(token)
  }
  // Keep the report readable: a long list is noise, and the first few are what
  // the user needs to act on.
  const cap = (list) => list.sort().slice(0, 12)
  return {
    state: missing.length > 0 || added.length > 0 ? 'drift' : 'ok',
    missing: cap(missing),
    added: cap(added),
  }
}
