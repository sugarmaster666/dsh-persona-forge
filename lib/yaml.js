/**
 * A small, strict YAML subset reader and writer for character cards.
 *
 * The plugin ships its own parser on purpose. A published plugin declares its
 * dependencies, but a locally `link:`-ed plugin does not get them installed, so
 * importing a YAML library makes the plugin work only when some unrelated
 * package happens to hoist one. Cards are a narrow, well-defined format, so
 * parsing that subset directly is both smaller and more predictable than
 * depending on a full YAML implementation.
 *
 * ## Supported subset
 *
 * - Block mappings, nested by indentation: `key: value`, `key:` then a deeper block.
 * - Block sequences: `- value`, `- key: value` (a mapping item, continued at the
 *   dash's content column).
 * - Block scalars: `|`, `|-`, `|+`, `>`, `>-`, `>+`.
 * - Single- and double-quoted scalars, with `\\` escapes in double quotes.
 * - Plain scalars, `true` / `false` / `null` / `~`, and full-line `#` comments.
 *
 * ## Deliberately unsupported
 *
 * Flow collections (`{}`, `[]`), anchors and aliases (`&`, `*`), tags (`!`),
 * merge keys (`<<`), multi-document streams (`---`, `...`) and tab
 * indentation. Each is REFUSED with a specific message rather than guessed at:
 * silently misreading a card is worse than refusing it, because the user would
 * get a persona that does not match the file they wrote.
 *
 * @module dsh-persona-forge/yaml
 */

/** A parse failure carrying the 1-based source line for the message. */
export class YamlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line})`)
    this.name = 'YamlError'
    this.line = line
  }
}

/** Constructs that this reader refuses, with the reason shown to the user. */
const UNSUPPORTED = [
  // A leading `{`, `[`, `&`, `*` or `!` opens a construct outside the subset.
  // `{{` is excluded: a template placeholder such as `{{input}}` is ordinary
  // text a card legitimately contains.
  { pattern: /^(?!\{\{)[{[&*!]/, reason: 'flow collections, anchors, aliases and tags are not supported' },
  { pattern: /^<</, reason: 'merge keys (<<) are not supported' },
  { pattern: /^---\s*$/, reason: 'multi-document streams (---) are not supported' },
  { pattern: /^\.\.\.\s*$/, reason: 'multi-document streams (...) are not supported' },
]

/**
 * Refuse a construct outside the supported subset.
 *
 * This runs inside the parser — on lines the parser is actually interpreting —
 * never as a scan over the raw file. That distinction matters: a block scalar
 * body is literal text, so `{{input}}` inside a `template: |` block is card
 * content, not a flow mapping, and must not be refused.
 * @param token - the syntax token being interpreted.
 * @param lineNumber - the 1-based source line, for the message.
 */
function assertSupported(token, lineNumber) {
  for (const rule of UNSUPPORTED) {
    if (rule.pattern.test(token)) throw new YamlError(rule.reason, lineNumber)
  }
}

/** Whether a scalar token is quoted, and therefore literal content. */
function isQuotedToken(token) {
  return (token.startsWith('"') && token.length > 1) || (token.startsWith("'") && token.length > 1)
}

/**
 * Strip a trailing `#` comment from a scalar line, respecting quotes.
 * @param text - the line content after the key or dash.
 * @returns the content with any trailing comment removed.
 */
function stripComment(text) {
  let quote = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index++
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    // A `#` starts a comment only at the start or after whitespace.
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd()
    }
  }
  return text
}

/**
 * Decode one scalar token.
 * @param token - the trimmed scalar text.
 * @param line - source line, for error reporting.
 * @returns the decoded value.
 */
function decodeScalar(token, line) {
  if (token === '') return ''
  if (token.startsWith('"')) {
    if (!token.endsWith('"') || token.length < 2) throw new YamlError('unterminated double-quoted string', line)
    const body = token.slice(1, -1)
    let out = ''
    for (let index = 0; index < body.length; index++) {
      const char = body[index]
      if (char !== '\\') {
        out += char
        continue
      }
      const next = body[++index]
      switch (next) {
        case 'n': out += '\n'; break
        case 't': out += '\t'; break
        case 'r': out += '\r'; break
        case '"': out += '"'; break
        case '\\': out += '\\'; break
        case '0': out += '\0'; break
        case 'u': {
          const hex = body.slice(index + 1, index + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new YamlError('invalid \\u escape', line)
          out += String.fromCharCode(parseInt(hex, 16))
          index += 4
          break
        }
        default:
          // An unknown escape keeps the escaped character, which is what a
          // user writing `\d` in a card means.
          out += next ?? ''
      }
    }
    return out
  }
  if (token.startsWith("'")) {
    if (!token.endsWith("'") || token.length < 2) throw new YamlError('unterminated single-quoted string', line)
    // The only escape in single quotes is a doubled quote.
    return token.slice(1, -1).split("''").join("'")
  }
  if (token === 'true') return true
  if (token === 'false') return false
  if (token === 'null' || token === '~') return null
  return token
}

/** Whether a scalar token is quoted (and therefore may contain `:` or `#`). */
function isQuoted(token) {
  return (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))
}

/**
 * Split `key: value` at the first unquoted colon that is followed by a space or
 * ends the line. Returns undefined when the line is not a mapping entry.
 * @param text - the trimmed line content.
 * @returns the raw key and the raw value, or undefined.
 */
function splitKey(text) {
  let quote = null
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index++
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== ':') continue
    const rest = text.slice(index + 1)
    if (rest === '' || /^\s/.test(rest)) {
      return { key: text.slice(0, index).trim(), value: rest.trim() }
    }
  }
  return undefined
}

