import { useEffect } from 'react'
import { create } from 'zustand'
import type { ClaudeCodeChange, ClaudeCodeState } from '#shared/protocol/claude-code.ts'
import type { ClaudeTiersChange } from '#shared/tiers/claude-code.ts'
import { runCommand } from '@/lib/host/client.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { createClaudeCodeSaver } from './claude-code-save.ts'

interface ClaudeCodeStore {
  state: ClaudeCodeState | null
  /** Why the first look failed, shown while there is no state. */
  readProblem: string | null
  /** Why the last save failed. */
  saveProblem: string | null
}

/** What the host last said about Claude Code. Both Settings tiles read it, so Subscriptions follows a change made in the Claude Code tile. */
export const useClaudeCode = create<ClaudeCodeStore>(() => ({ state: null, readProblem: null, saveProblem: null }))

// Each look runs `claude` twice, so the two tiles share one. Every change to the state bumps the count, so a look begun before it cannot undo it.
let reading: Promise<void> | null = null
let changes = 0

function read(): Promise<void> {
  const before = changes
  reading ??= runCommand('claude-code.read')
    .then(
      (state) => {
        if (changes === before) useClaudeCode.setState({ state, readProblem: null })
      },
      (error) => {
        useClaudeCode.setState({ readProblem: error instanceof Error ? error.message : String(error) })
      },
    )
    .finally(() => {
      reading = null
    })
  return reading
}

/** Claude Code's state once a host is connected, read when a tile that shows it appears. */
export function useReadClaudeCode(): ClaudeCodeState | null {
  const hasHost = useHasHost()
  const state = useClaudeCode((store) => store.state)
  useEffect(() => {
    if (hasHost) void read()
  }, [hasHost])
  return hasHost ? state : null
}

const saver = createClaudeCodeSaver({
  current: () => useClaudeCode.getState().state,
  show: (state) => {
    changes += 1
    useClaudeCode.setState({ state })
  },
  problem: (saveProblem) => useClaudeCode.setState({ saveProblem }),
  apply: (change) => runCommand('claude-code.apply', change),
})

/** Shows a change at once and saves it after a short quiet time, merged with the changes made meanwhile. */
export function saveClaudeCode(change: ClaudeCodeChange): void {
  saver.change(change)
}

/**
 * Saves the Models lightbox's tiers on Claude Code at once, when the user applies, and shows what the host kept.
 * Rejects with the host's reason, so the lightbox can say it and stay open.
 */
export async function applyClaudeTiers(tiers: ClaudeTiersChange): Promise<void> {
  const state = await runCommand('claude-code.apply', { tiers })
  changes += 1
  useClaudeCode.setState({ state })
}
