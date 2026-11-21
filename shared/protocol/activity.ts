/**
 * What a job does, as hobkin keeps it for display (`src/cli/job-activity.mjs`): the agent's words, and each tool
 * call with its arguments, its output and how it ended. hobkin never keeps the agent's thinking or a tool's
 * private details. The snapshot's `jobActivity` holds one list per run id.
 */
export interface CodemodeMetadata {
  calls: { id: string; name: string; args: string; status: 'running' | 'ok' | 'error' | 'cancelled'; durationMs?: number; error?: string; cost?: number }[]
  fullOutputPath?: string
}

export interface ActivityEntry {
  /** `message:<n>:<part>` for the agent's words, `tool:<call id>` for a tool call. */
  id: string
  kind: 'assistant' | 'tool'
  /** What the agent wrote, for `assistant`. */
  text?: string
  /** The tool's name, for `tool`. */
  name?: string
  state?: 'running' | 'completed' | 'failed'
  /** The tool's arguments, as JSON text. */
  input?: string
  /** What the tool gave back so far, as text. A failed tool's output is its error. */
  output?: string
  /** Bounded codemode operation previews, never nested result bodies. */
  codemode?: CodemodeMetadata
  /** When hobkin first saw it, in milliseconds since the epoch: when the agent began saying it, or made the call. A runtime from before 2026-11-15 leaves it out. */
  at?: number
}

/** Every job's activity, by run id. */
export type JobActivity = Record<string, readonly ActivityEntry[]>

/**
 * The main chat's own activity (the snapshot's `mainActivity`) rides the same steps as one more job under this id,
 * which no run id can be, and reaches the UI as `mainActivity` again.
 */
export const MAIN_ACTIVITY = '#main'

/**
 * How job activity changes on the wire. hobkin rebuilds every job's whole list on each refresh, which is many
 * times a second while an agent writes, so the host sends only what differs: entries added at the end, an entry
 * changed in place, entries or a whole job gone. Anything else resends that one job.
 */
export type ActivityStep =
  /** One job's whole list. */
  | { op: 'reset'; job: string; entries: ActivityEntry[] }
  | { op: 'append'; job: string; entries: ActivityEntry[] }
  /** The entry with this id, replaced in place. */
  | { op: 'update'; job: string; entry: ActivityEntry }
  /** The entry with this id, its words or output longer by `add` at the end and nothing else changed. Only to a window that reads it (`READS_PARAM`). */
  | { op: 'extend'; job: string; id: string; field: 'text' | 'output'; add: string }
  /** The entries with these ids, or with no ids the whole job. */
  | { op: 'remove'; job: string; ids?: string[] }

export type ActivitySteps = ActivityStep[]

/** Two entries say the same. hobkin copies them on every refresh, but a field that did not change is the same string. */
export function sameEntry(left: ActivityEntry, right: ActivityEntry): boolean {
  if (left === right) return true
  const keys = Object.keys(left) as (keyof ActivityEntry)[]
  return keys.length === Object.keys(right).length && keys.every((key) => key === 'codemode' ? sameCodemode(left.codemode, right.codemode) : left[key] === right[key])
}

function sameCodemode(left: CodemodeMetadata | undefined, right: CodemodeMetadata | undefined): boolean {
  if (left === right) return true
  if (!left || !right || left.fullOutputPath !== right.fullOutputPath || left.calls.length !== right.calls.length) return false
  const fields = ['id', 'name', 'args', 'status', 'durationMs', 'error', 'cost'] as const
  return left.calls.every((call, index) => fields.every(field => call[field] === right.calls[index]![field]))
}

type Growth = { field: 'text' | 'output'; add: string }

/** What grew at the end of an entry's words or its output, when nothing else about it changed. */
function growthOf(before: ActivityEntry, after: ActivityEntry): Growth | null {
  const keys = Object.keys(after) as (keyof ActivityEntry)[]
  if (keys.length !== Object.keys(before).length) return null

  let growth: Growth | null = null
  for (const key of keys) {
    const was = before[key]
    const now = after[key]
    if (key === 'codemode' ? sameCodemode(before.codemode, after.codemode) : was === now) continue
    if (growth || (key !== 'text' && key !== 'output') || typeof was !== 'string' || typeof now !== 'string') return null
    if (now.length <= was.length || !now.startsWith(was)) return null
    growth = { field: key, add: now.slice(was.length) }
  }
  return growth
}

