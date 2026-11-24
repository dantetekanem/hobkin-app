import { GitBranch, GitPullRequest, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { openAddress } from '@/lib/open-link.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { waited } from '@/features/reports/time.ts'
import { peopleOfOwner } from '@/features/review/panel/by-line.ts'
import { ByLineNames } from '@/features/review/panel/ByLine.tsx'
import { usePullPeople } from '@/features/review/use-people.ts'
import { LayerPlace } from '@/features/review/panel/StackStrip.tsx'
import { rowOffersStack } from '@/features/review/stack-start.ts'
import { useStackStart } from '@/features/review/use-stack-start.ts'
import { clockWords } from '@/features/review/preparing-model.ts'
import { heldDown } from '@/features/review/verdict.ts'
import { pullScreen } from '@/integration/pull-screen.ts'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { buildButton, canReviewAgain, canReviewNow, nothingChanged, repoWordsOf, reviewToOpen, REVIEW_ORDERS, rowsOf, type PriorityOf, type ReviewOrder, type ReviewRow } from './ai-reviews.ts'
import { GRADE_WORDS, orderRows, placedRows, projectsOf, setKeyOf, stateNews, stateWords } from './review-list.ts'
import { offersStory, sortStory, stackLookup, waitingRows, type StackOf } from './review-story.ts'
import { useStory } from './story-store.ts'
import { useWorkView } from './store.ts'
import { DeployWhy, GradeChip, ReviewBadge, ReviewProgress, SectionHeading, Segmented } from './parts.tsx'
import { QUESTIONS, type NeedNumbers } from '@/features/review/panel/needs.ts'
import { useReviewOrder } from './review-order.ts'
import { ReviewRowMenu, type ReviewRowMenuItem } from './ReviewRowMenu.tsx'
import { ACTION_LABEL, createReviewAgain, createRowActions, rowActions, type RowAction, type RowCommands } from './review-row-actions.ts'
import type { ReviewListView } from './use-review-list.ts'

/**
 * The Review list (spec 032, 067): every review the host knows, finished changes and pull requests together, as one
 * list. Each row says its own state in the same place: the rate and the five grades when it is rated, else "Reviewing
 * 48%", "Waits its turn", "Review failed" or "Not rated". The projects are quiet headings over their rows, a visual aid
 * only. The order is the story's, easiest first, until the user picks another; a row's place changes only when the
 * list's rows change or the order does.
 * One that is ready or stopped can be run again from its row: the review is built once more at the change's commit.
 * One that is waiting or running can be stopped from its row, alone: several run at a time.
 * Under it: Make it a stack (spec 060) on a change above 300 lines, and where the row has them, Remove, and Remove and delete branch. A review of an older commit says Rebuild where the others say Review again.
 */
export function AiReviews({ live, reviews, priorityOf }: {
  live: boolean
  reviews: ReviewListView
  /** Where a review's priority is read, for the order by priority and the chip on its row. */
  priorityOf: PriorityOf
}) {
  const order = useReviewOrder((state) => state.order)
  const { work } = useWorkView()
  const rows = useMemo(() => rowsOf(reviews.list, priorityOf), [reviews.list, priorityOf])
  const words = useMemo(() => repoWordsOf(reviews.list), [reviews.list])
  const waiting = useMemo(() => waitingRows(rows), [rows])
  const stackOf = useMemo(() => stackLookup((work?.finished ?? []).flatMap((group) => group.changes)), [work])
  const placed = usePlacedRows(rows, order, stackOf, work !== null)
  const projects = useMemo(() => projectsOf(placed), [placed])

  return (
    <div className="flex flex-col gap-8">
      {reviews.error ? (
        <p role="alert" className="px-1 text-[14px] leading-snug text-bad-fg">
          The reviews could not be read: {reviews.error}
        </p>
      ) : null}
      {reviews.list === null && !reviews.error ? (
        <p role="status" className="px-1 text-[14px] text-muted-foreground">
          Reading the reviews…
        </p>
      ) : null}
      {live && offersStory(waiting) ? <StoryOffer count={waiting.length} onStart={() => startStory(sortStory(waiting, stackOf))} /> : null}
      {reviews.list && rows.length === 0 ? <NoReviews /> : null}
      {rows.length > 0 ? <OrderSwitch count={rows.length} /> : null}
      {projects.map(({ project, rows: own }) => (
        <Project key={project} project={project} words={words.get(project)} rows={own} live={live} onAgain={reviews.refresh} />
      ))}
    </div>
  )
}

/**
 * The rows in the order picked, held while the list moves: sorted again only when the set of rows changes or the order
 * does, so a row never jumps under the user as a review runs or finishes. Its facts are always the newest. What the
 * order reads (the priorities, the stacks) is read when it sorts, and again once the work is known.
 */
function usePlacedRows(rows: ReviewRow[], order: ReviewOrder, stackOf: StackOf, known: boolean): ReviewRow[] {
  const latest = useRef({ rows, stackOf })
  latest.current = { rows, stackOf }
  const key = useMemo(() => setKeyOf(rows), [rows])
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- the sort reads the newest rows through the ref, on purpose.
  const ids = useMemo(() => orderRows(latest.current.rows, order, latest.current.stackOf).map((row) => row.item.id), [key, order, known])
  return useMemo(() => placedRows(ids, rows), [ids, rows])
}

/** Opens the first review of the story, whose order is fixed now (spec 064). */
function startStory(queue: readonly ReviewRow[]) {
  const first = useStory.getState().start(queue.map((row) => row.item.id))
  if (first) useView.getState().openReviewFor(first)
}

/** The offer to go through the reviews waiting on the user one by one: one quiet line at the top of the list. */
export function StoryOffer({ count, onStart }: { count: number; onStart: () => void }) {
  return (
    <div className="-mb-4 flex min-h-9 items-center gap-3 px-1">
      <p className="min-w-0 flex-1 text-[14px] leading-snug text-muted-foreground tabular-nums">
        {count} changes wait for you. Go through them one by one, easiest first?
      </p>
      <Button variant="outline" size="sm" data-stop="" onClick={onStart} className="shrink-0">
        Start
      </Button>
    </div>
  )
}

/** The order of the rows, picked by the user and kept on this machine. It is in the same place whatever the list holds. */
function OrderSwitch({ count }: { count: number }) {
  const order = useReviewOrder((state) => state.order)
  const choose = useReviewOrder((state) => state.choose)
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <h2 className="eyebrow flex items-baseline gap-2">
        Reviews <span className="tabular-nums">{count}</span>
      </h2>
      <div className="ml-auto flex items-center gap-2">
        <span className="eyebrow">Order</span>
        <Segmented label="Order of the reviews" name="review-order" value={order} options={REVIEW_ORDERS} onChoose={choose} />
      </div>
    </div>
  )
}

