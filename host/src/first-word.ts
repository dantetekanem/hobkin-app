/**
 * Where the time goes before a reply's first text, from hobkin's own event log. Each turn writes one `run_performance`
 * event with its stages in milliseconds since the turn began, and the window adds a `turn_shown` event for a main turn.
 * This reads those facts only: numbers, ids and model names.
 */

export type Spread = { median: number; p90: number; count: number } | null

export interface FirstWordRow {
  kind: string
  engine: string
  model: string
  turns: number
  /** Until the agent could start: the queue, the save, and for a turn that starts a process, that process coming up. */
  wait: Spread
  /** The part of the wait that was the agent's process starting and loading its settings. */
  boot: Spread
  /** From there to the first model request being open. */
  request: Spread
  /** From that request to the first text: the model thinking, and any tool calls it made first. */
  think: Spread
  /** From the turn's start to the first text reaching hobkin. */
  text: Spread
  /** From the user's Enter to the first text reaching the window, and to it being visible there. */
  arrived: Spread
  shown: Spread
  /** What the window added after the text reached hobkin. */
  afterText: Spread
  /** Turns whose first request sent most of its prompt uncached, of those with a prompt large enough to tell. */
  uncached: { turns: number; of: number }
}

export interface FirstWordSummary {
  from: string | null
  to: string | null
  timed: number
  untimed: number
  /** Events written before stages existed: only their prompt-to-first-output time is known. */
  untimedFirstOutput: Spread
  /**
   * The main agent's system prompt is built from parts (directions, memory, decisions, persona), and a change in any of
   * them sends the whole conversation uncached. Of the uncached main turns that can be compared with the turn before:
   * how many came after each part changed, and after none did. Null when no turn could be compared.
   */
  uncachedAfter: { turns: number; parts: Record<string, number>; nothing: number } | null
  rows: FirstWordRow[]
}

const KINDS = ['main', 'durable', 'helper', 'work', 'routine', 'session', 'other']
const ENGINES = ['pi', 'claude']
// A prompt smaller than this says nothing about caching either way.
const CACHE_WORTH_TOKENS = 20000

const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function spread(values: number[]): Spread {
  if (!values.length) return null
  const sorted = values.toSorted((left, right) => left - right)
  const at = (share: number) => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]!
  return { median: at(0.5), p90: at(0.9), count: sorted.length }
}

interface Turn {
  wait: number
  boot?: number
  request?: number
  think?: number
  text?: number
  arrived?: number
  shown?: number
  afterText?: number
  uncached?: boolean
}

function turnOf(event: Record<string, unknown>, shown: Record<string, unknown> | undefined): Turn | null {
  const stages = record(event.stages)
  if (!stages || !amount(stages.prompted)) return null
  const stage = (name: string) => (amount(stages[name]) ? (stages[name] as number) : undefined)
  const ready = stage('ready')
  const spawned = stage('spawned')
  const requested = stage('requested')
  const text = stage('text')
  // Claude Code takes its prompt as it starts, so it is ready after it is prompted; Pi is ready before.
  const wait = Math.max(stages.prompted, ready ?? 0)
  const turn: Turn = { wait }
  if (ready !== undefined && spawned !== undefined && ready >= spawned) turn.boot = ready - spawned
  if (requested !== undefined) turn.request = Math.max(0, requested - wait)
  if (requested !== undefined && text !== undefined) turn.think = Math.max(0, text - requested)
  if (text !== undefined) turn.text = text
  if (shown && amount(shown.arrivedMs) && amount(shown.shownMs)) {
    turn.arrived = shown.arrivedMs
    turn.shown = shown.shownMs
    if (text !== undefined) turn.afterText = Math.max(0, shown.shownMs - text)
  }
  const first = record(Array.isArray(event.steps) ? event.steps[0] : null)
  if (first && amount(first.input) && amount(first.cacheRead) && first.input + first.cacheRead >= CACHE_WORTH_TOKENS) {
    turn.uncached = first.input > first.cacheRead
  }
  return turn
}

const label = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback)
const place = (order: string[], value: string) => (order.includes(value) ? order.indexOf(value) : order.length)

