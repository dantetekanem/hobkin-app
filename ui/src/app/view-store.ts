import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { requestCanvasFocus } from './focus.ts'
import { closeOver, depth, ground, toggleIntegrationsOver, togglePageOver, toggleSettingsOver, type Over, type PageUnderSettings } from './overlays.ts'
import { screenIndex, type ScreenId, type VeilSection } from './screens.ts'
import type { Place } from '../features/main-agent/mind.ts'

/** Width of the chat, in pixels. */
export const CONVERSATION_WIDTH = { min: 360, initial: 460, max: 720 } as const
/** How much of the chat stays in view beside a review that has the user's attention, in pixels. */
export const REVIEW_KEEPS = 112
/** The gap between the chat and the right side (`Divider.tsx`, `w-2.5`), in pixels. */
export const DIVIDER_WIDTH = 10

/**
 * How far the canvas slides over the chat, in pixels. A review that has the user's attention takes almost the whole
 * window, and a durable hobkin's split takes all of it: its page lies where the chat was. Every other screen, an
 * agent's however it was opened, leaves the chat its room.
 */
export function canvasGrowth({ screen, canvasEngaged, conversationWidth, split = false }: Pick<ViewState, 'screen' | 'canvasEngaged' | 'conversationWidth'> & { split?: boolean }): number {
  if (split) return conversationWidth + DIVIDER_WIDTH
  return screen === 'review' && canvasEngaged ? Math.max(0, conversationWidth - REVIEW_KEEPS) : 0
}

/**
 * A durable hobkin's split (040-canvas-board): the right side grows over the chat by the chat and the divider, the
 * page takes that room, and the canvas keeps the right side's usual width beside it.
 */
export function splitSizes(windowWidth: number, conversationWidth: number): { grow: number; pageWidth: number; canvasWidth: number } {
  const pageWidth = Math.max(0, conversationWidth + DIVIDER_WIDTH)
  return { grow: pageWidth, pageWidth, canvasWidth: Math.max(0, windowWidth - pageWidth) }
}

/** How the canvas moves to its next screen: along the menu (x) or along the agents list (y), and which way. */
export interface ScreenMotion {
  axis: 'x' | 'y'
  direction: 1 | -1
}

type ReviewReturn = Pick<ViewState, 'screen' | 'settingsReturn' | 'githubReturn' | 'openAgent' | 'previewReturn'>

interface ViewState {
  screen: ScreenId
  screenMotion: ScreenMotion
  /** The list veiling the chat right now, if any. Not saved: the app opens on the conversation. */
  veil: VeilSection | null
  /** The row of the veil's list that Up and Down have reached. */
  veilActive: number
  /** The spotlight (Command+K) is open over the whole window. Not saved either. */
  spotlight: boolean
  conversationWidth: number
  /** Id of the review open on the canvas, if any. */
  openReview: string | null
  /** The screen and its return path before the review was explicitly entered. Not persisted. */
  reviewReturn: ReviewReturn | null
  /** Id of the agent whose canvas is open, if any. */
  openAgent: string | null
  /** While the user walks the agents list, the screen to return to when they leave it. */
  previewReturn: ScreenId | null
  /** The screen under an agent, kept when its preview becomes a canvas. */
  agentReturn: ScreenId | null
  /** While Settings or Integrations is open: the screen under both, which closing returns to. */
  settingsReturn: ScreenId | null
  /** While GitHub is open: the screen it was opened over. Closing a GitHub the menu leaves out returns there. */
  githubReturn: ScreenId | null
  /** Where leaving hobkin's mind goes back to. A reload keeps it (location.ts). */
  mindReturn: Place | null
  /** Where closing the main canvas goes back to: the place it was opened over. A reload keeps it (location.ts). */
  canvasReturn: Place | null
  /** The last revision of each canvas the user has seen in front, by owner. A newer one dots the canvas's pill. */
  canvasSeen: Record<string, number>
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
  /** Opens the spotlight. The veil gives way to it. */
  openSpotlight: () => void
  closeSpotlight: () => void
  resizeConversation: (width: number) => void
  openReviewFor: (reviewId: string) => void
  closeReview: () => void
  /** Shows an agent's canvas while the agents list has the keyboard. Leaving the list undoes it. */
  previewAgent: (agentId: string, direction: 1 | -1) => void
  endAgentPreview: () => void
  /** Opens an agent's canvas to stay. */
  openAgentCanvas: (agentId: string) => void
  closeAgentCanvas: () => void
  /** Opens Settings. In Settings it closes it, and in Integrations it steps back up to Settings. */
  toggleSettings: () => void
  /** Closes Settings and Integrations together, back to the screen under them. */
  closeSettings: () => void
  /** Opens Integrations, which always sits under Settings. In Integrations it steps back up to Settings. */
  toggleIntegrations: () => void
  /** Opens a page under Settings, such as Skills or Pi extensions. On that page it steps back up to Settings. */
  togglePage: (page: PageUnderSettings) => void
  /** Opens GitHub, from the menu, the spotlight or GitHub's entry in Integrations, whether or not the menu shows it. */
  openGitHub: () => void
  /** Leaves GitHub for the screen it was opened over. The menu offers it for a GitHub it leaves out, which is open only for now. */
  closeGitHub: () => void
  /** Takes the right side to the main canvas, coming in from the right, and keeps the place it came from. */
  openCanvasPlace: () => void
  /** Leaves the main canvas for the place it was opened over, exactly as it was. */
  closeCanvasPlace: () => void
  /** The revision of `owner`'s canvas the user has now seen. */
  seeCanvas: (owner: string, revision: number) => void
  engageCanvas: () => void
  disengageCanvas: () => void
}

