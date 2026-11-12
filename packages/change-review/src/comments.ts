/**
 * Which lines of a file hold nothing that runs: blank lines, and lines that are only a comment the way the file's
 * language reads it (FOUNDATION 4.1: `text` is only comments and white space). JavaScript, TypeScript and Ruby are read
 * from the top of the file through their strings, template literals, regular expressions, JSX and heredocs, so a `//`,
 * a `*` or a `#` inside one of them is never taken for a comment. Other languages are not read here: a line there is
 * blank or code. Where the reading cannot tell, the line is code: a false `text` is the costly error.
 */

/** `blank`: only white space, outside any literal. `comment`: only comments and white space. `code`: anything else. */
export type LineKind = 'blank' | 'comment' | 'code'

const SCRIPT = /\.[cm]?[jt]sx?$/
/** TypeScript without JSX: there a `<` starts a type, never an element. */
const PLAIN_TYPESCRIPT = /\.[cm]?ts$/
const RUBY = /\.(rb|rake|gemspec|ru|jbuilder)$|(^|\/)(Gemfile|Rakefile)$/

/** The kind of every line of a file, one per line of `text.split('\n')`. */
export function lineKinds(path: string, text: string): LineKind[] {
  if (SCRIPT.test(path)) return scriptKinds(text, !PLAIN_TYPESCRIPT.test(path))
  if (RUBY.test(path)) return rubyKinds(text)
  return text.split('\n').map((line) => (line.trim() ? 'code' : 'blank'))
}

/** Where a regular expression that starts at `start` ends on its own line, or -1 when it does not end there. */
function regexEnd(text: string, start: number): number {
  let inClass = false
  for (let at = start + 1; at < text.length && text[at] !== '\n'; at += 1) {
    const char = text[at]
    if (char === '\\') {
      if (text[at + 1] === '\n') return -1
      at += 1
    } else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      while (/[a-z]/i.test(text[at + 1] ?? '')) at += 1
      return at
    }
  }
  return -1
}

// ───────────────────────── JavaScript and TypeScript ─────────────────────────

/** Tokens after which a `/` starts a regular expression and a `<` an element, not a division or a comparison. */
const OPERATORS = new Set([...'(,=:[!&|?{};+-*%<>~^', '=>'])
const OPERATOR_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'])

/** `tag`: inside a JSX tag, `<a href="..."` up to its `>`. `text`: between a JSX element's tags. */
type ScriptMode = 'code' | 'line' | 'block' | 'string' | 'template' | 'tag' | 'text'

