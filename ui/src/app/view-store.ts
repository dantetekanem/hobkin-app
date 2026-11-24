import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { requestCanvasFocus } from './focus.ts'
import { arrive, readKeep } from './kept-place.ts'
import { closeOver, depth, ground, isUnderSettings, toggleIntegrationsOver, togglePageOver, toggleSettingsOver, type Over, type PageUnderSettings } from './overlays.ts'
import { isPartScreen } from '../integration/screens.ts'
import { screenIndex, type ScreenId, type VeilSection } from './screens.ts'
import { MOST_PLACES, samePlace, shownTrail, stopOf, whereOf, type Stop } from './trail.ts'
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
export function canvasGrowth({
  screen,
  canvasEngaged,
  conversationWidth,
  trail = [],
  split = false,
}: Pick<ViewState, 'screen' | 'canvasEngaged' | 'conversationWidth'> & { trail?: readonly Stop[]; split?: boolean }): number {
  if (split) return conversationWidth + DIVIDER_WIDTH
  // A TLA+ run opened from a review is part of reading it, so it keeps the review's room.
  const reviewing = screen === 'review' || (screen === 'proof' && trail.at(-1)?.screen === 'review')
  return reviewing && canvasEngaged ? Math.max(0, conversationWidth - REVIEW_KEEPS) : 0
}

/**
 * Whether the canvas covers the chat: it has grown over the whole chat column and settled there, and the keyboard is
 * not in the chat. A covered chat holds still and drops the blur over it (ChatDim.tsx). A review leaves a strip of the
 * chat in view, so that chat keeps both.
 */
export function covered({ growth, conversationWidth, settled, chatFocused }: {
  /** How far the canvas has grown over the chat, in pixels (canvasGrowth). */
  growth: number
  conversationWidth: number
  /** The canvas has finished growing to `growth`. */
  settled: boolean
  /** The keyboard is in the chat. */
  chatFocused: boolean
}): boolean {
  return settled && !chatFocused && growth >= conversationWidth
}

/**
 * A durable hobkin's split (040-canvas-board): the right side grows over the chat by the chat and the divider, the
 * page takes that room, and the canvas keeps the right side's usual width beside it.
 */
export function splitSizes(windowWidth: number, conversationWidth: number): { grow: number; pageWidth: number; canvasWidth: number } {
  const pageWidth = Math.max(0, conversationWidth + DIVIDER_WIDTH)
  return { grow: pageWidth, pageWidth, canvasWidth: Math.max(0, windowWidth - pageWidth) }
}

/**
 * What a draw does to a durable hobkin's page inset (where it was last sent against where it should be: the sketch's
 * width while its split shows, nothing otherwise). In place, or on its way, or a page leaving: leave it. The split
 * forming or undoing on the page travels on the split's spring; arriving, a resize, Still or a missed split jump.
 */