/** How a review starts, for a host that has none yet. */
function NoReviews() {
  const pulls = pullScreen()
  return (
    <section aria-label="No review yet" className="flex flex-col items-start gap-3 rounded-3xl bg-background p-6">
      <p className="font-heading text-[18px] leading-snug font-semibold tracking-[-0.015em]">No review yet</p>
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
        A finished change gets one by itself, once work mode finishes it.
        {pulls ? ` A pull request gets one when you press Start review on its row on the ${pulls.label} page.` : ''}
      </p>
      {pulls ? (
        <Button variant="outline" data-stop="" onClick={() => useView.getState().openPartScreen(pulls.id)}>
          Open {pulls.label}
        </Button>
      ) : null}
    </section>
  )
}

/** One project's rows under a quiet heading, a visual aid only: its name and count, and what the host keeps of its line. */
function Project({ project, words, rows, live, onAgain }: { project: string; words: string | undefined; rows: ReviewRow[]; live: boolean; onAgain: () => void }) {
  return (
    <section aria-label={project} className="flex flex-col gap-3">
      <SectionHeading label={project} count={rows.length}>
        {words ? <span className="min-w-0 text-[13px] leading-snug text-muted-foreground tabular-nums">{words}</span> : null}
      </SectionHeading>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.item.id} row={row} live={live} onAgain={onAgain} />
        ))}
      </ul>
    </section>
  )
}

