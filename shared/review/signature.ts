/**
 * What goes into a declaration and what comes out of it, read from its first lines: the parameters and the return
 * type. Line patterns, like the units, not a parser. The model's plain words replace these when it has some.
 */
import { splitLines } from './lines.ts'
import { cleanProse } from './prose.ts'
import { PROSE_LIMIT, type NodeIO } from './types.ts'
import { findDeclaration } from './units.ts'

const TEST_CASE = /^\s*(?:test|it|specify|describe)(?:\.\w+)?\s*\(/
/** Where a declaration's parameter list opens: a function, a function held in a constant, or a method. */
const OPENS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[\w$]*\s*(?:<[^>]*>)?\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>)?\s*\(/,
  /^\s*(?:(?:private|public|protected|static|async|override|get|set|readonly)\s+)*[\w$]+\s*(?:<[^>]*>)?\s*\(/,
]
const RUBY_DEF = /^\s*(?:private\s+|protected\s+)?def\s+(?:self\.)?[\w!?=]+\s*(\(?)(.*)$/

const tidy = (text: string) => cleanProse(text.replace(/\s+/g, ' ').trim().replace(/,$/, '').trim(), PROSE_LIMIT.io)

/**
 * The parameters and the return type of the declaration that starts on the first of `lines`. The lines after it are
 * read when the parameters run on. Null when the first line declares nothing that takes parameters.
 */
export function signatureOf(lines: readonly string[]): NodeIO | null {
  const first = lines[0] ?? ''
  if (TEST_CASE.test(first)) return null

  const ruby = RUBY_DEF.exec(first)
  if (ruby) {
    const [, paren, rest] = ruby
    if (!paren) return { in: tidy(rest!.replace(/#.*$/, '')), out: '' }
    const close = rest!.lastIndexOf(')')
    return { in: tidy(close < 0 ? rest! : rest!.slice(0, close)), out: '' }
  }

  const opening = OPENS.map((pattern) => pattern.exec(first)).find(Boolean)
  if (!opening) return null
  const text = lines.slice(0, 8).join('\n')
  let depth = 0
  let close = -1
  for (let index = opening[0].length - 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '(') depth += 1
    else if (character === ')' && (depth -= 1) === 0) {
      close = index
      break
    }
  }
  if (close < 0) return null

  const params = text.slice(opening[0].length, close)
  // What follows the list, on its line: `: Type {`, `: Type =>`, or nothing typed.
  let rest = text.slice(close + 1).split('\n')[0]!
  const arrow = rest.indexOf('=>')
  if (/=\s*(?:async\s*)?(?:<[^>]*>)?\s*\($/.test(opening[0]) && arrow >= 0) rest = rest.slice(0, arrow)
  const typed = /^\s*:\s*(.*?)\s*\{?\s*$/.exec(rest)
  return { in: tidy(params), out: typed ? tidy(typed[1]!) : '' }
}

/** The signature of a declaration in a file, by its name. Null when it is not declared there or takes no parameters. */
export function declaredSignature(text: string, symbol: string): NodeIO | null {
  const found = findDeclaration(text, symbol)
  if (!found) return null
  const source = splitLines(text)
  // The span starts at the comments and decorators above a declaration. Its first other line is the declaration.
  let line = found.startLine - 1
  while (line < found.endLine - 1 && /^\s*(?:$|\/\/|\/\*|\*|#(?:\s|$)|@[\w.]+)/.test(source[line] ?? '')) line += 1
  return signatureOf(source.slice(line, line + 8))
}
