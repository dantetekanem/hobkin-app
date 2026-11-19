import { Ellipsis, GitBranch, GitPullRequest, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { waited } from '@/features/reports/time.ts'
import { byLineWords, peopleOfOwner } from '@/features/review/panel/by-line.ts'
import { usePullPeople } from '@/features/review/use-people.ts'
import { clockWords } from '@/features/review/preparing-model.ts'
import { heldDown } from '@/features/review/verdict.ts'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { canReviewAgain, groupReviews, reviewToOpen, type ReviewRow } from './ai-reviews.ts'
import { DeployWhy, ReviewBadge, ReviewProgress, SectionHeading } from './parts.tsx'
import { createRowActions, moreTitle, rowActions, type RowAction, type RowCommands } from './review-row-actions.ts'
import type { ReviewListView } from './use-review-list.ts'

/**
 * The AI Reviews tab (spec 032): every review the host knows, finished changes and pull requests together, as what is
 * running, what is ready and what failed, each newest first. A running one says how far along it is, what it is doing
 * now and how long it has taken; a ready one its answer for the whole change (risky or safe to deploy), why, and when
 * it finished. A click opens it.
 * One that is ready or stopped can be run again from its row: the review is built once more at the change's commit.
 * One that is waiting or running can be stopped from its row, alone: several run at a time.
 * The rarer actions sit behind one small "More" on the row: Remove, Discard, and Discard and delete branch.
 */
export function AiReviews({ live, reviews }: { live: boolean; reviews: ReviewListView }) {
  const groups = groupReviews(reviews.list)
  // A running review's clock counts seconds; otherwise "finished 3 minutes ago" is enough.
  const now = useNow(true, groups.running.length ? 1_000 : 30_000)
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
      <Group label="Asked to merge, not merged" rows={groups.unmerged} now={now} live={live} onAgain={reviews.refresh} />
      <Group label="Running" rows={groups.running} now={now} live={live} onAgain={reviews.refresh} />
      <Group label="Ready" rows={groups.ready} now={now} live={live} onAgain={reviews.refresh} />
      <Group label="Failed" rows={groups.failed} now={now} live={live} onAgain={reviews.refresh} />
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

function Group({ label, rows, now, live, onAgain }: { label: string; rows: ReviewRow[]; now: number; live: boolean; onAgain: () => void }) {
  if (!rows.length) return null
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <SectionHeading label={label} count={rows.length} />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.item.id} row={row} now={now} live={live} onAgain={onAgain} />
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
 * "Review again" on a row: the host builds the review once more at the change's commit, tests and model pass
 * included, and the row moves to Running. It says so while the host is asked, and says why when the host refuses.
 */
function ReviewAgain({ id, live, onAgain, more }: { id: string; live: boolean; onAgain: () => void; more?: ReactNode }) {
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
      {more}
      <Button variant="outline" size="sm" data-stop="" disabled={asking} title="Builds this review again at the change's commit: its tests and one model pass." onClick={() => void again()} className="shrink-0">
        <RotateCcw aria-hidden="true" />
        {asking ? 'Starting…' : 'Review again'}
      </Button>
    </span>
  )
}

/** "Stop" on a row that is waiting or running: the host stops that review alone, where it is, tests included. */
function StopReview({ id, live, onStopped, more }: { id: string; live: boolean; onStopped: () => void; more?: ReactNode }) {
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
      {more}
      <Button variant="outline" size="sm" data-stop="" disabled={asking} title="Stops this review where it is. Others keep running." onClick={() => void stop()} className="shrink-0">
        <Square aria-hidden="true" className="fill-current" />
        {asking ? 'Stopping…' : 'Stop'}
      </Button>
    </span>
  )
}

