import type { ActivityEntry, CodemodeMetadata } from '#shared/protocol/activity.ts'
import { stateOf } from './steps.ts'

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const clean = (text: string, max: number) => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Saved branches are raw Pi records; apply the same narrow display boundary as live activity. */
function metadataOf(value: unknown): CodemodeMetadata | undefined {
  const data = object(value)
  if (!Array.isArray(data?.calls)) return undefined
  const calls: CodemodeMetadata['calls'] = []
  for (const value of data.calls.slice(0, 100)) {
    const call = object(value)
    if (!call || !['id', 'name', 'args'].every(key => typeof call[key] === 'string') || typeof call.status !== 'string' || !['running', 'ok', 'error', 'cancelled'].includes(call.status)) return undefined
    calls.push({ id: clean(call.id as string, 200), name: clean(call.name as string, 100), args: clean(call.args as string, 200), status: call.status as CodemodeMetadata['calls'][number]['status'],
      ...(finite(call.durationMs) ? { durationMs: call.durationMs } : {}), ...(finite(call.cost) ? { cost: call.cost } : {}), ...(typeof call.error === 'string' ? { error: clean(call.error, 500) } : {}) })
  }
  return { calls, ...(typeof data.fullOutputPath === 'string' ? { fullOutputPath: clean(data.fullOutputPath, 2000) } : {}) }
}

export function codemodeOf(entry: ActivityEntry, ended = false) {
  const metadata = metadataOf(entry.codemode)
  let source = entry.input ?? ''
  try { const args = JSON.parse(source); if (typeof args?.code === 'string') source = args.code } catch { /* Raw model-facing source is also valid. */ }
  const state = stateOf(entry, ended)
  return { state, source, output: entry.output ?? '', metadata,
    operations: metadata?.calls.map((call, ordinal) => ({ ...call, key: `${entry.id}:${ordinal}`, status: call.status === 'running' && state !== 'running' ? 'unknown' as const : call.status })) }
}

type Codemode = ReturnType<typeof codemodeOf>

/** What a codemode step's closed row says after "Ran codemode". */
export interface CodemodeWords {
  /** The script's own end, when it did not complete: "script failed", "stopped". It is said first. */
  script?: string
  /** The tool calls the script made. Absent when the host did not report them. */
  calls?: {
    /** "4 tool calls", "1 tool call", "2 tool calls so far", or "listed 12 tools" for a script that only printed the tools it found. */
    count: string
    /** "all passed", or "passed" for one. */
    passed?: string
    /** "1 failed", with the names of the calls that failed: "bash". */
    failed?: string
    names?: string
    /** Calls that were cancelled or still running when the script ended: "1 did not finish". */
    unfinished?: string
    /** What they were, each kind counted in the order first seen: "bash, 2 read, ls". */
    tally?: string
  }
}

const SCRIPT_END: Partial<Record<Codemode['state'], string>> = { failed: 'script failed', stopped: 'stopped' }

const calls = (count: number) => (count === 1 ? '1 tool call' : `${count} tool calls`)

/** Each name once, in the order first seen, with how many times it came when more than once. */
function tallyOf(names: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => (count === 1 ? name : `${count} ${name}`)).join(', ')
}

/** One tool as codemode's own search prints it: `{"name":"…","description":"…`. */
const LISTED_TOOL = /\{"name":"[^"]+","description":/g

/**
 * What a script that ran no tool through codemode printed, when that is a list of tools: "listed 12 tools". A list cut
 * short by the feed is not counted. Null for any other output.
 */
function listedTools(output: string): string | null {
  const found = output.match(LISTED_TOOL)?.length ?? 0
  if (found === 0) return null

  const whole = output.trimEnd().endsWith(']')
  if (!whole) return 'listed tools'
  return found === 1 ? 'listed 1 tool' : `listed ${found} tools`
}

/**
 * The words a codemode step's row says about its script and the tool calls it made. The calls are the tools the
 * script ran through codemode, as the runtime reports them. A script can do all its work with codemode's own
 * functions and report none, so a row with none never says "no tool calls": it says what the script printed when
 * that can be told, and otherwise nothing.
 */
export function codemodeWords({ state, operations, output = '' }: Pick<Codemode, 'state' | 'operations'> & { output?: string }): CodemodeWords {
  const script = SCRIPT_END[state]
  const words: CodemodeWords = script ? { script } : {}
  if (!operations) return words

  const running = state === 'running'
  if (operations.length === 0) {
    const listed = running ? null : listedTools(output)
    return listed ? { ...words, calls: { count: listed } } : words
  }

  const failed = operations.filter((operation) => operation.status === 'error')
  const unfinished = operations.filter((operation) => operation.status === 'cancelled' || operation.status === 'unknown').length
  const passed = !running && operations.every((operation) => operation.status === 'ok')
  return {
    ...words,
    calls: {
      count: running ? `${calls(operations.length)} so far` : calls(operations.length),
      ...(passed ? { passed: operations.length === 1 ? 'passed' : 'all passed' } : {}),
      ...(failed.length ? { failed: `${failed.length} failed`, names: [...new Set(failed.map((operation) => operation.name))].join(', ') } : {}),
      ...(unfinished ? { unfinished: `${unfinished} did not finish` } : {}),
      tally: tallyOf(operations.map((operation) => operation.name)),
    },
  }
}

