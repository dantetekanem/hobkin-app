import { create } from 'zustand'
import { runCommand } from '../../lib/host/client.ts'

/**
 * The Short reports switch (051-short-reports). hobkin keeps it in its config.json and, while it is on, writes a short
 * version of each new report on its fast tier. The tile reads it when it mounts and saves each click through the host.
 */

/** The line under the switch. */
export const SHORT_REPORTS_SAYS = 'A version you read in 30 seconds first, the full report under it.'

/** The tile's heading. Until hobkin answers it reads as off, which is how every home starts. */
export const shortReportsValue = (on: boolean | null): string => (on ? 'On' : 'Off')

interface ShortReportsState {
  /** hobkin's switch, or null until it has been read. */
  on: boolean | null
  saving: boolean
  /** Why the last read or save did not work, or null. */
  problem: string | null
  load: () => Promise<void>
  /** Moves the switch at once, and back when hobkin does not save it. */
  turn: (on: boolean) => Promise<void>
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Counts clicks, so a read that comes back after one does not undo it. */
let turns = 0

export const useShortReports = create<ShortReportsState>()((set, get) => ({
  on: null,
  saving: false,
  problem: null,
  load: async () => {
    const before = turns
    try {
      const { on } = await runCommand('short-reports.read')
      if (turns === before) set({ on, problem: null })
    } catch (error) {
      if (turns === before) set({ problem: reason(error) })
    }
  },
  turn: async (on) => {
    const turn = ++turns
    const before = get().on
    set({ on, saving: true, problem: null })
    try {
      const saved = await runCommand('short-reports.set', { on })
      if (turn === turns) set({ on: saved.on, saving: false })
    } catch (error) {
      if (turn === turns) set({ on: before, saving: false, problem: `Not saved: ${reason(error)}` })
    }
  },
}))
