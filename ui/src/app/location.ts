import { create } from 'zustand'
import type { Place } from '../features/main-agent/mind.ts'
import { useReports } from '../features/reports/store.ts'
import { useRoutines } from '../features/routines/store.ts'
import { hostStore } from '../lib/host/client.ts'
import { depth } from './overlays.ts'
import { SCREENS, screenIndex, type ScreenId } from './screens.ts'
import { MOST_PLACES, namesItsPage, samePlace, stopOf, type Keep, type Stop } from './trail.ts'
import { useView, type ScreenMotion } from './view-store.ts'

/**
 * Where the user is in the window, as small ids and never content: the screen, what is open on it, and the ways
 * back. Command+R comes back to it, and Command+Left and Right walk the places before and after it. It is kept in the
 * window's session storage, so a reload finds it and a new window starts as it always has.
 */
export interface Spot {
  screen: ScreenId
  settingsReturn: ScreenId | null
  githubReturn: ScreenId | null
  openAgent: string | null
  openReview: string | null
  /** The project its page shows, by slug. */
  project: string | null
  /** The places before this one, oldest first (the trail, 053). */
  trail: Stop[]
  mindReturn: Place | null
  /** Where closing the canvas goes back to. A reload on the canvas comes back to it while it is open. */
  canvasReturn: Place | null
  /** The proof run on its page. */
  openProof: string | null
  report: string | null
  routine: string | null
  action: string | null
  githubTab: GitHubTab
  /** The project GitHub's lists are narrowed to, by its slug. Null for All. */
  githubProject: string | null
}

export type GitHubTab = 'pulls' | 'issues'

const KEY = 'hobkin-client-location-1'
/** How many places back the window remembers. */
const MOST = 50

const isScreen = (value: unknown): value is ScreenId => SCREENS.some(({ id }) => id === value)
const screenOr = (value: unknown) => (isScreen(value) ? value : null)
const idOr = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
const placeOr = (value: unknown): Place | null => {
  const p = value as Record<string, unknown> | null
  if (!p || !isScreen(p.screen)) return null
  return { screen: p.screen, settingsReturn: screenOr(p.settingsReturn), githubReturn: screenOr(p.githubReturn), openAgent: idOr(p.openAgent), previewReturn: screenOr(p.previewReturn) }
}

const keepOr = (value: unknown): Keep | null => {
  const k = value as Record<string, unknown> | null
  if (!k || typeof k !== 'object') return null
  const keep: Keep = {
    ...(typeof k.tab === 'string' && k.tab ? { tab: k.tab } : {}),
    ...(typeof k.focus === 'string' && k.focus ? { focus: k.focus } : {}),
    ...(typeof k.scroll === 'number' && Number.isFinite(k.scroll) && k.scroll > 0 ? { scroll: k.scroll } : {}),
  }
  return Object.keys(keep).length ? keep : null
}

/** A place of a saved trail, or null for one this window would not have written, or a page that is gone. */
const stopOr = (value: unknown): Stop | null => {
  const s = value as Record<string, unknown> | null
  if (!s || typeof s !== 'object' || !isScreen(s.screen)) return null
  const about = idOr(s.about)
  const settingsReturn = screenOr(s.settingsReturn)
  const githubReturn = screenOr(s.githubReturn)
  const keep = keepOr(s.keep)
  return {
    screen: s.screen,
    ...(about ? { about } : {}),
    ...(settingsReturn ? { settingsReturn } : {}),
    ...(githubReturn ? { githubReturn } : {}),
    ...(keep ? { keep } : {}),
  }
}

/**
 * The trail a place saved by a window older than the trail (053) stands for. Such a place holds three single ways
 * back: a proof run's, a review's and an agent's. Each one that leads on from the page, or from the place under the
 * mind or the canvas, becomes a place before it; one that leads nowhere from there is left out.
 */
function trailOfSlots(raw: Record<string, unknown>, page: ScreenId): Stop[] {
  const agent = screenOr(raw.agentReturn)
  const slots: Partial<Record<ScreenId, Place>> = {
    proof: placeOr(raw.proofReturn) ?? undefined,
    review: placeOr(raw.reviewReturn) ?? undefined,
    agent: agent ? { screen: agent, settingsReturn: null, githubReturn: null, openAgent: null, previewReturn: null } : undefined,
  }
  const base = page === 'mind' ? placeOr(raw.mindReturn) : page === 'canvas' ? placeOr(raw.canvasReturn) : { screen: page }
  const trail: Stop[] = []
  for (let at = base?.screen; at && slots[at]; ) {
    const place = slots[at]!
    delete slots[at]
    trail.unshift(stopOf({ ...place, openReview: idOr(raw.openReview), openProof: null, project: null }))
    at = place.screen
  }
  return trail
}

