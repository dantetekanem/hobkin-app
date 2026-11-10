/**
 * Live events of the main turn, one for each event Pi emits that the client reads, in Pi's order.
 * Pi's own events carry the whole message so far on every update. These carry only what changed.
 */
export type TurnEvent =
  /** The agent started a run (`agent_start`). */
  | { kind: 'start' }
  /** That run ended (`agent_end`). Retries, steering and queued messages can still follow. */
  | { kind: 'end' }
  /** Nothing more follows by itself (`agent_settled`). */
  | { kind: 'settled'; aborted: boolean }
  | { kind: 'message-start'; role: string }
  /** `stop` is Pi's stop reason for an assistant message, and `error` its error text. */
  | { kind: 'message-end'; role: string; stop?: string; error?: string }
  | { kind: 'text-start'; index: number }
  | { kind: 'text-delta'; index: number; delta: string }
  /** The block's full text, which replaces what the deltas built. */
  | { kind: 'text-end'; index: number; text: string }
  | { kind: 'thinking-start'; index: number }
  | { kind: 'thinking-end'; index: number }
  /** The model is writing a tool call. */
  | { kind: 'tool-call'; index: number }
  | { kind: 'tool-start'; id: string; name: string }
  | { kind: 'tool-end'; id: string; name: string; failed: boolean }
  | { kind: 'retry-start'; attempt: number; of: number }
  | { kind: 'retry-end'; ok: boolean }
  | { kind: 'compaction-start'; reason: string }
  | { kind: 'compaction-end'; reason: string; outcome: 'completed' | 'cancelled' | 'failed' }

export type TurnEventKind = TurnEvent['kind']
