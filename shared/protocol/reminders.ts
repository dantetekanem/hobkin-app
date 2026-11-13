/** Metadata for an explicitly authorized, already delivered reminder. Not a report-to-task admission API. */
export interface ReminderOccurrence {
  /** The original report's exact identity, not a newly generated reminder id. */
  id: string
  routineId: string
  on: string
  dueAt: string
  timezone: string
  deliveredAt: string
  title: string
  next: string
  status: 'pending-confirmation' | 'done' | 'dismissed'
  resolvedAt: string | null
}
export interface ReminderState {
  home: string
  entries: ReminderOccurrence[]
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const words = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

/** Reject the whole document on ambiguity, rather than picking a duplicate's pending state over a completion. */
export function decodeOccurrences(value: unknown): ReminderOccurrence[] {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 100) {
    throw Error('Invalid reminder metadata.')
  }
  const ids = new Set<string>()
  for (const row of value.entries) {
    if (!record(row) || !words(row.routineId, 80) || !/^[a-z0-9][a-z0-9._-]*$/.test(row.routineId)
      || typeof row.on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.on)
      || row.id !== `${row.routineId}:${row.on}` || ids.has(row.id)
      || !instant(row.dueAt) || !instant(row.deliveredAt) || Date.parse(row.deliveredAt) < Date.parse(row.dueAt)
      || !words(row.timezone, 80) || !words(row.title, 160) || !words(row.next, 2000)
      || (row.status !== 'pending-confirmation' && row.status !== 'done' && row.status !== 'dismissed')
      || (row.status === 'pending-confirmation' ? row.resolvedAt !== null : !instant(row.resolvedAt))) {
      throw Error('Invalid reminder occurrence.')
    }
    const localDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: row.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(row.dueAt))
    if (localDay !== row.on) throw Error('Reminder due date does not match its timezone.')
    ids.add(row.id)
  }
  return value.entries.map(row => {
    const { id, routineId, on, dueAt, timezone, deliveredAt, title, next, status, resolvedAt } = row as unknown as ReminderOccurrence
    return { id, routineId, on, dueAt, timezone, deliveredAt, title, next, status, resolvedAt }
  })
}

/** A snapshot is data, never authority to create or complete anything. */
export function remindersOf(value: unknown): ReminderState | null {
  if (!record(value) || !words(value.home, 4096)) return null
  try {
    return { home: value.home, entries: decodeOccurrences({ version: 1, entries: value.entries }) }
  } catch {
    return null
  }
}
