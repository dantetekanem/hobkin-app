import { create } from 'zustand'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
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
}

export type AgentSendResult = { sent: true; local?: boolean } | { sent: false; why: string; uncertain?: boolean }

interface AgentThreads {
  /** What the user has said to each agent, by agent id. */
  notes: Record<string, AgentNote[]>
  say: (agentId: string, text: string) => void
  send: (agentId: string, text: string, deliver: (noteId: string) => Promise<AgentSendResult>, images?: readonly Attachment[]) => Promise<AgentSendResult>
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
  send: async (agentId, text, deliver, images) => {
    const note: AgentNote = { id: crypto.randomUUID(), text, at: Date.now(), delivery: 'sending', ...(images?.length ? { images } : {}) }
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

// Receipt handling outlives the open canvas; hot updates release only their own listener.
const unsubscribe = hostStore.subscribe(({ snapshot }) => useAgentThreads.getState().sync(snapshot))
import.meta.hot?.dispose(unsubscribe)
