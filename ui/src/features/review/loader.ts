import { createStore } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewLanding, ReviewNotes, ReviewStatus } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import { ReviewRefused } from '#shared/review/validate.ts'
import { mergeHostNotes } from './notes/merge.ts'
import { reviewStarted } from '../work/review-started.ts'
import { startOf, underWay } from './preparing-model.ts'
import type { ReviewLook } from './state/look.ts'
import { memoryKey, type MemoryState } from './state/memory.ts'
import type { StoreApi } from 'zustand/vanilla'

type ReviewCommand = 'review.status' | 'review.prepare' | 'review.get' | 'review.file' | 'review.notes'
export type ReviewCommands = <Name extends ReviewCommand>(name: Name, args: CommandArgs<Name>) => Promise<CommandResults[Name]>
export interface LoadState {
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
  /**
   * The review's look (spec 071), which the review on screen tells the loader. In Code the review opens on its diff as
   * soon as its graph is built, and nothing asks for its change review; the graph look asks for it and waits for it.
   */
  look: ReviewLook
  /**
   * The review on screen opened before its change review was ready, as the code look opens one, or the graph look has
   * just asked for it: until it is ready or stops, the graph look shows its progress (`waitsForReview`).
   */
  early: boolean
  /** The window is asking the host to start the change review, and the host has not answered yet. */
  asking: boolean
  /**
   * The graph look over a pull request the code look opened waits for "Start AI review" (`start`): a pull request is
   * reviewed only once the user asks, in the graph as when it opens there.
   */
  awaitingStart: boolean
}
interface Options {
  id: string
  scope: string
  memory: StoreApi<MemoryState>
  command?: ReviewCommands
  /** The look the review opens in (spec 071). Graph when none is given. */
  look?: ReviewLook
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
  const ownAssessment = [status.assessment, kept?.assessment].find((assessment) => assessment?.head === head)
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
    ...(ownAssessment ? { assessment: ownAssessment } : {}),
    landing: status.landing,
  }
}

/** Why a change that lands, with no review kept of it, shows none: none is prepared for it any more. */
const whyNoReview = (landing: ReviewLanding) =>
  landing.state === 'merged' ? 'This change is merged. It has no review to show.' : 'This change is being brought up to date to merge. It has no review to show.'

/**
 * A review whose graph stands at the commit its change is at, with no change review there: one built alone, as the code
 * look builds it (spec 071). The host must know that commit; a change that lands is done with.
 */
const unreviewed = (status: ReviewStatus): boolean => {
  if (status.state !== 'ready' || status.stale || status.landing) return false
  const run = status.assessment
  return run?.state === 'idle' && run.head != null
}

/**
 * Whether the graph look waits for the change review of the review on screen (spec 071): the review opened before it
 * was ready, none is loaded yet, and one is being asked for, is queued or is running. Until it is ready or stops, the
 * graph look shows its progress in place of the bare graph, as a review that opens in the graph waits for it.
 */
export function waitsForReview({ early, review, assessment, asking, preparation, awaitingStart }: Pick<LoadState, 'early' | 'review' | 'assessment' | 'asking' | 'preparation' | 'awaitingStart'>): boolean {
  if (!early || !review || assessment || preparation?.landing) return false
  if (awaitingStart) return true
  const run = preparation?.assessment?.state
  return asking || run === 'queued' || run === 'running'
}

/** A host from before spec 071 refuses an argument it does not know, as `changeReview`. */
const refusesArgument = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'invalid-arguments'