export function pageInsetMove(now: { onPage: boolean; wasOnPage: boolean; split: boolean; wasSplit: boolean; sent: number; canvasWidth: number; still: boolean }): 'leave' | 'jump' | 'travel' {
  if (!now.onPage) return 'leave'
  if (now.sent === (now.split ? now.canvasWidth : 0)) return 'leave'
  return now.wasOnPage && now.wasSplit !== now.split && !now.still ? 'travel' : 'jump'
}

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
  /** The spotlight (Command+K) is open over the whole window. Not saved either. */
  spotlight: boolean
  conversationWidth: number
  /** Id of the review open on the canvas, if any. */
  openReview: string | null
  /**
   * The trail (053): the places before this one, oldest first, each with what its page kept of itself. Opening a page
   * from a page puts the place left here, a way back takes it off, and the menu starts a new one. At most five, so with
   * the page itself the trail never holds more than six. A reload keeps it (location.ts); a new launch starts without.
   */
  trail: Stop[]
  /** The project its page shows, by slug (053). */
  project: string | null
  /** Id of the agent whose canvas is open, if any. */
  openAgent: string | null
  /** While the user walks the agents list, the screen to return to when they leave it. */
  previewReturn: ScreenId | null
  /** While the user walks the agents list from an agent's window: that agent, which leaving the list goes back to. */
  previewFrom: string | null
  /** While Settings or Integrations is open: the screen under both, which closing returns to. */
  settingsReturn: ScreenId | null
  /** While an integration's screen is open: the screen it was opened over. Closing one the menu leaves out returns there. */
  screenReturn: ScreenId | null
  /** Where leaving hobkin's mind goes back to. A reload keeps it (location.ts). */
  mindReturn: Place | null
  /** Where closing the main canvas goes back to: the place it was opened over. A reload keeps it (location.ts). */
  canvasReturn: Place | null
  /** The proof run its page shows, by id (050-tla-proofs). Null shows the newest. */
  openProof: string | null
  /** The last revision of each canvas the user has seen in front, by owner. A newer one dots the canvas's pill. */
  canvasSeen: Record<string, number>
  /**
   * True while the canvas has the user's attention: the keyboard is in it, or it was just clicked.
   * A review takes almost the whole window while it does, and gives the room back when the user returns to the chat.
   */
  canvasEngaged: boolean

  /** Opens a screen from a page, a link or a key: the place left goes on the trail, or the trail goes back to the screen when it is on it. */
  openScreen: (screen: ScreenId) => void
  /** Opens a screen from the menu, Command with a number or the spotlight: a new trail starts there. */
  openMenuScreen: (screen: ScreenId) => void
  /** Opens a project's page by its slug, a page of Work's own. */
  openProject: (slug: string) => void
  /** Goes back one place along the trail, and the page there gets what it kept. With none, to Work. */
  back: () => void
  /** Goes back to the place at `index` of the trail as it shows (`shownTrail`). The page itself, the last, does nothing. */
  backTo: (index: number) => void
  /** Escape on a page open only for now: back one place, by each page's own way back (Settings steps up, a review closes). */
  leave: () => void
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
  /** Opens an integration's screen, from the menu, the spotlight or its card in Integrations, whether or not the menu shows it. */
  openPartScreen: (screen: ScreenId) => void
  /** Leaves an integration's screen for the screen it was opened over. The menu offers it for one it leaves out, which is open only for now. */
  closePartScreen: () => void
  /** Takes the right side to the main canvas, coming in from the right, and keeps the place it came from. */
  openCanvasPlace: () => void
  /** Leaves the main canvas for the place it was opened over, exactly as it was. */
  closeCanvasPlace: () => void
  /** Opens a proof run's page, coming in from the right, and keeps the place it came from. From over itself it keeps the way back it had. */
  openProofRun: (id: string) => void
  /** Leaves a proof run's page for the place it was opened from. */
  closeProof: () => void
  /** The revision of `owner`'s canvas the user has now seen. */
  seeCanvas: (owner: string, revision: number) => void
  engageCanvas: () => void
  disengageCanvas: () => void
}

/** The screen and its ways back, as a way back of its own. */
const placeOf = ({ screen, settingsReturn, screenReturn, openAgent, previewReturn }: Place): Place => ({ screen, settingsReturn, screenReturn, openAgent, previewReturn })

/** The screen under the canvas, for a canvas with no way back. */
const UNDER_CANVAS: Place = { screen: 'work', settingsReturn: null, screenReturn: null, openAgent: null, previewReturn: null }

/**
 * How a move treats the trail:
 * - `go`: a page opened from a page. The place left goes on the trail, or the trail goes back to the new place when it
 *   is on it already.
 * - `push`: walking the agents list. The place left always goes on, so leaving the list goes back to it.
 * - `stay`: a page that replaces itself, one agent for another or a run for the next. The trail stays.
 * - `back`: a way back. The trail goes back to the place, and its page gets what it kept.
 * - `fresh`: the menu, Command with a number, the spotlight. A new trail starts.
 */
type How = 'go' | 'push' | 'stay' | 'back' | 'fresh'

/** The places a move leaves: the page with what it keeps, and Settings before a page under it opened straight away. */
function leaving(view: ViewState, after: ViewState): Stop[] {
  const keep = readKeep(view.screen)
  const left: Stop[] = [{ ...stopOf(view), ...(keep ? { keep } : {}) }]
  if (depth(view) === 0 && depth(after) === 2) left.push({ screen: 'settings', ...(after.settingsReturn ? { settingsReturn: after.settingsReturn } : {}) })
  return left
}

/** A move, with the trail it leaves. */
function moved(view: ViewState, next: Partial<ViewState>, how: How): Partial<ViewState> {
  const after = { ...view, ...next }
  const to = stopOf(after)
  if (how === 'fresh') {
    arrive(to.screen)
    return { ...next, trail: [] }
  }
  const at = how === 'push' ? -1 : view.trail.findIndex((stop) => samePlace(stop, to))
  if (at >= 0) {
    arrive(to.screen, how === 'back' ? view.trail[at]!.keep : undefined)
    return { ...next, trail: view.trail.slice(0, at) }
  }
  arrive(to.screen)
  if (how === 'back' || how === 'stay' || samePlace(stopOf(view), to)) return next
  return { ...next, trail: [...view.trail, ...leaving(view, after)].slice(-(MOST_PLACES - 1)) }
}

