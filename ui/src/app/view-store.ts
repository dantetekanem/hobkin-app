import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { closeOver, depth, ground, toggleIntegrationsOver, toggleSettingsOver, type Over } from './overlays.ts'
import { screenIndex, type ScreenId, type VeilSection } from './screens.ts'

/** Width of the chat, in pixels. */
export const CONVERSATION_WIDTH = { min: 360, initial: 460, max: 720 } as const

/** How the canvas moves to its next screen: along the menu (x) or along the agents list (y), and which way. */
export interface ScreenMotion {
  axis: 'x' | 'y'
  direction: 1 | -1
}

interface ViewState {
  screen: ScreenId
  screenMotion: ScreenMotion
  /** The list veiling the chat right now, if any. Not saved: the app opens on the conversation. */
  veil: VeilSection | null
  /** The row of the veil's list that Up and Down have reached. */
  veilActive: number
  conversationWidth: number
  /** Id of the review open on the canvas, if any. */
  openReview: string | null
  /** Id of the agent whose canvas is open, if any. */
  openAgent: string | null
  /** While the user walks the agents list, the screen to return to when they leave it. */
  previewReturn: ScreenId | null
  /** True while the user has stepped into an agent to talk to it: the canvas grows over the chat and gets its own input. */
  agentTalk: boolean
  /** While Settings or Integrations is open: the screen under both, which closing returns to. */
  settingsReturn: ScreenId | null
  /**
   * True while the canvas has the user's attention: the keyboard is in it, or it was just clicked.
   * A review takes almost the whole window while it does, and gives the room back when the user returns to the chat.
   */
  canvasEngaged: boolean

  openScreen: (screen: ScreenId) => void
  openVeil: (section: VeilSection) => void
  closeVeil: () => void
  /** Moves the veil's selection by one row within a list of `count` rows, or sets it. */
  moveVeil: (delta: 1 | -1, count: number) => void
  setVeilActive: (index: number) => void
  resizeConversation: (width: number) => void
  openReviewFor: (reviewId: string) => void
  closeReview: () => void
  /** Shows an agent's canvas while the agents list has the keyboard. Leaving the list undoes it. */
  previewAgent: (agentId: string, direction: 1 | -1) => void
  endAgentPreview: () => void
  /** Steps into an agent, to talk to it. Leaving steps back out to the agents list, with the canvas as it was. */
  enterAgentTalk: (agentId: string) => void
  leaveAgentTalk: () => void
  /** Opens an agent's canvas to stay. */
  openAgentCanvas: (agentId: string) => void
  closeAgentCanvas: () => void
  /** Opens Settings. In Settings it closes it, and in Integrations it steps back up to Settings. */
  toggleSettings: () => void
  /** Closes Settings and Integrations together, back to the screen under them. */
  closeSettings: () => void
  /** Opens Integrations, which always sits under Settings. In Integrations it steps back up to Settings. */
  toggleIntegrations: () => void
  /** Opens the GitHub page, which sits under Pages. */
  openGitHub: () => void
  /** Leaves the GitHub page for Pages, one step up. */
  closeGitHub: () => void
  engageCanvas: () => void
  disengageCanvas: () => void
}

/** One step of Settings or Integrations opening or being left, with the direction the canvas travels for it. */
function stepOver(state: ViewState, step: (over: Over) => Over): Partial<ViewState> {
  const before: Over = { screen: state.screen, settingsReturn: state.settingsReturn }
  const after = step(before)
  // Going deeper comes down over the canvas. Stepping back lifts away.
  return { ...after, previewReturn: null, agentTalk: false, screenMotion: { axis: 'y', direction: depth(after) > depth(before) ? -1 : 1 } }
}

/**
 * What the user is looking at. Kept in the browser's storage for now;
 * `014-continuity` moves it into the home so it follows the user's data.
 */