export function summarizeFirstWord(events: readonly unknown[]): FirstWordSummary {
  const shown = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    const fact = record(event)
    if (fact?.type === 'turn_shown' && typeof fact.id === 'string') shown.set(fact.id, fact)
  }
  const prompts = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    const fact = record(event)
    const parts = fact?.type === 'turn_prompt' && typeof fact.id === 'string' ? record(fact.parts) : null
    if (parts) prompts.set(fact!.id as string, parts)
  }
  const after = { turns: 0, parts: {} as Record<string, number>, nothing: 0 }
  let before: Record<string, unknown> | undefined
  const groups = new Map<string, { kind: string; engine: string; model: string; turns: Turn[] }>()
  const untimed: number[] = []
  let untimedCount = 0
  const times: string[] = []
  for (const event of events) {
    const fact = record(event)
    if (fact?.type !== 'run_performance') continue
    const turn = turnOf(fact, typeof fact.runId === 'string' ? shown.get(fact.runId) : undefined)
    if (!turn) {
      untimedCount++
      if (amount(fact.firstObservedOutputMs)) untimed.push(fact.firstObservedOutputMs)
      continue
    }
    if (typeof fact.at === 'string') times.push(fact.at)
    const kind = label(fact.kind, 'other')
    const engine = label(fact.engine, 'pi')
    const model = label(fact.model, 'unknown')
    if (kind === 'main') {
      const parts = typeof fact.runId === 'string' ? prompts.get(fact.runId) : undefined
      if (turn.uncached && parts && before) {
        const changed = Object.keys(parts).filter((part) => parts[part] !== before![part])
        after.turns++
        for (const part of changed) after.parts[part] = (after.parts[part] ?? 0) + 1
        if (!changed.length) after.nothing++
      }
      before = parts
    }
    const key = JSON.stringify([kind, engine, model])
    if (!groups.has(key)) groups.set(key, { kind, engine, model, turns: [] })
    groups.get(key)!.turns.push(turn)
  }
  const rows = [...groups.values()]
    .toSorted((left, right) =>
      place(KINDS, left.kind) - place(KINDS, right.kind)
      || place(ENGINES, left.engine) - place(ENGINES, right.engine)
      || left.model.localeCompare(right.model))
    .map(({ kind, engine, model, turns }): FirstWordRow => {
      const column = (name: Exclude<keyof Turn, 'uncached'>) => spread(turns.flatMap((turn) => (turn[name] === undefined ? [] : [turn[name]])))
      const judged = turns.filter((turn) => turn.uncached !== undefined)
      return {
        kind, engine, model, turns: turns.length,
        wait: column('wait'), boot: column('boot'), request: column('request'), think: column('think'), text: column('text'),
        arrived: column('arrived'), shown: column('shown'), afterText: column('afterText'),
        uncached: { turns: judged.filter((turn) => turn.uncached).length, of: judged.length },
      }
    })
  times.sort()
  return {
    from: times[0] ?? null, to: times.at(-1) ?? null,
    timed: rows.reduce((sum, row) => sum + row.turns, 0), untimed: untimedCount, untimedFirstOutput: spread(untimed),
    uncachedAfter: after.turns ? after : null, rows,
  }
}

const seconds = (value: Spread) => (value ? `${(value.median / 1000).toFixed(1)} · ${(value.p90 / 1000).toFixed(1)}` : '–')

/** The summary as text. Each time is the median, then the 90th percentile, in seconds. */
export function firstWordTable(summary: FirstWordSummary): string {
  const lines: string[] = []
  if (!summary.rows.length) lines.push('No turn with stage timings yet.')
  else {
    const head = ['kind', 'engine', 'model', 'turns', 'wait', 'start', 'request', 'think', 'first text', 'shown', 'after text', 'uncached']
    const body = summary.rows.map((row) => [
      row.kind, row.engine, row.model, String(row.turns), seconds(row.wait), seconds(row.boot), seconds(row.request), seconds(row.think),
      seconds(row.text), seconds(row.shown), seconds(row.afterText), row.uncached.of ? `${row.uncached.turns}/${row.uncached.of}` : '–',
    ])
    const widths = head.map((title, index) => Math.max(title.length, ...body.map((cells) => cells[index]!.length)))
    const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd()
    lines.push(`${summary.timed} turns, ${summary.from ?? '?'} to ${summary.to ?? '?'}. Seconds, median · 90th percentile.`, '', line(head), ...body.map(line), '',
      'wait: until the agent could start (queue, save, process start). start: the process coming up, part of wait.',
      'request: from there to the first model request. think: from that request to the first text.',
      'first text: from the start of the turn to the first text reaching hobkin. shown: from Enter to visible in the window.',
      'after text: what the window added. uncached: turns whose first request sent most of its prompt uncached.')
  }
  if (summary.uncachedAfter) {
    const { turns, parts, nothing } = summary.uncachedAfter
    const changed = Object.entries(parts).toSorted(([, left], [, right]) => right - left).map(([part, count]) => `${part} ${count}`)
    lines.push('', `${turns} uncached main turns came after a change in the system prompt's parts: ${changed.join(', ') || 'none'}; nothing changed ${nothing}.`)
  }
  if (summary.untimed) {
    lines.push('', `${summary.untimed} older turns have no stages; from prompt to first output they took ${seconds(summary.untimedFirstOutput)} s.`)
  }
  return lines.join('\n')
}
