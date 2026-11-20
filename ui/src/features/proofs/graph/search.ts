/**
 * Search in the state graph: `variable = value` over the dumped states (_specs/050-tla-proofs, "The state graph").
 * Any TLA+ expression would need an evaluator, which is an open question of the spec, so only a variable, or one key
 * of it, compared with a value is read. Pure, so the tests run it with Node alone.
 */
import type { StateGraph } from './model.ts'
import { bareKey, formatValue, lensValue, type Lens } from './values.ts'

export interface StateQuery {
  lens: Lens
  value: string
  negate: boolean
  /** The query as the note repeats it: `state[i1] = "merged"`. */
  text: string
}

export type ParsedQuery = { ok: true; query: StateQuery } | { ok: false; reason: string }

const SHAPE = /^\s*([A-Za-z_]\w*)\s*(?:\[\s*(.+?)\s*\]|\.\s*([A-Za-z_]\w*))?\s*(=|≠|\/=|#)\s*(.*?)\s*$/s
const HOW = 'Write it as variable = value, such as state[i1] = "merged".'

/** What the user typed, read against the lenses the states have. Null while the box is empty. */
export function parseQuery(text: string, lenses: readonly Lens[]): ParsedQuery | null {
  if (!text.trim()) return null
  const shape = SHAPE.exec(text)
  if (!shape || !shape[5]) return { ok: false, reason: HOW }
  const [, variable, bracket, dot, operator, value] = shape as unknown as [string, string, string | undefined, string | undefined, string, string]
  const key = bracket ?? dot
  if (!lenses.some((lens) => lens.variable === variable)) return { ok: false, reason: `No variable is called ${variable}.` }
  const lens = lenses.find((entry) => entry.variable === variable && (key == null ? entry.key == null : entry.key != null && bareKey(entry.key) === bareKey(key)))
  if (!lens) return { ok: false, reason: key == null ? HOW : `${variable} has no ${bareKey(key)}.` }
  const negate = operator !== '='
  return { ok: true, query: { lens, value, negate, text: `${lens.label} ${negate ? '≠' : '='} ${value}` } }
}

/** A value as both sides are compared: spacing, ASCII brackets and the quotes around a string do not count. */
function plain(text: string): string {
  const spaced = text
    .trim()
    .replaceAll('|->', '↦')
    .replaceAll('<<', '⟨')
    .replaceAll('>>', '⟩')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,:↦{}[\]⟨⟩])\s*/g, '$1')
  const bare = spaced.replace(/^"(.*)"$/s, '$1')
  return /^(true|false)$/i.test(bare) ? bare.toUpperCase() : bare
}

/** The states the query finds, in the graph's order. */
export function findStates(graph: StateGraph, query: StateQuery): string[] {
  const wanted = plain(query.value)
  const found: string[] = []
  for (const node of graph.nodes.values()) {
    const value = lensValue(node.vars, query.lens)
    const same = value != null && plain(formatValue(value)) === wanted
    if (same !== query.negate && value != null) found.push(node.id)
  }
  return found
}