/**
 * The words as one line of text: "script failed · 4 tool calls, 1 failed: bash · bash, 2 read, ls". The failed
 * calls' names end the result, so they can give way after the tally without taking anything else with them.
 */
export function codemodeText({ script, calls }: CodemodeWords): string {
  if (!calls) return script ?? ''
  let said = calls.count
  if (calls.passed) said += `, ${calls.passed}`
  if (calls.unfinished) said += `, ${calls.unfinished}`
  if (calls.failed) said += `, ${calls.failed}${calls.names ? `: ${calls.names}` : ''}`
  if (calls.tally) said += ` · ${calls.tally}`
  return script ? `${script} · ${said}` : said
}

/**
 * Why a codemode row that finished carries the warning mark instead of its tick: some tool call of its script failed
 * or did not finish. Null when every call passed, none was reported or known, or the script did not finish, which
 * keeps the mark its state has.
 */
export function codemodeWarning({ state, operations }: Pick<Codemode, 'state' | 'operations'>): string | null {
  if (state !== 'done' || !operations) return null
  const failed = operations.filter((operation) => operation.status === 'error').length
  const unfinished = operations.filter((operation) => operation.status !== 'ok' && operation.status !== 'error').length
  if (!failed && !unfinished) return null

  if (operations.length === 1) return `The script finished. Its one tool call ${failed ? 'failed' : 'did not finish'}.`
  const parts = [failed ? `${failed} failed` : '', unfinished ? `${unfinished} did not finish` : ''].filter(Boolean)
  return `The script finished. Of its ${operations.length} tool calls, ${parts.join(' and ')}.`
}

/** How long a tool call took, as the app says a time: 361 ms, 1.2 s, 1m 05s. */
export function callTime(ms: number): string {
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`
  const tenths = Math.round(ms / 100) / 10
  if (tenths < 60) return `${tenths.toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export interface SavedCodemode {
  entry: ActivityEntry
  correlation: 'matched' | 'missing' | 'ambiguous' | 'orphan'
}

/** Index only the supplied branch. Duplicate IDs are unknown, never a positional/name guess. */
export function savedCodemode(entries: readonly Record<string, unknown>[]): Map<object, SavedCodemode> {
  const calls = new Map<string, Record<string, unknown>[]>()
  const results = new Map<string, Record<string, unknown>[]>()
  const unidentified: { record: Record<string, unknown>; result: boolean }[] = []
  for (const entry of entries) {
    const message = object(entry.message)
    if (!message) continue
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const value of message.content) {
        const part = object(value)
        if (part?.type !== 'toolCall') continue
        if (typeof part.id !== 'string' || !part.id) { if (part.name === 'codemode') unidentified.push({ record: part, result: false }); continue }
        calls.set(part.id, [...(calls.get(part.id) ?? []), part])
      }
    }
    if (message.role === 'toolResult') {
      if (typeof message.toolCallId === 'string' && message.toolCallId) results.set(message.toolCallId, [...(results.get(message.toolCallId) ?? []), message])
      else if (message.toolName === 'codemode') unidentified.push({ record: message, result: true })
    }
  }
  const linked = new Map<object, SavedCodemode>()
  const activity = (id: string, part?: Record<string, unknown>, result?: Record<string, unknown>): ActivityEntry => {
    const content = result?.content
    const output = typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap(value => { const block = object(value); return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : [] }).join('\n') : ''
    const metadata = metadataOf(object(result?.details))
    return { id: `tool:${id}`, kind: 'tool', name: 'codemode', input: part ? JSON.stringify(part.arguments) : '', output, state: result ? result.isError === true ? 'failed' : 'completed' : 'running', ...(metadata ? { codemode: metadata } : {}) }
  }
  for (const [id, parts] of calls) {
    const found = results.get(id) ?? []
    const unique = parts.length === 1 && found.length === 1
    for (const part of parts.filter(part => part.name === 'codemode')) linked.set(part, { entry: activity(id, part, unique ? found[0] : undefined), correlation: unique ? 'matched' : parts.length > 1 || found.length > 1 ? 'ambiguous' : 'missing' })
  }
  for (const [id, found] of results) {
    const parts = calls.get(id) ?? []
    if (parts.length === 1 && found.length === 1) continue
    for (const result of found) if (result.toolName === 'codemode' || parts.some(part => part.name === 'codemode')) linked.set(result, { entry: activity(id, undefined, result), correlation: parts.length || found.length > 1 ? 'ambiguous' : 'orphan' })
  }
  for (const { record, result } of unidentified) linked.set(record, { entry: activity('unknown', result ? undefined : record, result ? record : undefined), correlation: result ? 'orphan' : 'missing' })
  return linked
}
