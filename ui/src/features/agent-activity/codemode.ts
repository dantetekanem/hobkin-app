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
