import { useCallback, useEffect, useState } from 'react'
import { useView } from '@/app/view-store.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { runCommand } from '@/lib/host/index.ts'
import { agoWords, groupReviews, SAMPLE_REVIEWS, type ReviewList, type ReviewRow } from './ai-reviews.ts'
import { ReviewBadge, SectionHeading } from './parts.tsx'

/** `review.list` is the host's; it is called by name until the command registry carries it. */
const listReviews = () => (runCommand as (name: string, args: object) => Promise<ReviewList>)('review.list', {})

/** Every AI review, in three groups, refreshed while the tab is open so a running one moves. */
export function AiReviews({ live, list = listReviews }: { live: boolean; list?: () => Promise<ReviewList> }) {
  const [reviews, setReviews] = useState<ReviewList | null>(live ? null : SAMPLE_REVIEWS)
  const [error, setError] = useState<string | null>(null)
  const now = useNow(true, 5_000)
  const refresh = useCallback(() => {
    if (!live) return
    list().then((next) => { setReviews(next); setError(null) }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [live, list])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2_000)
    return () => clearInterval(timer)
  }, [refresh])

  const groups = groupReviews(reviews)
  const total = groups.running.length + groups.ready.length + groups.failed.length
  return (
    <div className="flex flex-col gap-8">
      {error ? <p role="status" className="px-1 text-[13px] text-bad-fg">{error}</p> : null}
      {reviews && total === 0 ? <p className="px-1 text-[13.5px] text-muted-foreground">No AI review has been started yet.</p> : null}
      <Group label="Running" rows={groups.running} now={now} />
      <Group label="Ready" rows={groups.ready} now={now} />
      <Group label="Failed" rows={groups.failed} now={now} />
    </div>
  )
}

function Group({ label, rows, now }: { label: string; rows: ReviewRow[]; now: number }) {
  if (!rows.length) return null
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <SectionHeading label={label} count={rows.length} />
      {rows.map((row) => <Row key={row.item.id} row={row} now={now} />)}
    </section>
  )
}

function Row({ row, now }: { row: ReviewRow; now: number }) {
  const { item } = row
  return (
    <button
      type="button"
      data-stop=""
      data-review-id={item.id}
      onClick={() => useView.getState().openReviewFor(item.id)}
      className="flex flex-col gap-1.5 rounded-3xl bg-background p-5 text-left outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 focus-visible:bg-tone-2"
    >
      <p className="eyebrow">{item.project}</p>
      <h4 className="font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">{item.title}</h4>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        {row.group === 'ready' ? <ReviewBadge status={item.assessment} /> : null}
        {row.group === 'running' ? <span className="tabular-nums">{row.percent == null ? 'Running' : `${row.percent}%`} · {row.line}</span> : null}
        {row.group === 'failed' ? <span className="text-bad-fg">{row.line}</span> : null}
        <span>{item.kind === 'pull' ? 'Pull request' : 'Change'} · {agoWords(item.updatedAt, now)}</span>
      </div>
    </button>
  )
}
