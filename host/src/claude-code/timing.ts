/**
 * When each moment of a turn on Claude Code came, and what it spent: the facts of hobkin's `run_performance` event, which
 * a Pi turn gets from `createTurnMetrics` in hobkin's `src/cli/turn-metrics.mjs`. Pure: fed Claude's stream records and the
 * moments the harness knows, it reads only its clocks, keeps no words anyone wrote, and nothing it is fed makes it throw.
 */

/** What the runtime knows of a turn before it reached Claude Code. Times are epoch ms, and `since` is the earliest known. */
export interface TurnContext { since?: number; origin?: 'window' | 'host' | 'tool' | 'run'; kind?: string; marks?: { host?: number; admitted?: number } }
/** The run, and what Claude was asked for: a model until Claude names its own, and a level, or null for Claude's own. */
export interface TimingStart { runId: string; purpose?: unknown; scheduleId?: unknown; model?: string | null; effort?: string | null; turn?: TurnContext }
export type Measure = { value: number | null; state: 'complete' | 'partial' | 'unavailable' }
export type Stage = 'host' | 'admitted' | 'spawned' | 'prompted' | 'ready' | 'requested' | 'thinking' | 'tool' | 'text' | 'ended'
export type TurnFacts = {
  schemaVersion: 1; runId: string; sessionId: string; responses: number; incomplete: boolean; firstObservedOutputMs: number | null; dispatchElapsedMs: number | null
  input: Measure; output: Measure; cacheRead: Measure; cacheWrite: Measure; estimatedUsd: Measure; responseDurationMs: Measure
  kind: string; engine: 'claude'; model: string | null; effort: string | null; origin: string; stages: Partial<Record<Stage, number>>
  steps: { at: number | null; first: number | null; text: number | null; end: number | null; input: number | null; cacheRead: number | null; output: number | null }[]
}
export type TurnTiming = ReturnType<typeof turnTiming>

const TOKENS = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' } as const
type Tokens = keyof typeof TOKENS
/** One API response, by its message id. Its moments are on the monotonic clock. */
interface Response { at?: number; first?: number; text?: number; end?: number; usage: Partial<Record<Tokens, number>> }

const ORIGINS = new Set(['window', 'host', 'tool', 'run'])
const MAX_STEPS = 24
const MAX_RESPONSES = 1024
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const word = (value: unknown) => (typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null)
/** The ms from one moment to a later one, or null when either is unknown or they come the wrong way round. */
const span = (from: unknown, to: unknown) => (typeof from === 'number' && typeof to === 'number' && isCount(to - from) ? to - from : null)
const fromResult = (value: unknown): Measure => (isCount(value) ? { value, state: 'complete' } : { value: null, state: 'unavailable' })

/** The kind of turn, by what the request is for. */
export function turnKind({ purpose, scheduleId }: { purpose?: unknown; scheduleId?: unknown }): string {
  if (purpose === 'durable') return 'durable'
  if (typeof purpose === 'string' && purpose.startsWith('work-')) return 'work'
  if (typeof scheduleId === 'string' && scheduleId) return scheduleId.startsWith('session.') ? 'session' : 'routine'
  return 'other'
}