/** Back along the trail: it comes in from the left, lifts away from Settings and drops back from an agent. */
function backMotion(from: Over, to: Stop): ScreenMotion {
  const deeper = depth({ screen: to.screen, settingsReturn: null }) - depth(from)
  if (deeper !== 0) return { axis: 'y', direction: deeper > 0 ? -1 : 1 }
  return from.screen === 'agent' ? { axis: 'y', direction: -1 } : { axis: 'x', direction: -1 }
}

/** Back on `stop`, with `trail` before it. Its page gets what it kept. */
function restored(view: ViewState, stop: Stop, trail: Stop[]): Partial<ViewState> {
  arrive(stop.screen, stop.keep)
  return { ...whereOf(stop, view), trail, previewReturn: null, previewFrom: null, screenMotion: backMotion(view, stop) }
}

/** A screen opened along the menu: it comes in from the side of its item. */
function screenStep(current: ViewState, screen: ScreenId): Partial<ViewState> {
  return {
    screen,
    previewReturn: null,
    previewFrom: null,
    settingsReturn: null,
    screenReturn: isPartScreen(screen) ? backFromPartScreen(current) : null,
    screenMotion: { axis: 'x', direction: screenIndex(screen) > screenIndex(current.screen) ? 1 : -1 },
  }
}

/**
 * One step of Settings or Integrations opening or being left, with the direction the canvas travels for it. Leaving
 * them is a way back to the screen under them; going in, or from one of their pages to another, leaves a place.
 */
function stepOver(state: ViewState, step: (over: Over) => Over): Partial<ViewState> {
  const before: Over = { screen: state.screen, settingsReturn: state.settingsReturn }
  const after = step(before)
  // Going deeper comes down over the canvas. Stepping back lifts away.
  const next = { ...after, previewReturn: null, previewFrom: null, screenMotion: { axis: 'y', direction: depth(after) > depth(before) ? -1 : 1 } } as const
  return moved(state, next, depth(after) === 0 ? 'back' : 'go')
}

/**
 * Where leaving an integration's screen goes back to: the screen showing when it opened, the one under Settings and Integrations, or
 * the one an agent's preview came from. Opened again from over itself, it keeps the way back it had.
 */