/** When it happened, in the words of its state: the time so far, when the merge was asked, when it finished, or when it stopped. */
function whenOf({ state, merge, startedAt, at }: ReviewRow, now: number): string {
  if (state.kind === 'reviewing') return startedAt === null ? '' : `${clockWords((now - startedAt) / 1000)} so far`
  if (at === null || state.kind === 'waits') return ''
  if (merge) return `asked ${waited(at, now)} ago`
  return `${state.kind === 'ready' ? 'finished' : 'stopped'} ${waited(at, now)} ago`
}

/**
 * The row's time, the one part of it that follows the clock: a review being reviewed counts seconds, otherwise
 * "finished 3 minutes ago" is enough. Only this draws again as the time moves.
 */
function When({ row }: { row: ReviewRow }) {
  const now = useNow(true, row.state.kind === 'reviewing' ? 1_000 : 30_000)
  return <span className="ml-auto shrink-0 pl-2 tabular-nums">{whenOf(row, now)}</span>
}

/** Sample rows have no host: building one says so, and nothing runs. */
const sampleBuild = async () => {
  throw new Error('This is sample data, so no review runs here.')
}

/**
 * "Review again" on a row, or "Review now" on one that waits its turn (spec 058): the host builds the review once more
 * at the change's commit, or builds a waiting one at once outside its repository's line, and the row moves to Running.
 * With nothing changed since the review, Review again first says so and what it costs, and builds it on a second press
 * within ten seconds: a live host says it, in its own words, and the sample's row says it by itself. The button keeps
 * its width while it asks, so nothing beside it moves. It says so while the host is asked, and why when it refuses.
 */
function useReviewAgain(row: ReviewRow, live: boolean, onAgain: () => void) {
  const { word, now } = buildButton(row)
  // A live host decides whether anything changed; only a row with no host to ask checks by itself.
  const unchanged = !live && !now && nothingChanged(row)
  // Read when the host took it, so a list that reads itself again with a new function never starts this over.
  const started = useRef(onAgain)
  started.current = onAgain
  const again = useMemo(
    () =>
      createReviewAgain({
        id: row.item.id,
        unchanged,
        now,
        command: live ? (name, args) => runCommand(name, args) : sampleBuild,
        started: () => started.current(),
      }),
    [row.item.id, unchanged, now, live],
  )
  useEffect(() => () => again.cancel(), [again])
  const { armed, busy, error } = useStore(again)
  return { again, word, now, armed, busy, error, said: error ?? again.said() }
}

type AgainControl = ReturnType<typeof useReviewAgain>

function ReviewAgain({ control }: { control: AgainControl }) {
  const { again, word, now, armed, busy, error, said } = control
  const label = word

  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-2"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !again.getState().armed) return
        event.preventDefault()
        event.stopPropagation()
        again.cancel()
      }}
    >
      {said ? (
        <span role={error ? 'alert' : 'status'} className={cn('max-w-[22rem] text-[13px] leading-snug', error ? 'text-bad-fg' : 'text-foreground')}>
          {said}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        data-stop=""
        aria-pressed={armed}
        disabled={busy}
        title={now ? "Builds this review now, outside its repository's line: its tests and one model pass." : "Builds this review again at the change's commit: its tests and one model pass."}
        // A key still down from the first press only repeats: it never gives the second.
        onKeyDown={(event) => {
          if (heldDown(event)) event.preventDefault()
        }}
        onClick={() => void again.press()}
        className="shrink-0"
      >
        {now ? <Play aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
        {/* Each of its words holds the button's place; only the one that applies shows, and only it is read. */}
        <span className="grid justify-items-center">
          <span className={cn('col-start-1 row-start-1', (armed || busy) && 'invisible')}>{label}</span>
          {/* Only a press that can ask first holds the place of its second. */}
          {!now ? <span className={cn('col-start-1 row-start-1', !armed && 'invisible')}>Click again to confirm</span> : null}
          <span className={cn('col-start-1 row-start-1', !busy && 'invisible')}>Starting…</span>
        </span>
      </Button>
    </span>
  )
}

/** "Stop" on a row that is waiting or running: the host stops that review alone, where it is, tests included. */
function useStop(id: string, live: boolean, onStopped: () => void) {
  const [asking, setAsking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const stop = async () => {
    if (!live) return setRefused('This is sample data, so no review runs here.')
    setAsking(true)
    setRefused(null)
    try {
      await runCommand('review.stop', { id })
      onStopped()
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error))
    } finally {
      setAsking(false)
    }
  }
  return { asking, refused, stop }
}