/** The screen and its ways back, as a way back of its own. */
const placeOf = ({ screen, settingsReturn, githubReturn, openAgent, previewReturn }: Place): Place => ({ screen, settingsReturn, githubReturn, openAgent, previewReturn })

/** The screen under the canvas, for a canvas with no way back. */
const UNDER_CANVAS: Place = { screen: 'work', settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null }

/** One step of Settings or Integrations opening or being left, with the direction the canvas travels for it. */
function stepOver(state: ViewState, step: (over: Over) => Over): Partial<ViewState> {
  const before: Over = { screen: state.screen, settingsReturn: state.settingsReturn }
  const after = step(before)
  // Going deeper comes down over the canvas. Stepping back lifts away.
  return { ...after, previewReturn: null, screenMotion: { axis: 'y', direction: depth(after) > depth(before) ? -1 : 1 } }
}

/**
 * Where leaving GitHub goes back to: the screen showing when it opened, the one under Settings and Integrations, or
 * the one an agent's preview came from. Opened again from over itself, it keeps the way back it had.
 */
function backFromGitHub(state: ViewState): ScreenId | null {
  const back = state.screen === 'agent' ? (state.previewReturn ?? 'work') : ground(state)
  return back === 'github' ? state.githubReturn : back
}

/**
 * What a new launch of the app comes back to. Settings is not a place to reopen in: the app comes back on the screen that
 * was under it. Nor is the canvas: the app comes back on the place it was opened over (Command+R keeps it, location.ts).
 */
export function launchView({ screen, settingsReturn, canvasReturn, conversationWidth, openAgent, canvasSeen }: ViewState) {
  const onCanvas = ground({ screen, settingsReturn }) === 'canvas'
  const place = onCanvas ? (canvasReturn ?? UNDER_CANVAS) : { screen, settingsReturn, openAgent }
  const under = ground(place)
  // A review is not reopened either, so a review that cannot be drawn can never keep the app from starting.
  return {
    screen: under === 'review' || under === 'canvas' ? 'work' : under,
    conversationWidth,
    openReview: null,
    openAgent: place.openAgent,
    canvasSeen,
  }
}

/**
 * What the user is looking at. Kept in the browser's storage for now;
 * `014-continuity` moves it into the home so it follows the user's data.
 */
