/**
 * TLA+, for models under `_specs/tla/`: Shiki ships no grammar for it. Keywords, definitions, proof steps, comments
 * (block comments nest), strings, numbers and the logic and set operators. Scope names are the ones the themes color.
 */
import type { LanguageRegistration } from 'shiki/core'

const KEYWORDS = [
  'ACTION', 'ASSUME', 'ASSUMPTION', 'AXIOM', 'BY', 'CASE', 'CHOOSE', 'CONSTANT', 'CONSTANTS', 'COROLLARY', 'DEF', 'DEFINE', 'DEFS',
  'DOMAIN', 'ELSE', 'ENABLED', 'EXCEPT', 'EXTENDS', 'HAVE', 'HIDE', 'IF', 'IN', 'INSTANCE', 'LAMBDA', 'LEMMA', 'LET', 'LOCAL', 'MODULE',
  'NEW', 'OBVIOUS', 'OMITTED', 'ONLY', 'OTHER', 'PICK', 'PROOF', 'PROPOSITION', 'PROVE', 'QED', 'RECURSIVE', 'STATE', 'SUBSET',
  'SUFFICES', 'TAKE', 'TEMPORAL', 'THEN', 'THEOREM', 'UNCHANGED', 'UNION', 'USE', 'VARIABLE', 'VARIABLES', 'WITH', 'WITNESS',
]

const OPERATORS = [
  String.raw`/\\`, String.raw`\\/`, '<=>', '=>', '==', '~>', String.raw`\[\]`, '<>', String.raw`\|->`, '->', '<-', String.raw`\.\.`,
  ':=', '/=', '#', '<=', '>=', '=<', '@@', ':>', '~', "'",
  String.raw`\\(?:in|notin|subseteq|subset|supseteq|cup|cap|union|intersect|X|times|E|A|EE|AA|o|div|leq|geq|lnot|neg|land|lor|equiv|prec|succ|sqsubseteq|cdot)\b`,
]

const grammar: LanguageRegistration = {
  name: 'tlaplus',
  displayName: 'TLA+',
  scopeName: 'source.tlaplus',
  patterns: [
    { include: '#comments' },
    { include: '#module' },
    { include: '#strings' },
    { include: '#definition' },
    { include: '#proof-step' },
    { match: String.raw`\b(?:WF|SF)_`, name: 'keyword.control.fairness.tlaplus' },
    { match: `\\b(?:${KEYWORDS.join('|')})\\b`, name: 'keyword.control.tlaplus' },
    { match: String.raw`\b(?:TRUE|FALSE|BOOLEAN|STRING)\b`, name: 'constant.language.tlaplus' },
    { match: String.raw`\b\d+(?:\.\d+)?\b`, name: 'constant.numeric.tlaplus' },
    { match: OPERATORS.join('|'), name: 'keyword.operator.tlaplus' },
  ],
  repository: {
    comments: {
      patterns: [
        { match: String.raw`\\\*.*$`, name: 'comment.line.tlaplus' },
        { include: '#block-comment' },
      ],
    },
    'block-comment': {
      begin: String.raw`\(\*`,
      end: String.raw`\*\)`,
      name: 'comment.block.tlaplus',
      patterns: [{ include: '#block-comment' }],
    },
    module: {
      patterns: [
        {
          match: String.raw`^\s*(-{4,})\s*(MODULE)\s+(\w+)\s*(-{4,})`,
          captures: { 1: { name: 'comment.line.tlaplus' }, 2: { name: 'keyword.control.tlaplus' }, 3: { name: 'entity.name.type.module.tlaplus' }, 4: { name: 'comment.line.tlaplus' } },
        },
        { match: String.raw`^\s*(?:-{4,}|={4,})\s*$`, name: 'comment.line.separator.tlaplus' },
      ],
    },
    strings: {
      begin: '"',
      end: '"',
      name: 'string.quoted.double.tlaplus',
      patterns: [{ match: String.raw`\\.`, name: 'constant.character.escape.tlaplus' }],
    },
    // `Name ==` or `Name(a, b) ==` at the start of a line, and a definition inside LET.
    definition: {
      match: String.raw`^\s*(?:LOCAL\s+)?([A-Za-z_][A-Za-z0-9_]*)(?=\s*(?:\([^)]*\))?\s*==)`,
      captures: { 1: { name: 'entity.name.function.tlaplus' } },
    },
    'proof-step': {
      match: String.raw`<\d+>[A-Za-z0-9_]*\.?`,
      name: 'entity.name.tag.proof-step.tlaplus',
    },
  },
}

export default [grammar]
