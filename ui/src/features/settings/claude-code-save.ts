import { changeClaudeCode, type ClaudeCodeChange, type ClaudeCodeState } from '#shared/protocol/claude-code.ts'

/** How long the tile waits for the next change before it saves what it has. */
export const SAVE_QUIET_MS = 400

interface Saver {
  /** The settings now shown, or null before the host has answered. */
  current: () => ClaudeCodeState | null
  /** Shows these settings at once. */
  show: (state: ClaudeCodeState) => void
  /** Says why the last save failed, or null when a new one starts. */
  problem: (reason: string | null) => void
  apply: (change: ClaudeCodeChange) => Promise<ClaudeCodeState>
  wait?: number
  later?: (run: () => void, ms: number) => unknown
  cancel?: (timer: unknown) => void
}

const merged = (a: ClaudeCodeChange, b: ClaudeCodeChange): ClaudeCodeChange => ({
  ...a,
  ...b,
  ...(a.kinds || b.kinds ? { kinds: { ...a.kinds, ...b.kinds } } : {}),
})

/**
 * A change shows at once. Changes in quick succession merge and only the merged change is sent, after a short quiet
 * time, so a value the user only passed through is never saved. Saves never overlap. A failed save puts back the last
 * saved settings.
 */
export function createClaudeCodeSaver(saver: Saver) {
  const { wait = SAVE_QUIET_MS, later = (run, ms) => setTimeout(run, ms), cancel = (timer) => clearTimeout(timer as never) } = saver
  let pending: ClaudeCodeChange | null = null
  let saved: ClaudeCodeState | null = null
  let timer: unknown = null
  let sending = false

  const flush = async () => {
    timer = null
    if (sending || !pending) return
    const change = pending
    pending = null
    sending = true
    try {
      saved = await saver.apply(change)
      saver.show(pending ? { ...saved, settings: changeClaudeCode(saved.settings, pending) } : saved)
    } catch (error) {
      pending = null
      if (timer !== null) cancel(timer)
      timer = null
      saver.show(saved!)
      saver.problem(error instanceof Error ? error.message : String(error))
    } finally {
      sending = false
    }
    if (pending && timer === null) void flush()
  }

  return {
    change(change: ClaudeCodeChange) {
      const now = saver.current()
      if (!now) return
      if (!pending && !sending) saved = now
      saver.problem(null)
      pending = pending ? merged(pending, change) : change
      saver.show({ ...now, settings: changeClaudeCode(now.settings, change) })
      if (timer !== null) cancel(timer)
      timer = later(() => void flush(), wait)
    },
  }
}