function StopReview({ control }: { control: ReturnType<typeof useStop> }) {
  const { asking, refused, stop } = control
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      {refused ? (
        <span role="alert" className="max-w-[20rem] text-[13px] leading-snug text-bad-fg">
          {refused}
        </span>
      ) : null}
      <Button variant="outline" size="sm" data-stop="" disabled={asking} title="Stops this review where it is. Others keep running." onClick={() => void stop()} className="shrink-0">
        <Square aria-hidden="true" className="fill-current" />
        {asking ? 'Stopping…' : 'Stop'}
      </Button>
    </span>
  )
}

/** The place of a row's grades, one size whatever it holds, so the row's height never changes when a rating lands. */
const LEAD = 'flex h-[46px] w-[19rem] max-w-full shrink-0 items-stretch gap-1'

const toneOf = (value: number, low: number, high: number) => (value >= high ? 'text-ok-fg' : value >= low ? 'text-warn-fg' : 'text-bad-fg')

/** The general rate and the five grades, each with its question as its tooltip. A grade not known is a dash. */
function Grades({ needs }: { needs: NeedNumbers }) {
  const rate = needs.rate != null ? Number(needs.rate) : null
  return (
    <span className={LEAD} aria-label={`Rated: ${needs.numbers.map(({ word, value }) => `${word} ${value}`).join(', ')}${needs.rate ? `, general rate ${needs.rate}` : ''}`}>
      <span title="General rate: the review's own answer for the whole change." className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 tabular-nums">
        <span className="text-[10.5px] leading-none text-muted-foreground">Rate</span>
        <span className={cn('font-heading text-[16px] leading-tight font-semibold', rate != null ? toneOf(rate, 6, 8) : 'text-muted-foreground')}>{needs.rate ?? '–'}</span>
      </span>
      {needs.numbers.map(({ name, value }) => {
        const known = /^\d/.test(value)
        return (
          <span key={name} title={`${QUESTIONS[name]}${known ? '' : ' Not known.'}`} className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl bg-tone-1 tabular-nums">
            <span className="text-[10.5px] leading-none text-muted-foreground">{GRADE_WORDS[name]}</span>
            <span className={cn('text-[14px] leading-tight font-semibold', known ? toneOf(Number(value), 5, 7) : 'text-muted-foreground')}>{known ? value : '–'}</span>
          </span>
        )
      })}
    </span>
  )
}

/** Where the grades go, for a row with none: what the row is doing, or that its review has not rated it. Same size as the grades. */
function Standing({ row }: { row: ReviewRow }) {
  const failed = row.state.kind === 'failed'
  return (
    <span title={row.item.rating?.text ?? row.line} className={cn(LEAD, 'items-center rounded-xl bg-tone-1 px-3 text-[13px] leading-snug tabular-nums', failed ? 'text-bad-fg' : 'text-muted-foreground')}>
      <span className="truncate">{stateWords(row.state)}</span>
    </span>
  )
}