/**
 * Parse a YAML document into plain JavaScript values.
 * @param text - the document body.
 * @returns the parsed value.
 * @throws {YamlError} on a construct outside the supported subset.
 */
export function parseYaml(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  let pos = 0

  /** Indentation width of one line (spaces only; a tab is refused). */
  function indentOf(line, lineNumber) {
    const match = /^[ \t]*/.exec(line)[0]
    if (match.includes('\t')) throw new YamlError('tab indentation is not supported; use spaces', lineNumber)
    return match.length
  }

  const isBlank = (line) => line.trim() === ''
  const isComment = (line) => line.trim().startsWith('#')
  const isSkippable = (line) => isBlank(line) || isComment(line)

  /** Index of the next line that carries content. */
  function nextContent(from) {
    let index = from
    while (index < lines.length && isSkippable(lines[index])) index++
    return index
  }

  /** The next content line, or undefined at end of document. */
  function peek() {
    const index = nextContent(pos)
    if (index >= lines.length) return undefined
    return { index, indent: indentOf(lines[index], index + 1), raw: lines[index], text: lines[index].trim() }
  }

  /**
   * Read a block scalar (`|` or `>`) starting at the line after its header.
   * @param parentIndent - indentation of the line carrying the header.
   * @param header - the header token, e.g. `|-` or `>`.
   * @returns the decoded string.
   */
  function readBlockScalar(parentIndent, header) {
    const style = header[0]
    const chomp = header.slice(1)
    const body = []
    let blockIndent = null
    while (pos < lines.length) {
      const line = lines[pos]
      if (isBlank(line)) {
        body.push('')
        pos++
        continue
      }
      const indent = indentOf(line, pos + 1)
      if (indent <= parentIndent) break
      if (blockIndent === null) blockIndent = indent
      // Strip only the block's own indentation so relative indentation inside
      // the scalar survives.
      body.push(line.slice(Math.min(blockIndent, indent)))
      pos++
    }
    // Trailing blank lines belong to the chomping decision, not the content.
    let trailing = 0
    while (body.length > 0 && body[body.length - 1] === '') {
      body.pop()
      trailing++
    }
    let out
    if (style === '>') {
      // Folded: consecutive content lines join with a space; a blank line
      // becomes a newline.
      let folded = ''
      let pendingBlanks = 0
      for (const line of body) {
        if (line === '') {
          pendingBlanks++
          continue
        }
        if (folded !== '') folded += pendingBlanks > 0 ? '\n'.repeat(pendingBlanks) : ' '
        folded += line
        pendingBlanks = 0
      }
      out = folded
    } else {
      out = body.join('\n')
    }
    if (chomp === '-') return out
    if (chomp === '+') return out + '\n'.repeat(trailing + 1)
    return `${out}\n`
  }

  /**
   * Parse the node starting at `pos`, whose content sits at `indent`.
   * @param indent - the indentation that owns this node.
   * @returns the parsed value.
   */
  function parseNode(indent) {
    const first = peek()
    if (first === undefined || first.indent < indent) return null
    if (first.text.startsWith('- ') || first.text === '-') return parseSequence(first.indent)
    return parseMapping(first.indent)
  }

  /** Parse a block sequence at the given indentation. */
  function parseSequence(indent) {
    const out = []
    while (true) {
      const line = peek()
      if (line === undefined || line.indent !== indent) break
      if (!line.text.startsWith('- ') && line.text !== '-') break
      const rest = line.text === '-' ? '' : line.text.slice(2).trim()
      pos = line.index + 1
      if (rest === '') {
        // A dash alone: the item is the following, more-indented block.
        const child = peek()
        out.push(child !== undefined && child.indent > indent ? parseNode(child.indent) : null)
        continue
      }
      const entry = splitKey(rest)
      if (entry === undefined) {
        // A quoted scalar is literal content; only a plain scalar can open a
        // construct this reader refuses.
        if (!isQuotedToken(rest)) assertSupported(stripComment(rest), line.index + 1)
        out.push(decodeScalar(stripComment(rest), line.index + 1))
        continue
      }
      // `- key: value` opens a mapping whose entries continue at the column
      // where the key starts: the dash's indentation plus the dash and its
      // following space.
      const itemIndent = indent + 2
      const item = {}
      assignEntry(item, entry, line.index + 1, itemIndent, line.raw)
      collectMapping(item, itemIndent)
      out.push(item)
    }
    return out
  }

  /**
   * Assign one `key: value` pair, recursing when the value is a nested block.
   * @param target - the object receiving the entry.
   * @param entry - the raw key and value.
   * @param lineNumber - source line for errors.
   * @param ownerIndent - indentation of the mapping owning this key.
   * @param rawLine - the raw line, used to locate a block scalar header.
   */
  function assignEntry(target, entry, lineNumber, ownerIndent, rawLine) {
    // The key position is where a merge key (`<<`) appears, so it is checked
    // before the key is decoded.
    assertSupported(entry.key, lineNumber)
    const key = decodeScalar(entry.key, lineNumber)
    if (typeof key !== 'string' || key === '') throw new YamlError('empty mapping key', lineNumber)
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      throw new YamlError(`duplicate key "${key}"`, lineNumber)
    }
    const value = stripComment(entry.value)
    if (value === '') {
      const child = peek()
      target[key] = child !== undefined && child.indent > ownerIndent ? parseNode(child.indent) : null
      return
    }
    if (/^[|>][+-]?$/.test(value)) {
      target[key] = readBlockScalar(ownerIndent, value)
      return
    }
    // The value is a plain scalar here (quoted values are literal content), so
    // a leading flow/anchor/tag marker is a construct this reader refuses.
    if (!isQuotedToken(value)) assertSupported(value, lineNumber)
    target[key] = decodeScalar(value, lineNumber)
    void rawLine
  }

  /** Consume the remaining `key: value` entries of a mapping at one indent. */
  function collectMapping(target, indent) {
    while (true) {
      const line = peek()
      if (line === undefined || line.indent !== indent) break
      if (line.text.startsWith('- ') || line.text === '-') break
      const entry = splitKey(line.text)
      if (entry === undefined) throw new YamlError('expected "key: value"', line.index + 1)
      pos = line.index + 1
      assignEntry(target, entry, line.index + 1, indent, line.raw)
    }
  }

  /** Parse a block mapping at the given indentation. */
  function parseMapping(indent) {
    const out = {}
    collectMapping(out, indent)
    return out
  }

  // Unsupported constructs are refused where the parser interprets a syntax
  // token (see `assertSupported`), not by scanning raw lines: a block scalar's
  // body is literal content and may contain anything.
  const start = peek()
  if (start === undefined) return null
  if (start.indent !== 0) throw new YamlError('the document must start at indentation 0', start.index + 1)
  const value = parseNode(0)
  // Trailing content that the parser did not consume means the indentation was
  // inconsistent; refusing is better than silently dropping part of the file.
  const leftover = peek()
  if (leftover !== undefined) {
    throw new YamlError(`unexpected content at indentation ${leftover.indent}`, leftover.index + 1)
  }
  return value
}

