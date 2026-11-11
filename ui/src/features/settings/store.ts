import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppearanceRequest, BorderColors } from '#shared/protocol/appearance.ts'
import type { StoreApi } from 'zustand/vanilla'
import type { HostState } from '../../lib/host/state.ts'
import { AGENTS, BUDGET, OPACITY, migrateSettings, readablePalette, receiveAppearance, themeAsk, stepAgents, stepBudget, stepOpacity, type Palette, type ThemeAsk } from './rules.ts'

/** Lively plays movement even when the Mac asks for less. Still never moves. */
export type Movement = 'lively' | 'system' | 'still'

/** The face for reading text. Headings, labels and the wordmark stay in Space Grotesk. */
export type TypeFace = 'space-grotesk' | 'inter' | 'geist' | 'dm-sans' | 'figtree'

interface SettingsState extends BorderColors {
  movement: Movement
  typeFace: TypeFace
  /** hobkin's own settings. Sample values until the host supplies hobkin's (020-settings, S5). */
  agents: number
  dailyTokens: number
  /** Daily token usage when the host supplies it; null is unavailable, not zero. */
  usedToday: number | null
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
  request: ThemeAsk | null
  appearanceId: number
  appearanceHome: string | null
  ask: (text: string) => void
  receive: (appearance: AppearanceRequest) => void

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

/** Canonical receipts outrank the first-paint cache; an unchanged reconnect preserves the user's built-in choice. */
export function watchAppearance(host: Pick<StoreApi<HostState>, 'getState' | 'subscribe'>): () => void {
  let epoch: number | undefined
  const receive = () => {
    const source = host.getState()
    const appearance = source.appearance
    const state = useSettings.getState()
    if (!appearance) {
      if (source.home !== null && state.appearanceHome !== source.home) {
        useSettings.setState({
          appearanceHome: source.home,
          appearanceId: 0,
          palette: null,
          border: undefined,
          borderStrong: undefined,
          customTheme: false,
        })
        epoch = source.epoch
      }
      return
    }
    const baseline = state.appearanceHome !== source.home || (epoch !== source.epoch && appearance.id !== state.appearanceId) ? 0 : state.appearanceId
    const next = receiveAppearance({ ...state, appearanceId: baseline }, appearance, Date.now())
    if (next) useSettings.setState({ ...next, appearanceHome: source.home })
    if (next || appearance.id === state.appearanceId) epoch = source.epoch
  }
  const unsubscribe = host.subscribe(receive)
  receive()
  return unsubscribe
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      movement: 'system',
      typeFace: 'space-grotesk',
      agents: AGENTS.initial,
      dailyTokens: BUDGET.initial,
      usedToday: null,
      usageEvents: true,
      feedback: true,
      showGitHubInMenu: true,
      backgroundOpacity: OPACITY.initial,
      palette: null,
      customTheme: false,
      request: null,
      appearanceId: 0,
      appearanceHome: null,
      ask: (text) => set({ request: themeAsk(text, Date.now()) }),
      receive: (appearance) => {
        const next = receiveAppearance(get(), appearance, Date.now())
        if (next) set(next)
      },

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
      // Older saves keep their colors and opacity; version 3 adds request tracking.
      version: 3,
      migrate: (saved) => migrateSettings(saved),
      partialize: ({ movement, typeFace, agents, dailyTokens, usageEvents, feedback, showGitHubInMenu, backgroundOpacity, palette, border, borderStrong, customTheme, request, appearanceId, appearanceHome }) => ({
        movement,
        typeFace,
        agents,
        dailyTokens,
        usageEvents,
        feedback,
        showGitHubInMenu,
        backgroundOpacity,
        palette,
        border,
        borderStrong,
        customTheme,
        request,
        appearanceId,
        appearanceHome,
      }),
    },
  ),
)