const TAG = 'inline-flex h-5 shrink-0 items-center rounded-full bg-surface-2 px-2 font-heading text-[11px] font-medium whitespace-nowrap text-muted-foreground tabular-nums'

/** The one sentence under a title that says what its state is about: what it does now, why it waits, why it stopped, or why a merge did not happen. */
function detailOf(row: ReviewRow): { text: string; bad: boolean } | null {
  if (row.merge) return { text: `You said merge, and it did not merge: ${row.merge.why}`, bad: true }
  if (row.state.kind === 'failed') return { text: row.line, bad: true }
  if (row.state.kind === 'reviewing' || row.state.kind === 'waits') return { text: row.line, bad: false }
  return null
}

function Card({ row, live, onAgain }: { row: ReviewRow; live: boolean; onAgain: () => void }) {
  const { item, state } = row
  const Kind = item.kind === 'pull' ? GitPullRequest : GitBranch
  // Who its pull request is from: its own, or the one a finished change opened. The host is asked once for each review,
  // and the panel shares the answer; until it says, the author a pull request's review recorded.
  const hasPullRequest = item.kind === 'pull' || row.link !== null
  const answered = usePullPeople(item.id, live && hasPullRequest)
  const recorded = item.kind === 'pull' ? peopleOfOwner(item.owner) : null
  const people = answered ?? recorded
  const again = canReviewAgain(row)
  const control = useReviewAgain(row, live, onAgain)
  const stopping = useStop(item.id, live, onAgain)
  const rowControls = useRowActions(row, live, onAgain)
  const stopsHere = !again && !item.waiting
  const buildsHere = again || canReviewNow(row)
  const detail = detailOf(row)
  // A rated row shows its grades, so what it is doing is a tag; an unrated one says it where its grades would be.
  const news = row.needs ? stateNews(state) : null
  return (
    // The row is the card: opening it and running it again are two buttons, side by side, never one inside the other.
    <li className="flex flex-col rounded-3xl bg-background transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 has-[[data-review-id]:focus-visible]:bg-tone-2">
      {/* The button that opens the review is stretched under the line above it, so that line's links sit beside the button and the rest of the line still opens the review. */}
      <div className="relative isolate flex flex-col">
        <p className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-2 px-5 pt-5 text-[13px] text-muted-foreground [&_a]:pointer-events-auto">
          <Kind aria-hidden="true" className="size-4 shrink-0" />
          {row.link ? (
            <a href={row.link} target="_blank" rel="noopener noreferrer" data-stop="" className="min-w-0 truncate font-medium text-foreground underline decoration-foreground/35 underline-offset-2 hover:decoration-foreground">
              {row.where}
            </a>
          ) : (
            <span className="min-w-0 truncate font-medium text-foreground">{row.where}</span>
          )}
          <GradeChip grade={row.priority} />
          <span className="shrink-0">· {item.kind === 'pull' ? 'Pull request' : 'Finished change'}</span>
          {people?.author ? (
            <span className="min-w-0 truncate">
              · <ByLineNames people={people} />
            </span>
          ) : null}
          <When row={row} />
        </p>
        <button
          type="button"
          data-stop=""
          data-review-id={item.id}
          onClick={() => useView.getState().openReviewFor(reviewToOpen(item, live))}
          className="stretched flex w-full scroll-mt-[164px] scroll-mb-6 flex-wrap items-start gap-x-4 gap-y-2.5 rounded-3xl px-5 pt-2.5 pb-2.5 text-left"
        >
          {row.needs ? <Grades needs={row.needs} /> : <Standing row={row} />}
          <span className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
            <span className="flex items-start gap-3">
              <span className="min-w-0 flex-1 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">
                <LayerPlace reviewId={item.id} head={item.head} />
                {item.title}
              </span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {news ? <span className={cn(TAG, state.kind === 'failed' && 'bg-bad/15 text-bad-fg')}>{news}</span> : null}
                {row.merge ? <span className={cn(TAG, 'bg-bad/15 text-bad-fg')}>Did not merge</span> : null}
                {row.needs?.other ? <span className={cn(TAG, 'text-warn-fg')} title={row.needs.other}>rated at {row.needs.at}, older</span> : null}
                {state.kind === 'ready' && row.summary ? <ReviewBadge status={item.assessment} size="md" /> : null}
              </span>
            </span>
            {row.standing ? <span className="text-[14px] leading-snug text-muted-foreground">{row.standing}</span> : null}
            {state.kind === 'reviewing' && row.percent !== null ? (
              <span className="flex items-center gap-3">
                <ReviewProgress percent={row.percent} label={`${item.title}: ${row.percent}% reviewed`} />
                <span className="shrink-0 font-heading text-[14px] font-semibold tabular-nums">{row.percent}%</span>
              </span>
            ) : null}
            {/* Why, as the host says it: two lines at most, the rest in its tooltip. */}
            {detail ? (
              <span className={cn('line-clamp-2 text-[14px] leading-snug', detail.bad ? 'text-bad-fg' : 'text-foreground')} title={detail.text}>
                {detail.text}
              </span>
            ) : null}
          </span>
        </button>
      </div>
      <div
        role="group"
        aria-label={`Actions for ${item.title}`}
        className="flex flex-col px-5 pb-4"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !rowControls.actions.armed()) return
          event.preventDefault()
          event.stopPropagation()
          rowControls.actions.cancel()
        }}
      >
        <div className="flex min-h-8 items-center gap-3">
          {row.summary ? <DeployWhy summary={row.summary} head={item.head} /> : null}
          {buildsHere ? <ReviewAgain control={control} /> : null}
          {/* A row that waits its turn has nothing running to stop. */}
          {stopsHere ? <StopReview control={stopping} /> : null}
          {/* The menu is in the same place on every row: at the end, after the row's one action. */}
          <span className={cn('flex shrink-0 items-center', !buildsHere && !stopsHere && 'ml-auto')}>
            <ReviewRowMenu label={`More for ${item.title}`} items={menuItems({ row, live, control, stopping, rowControls, canBuild: buildsHere, canStop: stopsHere })} />
          </span>
        </div>
        {rowControls.stack.error ? (
          <p role="alert" className="mt-2 text-[13px] leading-snug text-pretty text-bad-fg [overflow-wrap:anywhere]">
            {rowControls.stack.error}
          </p>
        ) : null}
        <RowSaid kind={item.kind} removal={rowControls.removal} flow={rowControls.flow} armed={rowControls.armed} doing={rowControls.doing} />
      </div>
    </li>
  )
}