/** Scalars that are safe to emit without quotes. */
const PLAIN_SAFE = /^[A-Za-z0-9\u4e00-\u9fff][^\n:#]*$/

/** Whether a string can be written as a plain scalar without changing meaning. */
function isPlainSafe(text) {
  if (text === '') return false
  if (!PLAIN_SAFE.test(text)) return false
  if (/^[-?]/.test(text)) return false
  // A value that would read back as a different type needs quoting.
  if (text === 'true' || text === 'false' || text === 'null' || text === '~') return false
  if (/^\s|\s$/.test(text)) return false
  if (text.includes(': ') || text.endsWith(':')) return false
  if (text.includes(' #')) return false
  return true
}

/** Render one scalar for output. */
function emitScalar(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  const text = String(value)
  if (isPlainSafe(text)) return text
  return JSON.stringify(text)
}

/** Whether a string should be emitted as a block scalar. */
function isBlockString(text) {
  return text.includes('\n')
}

/**
 * Serialize a value into the supported YAML subset.
 *
 * Strings containing newlines become block scalars; the chomping indicator is
 * chosen so the exact string round-trips (`|-` when there is no trailing
 * newline, `|` when there is exactly one).
 * @param value - the value to serialize.
 * @returns the document text.
 */
export function dumpYaml(value) {
  const out = []
  writeNode(value, 0, out)
  return `${out.join('\n')}\n`
}

/**
 * Emit a block scalar whose header goes inline after `prefix` (e.g. `key: ` or
 * `- `), with the body indented under it.
 *
 * The chomping indicator is chosen so the exact string round-trips: `|-` when
 * there is no trailing newline, `|` for exactly one, `|+` for more.
 * @param text - the string to emit.
 * @param prefix - the text preceding the header on its line.
 * @param bodyIndent - indentation of the scalar's own lines.
 * @param out - the output line accumulator.
 */
function emitBlockString(text, prefix, bodyIndent, out) {
  const pad = ' '.repeat(bodyIndent)
  const trailingNewlines = /\n*$/.exec(text)[0].length
  const body = text.slice(0, text.length - trailingNewlines)
  const header = trailingNewlines === 0 ? '|-' : trailingNewlines === 1 ? '|' : '|+'
  out.push(`${prefix}${header}`)
  for (const line of body.split('\n')) out.push(line === '' ? '' : pad + line)
  // `|+` keeps trailing line breaks. One of them is the document's own final
  // newline, so only the extras need explicit blank lines.
  if (trailingNewlines > 1) {
    for (let index = 1; index < trailingNewlines - 1; index++) out.push('')
  }
}

/** Emit one node at the given indentation. */
function writeNode(value, indent, out) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}[]`)
      return
    }
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item)
        if (entries.length === 0) {
          out.push(`${pad}- {}`)
          continue
        }
        entries.forEach(([key, child], index) => {
          const prefix = index === 0 ? `${pad}- ` : `${pad}  `
          writeEntry(key, child, prefix, indent + 2, out)
        })
        continue
      }
      if (typeof item === 'string' && isBlockString(item)) {
        emitBlockString(item, `${pad}- `, indent + 2, out)
        continue
      }
      out.push(`${pad}- ${emitScalar(item)}`)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      out.push(`${pad}{}`)
      return
    }
    for (const [key, child] of entries) writeEntry(key, child, pad, indent, out)
    return
  }
  out.push(`${pad}${emitScalar(value)}`)
}

/** Emit one mapping entry, recursing for nested containers. */
function writeEntry(key, child, pad, indent, out) {
  const renderedKey = isPlainSafe(key) ? key : JSON.stringify(key)
  if (typeof child === 'string' && isBlockString(child)) {
    emitBlockString(child, `${pad}${renderedKey}: `, indent + 2, out)
    return
  }
  if (child !== null && typeof child === 'object') {
    const empty = Array.isArray(child) ? child.length === 0 : Object.keys(child).length === 0
    if (empty) {
      out.push(`${pad}${renderedKey}: ${Array.isArray(child) ? '[]' : '{}'}`)
      return
    }
    out.push(`${pad}${renderedKey}:`)
    writeNode(child, indent + 2, out)
    return
  }
  out.push(`${pad}${renderedKey}: ${emitScalar(child)}`)
}
