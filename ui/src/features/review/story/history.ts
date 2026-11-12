/**
 * Where the reviewer has been: the places they jumped to, to go back and forward through, as in a browser.
 * A walk along the story one step at a time is not kept: Left and Right already go back and forward there.
 */

/** A place in the review: a step, and a node or a group of nodes focused off its path, or the whole graph. */
export interface FocusEntry {
  step: number
  detour: string | null
  group?: readonly string[] | null
  whole: boolean
}

export interface FocusHistory {
  back: FocusEntry[]
  forward: FocusEntry[]
}

export const NO_HISTORY: FocusHistory = { back: [], forward: [] }

/** The most places kept behind the current one. */
export const HISTORY_LIMIT = 50

const sameGroup = (a: FocusEntry['group'], b: FocusEntry['group']) => (a ?? []).length === (b ?? []).length && (a ?? []).every((id) => (b ?? []).includes(id))
const same = (a: FocusEntry, b: FocusEntry) => a.step === b.step && a.detour === b.detour && sameGroup(a.group, b.group) && a.whole === b.whole

/** Notes a jump from one place to another. Going somewhere new drops what was ahead. */
export function recordFocus(history: FocusHistory, from: FocusEntry, to: FocusEntry): FocusHistory {
  if (same(from, to)) return history
  return { back: [...history.back, from].slice(-HISTORY_LIMIT), forward: [] }
}

export function goBack(history: FocusHistory, current: FocusEntry): { history: FocusHistory; entry: FocusEntry } | null {
  const entry = history.back.at(-1)
  if (!entry) return null
  return { history: { back: history.back.slice(0, -1), forward: [current, ...history.forward] }, entry }
}

export function goForward(history: FocusHistory, current: FocusEntry): { history: FocusHistory; entry: FocusEntry } | null {
  const entry = history.forward[0]
  if (!entry) return null
  return { history: { back: [...history.back, current].slice(-HISTORY_LIMIT), forward: history.forward.slice(1) }, entry }
}