/** The step for an entry changed in place: only what grew, to a window that reads that, or else the whole entry. */
function changedStep(job: string, before: ActivityEntry, after: ActivityEntry, extend: boolean): ActivityStep {
  const growth = extend ? growthOf(before, after) : null
  return growth ? { op: 'extend', job, id: after.id, ...growth } : { op: 'update', job, entry: after }
}

/**
 * Lists known to hold each id once. hobkin never changes a list or an entry it handed out (`JobActivity.snapshot`),
 * so a list checked once stays checked, and so does one that only grew from a checked list with new ids at its end.
 */
const distinct = new WeakSet<readonly ActivityEntry[]>()

function distinctIds(entries: readonly ActivityEntry[]): boolean {
  if (distinct.has(entries)) return true
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return false
  distinct.add(entries)
  return true
}

/**
 * The steps of the usual change, found by identity. hobkin keeps an entry it did not change as the same copy, so the
 * walk skips it without reading it, updates an entry whose id lines up and whose fields changed, and appends the new
 * entries at the end. Null for any other shape (a shorter list, an id out of line, a repeated id), which `comparedSteps`
 * works out the same way as for any change.
 */
function grownSteps(job: string, previous: readonly ActivityEntry[], next: readonly ActivityEntry[], extend: boolean): ActivityStep[] | null {
  if (next.length < previous.length) return null
  const steps: ActivityStep[] = []
  for (let index = 0; index < previous.length; index++) {
    const before = previous[index]!
    const after = next[index]!
    if (before === after) continue
    if (before.id !== after.id) return null
    if (!sameEntry(before, after)) steps.push(changedStep(job, before, after, extend))
  }
  if (next.length > previous.length) {
    const ids = new Set(previous.map((entry) => entry.id))
    if (ids.size !== previous.length) return null
    for (let index = previous.length; index < next.length; index++) {
      const { id } = next[index]!
      if (ids.has(id)) return null
      ids.add(id)
    }
    steps.push({ op: 'append', job, entries: next.slice(previous.length) })
  } else if (!distinctIds(previous)) return null
  distinct.add(next)
  return steps
}

function jobSteps(job: string, previous: readonly ActivityEntry[], next: readonly ActivityEntry[], extend = false): ActivityStep[] {
  if (previous === next) return []
  return grownSteps(job, previous, next, extend) ?? comparedSteps(job, previous, next, extend)
}

function comparedSteps(job: string, previous: readonly ActivityEntry[], next: readonly ActivityEntry[], extend = false): ActivityStep[] {
  const reset = (): ActivityStep[] => [{ op: 'reset', job, entries: [...next] }]
  const before = new Set(previous.map((entry) => entry.id))
  const after = new Set(next.map((entry) => entry.id))
  if (before.size !== previous.length || after.size !== next.length) return reset()

  // hobkin only adds at the end and sometimes drops a text, so what both hold leads the new list in the same order.
  const kept = previous.filter((entry) => after.has(entry.id))
  if (next.slice(0, kept.length).some((entry, index) => entry.id !== kept[index]!.id)) return reset()

  const steps: ActivityStep[] = []
  const removed = previous.filter((entry) => !after.has(entry.id)).map((entry) => entry.id)
  if (removed.length) steps.push({ op: 'remove', job, ids: removed })
  next.slice(0, kept.length).forEach((entry, index) => {
    if (!sameEntry(kept[index]!, entry)) steps.push(changedStep(job, kept[index]!, entry, extend))
  })
  const appended = next.slice(kept.length)
  if (appended.length) steps.push({ op: 'append', job, entries: appended })
  return steps
}

export interface DiffOptions {
  /** The jobs whose grown words and output go as `extend` steps, for a window that reads them. None by default. */
  extend?: (job: string) => boolean
}

