import { ChevronDown, ChevronUp, GitBranch, GitPullRequest, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
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
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { NeedNumbers } from '@/features/review/panel/needs.ts'
import { buildButton, canReviewAgain, canReviewNow, groupReviews, nothingChanged, repoLinesOf, reviewToOpen, REVIEW_ORDERS, type PriorityOf, type RepoLine, type ReviewGroup, type ReviewRow } from './ai-reviews.ts'
import { offersStory, sortStory, stackLookup, waitingRows } from './review-story.ts'
import { useStory } from './story-store.ts'
import { useWorkView } from './store.ts'
import { DeployWhy, GradeChip, ReviewBadge, ReviewProgress, SectionHeading, Segmented } from './parts.tsx'
import { useReviewOrder } from './review-order.ts'
import { ACTION_LABEL, createReviewAgain, createRowActions, rowActions, type RowAction, type RowCommands } from './review-row-actions.ts'
import type { ReviewListView } from './use-review-list.ts'

/**
 * The AI Reviews tab (spec 032): every review the host knows, finished changes and pull requests together, as what is
 * running, what is ready and what failed, each in the order the switch on the first heading says: by priority, newest
 * first or oldest first. A running one says how far along it is, what it is doing now and how long it has taken; a
 * ready one its answer for the whole change (risky or safe to deploy), why, and when it finished. A click opens it.
 * One that is ready or stopped can be run again from its row: the review is built once more at the change's commit.
 * One that is waiting or running can be stopped from its row, alone: several run at a time.
 * Under it: Make it a stack (spec 060) on a change above 300 lines, and where the row has them, Remove, and Remove and delete branch. A review of an older commit says Rebuild where the others say Review again.
 */
const GROUPS: readonly { group: ReviewGroup; label: string }[] = [
  // What the user said yes to and has not merged: first, so a yes that did not land is never out of sight.
  { group: 'unmerged', label: 'Asked to merge, not merged' },
  { group: 'running', label: 'Running' },
  { group: 'ready', label: 'Ready' },
  { group: 'failed', label: 'Failed' },
]

export function AiReviews({ live, reviews, priorityOf }: {
  live: boolean
  reviews: ReviewListView
  /** Where a review's priority is read, for the order by priority and the chip on its row. */
  priorityOf: PriorityOf
}) {
  const order = useReviewOrder((state) => state.order)
  const groups = useMemo(() => groupReviews(reviews.list, { order, priorityOf }), [reviews.list, order, priorityOf])
  const lines = useMemo(() => repoLinesOf(reviews.list, priorityOf), [reviews.list, priorityOf])
  const { work } = useWorkView()
  const waiting = useMemo(() => waitingRows(groups, lines), [groups, lines])
  const stackOf = useMemo(() => stackLookup((work?.finished ?? []).flatMap((group) => group.changes)), [work])
  const shown = GROUPS.filter(({ group }) => groups[group].length > 0)
  const none = shown.length === 0 && lines.length === 0

  return (
    <div className="flex flex-col gap-10">
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
      {reviews.list && none ? <NoReviews /> : null}
      {lines.length > 0 ? <RepoLines lines={lines} live={live} onAgain={reviews.refresh} /> : null}
      {shown.map(({ group, label }, index) => (
        // The order switch sits on the first heading, so it is always at the top of the list, whichever group that is.
        <Group key={group} label={label} rows={groups[group]} live={live} onAgain={reviews.refresh} tools={index === 0 ? <OrderSwitch /> : null} />
      ))}
    </div>
  )
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

/** The order of every group's rows, picked by the user and kept on this machine. */
function OrderSwitch() {
  const order = useReviewOrder((state) => state.order)
  const choose = useReviewOrder((state) => state.choose)
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="eyebrow">Order</span>
      <Segmented label="Order of the reviews" name="review-order" value={order} options={REVIEW_ORDERS} onChoose={choose} />
    </div>
  )
}

/**
 * A line for each repository above the rows (spec 058): its reviews current, waiting and outdated, and what this week's
 * cost. Its rows that wait their turn fold under "Waiting (N)", closed at first; the button keeps its place at the end
 * of the line, and the rows open under it.
 */
export function RepoLines({ lines, live, onAgain, openAtFirst = [] }: { lines: RepoLine[]; live: boolean; onAgain: () => void; openAtFirst?: readonly string[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(openAtFirst))
  const toggle = (project: string) =>
    setOpen((before) => {
      const next = new Set(before)
      if (!next.delete(project)) next.add(project)
      return next
    })

  return (
    <section aria-label="Repositories" className="flex flex-col gap-3">
      <SectionHeading label="Repositories" count={lines.length} />
      <ul className="flex flex-col gap-3">
        {lines.map((line) => {
          const opened = open.has(line.project)
          return (
            <li key={line.project} className="flex flex-col gap-2">
              <div className="flex min-h-9 items-center gap-3 rounded-2xl bg-background px-5 py-1.5">
                <p className="min-w-0 flex-1 text-[14px] leading-snug tabular-nums [overflow-wrap:anywhere]">{line.words}</p>
                {line.waiting.length > 0 ? (
                  <Button variant="outline" size="sm" data-stop="" aria-expanded={opened} onClick={() => toggle(line.project)} className="shrink-0">
                    Waiting ({line.waiting.length})
                    {opened ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                  </Button>
                ) : null}
              </div>
              {opened ? (
                <ul aria-label={`Waiting in ${line.project}`} className="flex flex-col gap-2 pl-6">
                  {line.waiting.map((row) => (
                    <Card key={row.item.id} row={row} live={live} onAgain={onAgain} />
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** How a review starts, for a host that has none yet. */
function NoReviews() {
  return (
    <section aria-label="No review yet" className="flex flex-col items-start gap-3 rounded-3xl bg-background p-6">
      <p className="font-heading text-[18px] leading-snug font-semibold tracking-[-0.015em]">No review yet</p>
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
        A finished change gets one by itself, once work mode finishes it. A pull request gets one when you press Start review on its row on the GitHub page.
      </p>
      <Button variant="outline" data-stop="" onClick={() => useView.getState().openGitHub()}>
        Open GitHub
      </Button>
    </section>
  )
}

function Group({ label, rows, live, onAgain, tools }: { label: string; rows: ReviewRow[]; live: boolean; onAgain: () => void; tools: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <SectionHeading label={label} count={rows.length}>
        {tools}
      </SectionHeading>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.item.id} row={row} live={live} onAgain={onAgain} />
        ))}
      </ul>
    </section>
  )
}

/** When it happened, in the words of its group: the time so far, when it finished, or when it stopped. */
function whenOf({ group, startedAt, at }: ReviewRow, now: number): string {
  if (group === 'running') return startedAt === null ? '' : `${clockWords((now - startedAt) / 1000)} so far`
  if (at === null) return ''
  if (group === 'unmerged') return `asked ${waited(at, now)} ago`
  return `${group === 'ready' ? 'finished' : 'stopped'} ${waited(at, now)} ago`
}

/**
 * The row's time, the one part of it that follows the clock: a running review counts seconds, otherwise "finished 3
 * minutes ago" is enough. Only this draws again as the time moves.
 */
function When({ row }: { row: ReviewRow }) {
  const now = useNow(true, row.group === 'running' ? 1_000 : 30_000)
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
function ReviewAgain({ row, live, onAgain }: { row: ReviewRow; live: boolean; onAgain: () => void }) {
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
  const said = error ?? again.said()
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
function StopReview({ id, live, onStopped }: { id: string; live: boolean; onStopped: () => void }) {
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

function Card({ row, live, onAgain }: { row: ReviewRow; live: boolean; onAgain: () => void }) {
  const { item } = row
  const Kind = item.kind === 'pull' ? GitPullRequest : GitBranch
  // Who its pull request is from: its own, or the one a finished change opened. The host is asked once for each review,
  // and the panel shares the answer; until it says, the author a pull request's review recorded.
  const hasPullRequest = item.kind === 'pull' || row.link !== null
  const answered = usePullPeople(item.id, live && hasPullRequest)
  const recorded = item.kind === 'pull' ? peopleOfOwner(item.owner) : null
  const people = answered ?? recorded
  const again = canReviewAgain(row)
  // A row for a change above 300 lines also has Make it a stack; the others are Remove and its kin, which a row offers by its state.
  const actions = rowActions(row)
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
          {row.needs ? <RowNeeds needs={row.needs} /> : row.rate != null ? <span className="shrink-0">· rate {row.rate}</span> : null}
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
          className="stretched flex w-full scroll-mt-[164px] scroll-mb-6 flex-col gap-2.5 rounded-3xl px-5 pt-2.5 pb-2.5 text-left"
        >
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">
              <LayerPlace reviewId={item.id} head={item.head} />
              {item.title}
            </span>
            {row.group === 'ready' && !row.summary ? (
              <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-surface-2 px-3 font-heading text-[13px] font-medium text-muted-foreground">Review ready</span>
            ) : row.group === 'ready' ? (
              <ReviewBadge status={item.assessment} size="md" />
            ) : row.group === 'failed' ? (
              <ReviewBadge status={{ state: 'failed', head: item.head, error: row.line }} size="md" />
            ) : null}
          </span>
          {row.standing ? <span className="text-[14px] leading-snug text-muted-foreground">{row.standing}</span> : null}
          {row.group === 'running' ? (
            <span className="flex flex-col gap-2">
              {row.percent !== null ? (
                <span className="flex items-center gap-3">
                  <ReviewProgress percent={row.percent} label={`${item.title}: ${row.percent}% reviewed`} />
                  <span className="shrink-0 font-heading text-[14px] font-semibold tabular-nums">{row.percent}%</span>
                </span>
              ) : null}
              {/* A waiting row's whole reason, as the host says it: two lines at most, the rest in its tooltip. */}
              <span className="line-clamp-2 text-[14px] leading-snug" title={row.line}>
                {row.line}
              </span>
            </span>
          ) : null}
        </button>
      </div>
      <div className="flex min-h-8 items-center gap-3 px-5 pb-4">
        {row.summary ? <DeployWhy summary={row.summary} head={item.head} /> : null}
        {row.group === 'failed' ? <span className="min-w-0 text-[14px] leading-snug text-bad-fg">{row.line}</span> : null}
        {row.group === 'unmerged' ? <span className={row.item.mergeAsked?.state === 'failed' ? 'min-w-0 text-[14px] leading-snug text-bad-fg' : 'min-w-0 text-[14px] leading-snug text-muted-foreground'}>{row.line}</span> : null}
        {again || canReviewNow(row) ? <ReviewAgain row={row} live={live} onAgain={onAgain} /> : null}
        {/* A row that waits its turn has nothing running to stop. */}
        {!again && !item.waiting ? <StopReview id={item.id} live={live} onStopped={onAgain} /> : null}
      </div>
      {actions.length > 0 || rowOffersStack(item) ? <RowActions row={row} actions={actions} live={live} onChanged={onAgain} /> : null}
    </li>
  )
}

/**
 * The review's own answers to the user's five questions (spec 058), small, in the user's order, each after its short
 * word, then the general rate. Plain numbers: the evidence is in the review. It sits in the row's top line, never among
 * its controls.
 */
function RowNeeds({ needs }: { needs: NeedNumbers }) {
  const numbers = [...needs.numbers.map(({ word, value }) => `${word} ${value}`), ...(needs.rate ? [`general rate ${needs.rate}`] : [])].join(', ')
  // Numbers made at another commit than the row's say so first, so they never read as current.
  const said = needs.other ? `${needs.other} ${numbers}` : numbers
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums" aria-label={`Rated: ${said}`} title={said}>
      <span aria-hidden="true">·</span>
      {needs.other ? (
        <span aria-hidden="true" className="text-warn-fg">
          rated at {needs.at}, older:
        </span>
      ) : null}
      {needs.numbers.map(({ name, word, value }) => (
        <span key={name} aria-hidden="true">
          {word} <span className={value === 'not known' ? 'text-muted-foreground' : 'font-semibold text-foreground'}>{value}</span>
        </span>
      ))}
      {needs.rate ? (
        <span aria-hidden="true">
          · rate <span className="font-semibold text-foreground">{needs.rate}</span>
        </span>
      ) : null}
    </span>
  )
}

/** Sample rows have no host: an action says so on its second click, and nothing is removed. */
const sampleOnly = (async () => {
  throw new Error('This is sample data, so nothing is removed here.')
}) as RowCommands

/**
 * A row's actions, always shown under it (spec 032): Remove, which takes the review out of this list and nothing else,
 * and Remove and delete branch, the review's own no as its panel gives it, without opening it.
 * Each asks first: the first click says what it will do, a second within ten seconds does it, and after that it goes
 * back. Escape takes back the one waiting. A button keeps its width while it asks, so the one beside it never moves.
 */
function RowActions({ row, actions: offered, live, onChanged }: { row: ReviewRow; actions: RowAction[]; live: boolean; onChanged: () => void }) {
  const { item } = row
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

  return (
    <div
      role="group"
      aria-label={`Actions for ${item.title}`}
      className="flex flex-col px-5 pb-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !actions.armed()) return
        event.preventDefault()
        event.stopPropagation()
        actions.cancel()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {rowOffersStack(item) ? (
          <Button variant="outline" size="sm" data-stop="" aria-disabled={stack.busy} title="An agent splits this change into layers a reviewer reads one at a time." onClick={() => void stack.press()} className={cn('shrink-0', stack.busy && 'opacity-60')}>
            {/* Both words hold the button's place; only the one that applies shows, and only it is read. */}
            <span className="grid justify-items-center">
              <span className={cn('col-start-1 row-start-1', stack.busy && 'invisible')}>Make it a stack</span>
              <span className={cn('col-start-1 row-start-1', !stack.busy && 'invisible')}>Starting…</span>
            </span>
          </Button>
        ) : null}
        {offered.map((action) => (
          <Button
            key={action}
            variant="outline"
            size="sm"
            data-stop=""
            aria-pressed={armed === action}
            // A key still down from the first click only repeats: it never gives the second.
            onKeyDown={(event) => {
              if (heldDown(event)) event.preventDefault()
            }}
            onClick={() => void press(action)}
            className={cn('shrink-0', action !== 'remove' && 'text-destructive hover:text-destructive')}
          >
            {/* Both words hold the button's place; only the one that applies shows, and only it is read. */}
            <span className="grid justify-items-center">
              <span className={cn('col-start-1 row-start-1', armed === action && 'invisible')}>{ACTION_LABEL[action]}</span>
              <span className={cn('col-start-1 row-start-1', armed !== action && 'invisible')}>Click again to confirm</span>
            </span>
          </Button>
        ))}
      </div>
      {stack.error ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-pretty text-bad-fg [overflow-wrap:anywhere]">
          {stack.error}
        </p>
      ) : null}
      <RowSaid kind={item.kind} removal={removal} flow={flow} armed={armed} doing={doing} />
    </div>
  )
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
        Takes this review out of the list, and nothing else: {kind === 'pull' ? 'the pull request and its branch stay on GitHub.' : 'the change, its branch and its pull request stay.'} Click Remove again within ten seconds to confirm.
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
