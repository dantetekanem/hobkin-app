import { create } from 'zustand'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import type { TakenBack } from '#shared/commands/registry.ts'
import type { Attachment } from '@/features/chat/draft.ts'
import { hostStore } from '../../lib/host/client.ts'

export interface AgentNote {
  id: string
  text: string
  at: number
  delivery?: 'sending' | 'waiting' | 'received' | 'refused' | 'unconfirmed' | 'local'
  receivedAt?: number
  why?: string
  /** The images that went with the words. The note keeps their previews. */
  images?: readonly Attachment[]
  /** Sent while the agent worked, it waits for its turn as this says. While it waits it shows above the box, not among the steps. */
  queue?: 'steer' | 'follow-up'
}

/** A note that waits for the agent's turn to read it: sent into a turn, and neither read nor refused yet. */
export const waitsForTurn = (note: AgentNote): boolean => note.queue !== undefined && (note.delivery === 'sending' || note.delivery === 'waiting')

/** `unsent`: what a turn the note interrupted never read, for the box. */
export type AgentSendResult = { sent: true; local?: boolean; unsent?: readonly TakenBack[] } | { sent: false; why: string; uncertain?: boolean }

interface AgentThreads {
  /** What the user has said to each agent, by agent id. */
  notes: Record<string, AgentNote[]>
  say: (agentId: string, text: string) => void
  send: (agentId: string, text: string, deliver: (noteId: string) => Promise<AgentSendResult>, images?: readonly Attachment[], queue?: AgentNote['queue']) => Promise<AgentSendResult>
  /** Notes the user took back into the box: they leave the page. */
  drop: (agentId: string, noteIds: readonly string[]) => void
  sync: (snapshot: WireSnapshot) => void
}

/**
 * Per-run messages survive canvas changes in this window, including pending commands and refusals.
 * A host acknowledgement means queued steering, never proof the agent consumed the words.
 */
export const useAgentThreads = create<AgentThreads>()((set, get) => ({
  notes: {},
  say: (agentId, text) => {
    const note = { id: crypto.randomUUID(), text, at: Date.now() }
    set({ notes: { ...get().notes, [agentId]: [...(get().notes[agentId] ?? []), note] } })
  },
  send: async (agentId, text, deliver, images, queue) => {
    const note: AgentNote = { id: crypto.randomUUID(), text, at: Date.now(), delivery: 'sending', ...(images?.length ? { images } : {}), ...(queue ? { queue } : {}) }
    set({ notes: { ...get().notes, [agentId]: [...(get().notes[agentId] ?? []), note] } })
    let result: AgentSendResult
    try {
      result = await deliver(note.id)
    } catch (error) {
      result = { sent: false, why: error instanceof Error ? error.message : String(error), uncertain: true }
    }
    const settled = result.sent
      ? { ...note, delivery: result.local ? 'local' as const : 'waiting' as const }
      : { ...note, delivery: result.uncertain ? 'unconfirmed' as const : 'refused' as const, why: result.why }
    set({ notes: { ...get().notes, [agentId]: (get().notes[agentId] ?? []).map((entry) => {
      if (entry.id !== note.id || entry.delivery === 'received' || (entry.delivery === 'unconfirmed' && result.sent && !result.local)) return entry
      return settled
    }) } })
    get().sync(hostStore.getState().snapshot)
    return get().notes[agentId]?.some((entry) => entry.id === note.id && entry.delivery === 'received') ? { sent: true } : result
  },
  drop: (agentId, noteIds) => {
    const notes = get().notes[agentId]
    if (!notes || !noteIds.length) return
    set({ notes: { ...get().notes, [agentId]: notes.filter((note) => !noteIds.includes(note.id)) } })
  },
  sync: (snapshot) => {
    let changed = false
    const notes = { ...get().notes }
    for (const [runId, entries] of Object.entries(notes)) {
      const ended = snapshot.runs?.some((run) => run.id === runId && run.state !== 'running')
      notes[runId] = entries.map((note) => {
        if (!note.delivery || note.delivery === 'local' || note.delivery === 'received') return note
        const receipt = snapshot.steeringReceipts?.[runId]?.find(({ noteId }) => noteId === note.id)
        if (receipt) {
          changed = true
          return { ...note, delivery: 'received', receivedAt: receipt.at, why: undefined }
        }
        if (ended && (note.delivery === 'sending' || note.delivery === 'waiting')) {
          changed = true
          return { ...note, delivery: 'unconfirmed', why: 'The run ended without a confirmed receipt.' }
        }
        return note
      })
    }
    if (changed) set({ notes })
  },
}))

/** The runs hobkin listed last. A state that does not say, such as a start-over before its snapshot is read, keeps them. */
let listed: WireSnapshot['runs'] = hostStore.getState().snapshot.runs

/** A run that was listed and is no longer takes the user's notes to it along. Notes to anything never listed stay. */
function forgetRunsThatLeft(runs: WireSnapshot['runs']): void {
  if (!Array.isArray(runs)) return
  const before = listed
  listed = runs
  if (!before) return

  const { notes } = useAgentThreads.getState()
  const isListed = (list: NonNullable<WireSnapshot['runs']>, runId: string) => list.some((run) => run.id === runId)
  const gone = Object.keys(notes).filter((runId) => isListed(before, runId) && !isListed(runs, runId))
  if (gone.length === 0) return
  const kept = Object.entries(notes).filter(([runId]) => !gone.includes(runId))
  useAgentThreads.setState({ notes: Object.fromEntries(kept) })
}

// Receipt handling outlives the open canvas; hot updates release only their own listener. A message that changes
// neither the runs nor the receipts has nothing new for the notes.
const unsubscribe = hostStore.subscribe(({ snapshot }, { snapshot: before }) => {
  if (snapshot.runs !== before.runs) forgetRunsThatLeft(snapshot.runs)
  if (snapshot.runs !== before.runs || snapshot.steeringReceipts !== before.steeringReceipts) useAgentThreads.getState().sync(snapshot)
})
import.meta.hot?.dispose(unsubscribe)
