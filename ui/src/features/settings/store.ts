import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppearanceRequest, Background, BorderColors, BuiltInTheme } from '#shared/protocol/appearance.ts'
import type { StoreApi } from 'zustand/vanilla'
import type { HostState } from '../../lib/host/state.ts'
import { DEFAULT_PET, petOr, type PetChoice } from '../../avatar/pets.ts'
import { clampAgents } from '../work/agents-at-once.ts'
import { AGENTS, BUDGET, OPACITY, OPEN_BY_DEFAULT, adjustedPalette, migrateSettings, receiveAppearance, stepBudget, stepOpacity, themeRequestText, type BlockKind, type Palette } from './rules.ts'

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
  /**
   * hobkin's little sounds as it talks and hops, and its chime for a notification (features/sound). Off until the user
   * turns it on. Settings saved before this was kept load with it off, as the store fills in what a saved state lacks.
   */
  sound: boolean
  typeFace: TypeFace
  /** The pet hobkin is drawn as (spec 047). Settings saved before the pets load with Ears, as the store fills in what a saved state lacks. */
  pet: PetChoice
  /** hobkin's own settings. Sample values until the host supplies hobkin's (020-settings, S5). */
  agents: number
  dailyTokens: number
  usageEvents: boolean
  feedback: boolean
  /** GitHub sits in the screen menu. The switch is in GitHub's detail in Integrations (024-github). */
  showGitHubInMenu: boolean
  /** How much of the backgrounds and cards shows, 0.1 to 1. Text, icons and the focus ring stay solid (app/theme.ts). */
  backgroundOpacity: number
  /**
   * Which kinds of an agent's tool blocks are open when they arrive (agent-activity/blocks.ts). Settings saved before
   * this was kept load with the default, as the store fills in what a saved state lacks.
   */
  openByDefault: Record<BlockKind, boolean>
  /** The custom theme's colors. Kept while a built-in theme is chosen, so choosing Custom again brings them back. */
  palette: Palette | null
  /** The custom theme's backdrop behind the window, or null for the flat palette background (app/theme.ts). */
  background: Background | null
  /** What the active custom theme is called (e.g. "Grand Line Sunshine"), or null for an unnamed one. */
  themeName: string | null
  /** The custom theme is the one showing. `hobkin-theme` keeps the light or dark under it for the first paint. */
  customTheme: boolean
  appearanceId: number
  appearanceHome: string | null
  /** A built-in theme hobkin asked for, until the theme code has shown it. Not kept across reloads. */
  requestedTheme: BuiltInTheme | null
  /** A Custom request is on its way to main hobkin. */
  themeSending: boolean
  /** What happened to the last Custom request: sent, or why not. Not kept across reloads. */
  themeNote: string | null
  /** Asks main hobkin to build a theme, as a chat message the user sent, leaving the composer's draft alone. True once hobkin took it. */
  ask: (text: string, chat: MainChat, host: { getState: () => Pick<HostState, 'link'> }) => Promise<boolean>
  receive: (appearance: AppearanceRequest) => void

  setMovement: (movement: Movement) => void
  setSound: (on: boolean) => void
  setTypeFace: (typeFace: TypeFace) => void
  setPet: (pet: PetChoice) => void
  /** The number the sample agents follow with no host, and the one kept for when there is none. */
  setAgents: (agents: number) => void
  setDailyTokens: (tokens: number) => void
  changeDailyTokens: (delta: -1 | 1) => void
  setUsageEvents: (on: boolean) => void
  setFeedback: (on: boolean) => void
  setShowGitHubInMenu: (on: boolean) => void
  setBackgroundOpacity: (opacity: number) => void
  changeBackgroundOpacity: (delta: -1 | 1) => void
  setOpenByDefault: (kind: BlockKind, open: boolean) => void
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
          background: null,
          themeName: null,
          border: undefined,
          borderStrong: undefined,
          customTheme: false,
        })
        epoch = source.epoch
      }
      return
    }
    const baseline = state.appearanceHome !== source.home || (epoch !== source.epoch && appearance.id !== state.appearanceId) ? 0 : state.appearanceId
    const next = receiveAppearance({ appearanceId: baseline }, appearance)
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
      sound: false,
      typeFace: 'space-grotesk',
      pet: DEFAULT_PET,
      agents: AGENTS.initial,
      dailyTokens: BUDGET.initial,
      usageEvents: true,
      feedback: true,
      showGitHubInMenu: true,
      backgroundOpacity: OPACITY.initial,
      openByDefault: { ...OPEN_BY_DEFAULT },
      palette: null,
      background: null,
      themeName: null,
      customTheme: false,
      appearanceId: 0,
      appearanceHome: null,
      requestedTheme: null,
      themeSending: false,
      themeNote: null,
      ask: async (text, chat, host) => {
        if (get().themeSending || !text.trim()) return false
        if (host.getState().link !== 'open') {
          set({ themeNote: 'Not sent. Connect to hobkin first.' })
          return false
        }

        set({ themeSending: true, themeNote: null })
        const sent = await chat.getState().send(themeRequestText(text))

        set({
          themeSending: false,
          themeNote: sent ? 'Sent to hobkin.' : (chat.getState().problem ?? 'Not sent. Try again.'),
        })
        return sent
      },
      receive: (appearance) => {
        const next = receiveAppearance(get(), appearance)
        if (next) set(next)
      },

      setMovement: (movement) => set({ movement }),
      setSound: (sound) => set({ sound }),
      setTypeFace: (typeFace) => set({ typeFace }),
      setPet: (pet) => set({ pet: petOr(pet) }),
      setAgents: (agents) => set({ agents: clampAgents(agents, AGENTS.max) }),
      setDailyTokens: (tokens) => set({ dailyTokens: stepBudget(tokens, 0) }),
      changeDailyTokens: (delta) => set({ dailyTokens: stepBudget(get().dailyTokens, delta) }),
      setUsageEvents: (usageEvents) => set({ usageEvents }),
      setFeedback: (feedback) => set({ feedback }),
      setShowGitHubInMenu: (showGitHubInMenu) => set({ showGitHubInMenu }),
      setBackgroundOpacity: (opacity) => set({ backgroundOpacity: stepOpacity(opacity, 0) }),
      changeBackgroundOpacity: (delta) => set({ backgroundOpacity: stepOpacity(get().backgroundOpacity, delta) }),
      setOpenByDefault: (kind, open) => set({ openByDefault: { ...OPEN_BY_DEFAULT, ...get().openByDefault, [kind]: open } }),
      setPalette: (palette) => set({ palette: adjustedPalette(palette) ?? get().palette }),
      setCustomTheme: (on) => set({ customTheme: on && get().palette !== null }),
    }),
    {
      name: 'hobkin-client-settings',
      // Version 4 drops the tracked theme ask: Custom's request is a chat message to main hobkin.
      // Version 5 closes code changes: older saves kept the old default, open, as if it had been chosen.
      version: 5,
      migrate: (saved, from) => migrateSettings(saved, from),
      partialize: ({ movement, sound, typeFace, pet, agents, dailyTokens, usageEvents, feedback, showGitHubInMenu, backgroundOpacity, openByDefault, palette, background, themeName, border, borderStrong, customTheme, appearanceId, appearanceHome }) => ({
        movement,
        sound,
        typeFace,
        pet,
        agents,
        dailyTokens,
        usageEvents,
        feedback,
        showGitHubInMenu,
        backgroundOpacity,
        openByDefault,
        palette,
        background,
        themeName,
        border,
        borderStrong,
        customTheme,
        appearanceId,
        appearanceHome,
      }),
    },
  ),
)
