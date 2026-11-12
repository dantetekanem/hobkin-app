import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewLanding, ReviewNotes, ReviewStatus } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import { ReviewRefused } from '#shared/review/validate.ts'
import { mergeHostNotes } from './notes/merge.ts'
import { startOf, underWay } from './preparing-model.ts'
import { memoryKey, type MemoryState } from './state/memory.ts'
import type { StoreApi } from 'zustand/vanilla'

type ReviewCommand = 'review.status' | 'review.prepare' | 'review.get' | 'review.file' | 'review.notes'
export type ReviewCommands = <Name extends ReviewCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
interface LoadState {
  status: 'loading' | 'awaiting' | 'preparing' | 'ready' | 'refused' | 'error'
  /**
   * When the run under way started (ms), for the time it has taken: the host's own time when it says, else when this
   * window first saw it. Null when nothing is under way.
   */
  startedAt: number | null
  review: Review | null
  /** How the host says the review stands. While its change lands, it holds the review on screen still (`heldStill`). */
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

/**
 * What the window keeps of a status for the review on screen. A finished change that lands holds still (spec 032): its
 * branch moving while an agent brings it up to date, or once it merged, is no newer change to review. The status then
 * stays on the review on screen, its commit, its preparation and its own change review, with nothing under way, outdated
 * or failed. It still says how the change lands, where hobkin moved the view, and when hobkin left notes.
 */
function heldStill(status: ReviewStatus, review: Review | null, kept: ReviewStatus | null): ReviewStatus {
  if (!status.landing || !review) return status
  const { head } = review.change
  const own = [status.assessment, kept?.assessment].find((assessment) => assessment?.head === head)
  return {
    id: status.id,
    state: 'ready',
    phase: null,
    head,
    stale: false,
    preparedAt: kept?.preparedAt ?? status.preparedAt,
    error: null,
    storyBy: kept?.storyBy ?? status.storyBy,
    ...(status.cursor ? { cursor: status.cursor } : {}),
    ...(status.notesAt != null ? { notesAt: status.notesAt } : {}),
    ...(own ? { assessment: own } : {}),
    landing: status.landing,
  }
}

/** Why a change that lands, with no review kept of it, shows none: none is prepared for it any more. */
const landedWithout = (landing: ReviewLanding) =>
  landing.state === 'merged' ? 'This change is merged. It has no review to show.' : 'This change is being brought up to date to merge. It has no review to show.'

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
  /**
   * Starts the clock when a run is first seen under way, at the host's own time when it says one, and stops it once
   * nothing is. The earliest start is kept, so the time never starts over between a graph and its change review.
   */
  const clock = (status: ReviewStatus): { startedAt: number | null } => {
    if (!underWay(status)) return { startedAt: null }
    const kept = store.getState().startedAt
    return { startedAt: Math.min(startOf(status) ?? kept ?? now(), kept ?? Infinity) }
  }
  /**
   * A pull request opens once its first change review is ready, or has stopped: its graph alone is a walk node by node,
   * not a review. A finished change opens on its graph while its change review runs.
   */
  const waits = (status: ReviewStatus): boolean => {
    const run = status.assessment?.state
    return !startsByItself(id) && !store.getState().review && (run === 'queued' || run === 'running')
  }
  const opens = (status: ReviewStatus) => status.state === 'ready' && !waits(status)
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
        // A change that lands is never built again, even when asked: there is nothing newer to review.
        const rebuild = refresh && !current.preparation?.landing
        preparation = rebuild ? await command('review.prepare', { id, refresh: true }) : await command('review.status', { id })
        if (disposed || turn !== generation) return
        const open = store.getState().review
        if (preparation.landing && open) {
          // The review on screen holds still while its change lands: nothing newer is fetched for it.
          const held = heldStill(preparation, open, store.getState().preparation)
          store.setState({ preparation: held, status: 'ready', ...clock(held) })
          return
        }
        // Nothing prepared and nothing under way, its change review included.
        const idle = preparation.state === 'idle' && !underWay(preparation)
        if (idle && !startsByItself(id) && !refresh) {
          // Opening a pull request asks nothing of the host; "Start AI review" does.
          store.setState({ preparation, status: open ? 'ready' : 'awaiting', startedAt: null })
          return
        }
        if (idle && !preparation.landing) preparation = await command('review.prepare', { id })
        if (disposed || turn !== generation) return
        store.setState({ preparation, ...clock(preparation) })
        if (!opens(preparation)) {
          // One that lands with no review kept, and none under way, waits for none: none is prepared for it.
          const without = preparation.landing && !underWay(preparation) ? landedWithout(preparation.landing) : null
          const unfinished = preparation.state === 'failed' || without ? 'error' : 'preparing'
          store.setState({ status: store.getState().review ? 'ready' : unfinished, error: without ?? preparation.error })
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
        // A sample's units load as a live review's do.
        assessment = (await sample.getAssessment?.(id)) ?? null
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
      const kept = preparation && heldStill(preparation, review, null)
      store.setState({ status: 'ready', review, preparation: kept, assessment, error: null, ...(kept ? clock(kept) : {}) })
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
      const ready = opens(preparation)
      store.setState({ preparation, status: preparation.state === 'failed' ? 'error' : ready ? 'loading' : 'preparing', error: preparation.error, ...clock(preparation) })
      if (ready) await load()
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
   * Review again) and finishes. A check that fails is tried again on the next one. While its change lands, the review
   * holds still: only its notes and where hobkin moved the view come in.
   */
  const check = async (): Promise<void> => {
    const review = store.getState().review
    if (!command || disposed || !review || checking) return
    checking = true
    try {
      const before = store.getState().preparation
      const status = heldStill(await command('review.status', { id }), review, before)
      if (disposed || store.getState().review !== review) return
      keep(status)
      const ready = status.assessment?.state === 'ready' && !status.landing ? finishedOf(status.assessment.head, status.assessment.summary) : null
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
  /** Keeps a status for the open review, only when something changed, so an open review does not draw again every second. */
  const keep = (status: ReviewStatus) => {
    if (JSON.stringify(status) !== JSON.stringify(store.getState().preparation)) store.setState({ preparation: status, ...clock(status) })
  }
  /**
   * Asks the host now how the change lands, and keeps what it says for the open review: null when it says nothing. A
   * verdict that has just landed asks, even once the review has closed.
   */
  const look = async (): Promise<ReviewLanding | null> => {
    if (!command) return null
    const status = await command('review.status', { id })
    const review = store.getState().review
    if (!disposed && review) keep(heldStill(status, review, store.getState().preparation))
    return status.landing ?? null
  }
  /** Hears how the change lands now, and again each time that changes, until the function it answers is called. */
  const follow = (heard: (landing: ReviewLanding | null) => void): (() => void) => {
    const landingOf = (state: LoadState) => state.preparation?.landing ?? null
    let last = JSON.stringify(landingOf(store.getState()))
    const stop = store.subscribe((state) => {
      const said = JSON.stringify(landingOf(state))
      if (said === last) return
      last = said
      heard(landingOf(state))
    })
    heard(landingOf(store.getState()))
    return stop
  }
  const dispose = () => {
    disposed = true
    generation++
    loading = null
    unsubscribe()
  }
  return Object.assign(store, { source, load, check, start, tick, refresh: () => load(true), flushNotes, saveNotes, look, follow, dispose })
}
export type ReviewLoader = ReturnType<typeof createReviewLoader>