function backFromPartScreen(state: ViewState): ScreenId | null {
  const back = state.screen === 'agent' ? (state.previewReturn ?? 'work') : ground(state)
  return isPartScreen(back) ? state.screenReturn : back
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
    // An integration's screen saved before its folder went is not one this window has.
    screen: under === 'review' || under === 'canvas' || under === 'proof' || under === 'project' || screenIndex(under) < 0 ? 'work' : under,
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
      trail: [],
      project: null,
      openAgent: null,
      previewReturn: null,
      previewFrom: null,
      settingsReturn: null,
      screenReturn: null,
      mindReturn: null,
      canvasReturn: null,
      openProof: null,
      canvasSeen: {},
      canvasEngaged: false,

      openScreen: (screen) => {
        const current = get()
        if (screen === current.screen) return
        // A review opened again over itself, as from Settings over it, replaces it.
        set(moved(current, screenStep(current, screen), screen === 'review' && ground(current) === 'review' ? 'stay' : 'go'))
      },
      openMenuScreen: (screen) => {
        const current = get()
        if (screen === current.screen && current.trail.length === 0) return
        set(moved(current, screen === current.screen ? {} : screenStep(current, screen), 'fresh'))
      },
      openProject: (project) => {
        const view = get()
        if (view.screen === 'project' && view.project === project) return
        set(moved(view, { ...screenStep(view, 'project'), project }, 'go'))
        requestCanvasFocus()
      },
      back: () => {
        const view = get()
        // With nothing on the trail, each page goes where it always went: an integration's screen open for now to the screen under it.
        const to = view.trail.at(-1) ?? { screen: isPartScreen(view.screen) ? (view.screenReturn ?? 'work') : 'work' }
        set(restored(view, to, view.trail.slice(0, -1)))
      },
      backTo: (index) => {
        const view = get()
        const shown = shownTrail(view)
        const to = shown[index]
        if (!to || index >= shown.length - 1) return
        set(restored(view, to, shown.slice(0, index)))
      },
      leave: () => {
        const view = get()
        if (view.screen === 'integrations') view.toggleIntegrations()
        else if (isUnderSettings(view.screen)) view.togglePage(view.screen)
        else if (view.screen === 'settings') view.closeSettings()
        else if (view.screen === 'review') view.closeReview()
        else view.back()
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
        const view = get()
        // A review opened over a review, or over the Settings opened over one, takes its place: closing it goes back to
        // where the first was opened from.
        if (view.screen === 'review') {
          set(moved(view, { openReview }, 'stay'))
        } else {
          const opened = { ...screenStep(view, 'review'), openReview }
          const overReview = ground(view) === 'review'
          const under = overReview ? view.trail.findLastIndex((stop) => stop.screen === 'review') : -1
          if (under >= 0) set({ ...moved(view, opened, 'stay'), trail: view.trail.slice(0, under) })
          else set(moved(view, opened, overReview ? 'stay' : 'go'))
        }
        // Opening a review is asking to look at it, so it takes the room at once.
        set({ canvasEngaged: true })
        requestCanvasFocus()
      },
      closeReview: () => {
        if (get().screen === 'review') {
          get().back()
          requestCanvasFocus()
        }
        set({ openReview: null })
      },
      previewAgent: (agentId, direction) => {
        const view = get()
        const { screen, previewReturn, previewFrom, openAgent } = view
        if (screen === 'agent' && openAgent === agentId) return
        const next = {
          // A walk that starts on an agent's window remembers that agent, and keeps it while the walk goes on.
          previewFrom: previewFrom ?? (screen === 'agent' && previewReturn === null ? openAgent : null),
          // Remember where the canvas was only on the way in, not while moving between agents.
          previewReturn: previewReturn ?? (screen === 'agent' ? null : screen),
          openAgent: agentId,
          screen: 'agent',
          // Agents are a vertical list under the input, so their canvases travel vertically too.
          screenMotion: { axis: 'y', direction },
        } as const
        // The screen the walk starts on goes on the trail, so leaving the list, or the agent, goes back to it.
        set(moved(view, next, screen === 'agent' ? 'stay' : 'push'))
      },
      endAgentPreview: () => {
        const view = get()
        if (view.previewFrom !== null) {
          set(moved(view, { openAgent: view.previewFrom, screen: 'agent', previewFrom: null, screenMotion: { axis: 'y', direction: -1 } }, 'stay'))
          return
        }
        if (view.previewReturn === null) return
        const last = view.trail.at(-1)
        const from = last?.screen === view.previewReturn ? last : null
        set(restored(view, from ?? { screen: view.previewReturn }, from ? view.trail.slice(0, -1) : view.trail))
      },
      openAgentCanvas: (agentId) => {
        const view = get()
        const same = view.screen === 'agent' && view.openAgent === agentId
        const next: Partial<ViewState> = {
          openAgent: agentId,
          screen: 'agent',
          previewReturn: null,
          previewFrom: null,
          ...(same ? {} : { screenMotion: { axis: 'y', direction: 1 } }),
        }
        // One agent's canvas replaces another's: closing it goes back to where the first was opened from.
        set(moved(view, next, view.screen === 'agent' ? 'stay' : 'go'))
      },
      closeAgentCanvas: () => {
        if (get().screen === 'agent') get().back()
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
      // An integration's screen is a menu screen, so it travels in along the menu as the others do, from wherever it is opened.
      openPartScreen: (screen) => get().openScreen(screen),
      closePartScreen: () => {
        if (isPartScreen(get().screen)) get().back()
      },
      // The canvas is a place to the right of everything: it comes in from the right and goes back the same way.
      openCanvasPlace: () => {
        const view = get()
        if (view.screen === 'canvas') return
        // Settings, or a page under it, opened over the canvas gives the canvas back with the way back it had.
        const back = ground(view) === 'canvas' && view.canvasReturn ? view.canvasReturn : placeOf(view)
        // The canvas keeps its own way back, and the trail stays as it was under it.
        arrive('canvas')
        set({ screen: 'canvas', canvasReturn: back, settingsReturn: null, previewReturn: null, previewFrom: null, screenMotion: { axis: 'x', direction: 1 } })
      },
      closeCanvasPlace: () => {
        const { screen, canvasReturn } = get()
        if (screen !== 'canvas') return
        const back = canvasReturn ?? UNDER_CANVAS
        arrive(back.screen)
        set({ ...back, canvasReturn: null, screenMotion: { axis: 'x', direction: -1 } })
      },
      openProofRun: (openProof) => {
        const view = get()
        // Run again follows the new run on the same page, with the same way back.
        const again = view.screen === 'proof'
        const next: Partial<ViewState> = {
          screen: 'proof',
          openProof,
          settingsReturn: null,
          previewReturn: null,
          previewFrom: null,
          ...(again ? {} : { screenMotion: { axis: 'x', direction: 1 } }),
        }
        set(moved(view, next, again ? 'stay' : 'go'))
        requestCanvasFocus()
      },
      closeProof: () => {
        if (get().screen === 'proof') get().back()
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