/** Everything the row can do, in the menu at its end: its own actions and the one beside it, each as it is today. */
function menuItems({ row, live, control, stopping, rowControls, canBuild, canStop }: {
  row: ReviewRow
  live: boolean
  control: AgainControl
  stopping: ReturnType<typeof useStop>
  rowControls: ReturnType<typeof useRowActions>
  canBuild: boolean
  canStop: boolean
}): ReviewRowMenuItem[] {
  const { item } = row
  const items: ReviewRowMenuItem[] = [{ key: 'open', label: 'Open the review', onSelect: () => useView.getState().openReviewFor(reviewToOpen(item, live)) }]
  if (canBuild) {
    items.push({
      key: 'build',
      label: control.armed ? 'Click again to confirm' : control.word,
      disabled: control.busy,
      // A review that asks first stays open for its second press.
      onSelect: async () => {
        await control.again.press()
        return control.again.getState().armed
      },
    })
  }
  if (rowOffersStack(item)) items.push({ key: 'stack', label: rowControls.stack.busy ? 'Starting…' : 'Make it a stack', disabled: rowControls.stack.busy, onSelect: () => void rowControls.stack.press() })
  if (canStop) items.push({ key: 'stop', label: stopping.asking ? 'Stopping…' : 'Stop the review', disabled: stopping.asking, onSelect: () => void stopping.stop() })
  if (row.link) {
    const link = row.link
    items.push({ key: 'pull', label: 'Open the pull request on GitHub', onSelect: () => openAddress(link) })
  }
  rowControls.offered.forEach((action, at) => {
    items.push({
      key: action,
      label: rowControls.armed === action ? 'Click again to confirm' : ACTION_LABEL[action],
      destructive: true,
      ruleBefore: at === 0,
      onSelect: async () => {
        await rowControls.press(action)
        return rowControls.actions.armed() !== null
      },
    })
  })
  return items
}

