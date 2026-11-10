import type { WireSnapshot } from '../../../../shared/protocol/snapshot.ts'
import { emptyQueue } from '../questions/queue.ts'
import { waiting, type ActionItem, type ItemKind, type WaitingRow } from './items.ts'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const nullableText = (value: unknown) => value === null || typeof value === 'string'

function isDecision(value: unknown): value is ActionItem {
  const row = record(value)
  return !!row && typeof row.id === 'string' && row.id.length > 0 &&
    ['from', 'question', 'tldr', 'at'].every((key) => typeof row[key] === 'string') &&
    ['key', 'recommended', 'why', 'changed'].every((key) => nullableText(row[key])) &&
    (row.answerTo === null || typeof record(row.answerTo)?.kind === 'string') &&
    Array.isArray(row.choices) && row.choices.every((choice) => {
      const entry = record(choice)
      return entry && typeof entry.value === 'string' && typeof entry.label === 'string'
    })
}

const GROUPS: [string, ItemKind][] = [
  ['wrong', 'work'],
  ['asks', 'question'],
  ['proposals', 'work'],
  ['branches', 'merge'],
  ['yours', 'yours'],
  ['reports', 'routine'],
]

/** The host's two waiting slices, without turning a saved summary into an answerable question. */
export function hostRows(snapshot: WireSnapshot): WaitingRow[] {
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions.filter(isDecision) : []
  const rows = waiting(decisions, emptyQueue).map((row) => ({
    ...row,
    links: Array.isArray(row.links)
      ? row.links.filter((link) => {
          const entry = record(link)
          return entry && typeof entry.label === 'string' && typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url)
        })
      : [],
  }))
  const pending = record(snapshot.waiting)
  for (const [group, kind] of GROUPS) {
    const entries = pending?.[group]
    if (!Array.isArray(entries)) continue
    entries.forEach((value, index) => {
      const entry = record(value)
      if (!entry) return
      const summary = text(entry.title) || text(entry.question) || text(entry.fact)
      if (!summary) return
      const identity = text(entry.id) || text(entry.key) || `${text(entry.slug)}:${text(entry.item)}`
      const id = `waiting:${group}:${identity === ':' ? index : identity}`
      const from = text(entry.from) || text(entry.project) || text(entry.slug) || 'hobkin'
      const detail = text(entry.summary) || text(entry.reason) || text(entry.next)
      rows.push({
        id,
        kind,
        from,
        summary,
        at: text(entry.at) || null,
        question: {
          id,
          from,
          question: summary,
          choices: [],
          ...(detail ? { tldr: detail } : {}),
        },
        putOff: false,
        branch: false,
        pick: null,
        changed: null,
        links: [],
        item: null,
      })
    })
  }
  return rows.toSorted((a, b) => (a.at ?? '\uffff').localeCompare(b.at ?? '\uffff'))
}
