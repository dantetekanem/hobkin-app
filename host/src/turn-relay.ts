import type { PiSessionEvent } from 'hobkin/src/cli/application.mjs'
import type { TurnMessage } from '#shared/protocol/messages.ts'
import type { TurnEvent } from '#shared/protocol/turn.ts'

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const number = (value: unknown) => (typeof value === 'number' ? value : 0)

/** A content-block update inside `message_update`. Pi's `start`, `done` and `error` arrive as message events instead. */
function blockEvent(update: Record<string, unknown>): TurnEvent | null {
  const index = number(update.contentIndex)
  switch (update.type) {
    case 'text_start':
      return { kind: 'text-start', index }
    case 'text_delta':
      return { kind: 'text-delta', index, delta: text(update.delta) }
    case 'text_end':
      return { kind: 'text-end', index, text: text(update.content) }
    case 'thinking_start':
      return { kind: 'thinking-start', index }
    case 'thinking_end':
      return { kind: 'thinking-end', index }
    case 'toolcall_start':
      return { kind: 'tool-call', index }
    default:
      return null
  }
}

/**
 * One of Pi's session events as the UI gets it, or null for an event the UI has no use for.
 * Pi's events are listed in its `docs/json.md`. Whole messages, tool arguments and tool results stay in the host.
 */
export function turnEventOf(event: PiSessionEvent): TurnEvent | null {
  const message = (event.message ?? {}) as { role?: unknown; stopReason?: unknown; errorMessage?: unknown }
  switch (event.type) {
    case 'agent_start':
      return { kind: 'start' }
    case 'agent_end':
      return { kind: 'end' }
    case 'agent_settled':
      return { kind: 'settled', aborted: event.aborted === true }
    case 'message_start':
      return { kind: 'message-start', role: text(message.role) }
    case 'message_end':
      return {
        kind: 'message-end',
        role: text(message.role),
        ...(typeof message.stopReason === 'string' ? { stop: message.stopReason } : {}),
        ...(typeof message.errorMessage === 'string' ? { error: message.errorMessage.slice(0, 500) } : {}),
      }
    case 'message_update':
      return blockEvent((event.assistantMessageEvent ?? {}) as Record<string, unknown>)
    case 'tool_execution_start':
      return { kind: 'tool-start', id: text(event.toolCallId), name: text(event.toolName) }
    case 'tool_execution_end':
      return { kind: 'tool-end', id: text(event.toolCallId), name: text(event.toolName), failed: event.isError === true }
    case 'auto_retry_start':
      return { kind: 'retry-start', attempt: number(event.attempt), of: number(event.maxAttempts) }
    case 'auto_retry_end':
      return { kind: 'retry-end', ok: event.success === true }
    case 'compaction_start':
      return { kind: 'compaction-start', reason: text(event.reason) }
    case 'compaction_end':
      return {
        kind: 'compaction-end',
        reason: text(event.reason),
        outcome: event.aborted ? 'cancelled' : event.errorMessage ? 'failed' : 'completed',
      }
    default:
      return null
  }
}

/** Numbers the events in the order Pi emitted them, and remembers the reply being written for a UI that joins late. */
export class TurnRelay {
  private seq = 0
  /** Text blocks of the assistant message that is open, by content index. Null between messages. */
  private open: string[] | null = null

  accept(event: PiSessionEvent): TurnMessage | null {
    const turn = turnEventOf(event)
    if (!turn) return null

    if (turn.kind === 'message-start') this.open = turn.role === 'assistant' ? [] : null
    else if (turn.kind === 'message-end' || turn.kind === 'settled') this.open = null
    else if (this.open && turn.kind === 'text-start') this.open[turn.index] = ''
    else if (this.open && turn.kind === 'text-delta') this.open[turn.index] = (this.open[turn.index] ?? '') + turn.delta
    else if (this.open && turn.kind === 'text-end') this.open[turn.index] = turn.text

    this.seq += 1
    return { type: 'turn', seq: this.seq, event: turn }
  }

  /** What a UI that connects in the middle of a reply needs to show it so far. The numbering goes on from here. */
  catchUp(): TurnMessage[] {
    if (!this.open) return []

    const events: TurnEvent[] = [{ kind: 'message-start', role: 'assistant' }]
    this.open.forEach((block, index) => {
      if (block === undefined) return
      events.push({ kind: 'text-start', index }, { kind: 'text-delta', index, delta: block })
    })
    return events.map((event) => ({ type: 'turn', seq: this.seq, event }))
  }
}