/** One turn's tracker. `now` is a monotonic clock, `wall` gives epoch ms. */
export function turnTiming(start: TimingStart, now = () => performance.now(), wall = Date.now) {
  const known = typeof start.turn?.since === 'number' && Number.isFinite(start.turn.since)
  const origin = known && ORIGINS.has(start.turn?.origin ?? '') ? start.turn!.origin! : 'run'
  const moments: Partial<Record<Stage, number>> = {}
  const responses = new Map<string, Response>()
  let since = Number.NaN
  // The monotonic clock's reading at the turn's start, so a moment minus it is ms since the start.
  let zero = Number.NaN
  let current: Response | undefined
  let firstDelta: number | undefined
  let result: Record<string, unknown> | undefined
  let session: string | null = null
  let model: string | null = null
  let lost = false
  try {
    const entry = wall()
    since = known ? start.turn!.since! : entry
    zero = now() - (entry - since)
  } catch {
    // Then no moment can be placed, and none is.
  }

  const mark = (stage: Stage) => {
    try {
      moments[stage] ??= now()
    } catch {
      // Left out.
    }
  }
  /** The response with this id, counted once however often it arrives. One with no id cannot be counted. */
  const response = (id: unknown) => {
    const key = word(id)
    let found = key ? responses.get(key) : undefined
    if (!found && key && responses.size < MAX_RESPONSES) responses.set(key, (found = { usage: {} }))
    if (!found) lost = true
    return found
  }
  /** Claude's counts are running totals within a response, so the largest seen is the latest. */
  const meter = (into: Response | undefined, usage: unknown) => {
    if (!into || !isRecord(usage)) return
    for (const field of Object.keys(TOKENS) as Tokens[]) {
      const value = usage[TOKENS[field]]
      if (isCount(value)) into.usage[field] = Math.max(into.usage[field] ?? 0, value)
    }
  }
  const streamed = (event: Record<string, unknown>, at: number) => {
    const message = isRecord(event.message) ? event.message : {}
    const delta = isRecord(event.delta) ? event.delta : {}
    if (event.type === 'message_start') {
      moments.requested ??= at
      current = response(message.id)
      if (current) current.at ??= at
      meter(current, message.usage)
    } else if (event.type === 'content_block_delta') {
      firstDelta ??= at
      if (current) current.first ??= at
      if (delta.type === 'thinking_delta') moments.thinking ??= at
      else if (delta.type === 'input_json_delta') moments.tool ??= at
      else if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        moments.text ??= at
        if (current) current.text ??= at
      }
    } else if (event.type === 'message_delta') meter(current, event.usage)
    else if (event.type === 'message_stop' && current) current.end = at
  }

  return {
    /** The claude process started, for the session the turn began with. */
    spawned(id: string) {
      session = id
      mark('spawned')
    },
    /** The turn's user message was written to Claude's input. */
    prompted: () => mark('prompted'),
    observe(record: Record<string, unknown>) {
      try {
        // Claude's own subagents report under their Agent call: their responses are not the turn's.
        if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) return
        const at = now()
        if (record.type === 'system' && record.subtype === 'init') {
          moments.ready ??= at
          session = word(record.session_id) ?? session
          model = word(record.model) ?? model
        } else if (record.type === 'stream_event' && isRecord(record.event)) streamed(record.event, at)
        else if (record.type === 'assistant' && isRecord(record.message)) {
          const found = response(record.message.id)
          if (found) found.end = at
          meter(found, record.message.usage)
          model ??= word(record.message.model)
        } else if (record.type === 'result') result = record
      } catch {
        // A timing is never worth a turn.
      }
    },
    /** What the turn measured, as it ends. Null for a turn whose process never started. */
    facts(): TurnFacts | null {
      try {
        if (moments.spawned === undefined || !session) return null
        mark('ended')
        const all = [...responses.values()]
        const incomplete = lost || !result || all.some((each) => !Object.keys(each.usage).length)
        const tokens = (field: Tokens): Measure => {
          const counted = all.map((each) => each.usage[field]).filter(isCount)
          if (!counted.length) return { value: null, state: 'unavailable' }
          return { value: counted.reduce((sum, value) => sum + value, 0), state: counted.length === all.length && !incomplete ? 'complete' : 'partial' }
        }
        const placed = (moment: number | undefined) => span(zero, moment)
        const stages: Partial<Record<Stage, number>> = {}
        const place = (stage: Stage, value: number | null) => {
          if (value !== null) stages[stage] = value
        }
        place('host', span(since, start.turn?.marks?.host))
        place('admitted', span(since, start.turn?.marks?.admitted))
        for (const [stage, at] of Object.entries(moments) as [Stage, number][]) place(stage, placed(at))
        return {
          schemaVersion: 1, runId: start.runId, sessionId: session, responses: all.length, incomplete,
          firstObservedOutputMs: span(moments.prompted, firstDelta), dispatchElapsedMs: span(moments.prompted, moments.ended),
          input: tokens('input'), output: tokens('output'), cacheRead: tokens('cacheRead'), cacheWrite: tokens('cacheWrite'),
          estimatedUsd: fromResult(result?.total_cost_usd), responseDurationMs: fromResult(result?.duration_api_ms),
          kind: word(start.turn?.kind) ?? turnKind(start), engine: 'claude', model: model ?? word(start.model),
          effort: word(start.effort), origin, stages,
          steps: all.slice(0, MAX_STEPS).map(({ at, first, text, end, usage }) => ({
            at: placed(at), first: placed(first), text: placed(text), end: placed(end),
            input: usage.input ?? null, cacheRead: usage.cacheRead ?? null, output: usage.output ?? null,
          })),
        }
      } catch {
        return null
      }
    },
  }
}