function scriptKinds(text: string, jsx: boolean): LineKind[] {
  const kinds: LineKind[] = []
  let kind: LineKind = 'blank'
  const see = (seen: LineKind) => {
    if (seen === 'code' || kind === 'blank') kind = seen
  }
  let mode: ScriptMode = 'code'
  let quote = ''
  /** Where a string goes back to: code, or the JSX tag it is an attribute of. */
  let back: ScriptMode = 'code'
  /** A backslash carries a quoted string onto the next line. */
  let continued = false
  /** The last token read in code: an operator, a word, or `)` for anything that ends a value. */
  let previous = ''
  let blockFrom = 0
  /** What each open `{` goes back to when it closes: code, a template literal, or a JSX tag or text. */
  const braces: ScriptMode[] = []
  /** Open JSX elements, innermost last: how many tags are open, and whether the tag being read closes one. */
  const elements: { depth: number; closing: boolean }[] = []
  const expression = () => previous === '' || OPERATORS.has(previous) || OPERATOR_WORDS.has(previous)

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!
    const next = text[at + 1] ?? ''
    if (char === '\n') {
      if (mode === 'line') mode = 'code'
      // A quoted string ends with its line unless a backslash carries it on; a JSX attribute may hold line breaks.
      if (mode === 'string' && back === 'code' && !continued) mode = 'code'
      continued = false
      kinds.push(kind)
      // A line that starts inside a literal or JSX is code, even when it is empty.
      kind = mode === 'code' || mode === 'block' ? 'blank' : 'code'
      continue
    }
    if (mode === 'line' || mode === 'block') {
      if (!/\s/.test(char)) see('comment')
      if (mode === 'block' && char === '*' && next === '/') {
        mode = 'code'
        at += 1
      }
      continue
    }
    if (mode !== 'code') see('code')
    if (mode === 'string') {
      if (char === '\\' && back === 'code') {
        if (next === '\n') continued = true
        else at += 1
      } else if (char === quote) {
        mode = back
        previous = ')'
      }
      continue
    }
    if (mode === 'template') {
      if (char === '\\' && next !== '\n') at += 1
      else if (char === '`') {
        mode = 'code'
        previous = ')'
      } else if (char === '$' && next === '{') {
        braces.push('template')
        mode = 'code'
        previous = '{'
        at += 1
      }
      continue
    }
    if (mode === 'tag' || mode === 'text') {
      const element = elements.at(-1)!
      if (char === '{') {
        braces.push(mode)
        mode = 'code'
        previous = '{'
      } else if (mode === 'text') {
        if (char === '<') {
          element.closing = next === '/'
          if (element.closing) at += 1
          mode = 'tag'
        }
      } else if (char === '"' || char === "'") {
        mode = 'string'
        quote = char
        back = 'tag'
      } else if (char === '>' || (char === '/' && next === '>')) {
        if (char === '/') at += 1
        else element.depth += element.closing ? -1 : 1
        element.closing = false
        if (element.depth > 0) mode = 'text'
        else {
          elements.pop()
          mode = 'code'
          previous = ')'
        }
      }
      continue
    }

    if (/\s/.test(char)) continue
    if (char === '/' && (next === '/' || next === '*')) {
      see('comment')
      mode = next === '/' ? 'line' : 'block'
      blockFrom = kinds.length
      at += 1
      continue
    }
    see('code')
    const regex = char === '/' && expression() ? regexEnd(text, at) : -1
    if (char === '"' || char === "'") {
      mode = 'string'
      quote = char
      back = 'code'
    } else if (char === '`') mode = 'template'
    else if (regex > at) {
      at = regex
      previous = ')'
    } else if (char === '<' && jsx && expression() && /[A-Za-z_$>]/.test(next)) {
      elements.push({ depth: 0, closing: false })
      mode = 'tag'
    } else if (char === '{') {
      braces.push('code')
      previous = '{'
    } else if (char === '}') {
      mode = braces.pop() ?? 'code'
      previous = '}'
    } else if (/[\w$]/.test(char)) {
      let end = at
      while (/[\w$]/.test(text[end + 1] ?? '')) end += 1
      previous = text.slice(at, end + 1)
      at = end
    } else if (char === '=' && next === '>') {
      previous = '=>'
      at += 1
    } else previous = char
  }
  kinds.push(kind)
  // A block comment that never closes was read wrong: nothing from where it opened is taken for a comment.
  if (mode === 'block') kinds.fill('code', blockFrom)
  return kinds
}

// ───────────────────────── Ruby ─────────────────────────

/** Words after which a `/`, `%`, `?` or `<<` starts a literal rather than an operator. */
const RUBY_KEYWORDS = new Set(['if', 'unless', 'while', 'until', 'when', 'and', 'or', 'not', 'return', 'then', 'do', 'else', 'elsif', 'case', 'in', 'yield', 'begin', 'rescue', 'ensure'])
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' }

/** A string, symbol, percent literal or command the reading is inside: what ends it, and what nests in it. */
interface Literal {
  open: string
  close: string
  nest: number
  interpolates: boolean
}

