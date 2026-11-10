import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AGENTS, BUDGET, stepAgents, stepBudget } from './rules.ts'

/** Lively plays movement even when the Mac asks for less. Still never moves. */
export type Movement = 'lively' | 'system' | 'still'

/** The face for reading text. Headings, labels and the wordmark stay in Space Grotesk. */
export type TypeFace = 'space-grotesk' | 'inter' | 'geist' | 'dm-sans' | 'figtree'

interface SettingsState {
  movement: Movement
  typeFace: TypeFace
  /** hobkin's own settings. Sample values until the host supplies hobkin's (020-settings, S5). */
  agents: number
  dailyTokens: number
  usedToday: number
  usageEvents: boolean
  feedback: boolean
  /** GitHub sits in the screen menu. The switch is in GitHub's detail in Integrations (024-github). */
  showGitHubInMenu: boolean

  setMovement: (movement: Movement) => void
  setTypeFace: (typeFace: TypeFace) => void
  changeAgents: (delta: -1 | 1) => void
  setDailyTokens: (tokens: number) => void
  changeDailyTokens: (delta: -1 | 1) => void
  setUsageEvents: (on: boolean) => void
  setFeedback: (on: boolean) => void
  setShowGitHubInMenu: (on: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      movement: 'system',
      typeFace: 'space-grotesk',
      agents: AGENTS.initial,
      dailyTokens: BUDGET.initial,
      usedToday: 38_000_000,
      usageEvents: true,
      feedback: true,
      showGitHubInMenu: true,

      setMovement: (movement) => set({ movement }),
      setTypeFace: (typeFace) => set({ typeFace }),
      changeAgents: (delta) => set({ agents: stepAgents(get().agents, delta) }),
      setDailyTokens: (tokens) => set({ dailyTokens: stepBudget(tokens, 0) }),
      changeDailyTokens: (delta) => set({ dailyTokens: stepBudget(get().dailyTokens, delta) }),
      setUsageEvents: (usageEvents) => set({ usageEvents }),
      setFeedback: (feedback) => set({ feedback }),
      setShowGitHubInMenu: (showGitHubInMenu) => set({ showGitHubInMenu }),
    }),
    {
      name: 'hobkin-client-settings',
      version: 1,
      partialize: ({ movement, typeFace, agents, dailyTokens, usageEvents, feedback, showGitHubInMenu }) => ({
        movement,
        typeFace,
        agents,
        dailyTokens,
        usageEvents,
        feedback,
        showGitHubInMenu,
      }),
    },
  ),
)