/** A saved place with the home it was saved in, or null for anything this window did not write. */
export function readSpot(text: string | null): (Spot & { home: string | null }) | null {
  let raw: Record<string, unknown> | null = null
  try {
    raw = JSON.parse(text ?? '')
  } catch {}
  if (!raw || !isScreen(raw.screen)) return null
  const saved = Array.isArray(raw.trail) ? raw.trail.map(stopOr).filter((stop) => stop !== null) : trailOfSlots(raw, raw.screen)
  // A place about nothing it names, as an agent with no id, would go back to an empty page: it is left out.
  const trail = saved.filter(namesItsPage)
  return {
    screen: raw.screen, settingsReturn: screenOr(raw.settingsReturn), githubReturn: screenOr(raw.githubReturn), openAgent: idOr(raw.openAgent),
    openReview: idOr(raw.openReview), project: idOr(raw.project), trail: trail.slice(-(MOST_PLACES - 1)),
    mindReturn: placeOr(raw.mindReturn), canvasReturn: placeOr(raw.canvasReturn), report: idOr(raw.report),
    openProof: idOr(raw.openProof),
    routine: idOr(raw.routine), action: idOr(raw.action), githubTab: raw.githubTab === 'issues' ? 'issues' : 'pulls', githubProject: idOr(raw.githubProject), home: idOr(raw.home),
  }
}

/** What a move changes: the screen, and what is open on it. Its ways back change with it. */
export function moveKey(spot: Spot): string {
  const open: Partial<Record<ScreenId, string | null>> = { agent: spot.openAgent, review: spot.openReview, reports: spot.report, routines: spot.routine, actions: spot.action, proof: spot.openProof, project: spot.project }
  return `${spot.screen}:${open[spot.screen] ?? ''}`
}

/** The canvas travels back and forth the way the move itself went: down into Settings, up from an agent, along the menu. */
export function motionBetween(from: Spot, to: Spot): ScreenMotion {
  // The main canvas lies to the right of everything, as opening and closing it travel.
  if (to.screen === 'canvas' || from.screen === 'canvas') return { axis: 'x', direction: to.screen === 'canvas' ? 1 : -1 }
  const deeper = depth(to) - depth(from)
  if (deeper !== 0) return { axis: 'y', direction: deeper > 0 ? -1 : 1 }
  if (to.screen === 'agent' || from.screen === 'agent') return { axis: 'y', direction: to.screen === 'agent' ? 1 : -1 }
  if (to.screen === 'mind' || from.screen === 'mind') return { axis: 'x', direction: to.screen === 'mind' ? -1 : 1 }
  return { axis: 'x', direction: screenIndex(to.screen) > screenIndex(from.screen) ? 1 : -1 }
}

