import { GitBranch, GitPullRequest, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { waited } from '@/features/reports/time.ts'
import { peopleOfOwner } from '@/features/review/panel/by-line.ts'
import { ByLineNames } from '@/features/review/panel/ByLine.tsx'
import { usePullPeople } from '@/features/review/use-people.ts'
import { clockWords } from '@/features/review/preparing-model.ts'
import { heldDown } from '@/features/review/verdict.ts'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { canReviewAgain, groupReviews, reviewToOpen, type ReviewRow } from './ai-reviews.ts'
import { DeployWhy, ReviewBadge, ReviewProgress, SectionHeading } from './parts.tsx'
import { ACTION_LABEL, createRowActions, rowActions, type RowAction, type RowCommands } from './review-row-actions.ts'
import type { ReviewListView } from './use-review-list.ts'

/**
 * The AI Reviews tab (spec 032): every review the host knows, finished changes and pull requests together, as what is
 * running, what is ready and what failed, each newest first. A running one says how far along it is, what it is doing
 * now and how long it has taken; a ready one its answer for the whole change (risky or safe to deploy), why, and when
 * it finished. A click opens it.
 * One that is ready or stopped can be run again from its row: the review is built once more at the change's commit.
 * One that is waiting or running can be stopped from its row, alone: several run at a time.
 * Under it, on every row that has them: Remove, and Remove and delete branch.
 */
export function AiReviews({ live, reviews }: { live: boolean; reviews: ReviewListView }) {
  const groups = groupReviews(reviews.list)
  const none = groups.unmerged.length + groups.running.length + groups.ready.length + groups.failed.length === 0

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
      {reviews.list && none ? <NoReviews /> : null}
      {/* What the user said yes to and has not merged: first, so a yes that did not land is never out of sight. */}
      <Group label="Asked to merge, not merged" rows={groups.unmerged} live={live} onAgain={reviews.refresh} />
      <Group label="Running" rows={groups.running} live={live} onAgain={reviews.refresh} />
      <Group label="Ready" rows={groups.ready} live={live} onAgain={reviews.refresh} />
      <Group label="Failed" rows={groups.failed} live={live} onAgain={reviews.refresh} />
    </div>
  )
}

/** How a review starts, for a host that has none yet. */
function NoReviews() {
  return (
    <section aria-label="No AI review yet" className="flex flex-col items-start gap-3 rounded-3xl bg-background p-6">
      <p className="font-heading text-[18px] leading-snug font-semibold tracking-[-0.015em]">No AI review yet</p>
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
        A finished change gets one by itself, once work mode finishes it. A pull request gets one when you press Start AI review on its row on the GitHub page.
      </p>
      <Button variant="outline" data-stop="" onClick={() => useView.getState().openGitHub()}>
        Open GitHub
      </Button>
    </section>
  )
}

function Group({ label, rows, live, onAgain }: { label: string; rows: ReviewRow[]; live: boolean; onAgain: () => void }) {
  if (!rows.length) return null
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <SectionHeading label={label} count={rows.length} />
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

/**
 * "Review again" on a row: the host builds the review once more at the change's commit, tests and model pass
 * included, and the row moves to Running. It says so while the host is asked, and says why when the host refuses.
 */
function ReviewAgain({ id, live, onAgain }: { id: string; live: boolean; onAgain: () => void }) {
  const [asking, setAsking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const again = async () => {
    if (!live) return setRefused('This is sample data, so no review runs here.')
    setAsking(true)
    setRefused(null)
    try {
      await runCommand('review.prepare', { id, refresh: true })
      onAgain()
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
      <Button variant="outline" size="sm" data-stop="" disabled={asking} title="Builds this review again at the change's commit: its tests and one model pass." onClick={() => void again()} className="shrink-0">
        <RotateCcw aria-hidden="true" />
        {asking ? 'Starting…' : 'Review again'}
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
  // A row with no action, as someone else's pull request while its review runs, has no row of them.
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
          className="stretched flex w-full scroll-mt-[164px] scroll-mb-6 flex-col gap-2.5 rounded-3xl px-5 pt-2.5 pb-2.5 text-left"
        >
          <span className="flex items-start gap-3">
            <span className="min-w-0 flex-1 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">{item.title}</span>
            {row.group === 'ready' && !row.summary ? (
              <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-surface-2 px-3 font-heading text-[13px] font-medium text-muted-foreground">Review ready</span>
            ) : row.group === 'ready' ? (
              <ReviewBadge status={item.assessment} size="md" />
            ) : row.group === 'failed' ? (
              <ReviewBadge status={{ state: 'failed', head: item.head, error: row.line }} size="md" />
            ) : null}
          </span>
          {row.group === 'running' ? (
            <span className="flex flex-col gap-2">
              {row.percent !== null ? (
                <span className="flex items-center gap-3">
                  <ReviewProgress percent={row.percent} label={`${item.title}: ${row.percent}% reviewed`} />
                  <span className="shrink-0 font-heading text-[14px] font-semibold tabular-nums">{row.percent}%</span>
                </span>
              ) : null}
              <span className="text-[14px] leading-snug">{row.line}</span>
            </span>
          ) : null}
        </button>
      </div>
      <div className="flex min-h-8 items-center gap-3 px-5 pb-4">
        {row.summary ? <DeployWhy summary={row.summary} head={item.head} /> : null}
        {row.group === 'failed' ? <span className="min-w-0 text-[14px] leading-snug text-bad-fg">{row.line}</span> : null}
        {row.group === 'unmerged' ? <span className={row.item.mergeAsked?.state === 'failed' ? 'min-w-0 text-[14px] leading-snug text-bad-fg' : 'min-w-0 text-[14px] leading-snug text-muted-foreground'}>{row.line}</span> : null}
        {again ? <ReviewAgain id={item.id} live={live} onAgain={onAgain} /> : null}
        {/* A row that waits its turn has nothing running to stop. */}
        {!again && !item.waiting ? <StopReview id={item.id} live={live} onStopped={onAgain} /> : null}
      </div>
      {actions.length ? <RowActions row={row} actions={actions} live={live} onChanged={onAgain} /> : null}
    </li>
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
