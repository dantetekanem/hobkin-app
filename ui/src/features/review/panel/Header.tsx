import { ChevronDown, FolderGit2, GitPullRequest, Pin, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'
import { changeDescription, riskBadge, type RiskBadge } from '../reading/model.ts'

/**
 * The frame's menu floats over the top middle of the canvas: about this wide, reaching this far down. Where it lies over
 * the panel, the header flows around it instead of leaving an empty band above everything.
 */
export const MENU = { width: 560, bottom: 108, gap: 12 } as const

/** A description longer than this folds to a few lines, and opens on a click. */
const LONG = 320

/**
 * The top of the review panel, the same for the whole review, whatever the step: which project changes, the change's
 * title, what it does in one paragraph, its overall risk as the change review rates it, its size and the commits it
 * was built from, and for a pull request from GitHub the description its author wrote, behind a button.
 */
export function PanelHeader({ review, overlap, pinned, onPin, onClose, live, preparation, assessment, rebuild }: {
  review: Review
  /** How much of the panel's width the frame's menu covers at its top. */
  overlap: number
  pinned: boolean
  onPin: () => void
  onClose: () => void
  live: boolean
  preparation: ReviewStatus | null
  /** The change review of a finished change, once it is ready. */
  assessment: ChangeAssessment | null
  rebuild: () => void
}) {
  const [described, setDescribed] = useState(false)
  const [whole, setWhole] = useState(false)
  const target = targetOfReviewId(review.id)
  const pull = target?.kind === 'pull'
  const { project, item, title, files, additions, deletions, description, base, head } = review.change
  const Place = pull ? GitPullRequest : FolderGit2
  const does = changeDescription(review, assessment)
  const badge = riskBadge(assessment, preparation?.assessment)
  const long = (does?.length ?? 0) > LONG

  return (
    <header className="px-4 pt-3.5 pb-3">
      {/* Floated, so the words beside it wrap clear of the menu and run full width below it. */}
      {overlap > 0 ? <div aria-hidden="true" className="float-right" style={{ width: overlap, height: MENU.bottom - 14 }} /> : null}
      <div className="flex items-center gap-1.5">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 font-heading text-[13px] font-semibold text-muted-foreground" title={pull ? `${project}${item}` : `The project ${project}`}>
          <Place className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {project}
            {pull ? ` ${item}` : ''}
          </span>
        </p>
        <RoundToggle label={pinned ? 'Let this panel tuck away (S)' : 'Keep this panel open (S)'} pressed={pinned} onClick={onPin}>
          <Pin />
        </RoundToggle>
        <RoundToggle label="Close the review (Esc)" onClick={onClose}>
          <X />
        </RoundToggle>
      </div>
      <h2 className="mt-1 font-heading text-[17px] leading-[1.28] font-semibold tracking-[-0.02em] text-pretty [overflow-wrap:anywhere]">{title}</h2>
      {does ? (
        <div className="mt-1.5">
          <div className={cn('text-[14px] leading-[1.5] text-pretty [overflow-wrap:anywhere]', long && !whole && 'rv-folded')}>
            <Markdown text={does} />
          </div>
          {long ? (
            <button type="button" data-stop onClick={() => setWhole((before) => !before)} className="font-heading text-[12.5px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {whole ? 'Show less' : 'Show all of it'}
            </button>
          ) : null}
        </div>
      ) : null}
      {badge ? <Risk badge={badge} live={live} rebuild={rebuild} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground">
        <span>
          {files} {files === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-[12.5px]" aria-label={`${additions} lines added, ${deletions} removed`}>
          <span className="text-ok-fg">+{additions}</span> <span className="text-bad-fg">−{deletions}</span>
        </span>
        <span className="font-mono text-[12px]" title="The commits this review was built from">
          {base.slice(0, 7)}..{head.slice(0, 7)}
        </span>
        {pull ? (
          <button
            type="button"
            data-stop
            aria-expanded={described}
            onClick={() => setDescribed((before) => !before)}
            className="flex h-7 items-center gap-1 rounded-full bg-background px-2.5 font-heading text-[12.5px] font-medium text-foreground transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-3.5"
          >
            Description
            <ChevronDown aria-hidden="true" className={cn('transition-transform duration-[160ms] ease-[var(--ease-out)]', described && 'rotate-180')} />
          </button>
        ) : null}
      </div>
      {pull && described ? (
        <div className="rv-scroll mt-2.5 max-h-[42vh] overflow-y-auto rounded-xl bg-background px-3 py-2.5 text-[14px] leading-[1.5] [overflow-wrap:anywhere]" aria-label="The pull request's description">
          {description ? (
            <Markdown text={description} />
          ) : (
            <p className="text-muted-foreground">
              {description === '' ? 'This pull request has no description.' : 'This review was prepared before it kept the description. Rebuild it to read it here.'}
            </p>
          )}
        </div>
      ) : null}
      <Outdated review={review} preparation={preparation} live={live} rebuild={rebuild} />
    </header>
  )
}

/**
 * The change's overall risk, as one badge: High risk, Mid risk or Safe, Critical beside it when something is, and how
 * many units sit at each level. Before the first rating it says how far along the review is, and why it stopped.
 */
function Risk({ badge, live, rebuild }: { badge: RiskBadge; live: boolean; rebuild: () => void }) {
  if (badge.kind === 'rated') {
    const { counts } = badge
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="rv-risk" data-level={badge.level} title="The change review's rating of the whole change">
          {badge.label}
        </span>
        {badge.critical ? <span className="rv-risk rv-risk-critical">Critical</span> : null}
        <span className="flex items-center gap-2 font-heading text-[12.5px] font-semibold text-muted-foreground tabular-nums" aria-label={`${counts.high} high, ${counts.mid} mid and ${counts.safe} safe units`}>
          {(['high', 'mid', 'safe'] as const).map((level) => (
            <span key={level} className="rv-count" data-level={level} data-none={counts[level] === 0}>
              {counts[level]} {level}
            </span>
          ))}
        </span>
        {badge.again ? <span className="text-[12.5px] text-muted-foreground">Reviewing it again…</span> : null}
      </div>
    )
  }
  if (badge.kind === 'rating') {
    return (
      <div className="mt-2.5 flex min-w-0 items-center gap-2" role="status">
        <span className="rv-risk" data-level="none">
          {badge.queued ? 'Waiting to rate' : `Rating${badge.percent != null ? ` ${badge.percent}%` : '…'}`}
        </span>
        {badge.now ? <span className="min-w-0 truncate text-[12.5px] text-muted-foreground" title={badge.now}>{badge.now.charAt(0).toUpperCase() + badge.now.slice(1)}</span> : null}
      </div>
    )
  }
  return (
    <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2" role="status">
      <span className="rv-risk" data-level="none" title={badge.error ?? undefined}>
        Not rated
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-bad-fg" title={badge.error ?? undefined}>
        {badge.error ?? 'The change review stopped.'}
      </span>
      {live ? (
        <Button size="sm" variant="outline" data-stop className="h-7 shrink-0 px-2.5 text-[12.5px]" onClick={rebuild}>
          <RefreshCw />
          Review again
        </Button>
      ) : null}
    </div>
  )
}

function RoundToggle({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-stop
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.94] [&_svg]:size-3.5',
        pressed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

/** Says when the review was built for an older commit than the change is at now, and offers to build it again. */
function Outdated({ review, preparation, live, rebuild }: { review: Review; preparation: ReviewStatus | null; live: boolean; rebuild: () => void }) {
  if (!live || !preparation) return null
  const rebuilding = preparation.phase != null
  const moved = preparation.head != null && preparation.head !== review.change.head
  if (!moved && !rebuilding) return null
  return (
    <div role="status" className="mt-2.5 flex items-start gap-2 rounded-xl bg-sun/15 px-2.5 py-2 text-[13px] leading-snug text-sun-fg">
      <p className="min-w-0 flex-1">
        {rebuilding
          ? `Building the review again${preparation.head ? ` for ${preparation.head.slice(0, 7)}` : ''}. This one stays open until it is ready.`
          : `Outdated. Built for ${review.change.head.slice(0, 7)}, and the change is now at ${preparation.head!.slice(0, 7)}.`}
      </p>
      {rebuilding ? null : (
        <Button size="sm" variant="outline" data-stop className="h-7 shrink-0 px-2.5 text-[12.5px]" onClick={rebuild}>
          <RefreshCw />
          Rebuild
        </Button>
      )}
    </div>
  )
}
