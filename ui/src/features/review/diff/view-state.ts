/**
 * What the code view keeps while its review is open (spec 071): where the keyboard is, each file's cursor and what of
 * its diff is drawn, and the files read so far. It is kept for the review's session, so the code view left for the graph
 * and opened again finds each file as it was. No React here.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ReviewFileContents } from '#shared/review/types.ts'
import { diffOf, startView, type Diff, type DiffView, type Emphasis } from '../code/diff-rows.ts'
import type { Pane } from './code-keys.ts'
import type { Cursor } from './cursor.ts'

/** One file as the code view left it: its cursor once it has moved, what of its diff is drawn, and lines still to open. */
export interface FilePlace {
  cursor: Cursor | null
  view: DiffView | null
  /** Lines asked for, by a step, a part or a note, to open once the file is read. */
  reveal: Emphasis | null
}

export type FileRead = ReviewFileContents | { failed: string }

export interface CodeViewState {
  pane: Pane
  /** The last of the session's asks to show a file (`diff.ask`) the code view took in. */
  handled: number
  places: Readonly<Record<string, FilePlace>>
  files: Readonly<Record<string, FileRead>>
}

export interface CodeViewStore extends StoreApi<CodeViewState> {
  /** Files asked of the source and not back yet. */
  reading: Set<string>
  /** Changes what is kept of one file. */
  place(fileId: string, change: Partial<FilePlace>): void
}

const NO_PLACE: FilePlace = { cursor: null, view: null, reveal: null }

const stores = new WeakMap<object, CodeViewStore>()

/** The code view's state for a review's session, made the first time the code view opens in it. */
export function codeViewStore(session: object): CodeViewStore {
  const kept = stores.get(session)
  if (kept) return kept

  const store = createStore<CodeViewState>()(() => ({ pane: 'files', handled: 0, places: {}, files: {} }))
  const place = (fileId: string, change: Partial<FilePlace>) =>
    store.setState((state) => {
      const before = state.places[fileId] ?? NO_PLACE
      return { places: { ...state.places, [fileId]: { ...before, ...change } } }
    })
  const made = Object.assign(store, { reading: new Set<string>(), place })
  stores.set(session, made)
  return made
}

/** What is kept of a file, nothing yet for one never shown. */
export const placeOf = (places: CodeViewState['places'], fileId: string | null): FilePlace => (fileId ? places[fileId] : undefined) ?? NO_PLACE

const diffs = new WeakMap<ReviewFileContents, Diff>()
/** A file's diff, worked out once for each copy of it read. */
export function diffFor(file: ReviewFileContents): Diff {
  const known = diffs.get(file)
  if (known) return known
  const diff = diffOf(file.base, file.head)
  diffs.set(file, diff)
  return diff
}

const starts = new WeakMap<Diff, DiffView>()
/** What a file's diff draws before anything is opened in it: one view for each diff, so the screen and the keys agree on it. */
export function startOf(diff: Diff): DiffView {
  const known = starts.get(diff)
  if (known) return known
  const view = startView(diff)
  starts.set(diff, view)
  return view
}

/** The diff a file read shows, null while it is read or when it failed. */
export const diffOfRead = (file: FileRead | undefined): Diff | null => (file && !('failed' in file) ? diffFor(file) : null)
