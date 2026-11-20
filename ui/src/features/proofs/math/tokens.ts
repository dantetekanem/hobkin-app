/**
 * Unicode TLA+ cut into tokens for the math view (_specs/050-tla-proofs, "The math"): keywords, operators, strings,
 * numbers, comments and the module's rules, so each gets its color. Every character is kept, in order.
 *
 * A Unicode symbol is a token of its own and says so (`symbol`): the view draws it exactly one column wide. The app's
 * JetBrains Mono has none of TLA+'s math symbols, so they come from a fallback font, and at one column each the
 * conjunctions tlauc aligned stay aligned whatever font draws them. Pure, so the tests run it with Node alone.
 */

export type TokenKind = 'keyword' | 'operator' | 'string' | 'number' | 'comment' | 'rule' | 'text'

export interface Token {
  kind: TokenKind
  text: string
  /** One Unicode symbol, drawn one column wide. */
  symbol?: true
}

const KEYWORDS = [
  'ACTION',
  'ASSUME',
  'ASSUMPTION',
  'AXIOM',
  'BOOLEAN',
  'BY',
  'CASE',
  'CHOOSE',
  'CONSTANT',
  'CONSTANTS',
  'COROLLARY',
  'DEF',
  'DEFS',
  'DOMAIN',
  'ELSE',
  'ENABLED',
  'EXCEPT',
  'EXTENDS',
  'FALSE',
  'HAVE',
  'HIDE',
  'IF',
  'IN',
  'INSTANCE',
  'LEMMA',
  'LET',
  'LOCAL',
  'MODULE',
  'NEW',
  'OBVIOUS',
  'OMITTED',
  'OTHER',
  'PICK',
  'PROOF',
  'PROPOSITION',
  'PROVE',
  'QED',
  'RECURSIVE',
  'STRING',
  'SUBSET',
  'SUFFICES',
  'TAKE',
  'TEMPORAL',
  'THEN',
  'THEOREM',
  'TRUE',
  'UNCHANGED',
  'UNION',
  'USE',
  'VARIABLE',
  'VARIABLES',
  'WITH',
  'WITNESS',
]

const PATTERN = new RegExp(
  [
    String.raw`(?<comment>\\\*.*$|\(\*.*?\*\))`,
    String.raw`(?<string>"(?:[^"\\]|\\.)*")`,
    // tlauc writes a module's ---- and ==== lines as box drawing.
    String.raw`(?<rule>[─━═]{2,}|-{4,}|={4,})`,
    String.raw`(?<keyword>\b(?:WF|SF)_|\b(?:${KEYWORDS.join('|')})\b)`,
    String.raw`(?<number>\b\d+(?:\.\d+)?\b)`,
    String.raw`(?<symbol>[^\x00-\x7F])`,
    String.raw`(?<operator>[<>@!#~|])`,
  ].join('|'),
  'gu',
)

/** The math blocks of Unicode: arrows, operators, technical, shapes (□ ◇), brackets (⟨ ⟩), and the few elsewhere. */
const MATH = /[←-⏿■-◿⟀-⟯⦀-⫿¬×÷‥…′″]/u

export function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  const text = (value: string) => {
    if (!value) return
    const last = tokens.at(-1)
    if (last?.kind === 'text' && !last.symbol) last.text += value
    else tokens.push({ kind: 'text', text: value })
  }
  let from = 0
  for (const match of line.matchAll(PATTERN)) {
    text(line.slice(from, match.index))
    from = match.index + match[0].length
    const [kind] = Object.entries(match.groups ?? {}).find(([, value]) => value != null) ?? ['text']
    if (kind === 'symbol') tokens.push({ kind: MATH.test(match[0]) ? 'operator' : 'text', text: match[0], symbol: true })
    else if (kind === 'text') text(match[0])
    else tokens.push({ kind: kind as TokenKind, text: match[0] })
  }
  text(line.slice(from))
  return tokens
}