function storage(): Storage | null {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

const saved = readSpot(storage()?.getItem(KEY) ?? null)

/**
 * A screen's own open state: Action Items' open item, and GitHub's tab and the project it is narrowed to (null for All). A reload and
 * Command+Left bring it back; a new visit starts over.
 */
export const remembered = create<{ action: string | null; githubTab: GitHubTab; githubProject: string | null }>()(() => ({
  action: saved?.action ?? null,
  githubTab: saved?.githubTab ?? 'pulls',
  githubProject: saved?.githubProject ?? null,
}))
type Remembered = ReturnType<typeof remembered.getState>

export function useRemembered<K extends keyof Remembered>(key: K): [Remembered[K], (value: Remembered[K]) => void] {
  return [remembered((state) => state[key]), (value) => remembered.setState({ [key]: value } as Pick<Remembered, K>)]
}

function spotNow(): Spot {
  const { screen, settingsReturn, githubReturn, openAgent, openReview, project, trail, mindReturn, canvasReturn, openProof } = useView.getState()
  return { screen, settingsReturn, githubReturn, openAgent, openReview, project, trail, mindReturn, canvasReturn, openProof, report: useReports.getState().openId, routine: useRoutines.getState().openId, ...remembered.getState() }
}

/**
 * Puts the canvas on a spot. A report or routine that is gone leaves its screen on the list. A main canvas that has
 * closed meanwhile is left for the place under it by the canvas itself (`placeMove`), once the host has said so.
 */
function show(spot: Spot, screenMotion?: ScreenMotion): void {
  const { screen, settingsReturn, githubReturn, openAgent, openReview, project, trail, mindReturn, canvasReturn, openProof, action, githubTab, githubProject } = spot
  useView.setState({ screen, settingsReturn, githubReturn, openAgent, openReview, project, trail, mindReturn, canvasReturn, openProof, previewReturn: null, previewFrom: null, ...(screenMotion ? { screenMotion } : {}) })
  remembered.setState({ action, githubTab, githubProject })
}

/** The report and routine a reload left open, until their home sends them, or has sent its lists without them. */
let wanted = saved && { home: saved.home, report: saved.report, routine: saved.routine }
if (saved) show(saved)

function land(): void {
  if (!wanted) return
  const host = hostStore.getState()
  const { home, report, routine } = wanted
  const reports = useReports.getState()
  const routines = useRoutines.getState()
  const openReport = host.home === home && report !== null && reports.openId === null && reports.inbox.reports.some(({ id }) => id === report)
  const openRoutine = host.home === home && routine !== null && routines.openId === null && routines.data.routines.some(({ id }) => id === routine)
  const left = { home, report: openReport ? null : report, routine: openRoutine ? null : routine }
  wanted = host.link === 'none' || host.epoch > 0 || (!left.report && !left.routine) ? null : left
  if (openReport) reports.open(report)
  if (openRoutine) routines.open(routine, `routine-${routine}`)
  // Coming back to where the user was is not a move of its own.
  if (openReport || openRoutine) last = spotNow()
}

let last = spotNow()
let trail: { back: Spot[]; forward: Spot[] } = { back: [], forward: [] }
let applying = false
let queued = false
land()

/** Everything one action changed is settled together: it is saved, and it is one move. Walking the agents list only looks. */
function settle(): void {
  queued = false
  const now = spotNow()
  try {
    storage()?.setItem(KEY, JSON.stringify({ ...now, home: hostStore.getState().home }))
  } catch {}
  const view = useView.getState()
  if (view.screen === 'agent' && (view.previewReturn !== null || view.previewFrom !== null)) return
  if (moveKey(now) !== moveKey(last)) {
    trail = { back: [...trail.back, last].slice(-MOST), forward: [] }
    wanted = null
  }
  last = now
}

function changed(): void {
  land()
  if (!queued) queueMicrotask(settle)
  queued = true
}

/** Command+Left (-1) and Command+Right (1): the place before or after this one. False at either end. */
export function travel(way: -1 | 1): boolean {
  if (queued) settle()
  const to = (way < 0 ? trail.back : trail.forward).at(-1)
  if (!to) return false
  const here = spotNow()
  trail = way < 0 ? { back: trail.back.slice(0, -1), forward: [...trail.forward, last] } : { back: [...trail.back, last], forward: trail.forward.slice(0, -1) }
  applying = true
  try {
    show(to, motionBetween(here, to))
    const reports = useReports.getState()
    if (to.report !== reports.openId) {
      reports.close()
      if (to.report) reports.open(to.report)
    }
    const routines = useRoutines.getState()
    if (to.routine !== routines.openId) {
      if (to.routine) routines.open(to.routine, `routine-${to.routine}`)
      else routines.close()
    }
  } finally {
    applying = false
  }
  last = spotNow()
  return true
}

const unsubscribe = [
  useView.subscribe((view, before) => {
    // A screen entered anew starts on its list and its first tab, as it did before it remembered them. One the trail
    // goes back to is not entered anew.
    const returning = before.trail.some((stop) => samePlace(stop, stopOf(view)))
    if (!applying && !returning && view.screen !== before.screen) {
      if (view.screen === 'actions') remembered.setState({ action: null })
      if (view.screen === 'github') remembered.setState({ githubTab: 'pulls', githubProject: null })
    }
    changed()
  }),
  useReports.subscribe(changed),
  useRoutines.subscribe(changed),
  remembered.subscribe(changed),
  hostStore.subscribe(land),
]
import.meta.hot?.dispose(() => unsubscribe.forEach((stop) => stop()))
