import { Check, CircleDashed, CircleDot, Clock, GitPullRequest, GitPullRequestDraft, Minus, PenLine, UserRound, X, type LucideIcon } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import { rowLayout } from '@/features/reports/list-motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { waited } from '@/features/reports/time.ts'
import type { ChecksState, GitHubIssue, GitHubPull, ReviewState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { openOnGitHub, openPullRequestReview } from './open.ts'

/**
 * The rows of the GitHub page. Each one is a link to its page on github.com and a stop in the screen's walk, so
 * Up and Down reach it and Enter opens it. A pull request opens through `openPullRequestReview`, which hands it to
 * Change Review. Each row drives its own arrival, so a row that a refresh brings rises in by itself, long after the
 * screen arrived.
 */

/** Whether the rows can be reached: false while their tab is leaving, so Up and Down walk only the tab that is open. */
export const Walkable = createContext(true)

type Tone = 'ok' | 'bad' | 'quiet'

const TONE: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  bad: 'bg-bad/15 text-bad-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
}

interface Said {
  label: string
  tone: Tone
  icon: LucideIcon
}

const REVIEW: Record<ReviewState, Said> = {
  approved: { label: 'Approved', tone: 'ok', icon: Check },
  'changes-requested': { label: 'Changes requested', tone: 'bad', icon: X },
  waiting: { label: 'Waiting for review', tone: 'quiet', icon: Clock },
  none: { label: 'No review asked', tone: 'quiet', icon: CircleDashed },
}

const CHECKS: Record<ChecksState, Said> = {
  passing: { label: 'Checks pass', tone: 'ok', icon: Check },
  failing: { label: 'Checks fail', tone: 'bad', icon: X },
  pending: { label: 'Checks running', tone: 'quiet', icon: Clock },
  none: { label: 'No checks', tone: 'quiet', icon: Minus },
}

function Chip({ label, tone, icon: Icon }: Said) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 font-heading text-[11px] font-medium whitespace-nowrap', TONE[tone])}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  )
}

interface Placed {
  variants: Variants
  /** Its turn in the screen's arrival, or -1 when it arrives on its own. */
  order: number
}

/**
 * A piece of the list that moves with its rows: it rises in, slides into the place a neighbor left, and fades out.
 * With Movement set to Still it does not slide: Motion's own reduced motion leaves layout animations running.
 */
function Piece({ variants, order, className, children }: Placed & { className?: string; children: ReactNode }) {
  const still = useStill()
  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className={className}>
      {children}
    </motion.li>
  )
}

function Row({ url, variants, order, onOpen, children }: Placed & { url: string; onOpen: (event: MouseEvent<HTMLAnchorElement>) => void; children: ReactNode }) {
  const walkable = useContext(Walkable)
  return (
    <Piece variants={variants} order={order} className="relative">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-stop={walkable ? '' : undefined}
        data-github-row={walkable ? '' : undefined}
        onClick={onOpen}
        // A row brought into view keeps a little room around it, inside its tab's own scrolling.
        className="group relative isolate flex w-full cursor-default scroll-mt-3 scroll-mb-6 items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-offset-[-2px]"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-2xl bg-surface-2 opacity-0 transition-opacity duration-[160ms] ease-[ease] group-hover:opacity-60 group-focus-visible:opacity-100"
        />
        {children}
      </a>
    </Piece>
  )
}

function Title({ title, at, now }: { title: string; at: string; now: number }) {
  const when = Date.parse(at)
  return (
    <span className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate font-heading text-[14px] leading-snug font-medium tracking-[-0.01em]">{title}</span>
      {Number.isFinite(when) ? (
        <time dateTime={at} className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
          {waited(when, now)} ago
        </time>
      ) : null}
    </span>
  )
}

const MOST_LABELS = 3

function Where({ repo, number, by, labels }: { repo: string; number: number; by: string | null; labels: string[] }) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-snug text-muted-foreground">
      <span className="min-w-0 truncate font-mono">
        {repo}#{number}
      </span>
      {by ? <span className="shrink-0">by @{by}</span> : null}
      {labels.slice(0, MOST_LABELS).map((label) => (
        <span key={label} className="max-w-[16ch] shrink-0 truncate rounded-full border border-border px-1.5 text-[11px] leading-4">
          {label}
        </span>
      ))}
      {labels.length > MOST_LABELS ? <span className="shrink-0 text-[11px]">+{labels.length - MOST_LABELS}</span> : null}
    </span>
  )
}

/** A pull request. One of the user's own shows where its review stands. One that waits for their review says who opened it. */
export function PullRow({ pull, mine, now, ...placed }: Placed & { pull: GitHubPull; mine: boolean; now: number }) {
  const Icon = pull.draft ? GitPullRequestDraft : GitPullRequest
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    openPullRequestReview(pull)
  }
  return (
    <Row url={pull.url} onOpen={open} {...placed}>
      <Icon className={cn('mt-[3px] size-4 shrink-0', pull.draft ? 'text-muted-foreground' : 'text-ok-fg')} aria-hidden="true" />
      <span className="relative min-w-0 flex-1">
        <Title title={pull.title} at={pull.updatedAt} now={now} />
        <Where repo={pull.repo} number={pull.number} by={mine ? null : pull.author} labels={pull.labels} />
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {mine ? <Chip {...REVIEW[pull.review]} /> : null}
          <Chip {...CHECKS[pull.checks]} />
          {pull.draft ? <Chip label="Draft" tone="quiet" icon={GitPullRequestDraft} /> : null}
        </span>
      </span>
    </Row>
  )
}

/** An issue, with why it is on the list: assigned to the user, opened by them, or both. */
export function IssueRow({ issue, now, ...placed }: Placed & { issue: GitHubIssue; now: number }) {
  return (
    <Row url={issue.url} onOpen={(event) => openOnGitHub(event, issue.url)} {...placed}>
      <CircleDot className="mt-[3px] size-4 shrink-0 text-ok-fg" aria-hidden="true" />
      <span className="relative min-w-0 flex-1">
        <Title title={issue.title} at={issue.updatedAt} now={now} />
        <Where repo={issue.repo} number={issue.number} by={null} labels={issue.labels} />
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {issue.assigned ? <Chip label="Assigned to you" tone="quiet" icon={UserRound} /> : null}
          {issue.authored ? <Chip label="Opened by you" tone="quiet" icon={PenLine} /> : null}
        </span>
      </span>
    </Row>
  )
}

/** A group's heading, with how many it holds. */
export function GroupHeading({ label, count, ...placed }: Placed & { label: string; count: number }) {
  return (
    <Piece {...placed} className="px-3 pt-8 pb-1 first:pt-1">
      <h2 className="eyebrow flex items-baseline gap-2">
        {label}
        <span className="tabular-nums">{count}</span>
      </h2>
    </Piece>
  )
}

/** A quiet line in the list: a group with nothing in it, or one that holds only the most recent. */
export function NoteRow({ children, ...placed }: Placed & { children: ReactNode }) {
  return (
    <Piece {...placed} className="px-3 py-2 text-[13px] text-muted-foreground">
      {children}
    </Piece>
  )
}