export const useView = create<ViewState>()(
  persist(
    (set, get) => ({
      // The first item of the menu.
      screen: 'home',
      screenMotion: { axis: 'x', direction: 1 },
      veil: null,
      veilActive: 0,
      spotlight: false,
      conversationWidth: CONVERSATION_WIDTH.initial,
      openReview: null,
      reviewReturn: null,
      openAgent: null,
      previewReturn: null,
      agentReturn: null,
      settingsReturn: null,
      githubReturn: null,
      mindReturn: null,
      canvasReturn: null,
      canvasSeen: {},
      canvasEngaged: false,

      openScreen: (screen) => {
        const current = get()
        if (screen === current.screen) return
        set({
          screen,
          ...(screen === 'review' ? { reviewReturn: ground(current) === 'review' ? current.reviewReturn : {
            screen: current.screen, settingsReturn: current.settingsReturn, githubReturn: current.githubReturn,
            openAgent: current.openAgent, previewReturn: current.previewReturn,
          } } : {}),
          previewReturn: null,
          settingsReturn: null,
          githubReturn: screen === 'github' ? backFromGitHub(current) : null,
          screenMotion: { axis: 'x', direction: screenIndex(screen) > screenIndex(current.screen) ? 1 : -1 },
        })
      },
      openVeil: (veil) => {
        // A new list starts at its first row.
        if (veil !== get().veil) set({ veil, veilActive: 0 })
      },
      closeVeil: () => set({ veil: null }),
      moveVeil: (delta, count) => set({ veilActive: Math.min(Math.max(0, count - 1), Math.max(0, get().veilActive + delta)) }),
      setVeilActive: (veilActive) => set({ veilActive }),
      openSpotlight: () => set({ spotlight: true, veil: null }),
      closeSpotlight: () => set({ spotlight: false }),
      resizeConversation: (width) =>
        set({ conversationWidth: Math.round(Math.min(CONVERSATION_WIDTH.max, Math.max(CONVERSATION_WIDTH.min, width))) }),
      openReviewFor: (openReview) => {
        set({ openReview })
        get().openScreen('review')
        // Opening a review is asking to look at it, so it takes the room at once.
        set({ canvasEngaged: true })
        requestCanvasFocus()
      },
      closeReview: () => {
        const { screen, reviewReturn } = get()
        if (screen === 'review') {
          get().openScreen(reviewReturn?.screen ?? 'work')
          if (reviewReturn) set(reviewReturn)
          requestCanvasFocus()
        }
        set({ openReview: null, reviewReturn: null })
      },
      previewAgent: (agentId, direction) => {
        const { screen, previewReturn, openAgent, agentReturn } = get()
        if (screen === 'agent' && openAgent === agentId) return
        set({
          // Remember where the canvas was only on the way in, not while moving between agents.
          previewReturn: previewReturn ?? (screen === 'agent' ? null : screen),
          agentReturn: screen === 'agent' ? agentReturn : screen,
          openAgent: agentId,
          screen: 'agent',
          // Agents are a vertical list under the input, so their canvases travel vertically too.
          screenMotion: { axis: 'y', direction },
        })
      },
      endAgentPreview: () => {
        const { previewReturn } = get()
        if (previewReturn === null) return
        set({ screen: previewReturn, openAgent: null, previewReturn: null, agentReturn: null, screenMotion: { axis: 'y', direction: -1 } })
      },
      openAgentCanvas: (agentId) => {
        const { screen, openAgent, previewReturn, agentReturn } = get()
        const same = screen === 'agent' && openAgent === agentId
        set({ openAgent: agentId, screen: 'agent', agentReturn: screen === 'agent' ? (agentReturn ?? previewReturn) : screen, previewReturn: null, ...(same ? {} : { screenMotion: { axis: 'y', direction: 1 } }) })
      },
      closeAgentCanvas: () => {
        const { screen, agentReturn, previewReturn } = get()
        if (screen !== 'agent') return
        set({ screen: agentReturn ?? previewReturn ?? 'work', openAgent: null, previewReturn: null, agentReturn: null, screenMotion: { axis: 'y', direction: -1 } })
      },
      // Settings and Integrations come down over whatever is showing, and lift away again when they are left.
      // The way back is in overlays.ts.
      toggleSettings: () => {
        set(stepOver(get(), toggleSettingsOver))
        if (get().screen === 'settings') requestCanvasFocus()
      },
      toggleIntegrations: () => {
        set(stepOver(get(), toggleIntegrationsOver))
        requestCanvasFocus()
      },
      togglePage: (page) => {
        set(stepOver(get(), (over) => togglePageOver(over, page)))
        requestCanvasFocus()
      },
      closeSettings: () => {
        if (depth(get()) > 0) set(stepOver(get(), closeOver))
      },
      // GitHub is a menu screen, so it travels in along the menu as the others do, from wherever it is opened.
      openGitHub: () => get().openScreen('github'),
      closeGitHub: () => {
        const { screen, githubReturn } = get()
        if (screen === 'github') get().openScreen(githubReturn ?? 'work')
      },
      // The canvas is a place to the right of everything: it comes in from the right and goes back the same way.
      openCanvasPlace: () => {
        const view = get()
        if (view.screen === 'canvas') return
        // Settings, or a page under it, opened over the canvas gives the canvas back with the way back it had.
        const back = ground(view) === 'canvas' && view.canvasReturn ? view.canvasReturn : placeOf(view)
        set({ screen: 'canvas', canvasReturn: back, settingsReturn: null, previewReturn: null, screenMotion: { axis: 'x', direction: 1 } })
      },
      closeCanvasPlace: () => {
        const { screen, canvasReturn } = get()
        if (screen !== 'canvas') return
        set({ ...(canvasReturn ?? UNDER_CANVAS), canvasReturn: null, screenMotion: { axis: 'x', direction: -1 } })
      },
      seeCanvas: (owner, revision) => {
        const { canvasSeen } = get()
        if (canvasSeen[owner] !== revision) set({ canvasSeen: { ...canvasSeen, [owner]: revision } })
      },
      engageCanvas: () => set({ canvasEngaged: true }),
      disengageCanvas: () => set({ canvasEngaged: false }),
    }),
    {
      name: 'hobkin-client-view',
      version: 5,
      // Earlier versions had a sidebar column, then a chat bar: their saved layouts do not carry over. Version 4 could
      // reopen on Pages, which is gone. GitHub, the page that lived under it, takes its place.
      migrate: (saved, version) => {
        if (version !== 4 || typeof saved !== 'object' || saved === null) return {}
        const view = saved as { screen?: unknown }
        return view.screen === 'pages' ? { ...view, screen: 'github' } : view
      },
      partialize: launchView,
    },
  ),
)
