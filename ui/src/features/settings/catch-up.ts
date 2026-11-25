import { create } from 'zustand'
import type { CatchUpState } from '#shared/protocol/reports.ts'
import { runCommand } from '../../lib/host/client.ts'

/**
 * When hobkin writes a reports catch-up (069-report-catch-up): daily at a time, and when unread reports pile up, each
 * with its own switch. hobkin keeps both in its home; the tile reads them when it mounts and saves each change through
 * the host.
 */

/** hobkin's defaults, which the tile shows with no host. */
export const SAMPLE_CATCH_UP: CatchUpState = { daily: '08:00', pileUp: 8, running: false, lastAt: null, uncovered: 0 }

/** The tile's heading: which triggers are on. */
export function catchUpValue({ daily, pileUp }: Pick<CatchUpState, 'daily' | 'pileUp'>): string {
  if (daily !== null && pileUp !== null) return `Daily at ${daily} and at ${pileUp} unread`
  if (daily !== null) return `Daily at ${daily}`
  if (pileUp !== null) return `At ${pileUp} unread`
  return 'Off'
}

/** A typed time as hobkin takes it, `HH:MM`, or null. A time field may send seconds too. */
export function parseDaily(text: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(text.trim())
  return match ? `${match[1]}:${match[2]}` : null
}

/** The most the registry lets the pile be. */
const MOST_PILE = 1000

/** A typed pile size as hobkin takes it, a whole number from 1, or null. */
export function parsePile(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const count = Number(trimmed)
  return count >= 1 && count <= MOST_PILE ? count : null
}

type Change = { daily?: string | null; pileUp?: number | null }

interface CatchUpSettingsState {
  /** hobkin's settings, or null until they have been read. */
  state: CatchUpState | null
  /** The value each trigger had last while it was on, so turning it on again brings that back. */
  kept: { daily: string; pileUp: number }
  /** Why the last read or save did not work, or null. */
  problem: string | null
  load: () => Promise<void>
  /** Moves the rows at once, and back when hobkin does not save the change. */
  change: (change: Change) => Promise<void>
  turnDaily: (on: boolean) => Promise<void>
  turnPile: (on: boolean) => Promise<void>
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Counts changes, so a read or a save that comes back after a newer change does not undo it. */
let changes = 0

/** The settings as given, and the kept values updated from each trigger that is on. */
function settled(state: CatchUpState, kept: CatchUpSettingsState['kept']) {
  return { state, kept: { daily: state.daily ?? kept.daily, pileUp: state.pileUp ?? kept.pileUp } }
}

export const useCatchUp = create<CatchUpSettingsState>()((set, get) => ({
  state: null,
  kept: { daily: SAMPLE_CATCH_UP.daily!, pileUp: SAMPLE_CATCH_UP.pileUp! },
  problem: null,
  load: async () => {
    const before = changes
    try {
      const state = await runCommand('reports.catchup.read')
      if (changes === before) set({ ...settled(state, get().kept), problem: null })
    } catch (error) {
      if (changes === before) set({ problem: reason(error) })
    }
  },
  change: async (change) => {
    const turn = ++changes
    const before = get().state
    if (before) set({ ...settled({ ...before, ...change }, get().kept), problem: null })
    try {
      const saved = await runCommand('reports.catchup.set', change)
      if (turn === changes) set(settled(saved, get().kept))
    } catch (error) {
      if (turn === changes) set({ state: before, problem: `Not saved: ${reason(error)}` })
    }
  },
  turnDaily: (on) => get().change({ daily: on ? get().kept.daily : null }),
  turnPile: (on) => get().change({ pileUp: on ? get().kept.pileUp : null }),
}))
