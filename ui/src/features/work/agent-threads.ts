import { create } from 'zustand'

export interface AgentNote {
  id: string
  text: string
  at: number
}

interface AgentThreads {
  /** What the user has said to each agent, by agent id. */
  notes: Record<string, AgentNote[]>
  say: (agentId: string, text: string) => void
}

/**
 * Messages the user sends to one agent. Kept in the window for now: the host will deliver them to the
 * running agent as steering, the way hobkin's `message_check` does (011-work).
 */
export const useAgentThreads = create<AgentThreads>()((set, get) => ({
  notes: {},
  say: (agentId, text) => {
    const note = { id: crypto.randomUUID(), text, at: Date.now() }
    set({ notes: { ...get().notes, [agentId]: [...(get().notes[agentId] ?? []), note] } })
  },
}))
