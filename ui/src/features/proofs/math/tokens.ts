/**
 * Unicode TLA+ cut into tokens for the math view (_specs/050-tla-proofs, "The math"): keywords, operators, strings,
 * numbers, comments and the module's rules, so each gets its color. Every character is kept, in order.
 *
 * A Unicode symbol is a token of its own. One the app's JetBrains Mono lacks, which is most of TLA+'s math, says so
 * (`symbol`): it comes from a fallback font, so the view draws it exactly one column wide, and the conjunctions tlauc
 * aligned stay aligned whatever font draws them. Pure, so the tests run it with Node alone.
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
const MATH = /[\u2190-\u23FF\u25A0-\u25FF\u27C0-\u27EF\u2980-\u2AFF\u00AC\u00D7\u00F7\u2025\u2026\u2032\u2033]/u
/** What the app's JetBrains Mono (its Latin files) draws itself, a column wide: Latin-1 (¬ × ÷) and a few marks (′ … −). */
const OWN = /[\u00A0-\u00FF\u2013\u2014\u2018-\u201A\u201C-\u201E\u2022\u2026\u2032\u2033\u2039\u203A\u2044\u20AC\u2122\u2191\u2193\u2212\u2215]/u

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
    if (kind === 'symbol') {
      const token: Token = { kind: MATH.test(match[0]) ? 'operator' : 'text', text: match[0] }
      if (!OWN.test(match[0])) token.symbol = true
      if (token.kind === 'text' && !token.symbol) text(match[0])
      else tokens.push(token)
    } else if (kind === 'text') text(match[0])
    else tokens.push({ kind: kind as TokenKind, text: match[0] })
  }
  text(line.slice(from))
  return tokens
}