/** The steps from one activity to the next. Applying them to `previous` gives `next`. */
export function diffActivity(previous: JobActivity, next: JobActivity, { extend }: DiffOptions = {}): ActivityStep[] {
  const steps: ActivityStep[] = []
  for (const job of Object.keys(previous)) {
    if (!Object.hasOwn(next, job)) steps.push({ op: 'remove', job })
  }
  for (const [job, entries] of Object.entries(next)) {
    const before = Object.hasOwn(previous, job) ? previous[job] : undefined
    steps.push(...(before ? jobSteps(job, before, entries, extend?.(job) ?? false) : [{ op: 'reset' as const, job, entries: [...entries] }]))
  }
  return steps
}

/** Every job whole, for a connection that holds nothing yet. */
export function resetActivity(activity: JobActivity): ActivityStep[] {
  return Object.entries(activity).map(([job, entries]) => ({ op: 'reset', job, entries: [...entries] }))
}

/** A tail's words go up to this many characters: more than an agent's row shows of them. */
export const TAIL_TEXT = 1000

const tails = new WeakMap<readonly ActivityEntry[], readonly ActivityEntry[]>()
const briefs = new WeakMap<ActivityEntry, ActivityEntry>()

/**
 * A job as a window that does not watch it gets it: its newest entry without its input, output and codemode, after
 * the newest entry with words when that is another, each with its words cut to TAIL_TEXT characters. That is all an
 * agent's row reads (`doingOf` and `updateOf` in the window). A list keeps its tail, and an entry its brief copy.
 */
export function tailOf(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
  const held = tails.get(entries)
  if (held) return held

  const last = entries.at(-1)
  let said: ActivityEntry | undefined
  for (let index = entries.length - 1; index >= 0 && !said; index--) {
    const entry = entries[index]!
    if (entry.kind === 'assistant' && entry.text) said = entry
  }
  const newest = !last ? [] : said && said !== last ? [said, last] : [last]
  const tail = newest.map(brief)
  tails.set(entries, tail)
  return tail
}

function brief(entry: ActivityEntry): ActivityEntry {
  const held = briefs.get(entry)
  if (held) return held

  const { input: _input, output: _output, codemode: _codemode, ...rest } = entry
  const copy = rest.text !== undefined && rest.text.length > TAIL_TEXT ? { ...rest, text: cut(rest.text) } : rest
  briefs.set(entry, copy)
  return copy
}

/** The first TAIL_TEXT characters, one fewer where the cut would split a character in two. */
function cut(text: string): string {
  const end = /[\uD800-\uDBFF]/.test(text[TAIL_TEXT - 1]!) ? TAIL_TEXT - 1 : TAIL_TEXT
  return text.slice(0, end)
}

/** The activity after the steps. A job or entry no step touches stays the same object, so what draws it can skip it. */
export function applyActivity(held: JobActivity, steps: readonly ActivityStep[]): JobActivity {
  const jobs: Record<string, readonly ActivityEntry[]> = { ...held }
  for (const step of steps) {
    const entries = jobs[step.job] ?? []
    if (step.op === 'reset') jobs[step.job] = [...step.entries]
    else if (step.op === 'append') jobs[step.job] = [...entries, ...step.entries]
    else if (step.op === 'update') {
      const at = entries.findIndex((entry) => entry.id === step.entry.id)
      jobs[step.job] = at === -1 ? [...entries, step.entry] : entries.with(at, step.entry)
    } else if (step.op === 'extend') {
      // Words grow at the newest entries, so the search starts there. An entry not held has nothing to grow.
      const at = entries.findLastIndex((entry) => entry.id === step.id)
      const entry = entries[at]
      if (entry) jobs[step.job] = entries.with(at, { ...entry, [step.field]: `${entry[step.field] ?? ''}${step.add}` })
    } else if (step.ids) {
      const gone = new Set(step.ids)
      jobs[step.job] = entries.filter((entry) => !gone.has(entry.id))
    } else delete jobs[step.job]
  }
  return jobs
}
