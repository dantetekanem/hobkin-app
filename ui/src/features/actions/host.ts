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

const ATTENTION_KINDS = new Map<string, ItemKind>([
  ['personal', 'yours'],
  ['approval', 'approval'],
  ['work', 'work'],
])

const GROUPS: [string, ItemKind][] = [
  ['wrong', 'work'],
  ['asks', 'question'],
  ['proposals', 'work'],
  ['branches', 'merge'],
  ['yours', 'yours'],
  ['reports', 'routine'],
]

/** The rules from Pi's AGENTS.md that Your directions lack (`038-resources`): a yes adds them, a no lasts until Pi's file changes. */
const PI_DIRECTIONS_CHOICES = [
  { value: 'yes', label: 'Yes, add them to my directions' },
  { value: 'later', label: 'No, but ask me later' },
  { value: 'no', label: "No, not until Pi's file changes" },
]

/**
 * What a learning proposal offers, in hobkin's words. A proposal about a repo is never asked again for that repo.
 */
const learningChoices = (scope: string) =>
  scope === 'pi-directions'
    ? PI_DIRECTIONS_CHOICES
    : [
        { value: 'yes', label: 'Yes, plan it' },
        { value: 'later', label: 'No, but ask me later' },
        { value: 'no', label: scope.startsWith('work.') ? 'No, never again for this repo' : 'No, never again' },
      ]

/** hobkin's `work done`: what the step left for the user is cleared, and any branch or PR stays as it is. */
const DONE = { value: 'done', label: 'Mark it done' }

/** A work-mode project proposal (an `asks` entry of kind `proposal`): taken at hobkin's level or skipped, by its slug. */
const TAKE_SKIP = [
  { value: 'take', label: 'Take it' },
  { value: 'skip', label: 'Skip' },
]

/** Where a waiting row that is not answered here is handled: a report in Reports, anything about work in Work. */
function opensOf(group: string, entry: Record<string, unknown>): WaitingRow['opens'] {
  if (group === 'reports' && text(entry.id)) return { screen: 'reports', report: text(entry.id) }
  if (group === 'wrong' && text(entry.report)) return { screen: 'reports', report: text(entry.report) }
  if (group === 'proposals') return undefined
  return { screen: 'work' }
}

/** The host's two waiting slices, without turning a saved summary into an answerable question. */
export function hostRows(snapshot: WireSnapshot): WaitingRow[] {
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions.filter(isDecision) : []
  const rows: WaitingRow[] = waiting(decisions, emptyQueue).map((row) => ({
    ...row,
    // Answered through hobkin's own decision action, by the id it filed it under.
    answers: { by: 'decision' as const, id: row.id },
    links: Array.isArray(row.links)
      ? row.links.filter((link) => {
          const entry = record(link)
          return entry && typeof entry.label === 'string' && typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url)
        })
      : [],
  }))
  const pending = record(snapshot.waiting)
  const branches = Array.isArray(pending?.branches) ? pending.branches : []
  const inWork = new Set(branches.map((value) => `${text(record(value)?.slug)}:${text(record(value)?.item)}`))
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
      // A learning proposal is a question hobkin answers with its learning action. The rest open where they are handled.
      const proposal = group === 'proposals' && /^[0-9a-f]{6}$/.test(text(entry.id))
      // A step Work shows no card for would open onto nothing there, so it is cleared here with hobkin's own done.
      const [slug, item] = [text(entry.slug), text(entry.item)]
      const clears = group === 'yours' && Boolean(slug && item) && !inWork.has(`${slug}:${item}`)
      // A work-mode project proposal is answered here, taken or skipped, so it never opens onto Work's hidden panel.
      const projectProposal = group === 'asks' && text(entry.kind) === 'proposal' && Boolean(slug)
      rows.push({
        id,
        kind: group === 'yours' ? ATTENTION_KINDS.get(text(entry.attentionKind)) ?? 'work' : kind,
        from,
        summary,
        at: text(entry.at) || null,
        question: {
          id,
          from,
          question: proposal ? text(entry.question) || summary : summary,
          choices: proposal ? learningChoices(text(entry.scope)) : clears ? [DONE] : projectProposal ? TAKE_SKIP : [],
          ...(detail ? { tldr: detail } : {}),
        },
        putOff: false,
        branch: false,
        pick: null,
        changed: null,
        links: [],
        item: null,
        ...(proposal ? { answers: { by: 'learning' as const, id: text(entry.id), cardId: `learning:${text(entry.id)}:${text(entry.at)}` } } : {}),
        ...(clears ? { answers: { by: 'work' as const, id: `${slug}:${item}`, slug, item } } : {}),
        ...(projectProposal ? { answers: { by: 'proposal' as const, slug, cardId: `project:${slug}:${text(entry.offeredAt)}` } } : {}),
        ...(!clears && !projectProposal && opensOf(group, entry) ? { opens: opensOf(group, entry) } : {}),
      })
    })
  }
  return rows.toSorted((a, b) => (a.at ?? '\uffff').localeCompare(b.at ?? '\uffff'))
}
