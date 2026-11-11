import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AGENTS, BUDGET, OPACITY, migrateSettings, readablePalette, stepAgents, stepBudget, stepOpacity, type Palette } from './rules.ts'

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
  /** How much of the backgrounds and cards shows, 0.1 to 1. Text, icons and the focus ring stay solid (app/theme.ts). */
  backgroundOpacity: number
  /** The custom theme's colors. Kept while a built-in theme is chosen, so choosing Custom again brings them back. */
  palette: Palette | null
  /** The custom theme is the one showing. `hobkin-theme` keeps the light or dark under it for the first paint. */
  customTheme: boolean

  setMovement: (movement: Movement) => void
  setTypeFace: (typeFace: TypeFace) => void
  changeAgents: (delta: -1 | 1) => void
  setDailyTokens: (tokens: number) => void
  changeDailyTokens: (delta: -1 | 1) => void
  setUsageEvents: (on: boolean) => void
  setFeedback: (on: boolean) => void
  setShowGitHubInMenu: (on: boolean) => void
  setBackgroundOpacity: (opacity: number) => void
  changeBackgroundOpacity: (delta: -1 | 1) => void
  /** Refuses a palette whose text would not read, and keeps the last one that does. */
  setPalette: (palette: Palette) => void
  setCustomTheme: (on: boolean) => void
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
      backgroundOpacity: OPACITY.initial,
      palette: null,
      customTheme: false,

      setMovement: (movement) => set({ movement }),
      setTypeFace: (typeFace) => set({ typeFace }),
      changeAgents: (delta) => set({ agents: stepAgents(get().agents, delta) }),
      setDailyTokens: (tokens) => set({ dailyTokens: stepBudget(tokens, 0) }),
      changeDailyTokens: (delta) => set({ dailyTokens: stepBudget(get().dailyTokens, delta) }),
      setUsageEvents: (usageEvents) => set({ usageEvents }),
      setFeedback: (feedback) => set({ feedback }),
      setShowGitHubInMenu: (showGitHubInMenu) => set({ showGitHubInMenu }),
      setBackgroundOpacity: (opacity) => set({ backgroundOpacity: stepOpacity(opacity, 0) }),
      changeBackgroundOpacity: (delta) => set({ backgroundOpacity: stepOpacity(get().backgroundOpacity, delta) }),
      setPalette: (palette) => set({ palette: readablePalette(palette) ?? get().palette }),
      setCustomTheme: (on) => set({ customTheme: on && get().palette !== null }),
    }),
    {
      name: 'hobkin-client-settings',
      // Version 2 added background opacity and the custom theme. Without `migrate`, a version 1 save would be thrown away.
      version: 2,
      migrate: (saved) => migrateSettings(saved) as unknown as SettingsState,
      partialize: ({ movement, typeFace, agents, dailyTokens, usageEvents, feedback, showGitHubInMenu, backgroundOpacity, palette, customTheme }) => ({
        movement,
        typeFace,
        agents,
        dailyTokens,
        usageEvents,
        feedback,
        showGitHubInMenu,
        backgroundOpacity,
        palette,
        customTheme,
      }),
    },
  ),
)
