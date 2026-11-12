import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppearanceRequest, BorderColors } from '#shared/protocol/appearance.ts'
import type { StoreApi } from 'zustand/vanilla'
import type { HostState } from '../../lib/host/state.ts'
import { AGENTS, BUDGET, OPACITY, migrateSettings, readablePalette, receiveAppearance, stepAgents, stepBudget, stepOpacity, themeRequestText, type Palette } from './rules.ts'

/** Lively plays movement even when the Mac asks for less. Still never moves. */
export type Movement = 'lively' | 'system' | 'still'

/** The face for reading text. Headings, labels and the wordmark stay in Space Grotesk. */
export type TypeFace = 'space-grotesk' | 'inter' | 'geist' | 'dm-sans' | 'figtree'

/** Main hobkin's chat (chat-store.ts). Custom's request goes through it as a message the user sent. */
interface MainChat {
  getState: () => { send: (text: string) => Promise<boolean>; problem: string | null }
}

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
  appearanceId: number
  appearanceHome: string | null
  /** A Custom request is on its way to main hobkin. */
  themeSending: boolean
  /** What happened to the last Custom request: sent, or why not. Not kept across reloads. */
  themeNote: string | null
  /** Asks main hobkin to build a theme, as a chat message the user sent, leaving the composer's draft alone. True once hobkin took it. */
  ask: (text: string, chat: MainChat, host: { getState: () => Pick<HostState, 'link'> }) => Promise<boolean>
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
      themeBusy: false,
      themeProblem: null,
      ask: async (text, host) => {
        if (get().themeBusy) return false
        const ask = themeAsk(text, Date.now())
        if (!ask) {
          set({ themeProblem: 'Describe a theme in 1–4000 characters.' })
          return false
        }
        const source = host.getState()
        if (source.link !== 'open') {
          set({ themeProblem: 'Not sent. Connect to hobkin first.' })
          return false
        }
        const previous = get().request
        const pending: ThemeAsk = { ...ask, home: source.home }
        const current = () => host.getState().home === source.home && host.getState().epoch === source.epoch
        set({ request: pending, themeBusy: true, themeProblem: null })

        try {
          const operation = await host.customize(pending.text)
          if (get().request !== pending) return false
          if (!current()) {
            set({
              request: { ...pending, phase: 'unknown' },
              themeProblem: 'The host changed before acknowledgement. The outcome is unknown.',
            })
            return false
          }
          set({ request: { ...pending, phase: 'known', operation } })
          return true
        } catch (error) {
          if (get().request === pending) {
            set({
              request: refused(error) ? previous : { ...pending, phase: 'unknown' },
              themeProblem: reason(error),
            })
          }
          return false
        } finally {
          set({ themeBusy: false })
        }
      },
      refreshTheme: async (host) => {
        const ask = get().request
        if (get().themeBusy || !ask?.operation) return
        const source = host.getState()
        if (source.link !== 'open' || source.home !== ask.home) {
          set({
            request: { ...ask, phase: 'unknown' },
            themeProblem: 'Connect to the same hobkin home to check this operation.',
          })
          return
        }
        set({ themeBusy: true, themeProblem: null })

        try {
          const operation = await host.status(ask.operation.id)
          if (get().request !== ask) return
          const current = host.getState()
          if (
            current.home !== source.home
            || current.epoch !== source.epoch
            || !operation
            || operation.id !== ask.operation.id
          ) {
            set({
              request: { ...ask, phase: 'unknown' },
              themeProblem: 'This operation receipt is unavailable. Its outcome is unknown.',
            })
            return
          }
          set({
            request: {
              ...ask,
              phase: 'known',
              operation: { ...operation, appearanceId: operation.appearanceId ?? ask.operation.appearanceId },
            },
          })
        } catch (error) {
          if (get().request === ask) {
            set({ request: { ...ask, phase: 'unknown' }, themeProblem: reason(error) })
          }
        } finally {
          set({ themeBusy: false })
        }
      },
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
      // Version 4 replaces chat attribution with acknowledged operation receipts.
      version: 4,
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
        request: request?.phase === 'pending' ? { ...request, phase: 'unknown' as const } : request,
        appearanceId,
        appearanceHome,
      }),
    },
  ),
)
