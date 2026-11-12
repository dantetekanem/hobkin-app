import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewNotes, ReviewStatus } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import { ReviewRefused } from '#shared/review/validate.ts'
import { mergeHostNotes } from './notes/merge.ts'
import { memoryKey, type MemoryState } from './state/memory.ts'
import type { StoreApi } from 'zustand/vanilla'

type ReviewCommand = 'review.status' | 'review.prepare' | 'review.get' | 'review.file' | 'review.notes'
export type ReviewCommands = <Name extends ReviewCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
interface LoadState {
  status: 'loading' | 'awaiting' | 'preparing' | 'ready' | 'refused' | 'error'
  /** When this window first saw the review being prepared (ms), for the time it has taken. Null when nothing is under way. */
  startedAt: number | null
  review: Review | null
  preparation: ReviewStatus | null
  /** A finished change's change review, once one is ready for the review's commit (spec 032). */
  assessment: ChangeAssessment | null
  error: string | null
  notesError: string | null
  saving: boolean
}
interface Options {
  id: string
  scope: string
  memory: StoreApi<MemoryState>
  command?: ReviewCommands
  /** The clock, in milliseconds; tests pass their own. */
  now?: () => number
  sample?: ReviewSource
}
const reason = (error: unknown) => error instanceof Error ? error.message : String(error)
/** A finished change review, by its commit and when it finished: one run again at the same commit is another. */
const finishedOf = (head: string | null, summary: { at: string } | undefined): string | null => (head ? `${head}@${summary?.at ?? ''}` : null)

/** One open target. Host cache, file reads and draft saves all use this same target and source identity. */
/** A pull request from GitHub is reviewed only once the user asks; a finished hobkin change is prepared by itself. */
export const startsByItself = (id: string): boolean => !id.startsWith('pr:')

