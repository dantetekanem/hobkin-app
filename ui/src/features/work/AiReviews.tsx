import { GitBranch, GitPullRequest, RotateCcw, Square } from 'lucide-react'
import { useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { waited } from '@/features/reports/time.ts'
import { clockWords } from '@/features/review/preparing-model.ts'
import { runCommand } from '@/lib/host/index.ts'
import { canReviewAgain, groupReviews, reviewToOpen, type ReviewRow } from './ai-reviews.ts'
import { DeployWhy, ReviewBadge, ReviewProgress, SectionHeading } from './parts.tsx'
import type { ReviewListView } from './use-review-list.ts'

/**
 * The AI Reviews tab (spec 032): every review the host knows, finished changes and pull requests together, as what is
 * running, what is ready and what failed, each newest first. A running one says how far along it is, what it is doing
 * now and how long it has taken; a ready one its answer for the whole change (risky or safe to deploy), why, and when
 * it finished. A click opens it.
 * One that is ready or stopped can be run again from its row: the review is built once more at the change's commit.
 * One that is waiting or running can be stopped from its row, alone: several run at a time.
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
    <span className="ml-auto flex min-w-0 items-center gap-3">
      {refused ? (
        <span role="alert" className="min-w-0 text-[13px] leading-snug text-bad-fg">
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
    <span className="ml-auto flex min-w-0 items-center gap-3">
      {refused ? (
        <span role="alert" className="min-w-0 text-[13px] leading-snug text-bad-fg">
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

function Card({ row, now, live, onAgain }: { row: ReviewRow; now: number; live: boolean; onAgain: () => void }) {
  const { item } = row
  const Kind = item.kind === 'pull' ? GitPullRequest : GitBranch
  const again = canReviewAgain(row)
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
        {again ? <ReviewAgain id={item.id} live={live} onAgain={onAgain} /> : <StopReview id={item.id} live={live} onStopped={onAgain} />}
      </div>
    </li>
  )
}
