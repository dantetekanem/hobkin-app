import { create } from 'zustand'
import type { Place } from '../features/main-agent/mind.ts'
import { useReports } from '../features/reports/store.ts'
import { useRoutines } from '../features/routines/store.ts'
import { hostStore } from '../lib/host/client.ts'
import { depth } from './overlays.ts'
import { SCREENS, screenIndex, type ScreenId } from './screens.ts'
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
  reviewReturn: Place | null
  mindReturn: Place | null
  report: string | null
  routine: string | null
  action: string | null
  githubTab: GitHubTab
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
  return { screen: p.screen, settingsReturn: screenOr(p.settingsReturn), githubReturn: screenOr(p.githubReturn), openAgent: idOr(p.openAgent), previewReturn: screenOr(p.previewReturn), agentTalk: p.agentTalk === true }
}

/** A saved place with the home it was saved in, or null for anything this window did not write. */
export function readSpot(text: string | null): (Spot & { home: string | null }) | null {
  let raw: Record<string, unknown> | null = null
  try {
    raw = JSON.parse(text ?? '')
  } catch {}
  if (!raw || !isScreen(raw.screen)) return null
  return {
    screen: raw.screen, settingsReturn: screenOr(raw.settingsReturn), githubReturn: screenOr(raw.githubReturn), openAgent: idOr(raw.openAgent),
    openReview: idOr(raw.openReview), reviewReturn: placeOr(raw.reviewReturn), mindReturn: placeOr(raw.mindReturn), report: idOr(raw.report),
    routine: idOr(raw.routine), action: idOr(raw.action), githubTab: raw.githubTab === 'issues' ? 'issues' : 'pulls', home: idOr(raw.home),
  }
}

/** What a move changes: the screen, and what is open on it. Its ways back change with it. */
export function moveKey(spot: Spot): string {
  const open: Partial<Record<ScreenId, string | null>> = { agent: spot.openAgent, review: spot.openReview, reports: spot.report, routines: spot.routine, actions: spot.action }
  return `${spot.screen}:${open[spot.screen] ?? ''}`
}

/** The canvas travels back and forth the way the move itself went: down into Settings, up from an agent, along the menu. */
export function motionBetween(from: Spot, to: Spot): ScreenMotion {
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

/** A screen's own open state: Action Items' open item and GitHub's tab. A reload and Command+Left bring it back; a new visit starts over. */
export const remembered = create<{ action: string | null; githubTab: GitHubTab }>()(() => ({ action: saved?.action ?? null, githubTab: saved?.githubTab ?? 'pulls' }))
type Remembered = ReturnType<typeof remembered.getState>

export function useRemembered<K extends keyof Remembered>(key: K): [Remembered[K], (value: Remembered[K]) => void] {
  return [remembered((state) => state[key]), (value) => remembered.setState({ [key]: value } as Pick<Remembered, K>)]
}

function spotNow(): Spot {
  const { screen, settingsReturn, githubReturn, openAgent, openReview, reviewReturn, mindReturn } = useView.getState()
  return { screen, settingsReturn, githubReturn, openAgent, openReview, reviewReturn, mindReturn, report: useReports.getState().openId, routine: useRoutines.getState().openId, ...remembered.getState() }
}

/** Puts the canvas on a spot. A report or routine that is gone leaves its screen on the list. */
function show(spot: Spot, screenMotion?: ScreenMotion): void {
  const { screen, settingsReturn, githubReturn, openAgent, openReview, reviewReturn, mindReturn, action, githubTab } = spot
  useView.setState({ screen, settingsReturn, githubReturn, openAgent, openReview, reviewReturn, mindReturn, previewReturn: null, agentTalk: false, ...(screenMotion ? { screenMotion } : {}) })
  remembered.setState({ action, githubTab })
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
  if (view.screen === 'agent' && view.previewReturn !== null) return
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
    // A screen entered anew starts on its list and its first tab, as it did before it remembered them.
    if (!applying && view.screen !== before.screen) {
      if (view.screen === 'actions') remembered.setState({ action: null })
      if (view.screen === 'github') remembered.setState({ githubTab: 'pulls' })
    }
    changed()
  }),
  useReports.subscribe(changed),
  useRoutines.subscribe(changed),
  remembered.subscribe(changed),
  hostStore.subscribe(land),
]
import.meta.hot?.dispose(() => unsubscribe.forEach((stop) => stop()))