function rubyKinds(text: string): LineKind[] {
  const lines = text.split('\n')
  const kinds: LineKind[] = []
  let literal: Literal | null = null
  /** `#{` interpolations open inside literals, innermost last, with the braces opened inside each. */
  const frames: { literal: Literal; depth: number }[] = []
  /** Heredocs opened on the line being read: their bodies follow it. */
  let heredocs: { id: string; indented: boolean }[] = []
  let docs = false
  /** The last token: '' at the start of a statement, an operator, a word, or `)` for anything that ends a value. */
  let previous = ''
  const expression = () => previous === '' || RUBY_KEYWORDS.has(previous) || !/^[\w@$)\]}]/.test(previous)
  /** `puts /x/`, `puts %w[a]`, `puts <<EOS`: a name, a space before and none after read as a call with a literal. */
  const call = (line: string, at: number) => /^[A-Za-z_]/.test(previous) && !RUBY_KEYWORDS.has(previous) && /\s/.test(line[at - 1] ?? '') && !/\s/.test(line[at + 1] ?? '')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (docs) {
      kinds.push('comment')
      if (/^=end(\s|$)/.test(line)) docs = false
      continue
    }
    if (!literal && !frames.length) {
      if (/^=begin(\s|$)/.test(line)) {
        docs = true
        kinds.push('comment')
        continue
      }
      // What follows __END__ is data the program may read.
      if (/^__END__\r?$/.test(line)) {
        kinds.push(...lines.slice(index).map((): LineKind => 'code'))
        break
      }
      previous = ''
    }
    let kind: LineKind = literal ? 'code' : 'blank'
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at]!
      const next = line[at + 1] ?? ''
      if (literal) {
        kind = 'code'
        if (char === '\\') at += 1
        else if (literal.interpolates && char === '#' && next === '{') {
          frames.push({ literal, depth: 0 })
          literal = null
          previous = '{'
          at += 1
        } else if (char === literal.open) literal.nest += 1
        else if (char === literal.close && literal.nest > 0) literal.nest -= 1
        else if (char === literal.close) {
          literal = null
          previous = ')'
        }
        continue
      }
      if (/\s/.test(char)) continue
      if (char === '#') {
        if (kind === 'blank') kind = 'comment'
        break
      }
      kind = 'code'
      const rest = line.slice(at)
      const heredoc = /^<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/.exec(rest)
      const percent = /^%([qQwWiIrsx]?)([^\w\s=])/.exec(rest)
      const regex = char === '/' && (expression() || call(line, at)) ? regexEnd(line, at) : -1
      if (char === '"' || char === "'" || char === '`') literal = { open: '', close: char, nest: 0, interpolates: char !== "'" }
      else if (heredoc && (heredoc[1] || heredoc[2] || expression() || call(line, at))) {
        heredocs.push({ id: heredoc[3]!, indented: heredoc[1] !== '' })
        at += heredoc[0].length - 1
        previous = ')'
      } else if (percent && (expression() || call(line, at))) {
        const [whole, type, open] = percent as unknown as [string, string, string]
        literal = { open: PAIRS[open] ? open : '', close: PAIRS[open] ?? open, nest: 0, interpolates: !/[qwis]/.test(type) }
        at += whole.length - 1
      } else if (regex > at) {
        at = regex
        previous = ')'
      } else if (char === '?' && expression() && next && !/\s/.test(next) && !/\w/.test(line[at + (next === '\\' ? 3 : 2)] ?? '')) {
        // A character literal: `?a`, `?"`, `?#`.
        at += next === '\\' ? 2 : 1
        previous = ')'
      } else if (char === '$') {
        // A global such as `$'` or `$"`: its second character is no quote.
        at += 1
        previous = ')'
      } else if (char === '{') {
        if (frames.length) frames.at(-1)!.depth += 1
        previous = '{'
      } else if (char === '}') {
        const frame = frames.at(-1)
        if (frame?.depth === 0) {
          frames.pop()
          literal = frame.literal
          continue
        }
        if (frame) frame.depth -= 1
        previous = '}'
      } else if (/[A-Za-z_@]/.test(char)) {
        let end = at
        while (/[\w@]/.test(line[end + 1] ?? '')) end += 1
        // `empty?` and `save!` are names; `a!=b` is a comparison.
        if (/[?!]/.test(line[end + 1] ?? '') && line[end + 2] !== '=') end += 1
        previous = line.slice(at, end + 1)
        at = end
      } else if (/\d/.test(char)) {
        while (/[\w.]/.test(line[at + 1] ?? '')) at += 1
        previous = ')'
      } else previous = char
    }
    // A line that opens with `#{` may be the inside of a string read wrong: it is code, never a comment.
    if (kind === 'comment' && /^\s*#\{/.test(line)) kind = 'code'
    kinds.push(kind)
    // Heredoc bodies follow the line that opened them, in order, each up to the line that holds only its name.
    for (const { id, indented } of heredocs) {
      while (index + 1 < lines.length) {
        index += 1
        kinds.push('code')
        const body = lines[index]!.replace(/\r$/, '')
        if ((indented ? body.trimStart() : body) === id) break
      }
    }
    heredocs = []
  }
  return kinds
}
