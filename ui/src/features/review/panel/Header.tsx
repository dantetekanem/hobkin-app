import { BookOpenText, ChevronDown, FolderGit2, GitPullRequest, Network, Pin, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import type { ReviewMode } from '../reading/model.ts'

/**
 * The frame's menu floats over the top middle of the canvas: about this wide, reaching this far down. Where it lies over
 * the panel, the header flows around it instead of leaving an empty band above everything.
 */
export const MENU = { width: 560, bottom: 108, gap: 12 } as const

/**
 * The top of the review panel: which project the change is in, its title and how big it is, and for a pull request
 * from GitHub the description its author wrote, behind a button.
 */
export function PanelHeader({ review, overlap, pinned, onPin, onClose, live, preparation, rebuild, mode, onMode }: {
  review: Review
  /** How much of the panel's width the frame's menu covers at its top. */
  overlap: number
  pinned: boolean
  onPin: () => void
  onClose: () => void
  live: boolean
  preparation: ReviewStatus | null
  rebuild: () => void
  /** The story or the graph, when the review has a story to read. Without it there is no switch. */
  mode?: ReviewMode
  onMode?: (mode: ReviewMode) => void
}) {
  const [described, setDescribed] = useState(false)
  const target = targetOfReviewId(review.id)
  const pull = target?.kind === 'pull'
  const { project, item, title, files, additions, deletions, description } = review.change
  const Place = pull ? GitPullRequest : FolderGit2

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
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground">
        <span>
          {files} {files === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-[12.5px]" aria-label={`${additions} lines added, ${deletions} removed`}>
          <span className="text-ok-fg">+{additions}</span> <span className="text-bad-fg">−{deletions}</span>
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
      {mode && onMode ? <ModeSwitch mode={mode} onMode={onMode} /> : null}
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

/** Story or Graph: two halves of one control, the one shown pressed. T switches. */
function ModeSwitch({ mode, onMode }: { mode: ReviewMode; onMode: (mode: ReviewMode) => void }) {
  const half = (value: ReviewMode, label: string, Icon: typeof BookOpenText) => (
    <button
      type="button"
      data-stop
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-semibold transition-[background-color,color] duration-[160ms] ease-[var(--ease-out)] [&_svg]:size-3.5',
        mode === value ? 'bg-background text-foreground shadow-[0_0_0_1px_var(--hb-border)]' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </button>
  )
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div role="group" aria-label="Show the story or the graph" className="flex items-center gap-0.5 rounded-full bg-secondary p-0.5">
        {half('story', 'Story', BookOpenText)}
        {half('graph', 'Graph', Network)}
      </div>
      <Kbd>T</Kbd>
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
