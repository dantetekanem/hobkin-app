import type { WireSnapshot } from '#shared/protocol/snapshot.ts'

/** What hobkin's turn is doing, in one word, or null when no turn is running. The words are hobkin's (`src/cli/doing.mjs`). */
export function doingNow(snapshot: WireSnapshot): string | null {
  if (snapshot.context?.compacting) return 'compacting'
  return snapshot.busy ? (snapshot.doing ?? 'thinking') : null
}

/** When the running turn started, in milliseconds, if hobkin's runs say. */
export function turnStartedAt(snapshot: WireSnapshot): number | null {
  const turn = snapshot.runs?.find((run) => run.kind === 'main' && run.state === 'running' && run.title === 'Conversation')
  const at = Date.parse(turn?.startedAt ?? '')
  return Number.isFinite(at) ? at : null
}

/** What a message the user sent can wait behind. Each ends by itself, and the message goes then. */
export type Holder = 'compacting' | 'turn'

/**
 * What holds a message the user sent at `sentAt` until hobkin takes it: hobkin compacting the conversation, or a turn that began before
 * the message. Null when nothing does and only the host's answer is on its way.
 */
export function heldBy(snapshot: WireSnapshot, sentAt: number): Holder | null {
  if (snapshot.context?.compacting) return 'compacting'

  const startedAt = turnStartedAt(snapshot)
  const turnBeganBefore = startedAt !== null && startedAt <= sentAt
  return snapshot.busy && turnBeganBefore ? 'turn' : null
}

/** `8s`, then `1m 05s`, as the terminal app counts a turn. */
export function elapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