export function createReviewLoader({ id, scope, memory, command, sample, now = Date.now }: Options) {
  const store = createStore<LoadState>(() => ({ status: 'loading', startedAt: null, review: null, preparation: null, assessment: null, error: null, notesError: null, saving: false }))
  let generation = 0
  let disposed = false
  let unsubscribe = () => {}
  let pending: ReviewNotes | null = null
  let writing: Promise<void> | null = null
  let latest: ReviewNotes | null = null
  let notesRevision = 0
  let loading: Promise<void> | null = null
  let checking = false
  /** The finished change review last fetched (`finishedOf`), so each one is fetched once, a run again at the same commit too. */
  let assessed: string | null = null
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
    })().finally(() => {
      writing = null
    })
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
  /** Starts the clock when a review is first seen under way, and stops it once nothing is. */
  const clock = (status: ReviewStatus): { startedAt: number | null } => {
    const underWay = status.state === 'preparing' || status.assessment?.state === 'queued' || status.assessment?.state === 'running'
    return { startedAt: underWay ? store.getState().startedAt ?? now() : null }
  }
  const executeLoad = async (refresh: boolean) => {
    disposed = false
    const turn = ++generation
    const revision = notesRevision
    const unsavedAtStart = memory.getState().unsyncedNotes[notesKey]
    const current = store.getState()
    // Polling a review being prepared keeps its view; only a first look shows "loading".
    store.setState({ error: null, ...(current.review || current.status === 'preparing' || current.status === 'awaiting' ? {} : { status: 'loading' as const }) })
    try {
      let review: Review
      let notes: ReviewNotes | null = null
      let preparation: ReviewStatus | null = null
      let assessment: ChangeAssessment | null = null
      if (command) {
        preparation = refresh ? await command('review.prepare', { id, refresh: true }) : await command('review.status', { id })
        if (disposed || turn !== generation) return
        if (preparation.state === 'idle' && !startsByItself(id) && !refresh) {
          // Opening a pull request asks nothing of the host; "Start AI review" does.
          store.setState({ preparation, status: store.getState().review ? 'ready' : 'awaiting', startedAt: null })
          return
        }
        if (preparation.state === 'idle') preparation = await command('review.prepare', { id })
        if (disposed || turn !== generation) return
        store.setState({ preparation, ...clock(preparation) })
        if (preparation.state !== 'ready') {
          const unfinished = preparation.state === 'failed' ? 'error' : 'preparing'
          store.setState({ status: store.getState().review ? 'ready' : unfinished, error: preparation.error })
          return
        }
        const opened = await command('review.get', { id })
        review = opened.review
        notes = opened.notes
        preparation = opened.status
        assessment = opened.assessment ?? null
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
        if (unsaved) {
          pending = unsaved
          void flushNotes()
        }
      }
      watch(review)
      if (assessment) {
        assessed = finishedOf(assessment.head, assessment.summary)
      } else if (preparation?.assessment?.state === 'ready') {
        assessed = finishedOf(preparation.assessment.head, preparation.assessment.summary)
      } else {
        assessed = null
      }
      store.setState({ status: 'ready', review, preparation, assessment, error: null, ...(preparation ? clock(preparation) : {}) })
    } catch (error) {
      if (!disposed && turn === generation) {
        const unopened = error instanceof ReviewRefused ? 'refused' : 'error'
        store.setState({ status: store.getState().review ? 'ready' : unopened, error: reason(error) })
      }
    }
  }
  const load = (refresh = false): Promise<void> => {
    if (!refresh && loading) return loading
    const request = executeLoad(refresh).finally(() => {
      if (loading === request) loading = null
    })
    loading = request
    return request
  }
  /** "Start AI review": asks the host to prepare this review, then follows it like any other. */
  const start = async (): Promise<void> => {
    if (!command || disposed) return
    const turn = ++generation
    try {
      const preparation = await command('review.prepare', { id })
      if (disposed || turn !== generation) return
      store.setState({ preparation, status: preparation.state === 'failed' ? 'error' : preparation.state === 'ready' ? 'loading' : 'preparing', error: preparation.error, ...clock(preparation) })
      if (preparation.state === 'ready') await load()
    } catch (error) {
      if (!disposed && turn === generation) store.setState({ status: 'error', error: reason(error) })
    }
  }
  /** One poll: a review still being prepared is asked about again until it opens; an open one is checked. */
  const tick = (): Promise<void> => {
    const { status, preparation } = store.getState()
    if (status === 'preparing' || (status !== 'awaiting' && preparation?.phase)) return load()
    if (status === 'ready') return check()
    return Promise.resolve()
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
  /**
   * While a review is open, asks the host how it stands: whether its change moved on, where hobkin moved the view,
   * whether hobkin left notes, which then join the window's own, and how its change review is getting on. The status
   * carries that progress, so nothing more is asked while it runs. Once it is ready, the review is fetched once more,
   * for its story and the levels on its graph, and once more each time it is run again at the same commit (Rebuild, or
   * Review again) and finishes. A check that fails is tried again on the next one.
   */
  const check = async (): Promise<void> => {
    const review = store.getState().review
    if (!command || disposed || !review || checking) return
    checking = true
    try {
      const before = store.getState().preparation
      const status = await command('review.status', { id })
      if (disposed || store.getState().review !== review) return
      // Kept only when something changed, so an open review does not draw again every second.
      if (JSON.stringify(status) !== JSON.stringify(before)) store.setState({ preparation: status, ...clock(status) })
      const ready = status.assessment?.state === 'ready' ? finishedOf(status.assessment.head, status.assessment.summary) : null
      const finished = ready !== assessed ? ready : null
      if ((status.notesAt ?? 0) <= (before?.notesAt ?? 0) && !finished) return
      if (finished) assessed = finished
      const opened = await command('review.get', { id })
      if (disposed || store.getState().review !== review) return
      if (finished && opened.assessment) store.setState({ review: { ...opened.review, memoryScope: scope } as Review, assessment: opened.assessment })
      const key = memoryKey(review)
      memory.setState((state) => {
        const mine = state.of(review)
        const notes = mergeHostNotes(mine.notes, opened.notes.entries)
        return notes === mine.notes ? state : { reviews: { ...state.reviews, [key]: { ...mine, notes: [...notes] } } }
      })
    } catch {
      // Tried again on the next check.
    } finally {
      checking = false
    }
  }
  const dispose = () => {
    disposed = true
    generation++
    loading = null
    unsubscribe()
  }
  return Object.assign(store, { source, load, check, start, tick, refresh: () => load(true), flushNotes, saveNotes, dispose })
}
export type ReviewLoader = ReturnType<typeof createReviewLoader>