export const useView = create<ViewState>()(
  persist(
    (set, get) => ({
      // The first item of the menu.
      screen: 'reports',
      screenMotion: { axis: 'x', direction: 1 },
      veil: null,
      veilActive: 0,
      conversationWidth: CONVERSATION_WIDTH.initial,
      openReview: null,
      openAgent: null,
      previewReturn: null,
      agentTalk: false,
      settingsReturn: null,
      canvasEngaged: false,

      openScreen: (screen) => {
        const current = get().screen
        if (screen === current) return
        set({ screen, previewReturn: null, agentTalk: false, settingsReturn: null, screenMotion: { axis: 'x', direction: screenIndex(screen) > screenIndex(current) ? 1 : -1 } })
      },
      openVeil: (veil) => {
        // A new list starts at its first row.
        if (veil !== get().veil) set({ veil, veilActive: 0 })
      },
      closeVeil: () => set({ veil: null }),
      moveVeil: (delta, count) => set({ veilActive: Math.min(Math.max(0, count - 1), Math.max(0, get().veilActive + delta)) }),
      setVeilActive: (veilActive) => set({ veilActive }),
      resizeConversation: (width) =>
        set({ conversationWidth: Math.round(Math.min(CONVERSATION_WIDTH.max, Math.max(CONVERSATION_WIDTH.min, width))) }),
      openReviewFor: (openReview) => {
        set({ openReview })
        get().openScreen('review')
        // Opening a review is asking to look at it, so it takes the room at once.
        set({ canvasEngaged: true })
      },
      closeReview: () => {
        if (get().screen === 'review') get().openScreen('work')
        set({ openReview: null })
      },
      previewAgent: (agentId, direction) => {
        const { screen, previewReturn, openAgent } = get()
        if (screen === 'agent' && openAgent === agentId) return
        set({
          // Remember where the canvas was only on the way in, not while moving between agents.
          previewReturn: previewReturn ?? (screen === 'agent' ? null : screen),
          openAgent: agentId,
          screen: 'agent',
          // Agents are a vertical list under the input, so their canvases travel vertically too.
          screenMotion: { axis: 'y', direction },
        })
      },
      endAgentPreview: () => {
        const { previewReturn, agentTalk } = get()
        // Stepping into an agent takes the keyboard out of the list without ending the preview.
        if (previewReturn === null || agentTalk) return
        set({ screen: previewReturn, openAgent: null, previewReturn: null, screenMotion: { axis: 'y', direction: -1 } })
      },
      enterAgentTalk: (agentId) => {
        const { screen, openAgent, previewReturn } = get()
        const same = screen === 'agent' && openAgent === agentId
        set({
          openAgent: agentId,
          screen: 'agent',
          agentTalk: true,
          previewReturn: previewReturn ?? (screen === 'agent' ? null : screen),
          ...(same ? {} : { screenMotion: { axis: 'y', direction: 1 } }),
        })
      },
      leaveAgentTalk: () => set({ agentTalk: false }),
      openAgentCanvas: (agentId) => {
        const { screen, openAgent } = get()
        const same = screen === 'agent' && openAgent === agentId
        set({ openAgent: agentId, screen: 'agent', previewReturn: null, ...(same ? {} : { screenMotion: { axis: 'y', direction: 1 } }) })
      },
      closeAgentCanvas: () => {
        if (get().screen === 'agent') set({ screen: 'work', screenMotion: { axis: 'y', direction: -1 } })
        set({ openAgent: null, previewReturn: null, agentTalk: false })
      },
      // Settings and Integrations come down over whatever is showing, and lift away again when they are left.
      // The way back is in overlays.ts.
      toggleSettings: () => set(stepOver(get(), toggleSettingsOver)),
      toggleIntegrations: () => set(stepOver(get(), toggleIntegrationsOver)),
      closeSettings: () => {
        if (depth(get()) > 0) set(stepOver(get(), closeOver))
      },
      // Opened from anywhere (Pages, or the GitHub entry in Integrations), it comes down over the canvas,
      // and leaving it lifts it away onto Pages.
      openGitHub: () => {
        if (get().screen === 'github') return
        set({ screen: 'github', settingsReturn: null, previewReturn: null, agentTalk: false, screenMotion: { axis: 'y', direction: -1 } })
      },
      closeGitHub: () => {
        if (get().screen === 'github') set({ screen: 'pages', screenMotion: { axis: 'y', direction: 1 } })
      },
      engageCanvas: () => set({ canvasEngaged: true }),
      disengageCanvas: () => set({ canvasEngaged: false }),
    }),
    {
      name: 'hobkin-client-view',
      version: 4,
      // Earlier versions had a sidebar column, then a chat bar. Their saved layouts do not carry over.
      migrate: () => ({}),
      // Settings is not a place to reopen in: the app comes back on the screen that was under it.
      partialize: ({ screen, settingsReturn, conversationWidth, openAgent }) => {
        const under = ground({ screen, settingsReturn })
        // A review is not reopened either, so a review that cannot be drawn can never keep the app from starting.
        return { screen: under === 'review' ? 'work' : under, conversationWidth, openReview: null, openAgent }
      },
    },
  ),
)