/** Sample rows have no host: an action says so on its second click, and nothing is removed. */
const sampleOnly = (async () => {
  throw new Error('This is sample data, so nothing is removed here.')
}) as RowCommands

/**
 * A row's actions (spec 032), in the row's menu: Remove, which takes the review out of this list and nothing else, and
 * Remove and delete branch, the review's own no as its panel gives it, without opening it.
 * Each asks first: the first press says what it will do, a second within ten seconds does it, and after that it goes
 * back. Escape takes back the one waiting. Its words show under the row.
 */
function useRowActions(row: ReviewRow, live: boolean, onChanged: () => void) {
  const { item } = row
  const offered = rowActions(row)
  // Read when the host has done one, so a list that reads itself again with a new function never starts this over.
  const changed = useRef(onChanged)
  changed.current = onChanged
  const actions = useMemo(
    () => createRowActions({ id: item.id, head: item.head, command: live ? runCommand : sampleOnly, changed: () => changed.current() }),
    [item.id, item.head, live],
  )
  useEffect(() => actions.connect(), [actions])
  const removal = useStore(actions.removal)
  const flow = useStore(actions.verdicts)
  const armed: RowAction | null = removal.armed ? 'remove' : ((flow.preview?.verdict as RowAction | undefined) ?? null)
  // The action whose second click the host is doing now.
  const [doing, setDoing] = useState<RowAction | null>(null)
  const stack = useStackStart(item.id, live)

  const press = async (action: RowAction) => {
    if (armed === action) setDoing(action)
    try {
      await actions.press(action)
    } finally {
      setDoing(null)
    }
  }
  return { actions, offered, removal, flow, armed, doing, stack, press }
}

/** What the row says under its actions: what the one waiting will do, the host at work, its words when done, or why not. */
function RowSaid({ kind, removal, flow, armed, doing }: {
  kind: 'change' | 'pull'
  removal: { busy: boolean; error: string | null }
  flow: { busy: boolean; preview: { lines: string[] } | null; error: string | null; message: string | null }
  armed: RowAction | null
  doing: RowAction | null
}) {
  const error = removal.error ?? flow.error
  let said: ReactNode = null
  if (removal.busy) said = <p className="text-muted-foreground">Removing it from the list…</p>
  else if (flow.busy) said = <p className="text-muted-foreground">{doing ? 'The host is doing it…' : 'Asking the host what it will do…'}</p>
  else if (error) {
    said = (
      <p className="flex items-start gap-2 text-bad-fg">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </p>
    )
  } else if (armed === 'remove') {
    said = (
      <p className="text-pretty">
        Takes this review out of the list, and nothing else: {kind === 'pull' ? 'the pull request and its branch stay where they are.' : 'the change, its branch and its pull request stay.'} Click Remove again within ten seconds to confirm.
      </p>
    )
  } else if (flow.preview && armed) {
    said = (
      <div className="flex flex-col gap-1.5">
        <p className="font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{ACTION_LABEL[armed]} will</p>
        <ul className="flex flex-col gap-1 text-pretty">
          {flow.preview.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">Click it again within ten seconds to confirm. Esc takes it back.</p>
      </div>
    )
  } else if (flow.message) said = <p className="text-pretty">{flow.message}</p>
  // The status region is always there, so what it comes to say is read out; only its words come and go.
  return (
    <div role="status">
      {said ? <div className="mt-2.5 max-w-[72ch] rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] leading-[1.45] [overflow-wrap:anywhere]">{said}</div> : null}
    </div>
  )
}
