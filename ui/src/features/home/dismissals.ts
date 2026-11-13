import { create } from 'zustand'

/**
 * What the user has dismissed on Home ("seen it / not now"): a card or row id mapped to when it was put away. It is
 * kept per window profile in the app's own storage, so a dismissal survives a reload and Command+R but never leaves
 * this machine. Dismissed things are dropped everywhere they would show; the real item still lives on its own screen,
 * so nothing is lost, only quieted. The map is pruned by age and capped, so it cannot grow without bound.
 */

const KEY = 'hobkin-client-home-dismissed-1'
/** A dismissal older than this is forgotten, so a thing put away long ago can resurface if it is still around. */
const MAX_AGE_MS = 60 * 24 * 3_600_000
/** At most this many dismissals are kept, newest first, so the store stays small. */
const MAX = 400

export type Dismissals = Record<string, number>

/** The kept dismissals: age out the stale ones, then keep the newest up to the cap. */
export function prune(record: Dismissals, now: number): Dismissals {
  const fresh = Object.entries(record)
    .filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && now - at < MAX_AGE_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX)
  return Object.fromEntries(fresh)
}

/** The record with `id` dismissed as of `now`. An id already dismissed keeps its first time. */
export function withDismissal(record: Dismissals, id: string, now: number): Dismissals {
  if (record[id]) return record
  return prune({ ...record, [id]: now }, now)
}

/** The stored record, parsed and pruned. Anything malformed reads as empty. */
export function readDismissals(text: string | null, now: number): Dismissals {
  try {
    const raw: unknown = JSON.parse(text ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return prune(raw as Dismissals, now)
  } catch {
    return {}
  }
}

function storage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function load(): Dismissals {
  return readDismissals(storage()?.getItem(KEY) ?? null, Date.now())
}

function save(record: Dismissals): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(record))
  } catch {
    // Storage can be unavailable; the dismissal still holds for this session.
  }
}

interface DismissalState {
  record: Dismissals
  /** The ids as a set, rebuilt on every change, so the Home model can read it without allocating each render. */
  ids: ReadonlySet<string>
}

const from = (record: Dismissals): DismissalState => ({ record, ids: new Set(Object.keys(record)) })

export const useDismissals = create<DismissalState>()(() => from(load()))

/** Put a card or row away. It leaves Home at once and stays gone across reloads. */
export function dismiss(id: string): void {
  const next = withDismissal(useDismissals.getState().record, id, Date.now())
  if (next === useDismissals.getState().record) return
  save(next)
  useDismissals.setState(from(next))
}

/** Bring everything back (nothing in the UI calls this yet; kept for a future "show dismissed" affordance). */
export function restoreAll(): void {
  save({})
  useDismissals.setState(from({}))
}