function Card({ row, now, live, onAgain }: { row: ReviewRow; now: number; live: boolean; onAgain: () => void }) {
  const { item } = row
  const Kind = item.kind === 'pull' ? GitPullRequest : GitBranch
  // Who it is from, as words: the row is itself a button, so its names are no links. The host is asked once for each
  // review, and the panel shares the answer; until it says, the author the review recorded.
  const people = usePullPeople(item.id, live && item.kind === 'pull')
  const byLine = item.kind === 'pull' ? byLineWords(people ?? peopleOfOwner(item.owner)) : null
  const again = canReviewAgain(row)
  const [more, setMore] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  // "More" sits before the row's main button, so that button keeps the right edge the time and the badge hold. A row
  // with nothing in it, as someone else's pull request while its review runs, has none.
  const held = rowActions(row)
  const moreToggle = held.length === 0 ? null : (
    <Button
      ref={toggle}
      variant="ghost"
      size="icon-sm"
      data-stop=""
      aria-expanded={more}
      aria-label={more ? 'Fewer actions' : 'More actions'}
      title={moreTitle(held)}
      onClick={() => setMore((open) => !open)}
      className="shrink-0"
    >
      <Ellipsis aria-hidden="true" />
    </Button>
  )
  return (
    // The row is the card: opening it and running it again are two buttons, side by side, never one inside the other.
    <li className="flex flex-col rounded-3xl bg-background transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 has-[[data-review-id]:focus-visible]:bg-tone-2">
      <button
        type="button"
        data-stop=""
        data-review-id={item.id}
        onClick={() => useView.getState().openReviewFor(reviewToOpen(item, live))}
        className="flex w-full scroll-mt-[124px] scroll-mb-6 flex-col gap-2.5 rounded-3xl p-5 pb-2.5 text-left outline-offset-[-2px]"
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          <Kind aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 truncate font-medium text-foreground">{row.where}</span>
          <span className="shrink-0">· {item.kind === 'pull' ? 'Pull request' : 'Finished change'}</span>
          {byLine ? <span className="min-w-0 truncate">· {byLine}</span> : null}
          <span className="ml-auto shrink-0 pl-2 tabular-nums">{whenOf(row, now)}</span>
        </span>
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
      <div className="flex min-h-8 items-center gap-3 px-5 pb-4">
        {row.summary ? <DeployWhy summary={row.summary} head={item.head} /> : null}
        {row.group === 'failed' ? <span className="min-w-0 text-[14px] leading-snug text-bad-fg">{row.line}</span> : null}
        {row.group === 'unmerged' ? <span className={row.item.mergeAsked?.state === 'failed' ? 'min-w-0 text-[14px] leading-snug text-bad-fg' : 'min-w-0 text-[14px] leading-snug text-muted-foreground'}>{row.line}</span> : null}
        {again ? <ReviewAgain id={item.id} live={live} onAgain={onAgain} more={moreToggle} /> : <StopReview id={item.id} live={live} onStopped={onAgain} more={moreToggle} />}
      </div>
      {more ? (
        <RowMore
          row={row}
          live={live}
          onChanged={onAgain}
          onClose={() => {
            setMore(false)
            toggle.current?.focus({ preventScroll: true })
          }}
        />
      ) : null}
    </li>
  )
}

const ACTION_LABEL: Record<RowAction, string> = { remove: 'Remove', discard: 'Discard', 'discard-branch': 'Discard and delete branch' }

/** Sample rows have no host: an action says so on its second click, and nothing is removed or discarded. */
const sampleOnly = (async () => {
  throw new Error('This is sample data, so nothing is removed or discarded here.')
}) as RowCommands

/**
 * The rarer actions of a row, opened in place by "More" (spec 032). Remove takes the review out of this list and nothing
 * else. Discard and Discard and delete branch are the review's own noes, as its panel gives them, without opening it.
 * Each asks first: the first click says what it will do, a second within ten seconds does it, and after that it goes
 * back. The keyboard lands on the first of them; Escape takes back the one waiting, then closes them.
 */
function RowMore({ row, live, onChanged, onClose }: { row: ReviewRow; live: boolean; onChanged: () => void; onClose: () => void }) {
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
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [])

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
      aria-label={`More for ${item.title}`}
      className="flex flex-col gap-2.5 px-5 pb-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        if (actions.armed()) actions.cancel()
        else onClose()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {rowActions(row).map((action, index) => (
          <Button
            key={action}
            ref={index === 0 ? first : undefined}
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
            {armed === action ? 'Click again to confirm' : ACTION_LABEL[action]}
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
  if (!said) return null
  return (
    <div role="status" className="max-w-[72ch] rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] leading-[1.45] [overflow-wrap:anywhere]">
      {said}
    </div>
  )
}
