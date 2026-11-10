import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { ReviewNotes, ReviewStatus } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import { ReviewRefused } from '#shared/review/validate.ts'
import { memoryKey, type MemoryState } from './state/memory.ts'
import type { StoreApi } from 'zustand/vanilla'

type ReviewCommand = 'review.status' | 'review.prepare' | 'review.get' | 'review.file' | 'review.notes'
export type ReviewCommands = <Name extends ReviewCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
interface LoadState {
  status: 'loading' | 'preparing' | 'ready' | 'refused' | 'error'
  review: Review | null
  preparation: ReviewStatus | null
  error: string | null
  notesError: string | null
  saving: boolean
}
interface Options {
  id: string
  scope: string
  memory: StoreApi<MemoryState>
  command?: ReviewCommands
  sample?: ReviewSource
}
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One open target. Host cache, file reads and draft saves all use this same target and source identity. */
export function createReviewLoader({ id, scope, memory, command, sample }: Options) {
  const store = createStore<LoadState>(() => ({ status: 'loading', review: null, preparation: null, error: null, notesError: null, saving: false }))
  let generation = 0
  let disposed = false
  let unsubscribe = () => {}
  let pending: ReviewNotes | null = null
  let writing: Promise<void> | null = null
  let latest: ReviewNotes | null = null
  let notesRevision = 0
  let loading: Promise<void> | null = null
  const notesKey = JSON.stringify([scope, id])
  const notesOf = (review: Review): ReviewNotes => {
    const saved = memory.getState().of(review)
    return { entries: saved.notes, draft: saved.draft }
  }
  const flushNotes = (): Promise<void> => {
    if (!command || writing || !pending) return writing ?? Promise.resolve()
    writing = (async () => {
      store.setState({ saving: true })
      while (pending) {
        const notes = pending
        pending = null
        try {
          await command('review.notes', { id, ...notes })
          if (memory.getState().unsyncedNotes[notesKey] === notes) {
            memory.setState((state) => {
              const { [notesKey]: _saved, ...unsyncedNotes } = state.unsyncedNotes
              return { unsyncedNotes }
            })
          }
          store.setState({ notesError: null })
        } catch (error) {
          pending ??= notes
          store.setState({ notesError: reason(error) })
          break
        }
      }
      store.setState({ saving: false })
    })().finally(() => { writing = null })
    return writing
  }
  const watch = (review: Review) => {
    unsubscribe()
    let known = notesOf(review)
    unsubscribe = memory.subscribe(() => {
      const next = notesOf(review)
      if (next.entries === known.entries && next.draft === known.draft) return
      known = next
      latest = next
      notesRevision++
      if (command) memory.setState((state) => ({ unsyncedNotes: { ...state.unsyncedNotes, [notesKey]: next } }))
      pending = next
      void flushNotes()
    })
  }
  const executeLoad = async (refresh: boolean) => {
    disposed = false
    const turn = ++generation
    const revision = notesRevision
    const unsavedAtStart = memory.getState().unsyncedNotes[notesKey]
    store.setState({ error: null, ...(store.getState().review ? {} : { status: 'loading' as const }) })
    try {
      let review: Review
      let notes: ReviewNotes | null = null
      let preparation: ReviewStatus | null = null
      if (command) {
        preparation = refresh ? await command('review.prepare', { id, refresh: true }) : await command('review.status', { id })
        if (disposed || turn !== generation) return
        if (preparation.state === 'idle') preparation = await command('review.prepare', { id })
        if (disposed || turn !== generation) return
        store.setState({ preparation })
        if (preparation.state !== 'ready') {
          store.setState({ status: store.getState().review ? 'ready' : preparation.state === 'failed' ? 'error' : 'preparing', error: preparation.error })
          return
        }
        const opened = await command('review.get', { id })
        review = opened.review
        notes = opened.notes
        preparation = opened.status
      } else {
        if (!sample) throw new Error('No review source is available.')
        review = await sample.getReview(id)
      }
      if (disposed || turn !== generation) return
      // The model id stays intact for host commands; only browser memory is namespaced by its source.
      review = { ...review, memoryScope: scope } as Review
      unsubscribe()
      const unsaved = memory.getState().unsyncedNotes[notesKey]
      // Only unsynced revisions may override host notes; snapshot memory owns layout/history.
      const restore = command ? (notesRevision !== revision ? latest : unsaved ?? unsavedAtStart ?? notes) : null
      if (restore) {
        const key = memoryKey(review)
        memory.setState((state) => ({ reviews: { ...state.reviews, [key]: { ...state.of(review), notes: restore.entries, draft: restore.draft } } }))
        latest = restore
        if (unsaved) { pending = unsaved; void flushNotes() }
      }
      watch(review)
      store.setState({ status: 'ready', review, preparation, error: null })
    } catch (error) {
      if (!disposed && turn === generation) store.setState({ status: store.getState().review ? 'ready' : error instanceof ReviewRefused ? 'refused' : 'error', error: reason(error) })
    }
  }
  const load = (refresh = false): Promise<void> => {
    if (!refresh && loading) return loading
    const request = executeLoad(refresh).finally(() => { if (loading === request) loading = null })
    loading = request
    return request
  }
  const source: ReviewSource = {
    async getReview() {
      const review = store.getState().review
      if (!review) throw new Error('The review is not ready.')
      return review
    },
    getFile: (_reviewId, fileId) => command ? command('review.file', { id, fileId }) : sample!.getFile(id, fileId),
  }
  const saveNotes = async () => {
    await flushNotes()
    if (store.getState().notesError) throw new Error(store.getState().notesError!)
  }
  return Object.assign(store, { source, load, refresh: () => load(true), flushNotes, saveNotes, dispose: () => { disposed = true; generation++; loading = null; unsubscribe() } })
}
export type ReviewLoader = ReturnType<typeof createReviewLoader>
