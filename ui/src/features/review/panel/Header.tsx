import { Check, ChevronDown, ChevronsLeft, FolderGit2, GitCommitHorizontal, GitPullRequest, Hand, Inbox, RefreshCw, TriangleAlert, Wrench, X } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import { pullUrl, targetOfReviewId } from '#shared/review/ids.ts'
import type { ReviewPerson, ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { PAGE_TOP } from '@/app/screen-layout.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { openTarget } from '@/features/home/navigate.ts'
import { cn } from '@/lib/utils.ts'
import { usePullPeople } from '../use-people.ts'
import { headerBadge, type HeaderBadge, type HeaderFix } from './sidebar.ts'

/**
 * The frame's menu floats over the top middle of the canvas: about this wide, reaching this far down. Where it lies over
 * the panel, the header flows around it instead of leaving an empty band above everything. How far down is read from
 * where every page starts under the menu and its trail (`PAGE_TOP`, which the menu sets), and keeps the 30px more the
 * panel always kept than a page, so the review moves with the pages when the menu does.
 */
export const MENU = { width: 560, bottom: PAGE_TOP + 30, gap: 12 } as const

/**
 * The top of the review panel, the same for the whole review, whatever the step: which project changes, the change's
 * title with its overall risk right under it, always there ("Safe", "Mid risk" or "High risk", how far along the
 * change review is, that it failed and why, or that there is none), "Merged" beside it once the change merged, how
 * many units sit at each level, its size and the commits it was built from, and for a pull request from GitHub the
 * description its author wrote, behind a button. What the change does is told under "What matters".
 */
export function PanelHeader({ review, overlap, onHide, onClose, live, preparation, assessment, rebuild }: {
  review: Review
  /** How much of the panel's width the frame's menu covers at its top. */
  overlap: number
  onHide: () => void
  onClose: () => void
  live: boolean
  preparation: ReviewStatus | null
  /** The change review, once it is ready. */
  assessment: ChangeAssessment | null
  rebuild: () => void
}) {
  const [described, setDescribed] = useState(false)
  const target = targetOfReviewId(review.id)
  const pull = target?.kind === 'pull'
  const { project, item, title, files, additions, deletions, description, base, head } = review.change
  const Place = pull ? GitPullRequest : FolderGit2

  return (
    <header className="px-4 pt-3 pb-3.5">
      {/* Floated, so the words beside it wrap clear of the menu and run full width below it. */}
      {overlap > 0 ? <div aria-hidden="true" className="float-right" style={{ width: overlap, height: MENU.bottom - 14 }} /> : null}
      <div className="flex items-center gap-1">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 font-heading text-[13px] font-semibold text-muted-foreground" title={pull ? `${project}${item}` : `The project ${project}`}>
          {target?.kind === 'pull' && pullUrl(target) ? (
            // The pull request's own page, opened in the browser as every link in the window is. Underlined, as the panel's links are.
            <a href={pullUrl(target)!} target="_blank" rel="noopener noreferrer" data-stop className="flex min-w-0 items-center gap-1.5 underline underline-offset-2 hover:text-foreground">
              <Place className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {project} {item}
              </span>
            </a>
          ) : (
            <>
              <Place className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {project}
                {pull ? ` ${item}` : ''}
              </span>
            </>
          )}
        </p>
        <QuietButton label="Hide the panel" keys="S" onClick={onHide}>
          <ChevronsLeft />
        </QuietButton>
        <QuietButton label="Close the review" keys="esc" onClick={onClose}>
          <X />
        </QuietButton>
      </div>
      <h2 className="mt-1 font-heading text-[17px] leading-[1.28] font-semibold tracking-[-0.02em] text-pretty [overflow-wrap:anywhere]">{title}</h2>
      {pull ? <ByLine id={review.id} live={live} /> : null}
      {/* A change that lands is never reviewed again, so its review offers no "Try again". */}
      <Risk badge={headerBadge(assessment, preparation?.assessment)} live={live && !preparation?.landing} merged={preparation?.landing?.state === 'merged'} rebuild={rebuild} />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground">
        <span>
          {files} {files === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-[12.5px]" aria-label={`${additions} lines added, ${deletions} removed`}>
          <span className="text-ok-fg">+{additions}</span> <span className="text-bad-fg">−{deletions}</span>
        </span>
        <span className="font-mono text-[12.5px]" title="The commits this review was built from">
          {base.slice(0, 7)}..{head.slice(0, 7)}
        </span>
        {pull ? (
          <button
            type="button"
            data-stop
            aria-expanded={described}
            onClick={() => setDescribed((before) => !before)}
            className="flex h-7 items-center gap-1 rounded-full bg-background px-2.5 font-heading text-[13px] font-medium text-foreground transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-3.5"
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
 * Who a pull request is from, under its title: "By" its author, or "By" the agent and "for" the person who asked, each
 * a link to their profile when one is known, opened in the browser. Nothing without a host, or when nobody is named.
 */
function ByLine({ id, live }: { id: string; live: boolean }) {
  const people = usePullPeople(id, live)
  if (!people?.author) return null
  const named = (person: ReviewPerson) =>
    person.url ? (
      <a href={person.url} target="_blank" rel="noopener noreferrer" data-stop className="underline underline-offset-2 hover:text-foreground">
        {person.name}
      </a>
    ) : (
      <span>{person.name}</span>
    )
  return (
    <p className="mt-1 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
      By {named(people.author)}
      {people.for ? <>, for {named(people.for)}</> : null}
    </p>
  )
}

/**
 * The review's one answer for the whole change, as a badge under the title, which is always there. Rated: Risky to
 * deploy or Safe to deploy, Critical beside it when something is, what hobkin does about a risky answer on its own
 * change, and why in a sentence under it. Under way: how
 * far along it is, the badge filling as it goes, and what it is doing. Failed: why, in plain words, and a way to try
 * again. None: "Not reviewed". A change that merged says "Merged" beside it, whatever it says.
 */
function Risk({ badge, live, merged, rebuild }: { badge: HeaderBadge; live: boolean; merged: boolean; rebuild: () => void }) {
  const landed = merged ? <MergedChip /> : null
  if (badge.kind === 'rated') {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rv-risk" data-level={badge.deploy === 'risky' ? 'high' : 'safe'} title="The review's answer for the whole change">
            {badge.label}
          </span>
          {badge.critical ? <span className="rv-risk rv-risk-critical">Critical</span> : null}
          {landed}
          {badge.fix?.opens ? <ActionItemButton action={badge.fix.opens.action} /> : null}
        </div>
        {badge.fix ? <FixLine fix={badge.fix} /> : null}
        {/* Why, for the whole change. What a part is shows on the part; risk is said here only. */}
        <p className="text-[13.5px] leading-snug text-pretty [overflow-wrap:anywhere]">{badge.why}</p>
        {badge.since ? <p className="text-[12.5px] leading-snug text-pretty text-muted-foreground [overflow-wrap:anywhere]">{badge.since}</p> : null}
        {badge.again ? <p className="text-[12.5px] text-muted-foreground">{badge.again}</p> : null}
      </div>
    )
  }
  if (badge.kind === 'reviewing') {
    const { percent } = badge
    return (
      <Status
        badge={
          <>
            <span className="rv-risk" data-level="none" data-progress={percent != null} style={percent != null ? ({ '--rv-progress': `${percent}%` } as CSSProperties) : undefined}>
              {badge.label}
            </span>
            {landed}
          </>
        }
      >
        {badge.now ? <span className="truncate" title={badge.now}>{badge.now}</span> : null}
      </Status>
    )
  }
  if (badge.kind === 'failed') {
    return (
      <div className="mt-2 flex flex-col gap-1.5" role="status">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rv-risk gap-1.5" data-level="none">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            {badge.label}
          </span>
          {landed}
          {live ? (
            <Button size="sm" variant="outline" data-stop className="h-7 px-2.5 text-[13px]" onClick={rebuild}>
              <RefreshCw />
              Try again
            </Button>
          ) : null}
        </div>
        <p className="text-[13.5px] leading-snug text-pretty text-bad-fg [overflow-wrap:anywhere]">{badge.reason}</p>
      </div>
    )
  }
  return (
    <Status
      badge={
        <>
          <span className="rv-risk" data-level="none">
            {badge.label}
          </span>
          {landed}
        </>
      }
    />
  )
}

const FIX_ICON = { fixing: Wrench, fixed: GitCommitHorizontal, waiting: Hand } as const

/** What hobkin does about a risky answer on its own change, right under the answer: fixing it with the round, fixed in a newer commit, or waiting on the user. */
function FixLine({ fix }: { fix: HeaderFix }) {
  const Icon = FIX_ICON[fix.state]
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-[13.5px] leading-snug font-medium text-pretty [overflow-wrap:anywhere]" role="status">
      <Icon aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" />
      <span>{fix.words}</span>
    </p>
  )
}

/** Once the change is the user's, its Action Item is a click away, beside the answer as "Try again" is beside a failed one. */
function ActionItemButton({ action }: { action: string | null }) {
  return (
    <Button size="sm" variant="outline" data-stop className="h-7 px-2.5 text-[13px]" onClick={() => openTarget(action ? { to: 'action', id: action } : { to: 'screen', screen: 'actions' })}>
      <Inbox />
      Open in Action Items
    </Button>
  )
}

/** "Merged", beside the risk: calm, with the check of a change that is done. */
function MergedChip() {
  return (
    <span className="rv-risk gap-1.5" data-level="none">
      <Check aria-hidden="true" className="size-3.5 text-ok-fg" />
      Merged
    </span>
  )
}

function Status({ badge, children }: { badge: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-1.5" role="status">
      <div className="flex flex-wrap items-center gap-1.5">{badge}</div>
      {children ? <p className="flex min-w-0 text-[13px] text-muted-foreground">{children}</p> : null}
    </div>
  )
}

/** A quiet round button, its name and key in a tooltip. */
function QuietButton({ label, keys, onClick, children }: { label: string; keys: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-stop
            aria-label={label}
            onClick={onClick}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-[0.94] [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** Says when the review was built for an older commit than the change is at now, and offers to build it again. */
function Outdated({ review, preparation, live, rebuild }: { review: Review; preparation: ReviewStatus | null; live: boolean; rebuild: () => void }) {
  if (!live || !preparation) return null
  const rebuilding = preparation.phase != null
  const moved = preparation.head != null && preparation.head !== review.change.head
  if (!moved && !rebuilding) return null
  return (
    <div role="status" className="mt-2.5 flex items-start gap-2 rounded-xl bg-sun/15 px-2.5 py-2 text-[13.5px] leading-snug text-sun-fg">
      <p className="min-w-0 flex-1">
        {rebuilding
          ? `Building the review again${preparation.head ? ` for ${preparation.head.slice(0, 7)}` : ''}. This one stays open until it is ready.`
          : `Outdated. Built for ${review.change.head.slice(0, 7)}, and the change is now at ${preparation.head!.slice(0, 7)}.`}
      </p>
      {rebuilding ? null : (
        <Button size="sm" variant="outline" data-stop className="h-7 shrink-0 px-2.5 text-[13px]" onClick={rebuild}>
          <RefreshCw />
          Rebuild
        </Button>
      )}
    </div>
  )
}