export function createReviewLoader({ id, scope, memory, command, sample, look: opensIn = 'graph', now = Date.now }: Options) {
  const store = createStore<LoadState>(() => ({ status: 'loading', startedAt: null, review: null, preparation: null, assessment: null, error: null, notesError: null, saving: false, look: opensIn, early: false, asking: false, awaitingStart: false }))
  let generation = 0
  /** Whether the host was asked how the review stands yet: only the first look asks for a change review nothing asked for. */
  let looked = false
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
  /**
   * Sets what changed, and nothing when nothing did. The host's replies are parsed anew each time, so a status, review
   * or change review equal to the one held is kept as it was: what reads the loader draws again only when the host says
   * something new, not each second it is asked.
   */
  const patch = (next: Partial<LoadState>) => {
    const held = store.getState()
    const changed = Object.entries(next).filter(([key, value]) => {
      const before = held[key as keyof LoadState]
      if (Object.is(value, before)) return false
      const replied = key === 'review' || key === 'preparation' || key === 'assessment'
      return !(replied && value && before && JSON.stringify(value) === JSON.stringify(before))
    })
    if (changed.length) store.setState(Object.fromEntries(changed) as Partial<LoadState>)
  }
  const notesOf = (review: Review): ReviewNotes => {
    const saved = memory.getState().of(review)
    return { entries: saved.notes, draft: saved.draft }
  }
  const flushNotes = (): Promise<void> => {
    if (!command || writing || !pending) return writing ?? Promise.resolve()
    writing = (async () => {
      patch({ saving: true })
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
          patch({ notesError: null })
        } catch (error) {
          pending ??= notes
          patch({ notesError: reason(error) })
          break
        }
      }
      patch({ saving: false })
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
   * A review opens once its change review is ready, or has stopped: its graph alone is a walk node by node, not a
   * review, and a review that is still being made is never shown as if it were done. Until then its progress shows.
   * The code look waits for none: its diff opens once the graph is built (spec 071).
   */
  const waits = (status: ReviewStatus): boolean => {
    const state = store.getState()
    const run = status.assessment?.state
    return state.look === 'graph' && !state.review && (run === 'queued' || run === 'running')
  }
  /**
   * Asks for the review's graph and its files alone, as the code look opens a review (spec 071). A host from before that
   * refuses the argument and builds each review whole: a finished change is asked for as before then, and a pull request
   * waits for "Start AI review" (null).
   */
  const graphOnly = async (ask: ReviewCommands): Promise<ReviewStatus | null> => {
    try {
      return await ask('review.prepare', { id, changeReview: false })
    } catch (error) {
      if (!refusesArgument(error)) throw error
      return startsByItself(id) ? ask('review.prepare', { id }) : null
    }
  }
  const opens = (status: ReviewStatus) => status.state === 'ready' && !waits(status)
  const executeLoad = async (refresh: boolean) => {
    disposed = false
    const turn = ++generation
    const revision = notesRevision
    const unsavedAtStart = memory.getState().unsyncedNotes[notesKey]
    const current = store.getState()
    // Polling a review being prepared keeps its view; only a first look shows "loading".
    patch({ error: null, ...(current.review || current.status === 'preparing' || current.status === 'awaiting' ? {} : { status: 'loading' as const }) })
    try {
      let review: Review
      let notes: ReviewNotes | null = null
      let preparation: ReviewStatus | null = null
      let assessment: ChangeAssessment | null = null
      if (command) {
        // A change that lands is never built again, even when asked: there is nothing newer to review.
        const rebuild = refresh && !current.preparation?.landing
        preparation = rebuild ? await command('review.prepare', { id, refresh: true }) : await command('review.status', { id })
        if (rebuild) reviewStarted(id)
        if (disposed || turn !== generation) return
        const open = store.getState().review
        if (preparation.landing && open) {
          // The review on screen holds still while its change lands: nothing newer is fetched for it.
          const held = heldStill(preparation, open, store.getState().preparation)
          patch({ preparation: held, status: 'ready', ...clock(held) })
          return
        }
        // Nothing prepared and nothing under way, its change review included. In the graph, a first look that finds a graph
        // built alone, with no change review at its commit, finds nothing asked for either (spec 071). A later look that
        // finds none, as after a stop while its graph was drawn, opens the graph as it is.
        const code = store.getState().look === 'code'
        const first = !looked
        looked = true
        const idle = preparation.state === 'idle' && !underWay(preparation)
        const asks = idle || (!code && first && !open && unreviewed(preparation))
        if (asks && !code && !startsByItself(id) && !refresh) {
          // Opening a pull request in the graph asks nothing of the host; "Start AI review" does.
          patch({ preparation, status: open ? 'ready' : 'awaiting', startedAt: null })
          return
        }
        if (asks && !preparation.landing) {
          // The code look asks for the graph and its files alone, a pull request's too: its diff opens with no change review.
          const asked = code ? await graphOnly(command) : await command('review.prepare', { id })
          if (asked) reviewStarted(id)
          if (disposed || turn !== generation) return
          if (!asked) {
            // A host from before the code look builds a pull request's review only on "Start AI review".
            patch({ preparation, status: open ? 'ready' : 'awaiting', startedAt: null })
            return
          }
          preparation = asked
        }
        patch({ preparation, ...clock(preparation) })
        if (!opens(preparation)) {
          // One that lands with no review kept, and none under way, waits for none: none is prepared for it.
          const noReview = preparation.landing && !underWay(preparation) ? whyNoReview(preparation.landing) : null
          const unfinished = preparation.state === 'failed' || noReview ? 'error' : 'preparing'
          patch({ status: store.getState().review ? 'ready' : unfinished, error: noReview ?? preparation.error })
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
      // Opened in the code look, it did not wait for its change review. A rebuild asked for in the graph shows over the graph, as before.
      const early = store.getState().look === 'code' || (!refresh && store.getState().early)
      patch({ status: 'ready', review, preparation: kept, assessment, error: null, early, ...(kept ? clock(kept) : {}) })
    } catch (error) {
      if (!disposed && turn === generation) {
        const unopened = error instanceof ReviewRefused ? 'refused' : 'error'
        patch({ status: store.getState().review ? 'ready' : unopened, error: reason(error) })
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
    // Over a review open already, as the graph look over a pull request the code look opened: its change review is
    // asked for, and the graph look shows its progress.
    if (store.getState().review) {
      patch({ awaitingStart: false })
      return askForReview()
    }
    const turn = ++generation
    try {
      const preparation = await command('review.prepare', { id })
      reviewStarted(id)
      if (disposed || turn !== generation) return
      const ready = opens(preparation)
      patch({ preparation, status: preparation.state === 'failed' ? 'error' : ready ? 'loading' : 'preparing', error: preparation.error, ...clock(preparation) })
      if (ready) await load()
    } catch (error) {
      if (!disposed && turn === generation) patch({ status: 'error', error: reason(error) })
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
      if (finished && opened.assessment) patch({ review: { ...opened.review, memoryScope: scope } as Review, assessment: opened.assessment })
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
  const keep = (status: ReviewStatus) => patch({ preparation: status, ...clock(status) })
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
  /**
   * Follows the review's look (spec 071). The graph look is where a change review starts: once the look becomes Graph
   * over a review whose change review is idle at its commit, the window asks for it, as "Start AI review" does, and the
   * graph look shows its progress until it is ready (`waitsForReview`). Going back to the code meanwhile leaves it running.
   */
  const setLook = async (next: ReviewLook): Promise<void> => {
    if (disposed || store.getState().look === next) return
    patch({ look: next })

    const { review, preparation, assessment } = store.getState()
    if (next !== 'graph' || !command || !review || assessment || preparation?.landing) return
    // Only a change review idle at the commit on screen: a review of an older commit is built again on the reviewer's word.
    const run = preparation?.assessment
    if (run?.state !== 'idle' || run.head !== review.change.head) return
    // A pull request is reviewed only once the user asks: the graph look offers "Start AI review" instead.
    if (!startsByItself(id)) {
      patch({ early: true, awaitingStart: true })
      return
    }
    await askForReview()
  }
  /** Asks the host for the change review of the review on screen, which the graph look then waits on. */
  const askForReview = async (): Promise<void> => {
    if (!command) return
    patch({ asking: true, early: true })
    try {
      const status = await command('review.prepare', { id })
      reviewStarted(id)
      const open = store.getState().review
      if (!disposed && open) keep(heldStill(status, open, store.getState().preparation))
    } catch (error) {
      if (!disposed) patch({ error: reason(error) })
    } finally {
      if (!disposed) patch({ asking: false })
    }
  }
  const dispose = () => {
    disposed = true
    generation++
    loading = null
    unsubscribe()
  }
  return Object.assign(store, { source, load, check, start, tick, refresh: () => load(true), flushNotes, saveNotes, look, setLook, dispose })
}
export type ReviewLoader = ReturnType<typeof createReviewLoader>
