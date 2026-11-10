/**
 * Pass 4 as the host sees it: whatever the model returned, read without trust.
 *
 * The model arranges prepared ids and writes prose. It returns the story order, a teaching text per step,
 * a one-line summary per node, extra wires, and unchanged context it found. Nothing here throws:
 * a field that is not what was asked for is left out, and the host completes the review without it.
 */
import { cleanProse } from './prose.ts'
import { PROSE_LIMIT } from './types.ts'

export interface ModelContext {
  /** The model's own name for this context, used by its wires and steps. The host gives the node its real id. */
  id: string
  path: string
  symbol: string
  summary: string
}

export interface ModelWire {
  from: string
  to: string
  kind: string
  label: string
}

export interface ModelStep {
  title: string
  text: string
  focus: string[]
  criteria: string[]
  specStep: string
}

export interface ModelPass {
  summary: string
  /** Node id to its one-line summary. */
  summaries: Map<string, string>
  context: ModelContext[]
  wires: ModelWire[]
  story: ModelStep[]
  /** A few words to open the closing step with. */
  closing: string
}

/** The shape the model is asked to return, before it is read. Every field is optional. */
export interface ModelPassInput {
  summary?: string
  nodes?: Record<string, { summary?: string }>
  context?: { id?: string; path?: string; symbol?: string; summary?: string }[]
  wires?: { from?: string; to?: string; kind?: string; label?: string }[]
  story?: { title?: string; text?: string; focus?: string[]; criteria?: string[]; specStep?: string }[]
  closing?: string
}

const record = (value: unknown): Record<string, unknown> | undefined => (value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const id = (value: unknown): string => (typeof value === 'string' ? cleanProse(value, 200) : '')
const ids = (value: unknown): string[] => list(value).map(id).filter(Boolean)

export function readModelPass(output: unknown): ModelPass {
  let value = output
  if (typeof value === 'string') {
    // Models often wrap JSON in a code fence.
    const text = value.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    try {
      value = JSON.parse(text)
    } catch {
      value = undefined
    }
  }
  const root = record(value) ?? {}

  const summaries = new Map<string, string>()
  for (const [nodeId, raw] of Object.entries(record(root.nodes) ?? {})) {
    const summary = cleanProse(record(raw)?.summary ?? raw, PROSE_LIMIT.summary)
    if (summary) summaries.set(nodeId, summary)
  }

  return {
    summary: cleanProse(root.summary, PROSE_LIMIT.stepText),
    summaries,
    context: list(root.context).flatMap((raw) => {
      const entry = record(raw)
      const context = { id: id(entry?.id), path: typeof entry?.path === 'string' ? entry.path : '', symbol: id(entry?.symbol), summary: cleanProse(entry?.summary, PROSE_LIMIT.summary) }
      return context.id ? [context] : []
    }),
    wires: list(root.wires).flatMap((raw) => {
      const entry = record(raw)
      return entry ? [{ from: id(entry.from), to: id(entry.to), kind: id(entry.kind), label: cleanProse(entry.label, PROSE_LIMIT.label) }] : []
    }),
    story: list(root.story).flatMap((raw) => {
      const entry = record(raw)
      if (!entry) return []
      return [{ title: cleanProse(entry.title, PROSE_LIMIT.title), text: cleanProse(entry.text, PROSE_LIMIT.stepText), focus: ids(entry.focus), criteria: ids(entry.criteria), specStep: id(entry.specStep) }]
    }),
    closing: cleanProse(root.closing, PROSE_LIMIT.stepText),
  }
}
