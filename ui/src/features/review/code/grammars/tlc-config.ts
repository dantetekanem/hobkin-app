/**
 * TLC's model config, the `.cfg` beside a TLA+ model: its sections, what each names, comments, strings and numbers.
 * Shiki ships no grammar for it.
 */
import type { LanguageRegistration } from 'shiki/core'

const SECTIONS = [
  'SPECIFICATION', 'INIT', 'NEXT', 'INVARIANT', 'INVARIANTS', 'PROPERTY', 'PROPERTIES', 'CONSTANT', 'CONSTANTS', 'CONSTRAINT',
  'CONSTRAINTS', 'ACTION_CONSTRAINT', 'ACTION_CONSTRAINTS', 'SYMMETRY', 'VIEW', 'CHECK_DEADLOCK', 'POSTCONDITION', 'ALIAS',
]

const grammar: LanguageRegistration = {
  name: 'tlc-config',
  displayName: 'TLC config',
  scopeName: 'source.tlc-config',
  patterns: [
    { match: String.raw`\\\*.*$`, name: 'comment.line.tlc-config' },
    { include: '#block-comment' },
    { begin: '"', end: '"', name: 'string.quoted.double.tlc-config' },
    { match: `\\b(?:${SECTIONS.join('|')})\\b`, name: 'keyword.control.tlc-config' },
    { match: String.raw`\b(?:TRUE|FALSE)\b`, name: 'constant.language.tlc-config' },
    { match: String.raw`\b\d+\b`, name: 'constant.numeric.tlc-config' },
    { match: String.raw`<-|=`, name: 'keyword.operator.tlc-config' },
  ],
  repository: {
    'block-comment': {
      begin: String.raw`\(\*`,
      end: String.raw`\*\)`,
      name: 'comment.block.tlc-config',
      patterns: [{ include: '#block-comment' }],
    },
  },
}

export default [grammar]
