import {
  Ban,
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Layers,
  ListPlus,
  LoaderCircle,
  MessageSquareText,
  Minus,
  PenLine,
  Rocket,
  RotateCcw,
  Sparkles,
  UserRound,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { createContext, useContext, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { IssueWork } from '../protocol.ts'
import type { StackPlace } from '#shared/protocol/work.ts'
import { pullUrl, targetOfReviewId } from '#shared/review/ids.ts'
import { useView } from '@/app/view-store.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { rowLayout } from '@/features/reports/list-motion.ts'
import { useStill } from '@/features/reports/still.ts'
import { waited } from '@/features/reports/time.ts'
import { clockWords } from '@/features/review/preparing-model.ts'
import { heldDown } from '@/features/review/verdict.ts'
import { DeployWhy, ReviewBadge, ReviewProgress } from '@/features/work/parts.tsx'
import { useWorkUi, useWorkView, type Said as HobkinSaid } from '@/features/work/store.ts'
import { openOnWork } from '@/features/work/work-target.ts'
import { runCommand } from '@/lib/host/index.ts'
import { openAddress, openLink } from '@/lib/open-link.ts'
import type { ChecksState, GitHubIssue, ReviewState } from '../protocol.ts'
import { cn } from '@/lib/utils.ts'
import { ReviewRowMenu, type ReviewRowMenuItem } from '@/features/work/ReviewRowMenu.tsx'
import { CLOSE_CONFIRM_MS, CLOSE_REASONS, closeIssueAs, closeWarning, createIssueClose, type CloseCommand, type IssueClose } from './issue-close.ts'
import { issueChip, issueMenu, JUST_ADDED, placeOnWork, workAgain, type ChipTone, type IssueChip, type IssueMenuItem } from './issue-work.ts'
import { addIssueToQueue } from './add-to-queue.ts'
import { run } from './commands.ts'
import { openPullRequestReview } from './review.ts'
import { reviewStarted } from '@/features/work/review-started.ts'
import { stateWords } from '@/features/work/review-list.ts'
import { startAiReview, type PullAi, type PullEntry } from './pull-reviews.ts'

/**
 * The rows of the GitHub page, as cards in the Work screen's manner. A card's title is a link to its page on
 * github.com and the card's stop in the screen's walk, so Up and Down reach it and Enter opens it; the whole card is
 * that link to the pointer. A pull request opens in Change Review, and its card shows its AI review on the right:
 * Start AI review, how far along it is, or its level and Open review. Each row drives its own arrival, so a row that
 * a refresh brings rises in by itself, long after the screen arrived.
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

export const CHECKS: Record<ChecksState, Said> = {
  passing: { label: 'Checks pass', tone: 'ok', icon: Check },
  failing: { label: 'Checks fail', tone: 'bad', icon: X },
  pending: { label: 'Checks running', tone: 'quiet', icon: Clock },
  none: { label: 'No checks', tone: 'quiet', icon: Minus },
}

export function Chip({ label, tone, icon: Icon }: Said) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 font-heading text-[12.5px] font-medium whitespace-nowrap', TONE[tone])}>
      <Icon className="size-3.5" aria-hidden="true" />
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
function Piece({ variants, order, className, children, aiOnly }: Placed & { className?: string; children: ReactNode; aiOnly?: boolean }) {
  const still = useStill()
  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className={className} data-ai-only={aiOnly || undefined}>
      {children}
    </motion.li>
  )
}

/** A card: its title link covers it, and what sits on top of it (the AI review's buttons) is raised above the link. */
const CARD =
  'relative isolate flex flex-wrap items-start gap-x-6 gap-y-3 rounded-3xl bg-background px-5 py-4 transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 has-[[data-github-row]:focus-visible]:bg-tone-2'
const TITLE_LINK =
  "mt-1 block font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance outline-none after:absolute after:inset-0 after:rounded-3xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring"

/** The card's title: the link to its page, and its stop in the walk. */
function TitleLink({ url, title, onOpen }: { url: string; title: string; onOpen: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const walkable = useContext(Walkable)
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-stop={walkable ? '' : undefined} data-github-row={walkable ? '' : undefined} onClick={onOpen} className={cn(TITLE_LINK, 'scroll-mt-24 scroll-mb-6')}>
      {title}
    </a>
  )
}

const MOST_LABELS = 3

function Labels({ labels }: { labels: string[] }) {
  return (
    <>
      {labels.slice(0, MOST_LABELS).map((label) => (
        <span key={label} className="inline-flex h-6 max-w-[18ch] items-center truncate rounded-full border border-border px-2.5 text-[12.5px] text-muted-foreground">
          {label}
        </span>
      ))}
      {labels.length > MOST_LABELS ? <span className="text-[12.5px] text-muted-foreground">+{labels.length - MOST_LABELS}</span> : null}
    </>
  )
}

/** Lines added and removed, and files, as GitHub counts them, or as the AI review read them for one GitHub no longer lists. */
function Size({ size }: { size: NonNullable<PullEntry['size']> }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 font-heading text-[12.5px] font-medium tabular-nums">
      <span className="text-ok-fg">+{size.added}</span>
      <span className="text-bad-fg">−{size.removed}</span>
      <span className="text-muted-foreground">
        · {size.files} {size.files === 1 ? 'file' : 'files'}
      </span>
    </span>
  )
}

/** "Layer 2 of 3": a pull request's place in its stack, counted from the bottom, of the layers the page lists. */
export function LayerBadge({ place }: { place: StackPlace }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 font-heading text-[12px] font-medium whitespace-nowrap text-foreground tabular-nums [&_svg]:size-3.5">
      <Layers aria-hidden="true" className="text-muted-foreground" />
      Layer {place.layer} of {place.of}
    </span>
  )
}

/** A plain click opens the pull request's review. A click with a key held, or a middle click, is the browser's. */
const opensHere = (event: MouseEvent<HTMLAnchorElement>) => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)

/**
 * A pull request, with its AI review on the right. One that waits for the user's review says who opened it; one of
 * theirs says where its review stands. One the AI reviewed that left GitHub's lists shows what the review knows. A layer
 * of a stack says its place, and, when the rest of its stack is in another list, where.
 */
export function PullCard({
  entry,
  mine,
  live,
  now,
  place = null,
  elsewhere = null,
  ...placed
}: Placed & { entry: PullEntry; mine: boolean; live: boolean; now: number; place?: StackPlace | null; elsewhere?: string | null }) {
  const { pull, id } = entry
  const target = id ? targetOfReviewId(id) : null
  const url = pull?.url ?? (target?.kind === 'pull' ? pullUrl(target) : null)
  const updated = pull ? Date.parse(pull.updatedAt) : Number.NaN
  const Icon = pull?.draft ? GitPullRequestDraft : GitPullRequest

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!opensHere(event)) return
    event.preventDefault()
    if (pull) openPullRequestReview(pull)
    else if (id) useView.getState().openReviewFor(id)
  }

  return (
    <Piece {...placed} className="relative" aiOnly={!pull}>
      <div className={CARD}>
        <div className="min-w-[240px] flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
            <Icon className={cn('size-4 shrink-0', pull?.draft ? 'text-muted-foreground' : 'text-ok-fg')} aria-hidden="true" />
            <span className="font-medium text-foreground">{entry.repo}</span>
            {entry.number !== null ? <span className="tabular-nums">#{entry.number}</span> : null}
            {place ? <LayerBadge place={place} /> : null}
            {pull?.author && !mine ? <span>· by @{pull.author}</span> : null}
            {Number.isFinite(updated) ? (
              <time dateTime={pull!.updatedAt} className="tabular-nums">
                · updated {waited(updated, now)} ago
              </time>
            ) : null}
          </p>
          {url ? <TitleLink url={url} title={entry.title} onOpen={open} /> : <p className={TITLE_LINK}>{entry.title}</p>}
          <p className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
            {pull ? <Chip {...CHECKS[pull.checks]} /> : null}
            {pull && mine ? <Chip {...REVIEW[pull.review]} /> : null}
            {pull?.draft ? <Chip label="Draft" tone="quiet" icon={GitPullRequestDraft} /> : null}
            {entry.size ? <Size size={entry.size} /> : null}
            {pull ? <Labels labels={pull.labels} /> : null}
          </p>
          {elsewhere ? <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{elsewhere}</p> : null}
          {/* Its title opens the review here. This opens the pull request itself on github.com, to read it there, close it or change it. */}
          {url ? (
            <Button variant="ghost" size="sm" data-stop="" className="relative z-10 mt-2 -ml-2" title="Opens this pull request on github.com" onClick={() => openAddress(url)}>
              <ExternalLink aria-hidden="true" />
              Open on GitHub
            </Button>
          ) : null}
        </div>
        {id && entry.ai.state !== 'unavailable' ? <AiReview id={id} ai={entry.ai} live={live} title={entry.title} /> : null}
      </div>
    </Piece>
  )
}

/** When it happened, for the AI review's line: the time so far, when it finished, or when it stopped. */
function aiWhen(ai: PullAi, now: number): string | null {
  if (ai.state === 'running') return ai.startedAt === null ? null : `${clockWords((now - ai.startedAt) / 1000)} so far`
  if (ai.state === 'ready' && ai.row.at !== null) return `finished ${waited(ai.row.at, now)} ago`
  return null
}

/** The AI review's time, the one part of its card that follows the clock: seconds while it runs, half minutes after. */
function AiWhen({ ai }: { ai: PullAi }) {
  const now = useNow(true, ai.state === 'running' ? 1_000 : 30_000)
  const when = aiWhen(ai, now)
  return when ? <span className="text-[12.5px] text-muted-foreground tabular-nums">{when}</span> : null
}

/**
 * A pull request's AI review, on its card. None yet: Start AI review, which asks the host to prepare it and opens it.
 * Running: how far along it is and what it is doing now. Ready: its level, its units at each level, and Open review.
 * Failed: why, and Try again. A refusal says why on the card.
 */
function AiReview({ id, ai, live, title }: { id: string; ai: PullAi; live: boolean; title: string }) {
  const [starting, setStarting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const openReview = (reviewId: string) => useView.getState().openReviewFor(reviewId)

  const start = async (again: boolean) => {
    setStarting(true)
    setRefusal(null)
    const why = await startAiReview(id, { live, prepare: async (reviewId) => {
        const answer = await runCommand('review.prepare', { id: reviewId, ...(again ? { refresh: true } : {}) })
        reviewStarted(reviewId)
        return answer
      }, open: openReview })
    setStarting(false)
    setRefusal(why)
  }

  return (
    <div data-ai-review className="relative z-10 flex w-[260px] max-w-full shrink-0 flex-col items-start gap-2">
      {ai.state === 'none' ? (
        <>
          <span className="text-[13px] text-muted-foreground">Not reviewed yet</span>
          <Button variant="outline" data-stop="" disabled={starting} focusableWhenDisabled onClick={() => void start(false)}>
            <Sparkles aria-hidden="true" />
            {starting ? 'Starting…' : 'Start review'}
          </Button>
        </>
      ) : null}
      {ai.state === 'running' ? (
        <>
          <span className="flex w-full items-baseline justify-between gap-2 font-heading text-[14px] font-semibold">
            Review running
            {ai.percent !== null ? <span className="tabular-nums">{ai.percent}%</span> : null}
          </span>
          <ReviewProgress percent={ai.percent} label={`Review of ${title}`} />
          <span role="status" className="line-clamp-2 text-[13.5px] leading-snug">
            {ai.line}
          </span>
        </>
      ) : null}
      {ai.state === 'waits' ? (
        <span role="status" className="font-heading text-[14px] font-semibold text-muted-foreground">
          {stateWords({ kind: 'waits', ahead: ai.ahead })}
        </span>
      ) : null}
      {ai.state === 'ready' ? (
        <>
          {ai.row.summary ? (
            <ReviewBadge status={ai.row.item.assessment} size="md" />
          ) : (
            <span className="inline-flex h-7 items-center rounded-full bg-surface-2 px-3 font-heading text-[13px] font-medium text-muted-foreground">Review ready</span>
          )}
          {ai.row.summary ? <DeployWhy summary={ai.row.summary} head={ai.row.item.head} /> : null}
          <Button variant="outline" data-stop="" onClick={() => openReview(ai.row.item.id)}>
            Open review
          </Button>
        </>
      ) : null}
      {ai.state === 'failed' ? (
        <>
          <span className="font-heading text-[14px] font-semibold text-bad-fg">Review failed</span>
          <span title={ai.line} className="line-clamp-3 text-[13px] leading-snug text-muted-foreground">
            {ai.line}
          </span>
          <Button variant="outline" data-stop="" disabled={starting} focusableWhenDisabled onClick={() => void start(true)}>
            {starting ? 'Starting…' : 'Try again'}
          </Button>
        </>
      ) : null}
      <AiWhen ai={ai} />
      {refusal ? (
        <p role="alert" className="text-[13px] leading-snug text-bad-fg">
          {refusal}
        </p>
      ) : null}
    </div>
  )
}

/**
 * An issue, with why it is on the list: assigned to the user, opened by them, or both. It opens on github.com. On its
 * right, Add to queue files it as work on the project whose repository it is in, and once hobkin has work filed for it
 * a chip says where that work stands. Close issue closes it on GitHub, after a second click.
 */
export function IssueRow({ issue, live, now, ...placed }: Placed & { issue: GitHubIssue; live: boolean; now: number }) {
  const updated = Date.parse(issue.updatedAt)
  return (
    <Piece {...placed} className="relative">
      <div className={CARD}>
        <div className="min-w-[240px] flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
            <CircleDot className="size-4 shrink-0 text-ok-fg" aria-hidden="true" />
            <span className="font-medium text-foreground">{issue.repo}</span>
            <span className="tabular-nums">#{issue.number}</span>
            {Number.isFinite(updated) ? (
              <time dateTime={issue.updatedAt} className="tabular-nums">
                · updated {waited(updated, now)} ago
              </time>
            ) : null}
          </p>
          <TitleLink url={issue.url} title={issue.title} onOpen={(event) => openLink(event, issue.url)} />
          <p className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
            {issue.assigned ? <Chip label="Assigned to you" tone="quiet" icon={UserRound} /> : null}
            {issue.authored ? <Chip label="Opened by you" tone="quiet" icon={PenLine} /> : null}
            <Labels labels={issue.labels} />
          </p>
        </div>
        <IssueStanding issue={issue} live={live} />
      </div>
    </Piece>
  )
}

const CHIP_TONE: Record<ChipTone, string> = {
  ok: 'bg-ok/15 text-ok-fg',
  live: 'bg-sun/20 text-sun-fg',
  warn: 'bg-warn/15 text-warn-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
}

const CHIP_ICON: Record<string, LucideIcon> = {
  'Added to queue': Check,
  'In queue': Clock,
  Working: LoaderCircle,
  'Read its note': MessageSquareText,
  'Review its change': Waypoints,
  'Approve its change': GitMerge,
  'Merging after your yes': LoaderCircle,
  Finished: CircleDashed,
  'PR open': GitPullRequest,
  'Merged, waits for deploy': Rocket,
  Deploying: LoaderCircle,
  Done: CircleCheck,
  Declined: Ban,
  Dropped: Minus,
}

const CHIP = 'inline-flex h-7 items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-medium whitespace-nowrap'

/**
 * What a chip's tooltip says of the item hobkin filed for an issue. A merged one reads Done, so its tooltip says it merged, and one whose
 * deploy is still to hold says why GitHub lists the issue open.
 */
function filedWords({ state, project, item, deploy }: IssueWork): string {
  if (state !== 'merged') return `Filed on ${project} as ${item}.`

  const merged = `Merged on ${project} as ${item}.`
  const deployStillToHold = Boolean(deploy) && deploy !== 'live'
  if (!deployStillToHold) return merged
  return `${merged} ${project} deploys, so hobkin closes the issue once a deploy that carries it held.`
}

/** Its pull request's address, to open while it is open and once it merged. */
const prShown = ({ state, pr }: IssueWork): string | null => (state === 'pr' || state === 'merged' ? pr : null)

/**
 * The right of an issue's card: where its work stands, with the ⋯ menu of everything the row can do, then Close issue.
 * Every row is an open issue, so every row can be closed.
 */
function IssueStanding({ issue, live }: { issue: GitHubIssue; live: boolean }) {
  const close = useIssueClose(issue, live)
  return (
    <div className="relative z-10 flex w-[260px] max-w-full shrink-0 flex-col items-start gap-3">
      <IssueWorkStanding issue={issue} live={live} close={close} />
      <CloseIssue issue={issue} flow={close} />
    </div>
  )
}

/** What the ⋯ menu of an issue's row calls each thing it does. */
const MENU_LABELS: Record<IssueMenuItem, string> = {
  add: 'Add to queue',
  again: 'Work on it again',
  work: 'Open it on Work',
  pr: 'Open the PR',
  github: 'Open on GitHub',
  close: 'Close issue',
}

/**
 * Where an issue's work stands: Add to queue while hobkin has nothing filed for it, and then a chip that says what it
 * waits on. Right after Add to queue the chip says so, with hobkin's whole answer in its tooltip. A chip whose item the
 * Work screen shows opens it there, where the user can act on it, and a PR's chip comes with the PR's link. Once that
 * work is over, Work on it again files a follow-up, and what hobkin answers shows under it. A refusal says why, in a
 * line or two. The ⋯ menu at the end of the first line holds every action the row has.
 */
function IssueWorkStanding({ issue, live, close }: { issue: GitHubIssue; live: boolean; close: IssueClose }) {
  const place = `issue:${issue.url}`
  const busy = useWorkUi((state) => Boolean(state.busy[place]))
  const said = useWorkUi((state) => state.said[place])
  const { work: shown } = useWorkView()
  const added = said?.tone === 'done'
  const { work } = issue
  // What Work on it again said is kept under the item it followed up, so the follow-up reaching the page takes its line away.
  const againAt = `issue-again:${issue.url}:${work?.item ?? ''}`
  const filingAgain = useWorkUi((state) => Boolean(state.busy[againAt]))
  const again = useWorkUi((state) => state.said[againAt])
  const armed = useStore(close, (state) => state.armed)
  // Once hobkin filed the follow-up, which reaches the page with its next view, it is not offered twice.
  const offer = again?.tone === 'done' ? null : workAgain(work)

  const chip = work ? issueChip(work, placeOnWork(shown, work.slug, work.item), added) : added ? JUST_ADDED : null
  const pr = work ? prShown(work) : null
  const addToQueue = () => void addIssueToQueue(issue, { live, place })
  const workOnItAgain = () => void addIssueToQueue(issue, { live, place: againAt, again: true })

  const actions: Record<IssueMenuItem, ReviewRowMenuItem['onSelect']> = {
    add: addToQueue,
    again: workOnItAgain,
    work: () => openOnWork(chip!.target!),
    pr: () => openAddress(pr!),
    github: () => openAddress(issue.url),
    // As the button under it: the first press asks for a second, in the same place, and the menu stays open for it.
    close: async () => {
      const first = !close.getState().armed
      await close.press()
      return first
    },
  }
  const labels = { ...MENU_LABELS, close: armed ? 'Click again to close' : MENU_LABELS.close }
  const unavailable: Partial<Record<IssueMenuItem, boolean>> = { add: busy, again: filingAgain || offer === null }
  const menu = issueMenu(work, { added, onWork: Boolean(chip?.target), pr: Boolean(pr) }).map(
    (key): ReviewRowMenuItem => ({
      key,
      label: labels[key],
      onSelect: actions[key],
      destructive: key === 'close',
      ruleBefore: key === 'close',
      disabled: unavailable[key] ?? false,
    }),
  )

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className="flex w-full items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          {chip ? (
            <WorkChip chip={chip} why={added ? (said?.text ?? '') : filedWords(work!)} />
          ) : (
            <Button variant="outline" data-stop="" disabled={busy} focusableWhenDisabled onClick={addToQueue}>
              <ListPlus aria-hidden="true" />
              {busy ? 'Adding…' : 'Add to queue'}
            </Button>
          )}
          {pr ? (
            <a
              href={pr}
              target="_blank"
              rel="noopener noreferrer"
              data-stop=""
              onClick={(event) => openLink(event, pr)}
              className="text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Open the PR
            </a>
          ) : null}
        </div>
        <ReviewRowMenu label={`Everything ${issue.repo}#${issue.number} can do`} title="Everything this issue can do" items={menu} />
      </div>
      {offer === 'action' ? (
        <Button variant="outline" data-stop="" disabled={filingAgain} focusableWhenDisabled onClick={workOnItAgain}>
          <RotateCcw aria-hidden="true" />
          {filingAgain ? 'Filing…' : 'Work on it again'}
        </Button>
      ) : null}
      {again ? <SaidLine said={again} /> : null}
      {said && !added ? <SaidLine said={said} /> : null}
    </div>
  )
}

/** What hobkin said of a press on the row, in a line or two: its answer, or why it refused. */
function SaidLine({ said }: { said: HobkinSaid }) {
  const refused = said.tone === 'refused'
  return (
    <p role={refused ? 'alert' : 'status'} title={said.text} className={cn('line-clamp-2 text-[13px] leading-snug', refused ? 'text-bad-fg' : 'text-muted-foreground')}>
      {said.text}
    </p>
  )
}

/** The chip of an issue's filed work. One whose item the Work screen shows opens it there. */
function WorkChip({ chip, why }: { chip: IssueChip; why: string }) {
  const Icon = CHIP_ICON[chip.label] ?? CircleDot
  const face = (
    <>
      <Icon className="size-3.5" aria-hidden="true" />
      {chip.label}
    </>
  )
  if (!chip.target) {
    return (
      <span title={why} className={cn(CHIP, CHIP_TONE[chip.tone])}>
        {face}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-stop=""
      title={`${why} Opens it on the Work screen.`}
      onClick={() => openOnWork(chip.target!)}
      className={cn(CHIP, CHIP_TONE[chip.tone], 'outline-offset-2 transition-opacity duration-[160ms] ease-[ease] hover:opacity-80')}
    >
      {face}
    </button>
  )
}

const REASON = 'inline-flex h-6 items-center rounded-full px-2.5 font-heading text-[12.5px] font-medium whitespace-nowrap outline-offset-2 transition-colors duration-[160ms] ease-[ease]'

const closeOnHost: CloseCommand = (args) => run('github.issue.close', args)

/** One issue's Close issue, for its button and its menu. The close reads the issue and the host as they are when it is confirmed, not as they were when the row appeared. */
function useIssueClose(issue: GitHubIssue, live: boolean): IssueClose {
  const latest = useRef({ issue, live })
  useEffect(() => {
    latest.current = { issue, live }
  })
  const [flow] = useState(() => createIssueClose({ close: (reason) => closeIssueAs(reason, { ...latest.current, command: closeOnHost }) }))
  useEffect(() => () => flow.dispose(), [flow])
  return flow
}

/**
 * Close issue, confirmed in place as a verdict in Review is (`issue-close.ts`): the first click turns the button into
 * "Click again to close" for ten seconds, a line along its foot running out over them, with the reason to close it
 * as, Completed or Not planned, and what becomes of hobkin's item for it. The second click closes it through the
 * host's gh; Escape, leaving the button or the ten seconds running out take the first click back. With no host it
 * answers that this is sample data.
 */
function CloseIssue({ issue, flow }: { issue: GitHubIssue; flow: IssueClose }) {
  const still = useStill()
  const { armed, choice: reason, busy, said } = useStore(flow)
  const label = busy ? 'Closing…' : armed ? 'Click again to close' : 'Close issue'
  const warning = armed ? closeWarning(issue.work) : null
  const Icon = reason === 'not-planned' ? Ban : CircleCheck

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !armed) return
    // Escape takes the first click back here, before the screen or the frame hears it.
    event.preventDefault()
    event.stopPropagation()
    flow.cancel()
  }
  // Focus that moves to another control takes the first click back. A click that focuses nothing names nowhere, and the ten seconds see to it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (armed && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) flow.cancel()
  }

  return (
    <div className="flex flex-col items-start gap-2" onKeyDownCapture={onKeyDownCapture} onBlur={onBlur}>
      <Button
        variant="outline"
        data-stop=""
        aria-pressed={armed}
        disabled={busy}
        focusableWhenDisabled
        // A key held from the first click only repeats, and never gives the second.
        onKeyDown={(event) => {
          if (heldDown(event)) event.preventDefault()
        }}
        onClick={() => void flow.press()}
        className={cn('relative overflow-hidden', armed && 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background')}
      >
        <Icon aria-hidden="true" />
        {label}
        {armed && !still ? (
          <motion.span
            key={reason}
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-55"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: CLOSE_CONFIRM_MS / 1000, ease: 'linear' }}
          />
        ) : null}
      </Button>
      {armed ? (
        <div role="radiogroup" aria-label="Close it as" className="flex flex-wrap gap-1.5">
          {CLOSE_REASONS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={reason === choice.value}
              data-stop=""
              onClick={() => flow.choose(choice.value)}
              className={cn(REASON, reason === choice.value ? 'bg-foreground text-background' : 'bg-surface-2 text-muted-foreground hover:text-foreground')}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
      {warning ? <p className="text-[13px] leading-snug text-warn-fg">{warning}</p> : null}
      {said ? (
        <p
          role={said.tone === 'refused' ? 'alert' : 'status'}
          title={said.text}
          className={cn('line-clamp-3 text-[13px] leading-snug', said.tone === 'refused' ? 'text-bad-fg' : 'text-muted-foreground')}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  )
}

/** A group's heading, with how many it holds and, when it helps, what it holds. */
export function GroupHeading({ label, count, about, ...placed }: Placed & { label: string; count: number; about?: string }) {
  return (
    <Piece {...placed} className="px-1 pt-8 pb-1 first:pt-0">
      <h2 className="eyebrow flex items-baseline gap-2">
        {label}
        <span className="tabular-nums">{count}</span>
      </h2>
      {about ? <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">{about}</p> : null}
    </Piece>
  )
}

/** A quiet line in the list: a group with nothing in it, or one that holds only the most recent. */
export function NoteRow({ children, ...placed }: Placed & { children: ReactNode }) {
  return (
    <Piece {...placed} className="rounded-3xl border border-dashed border-border px-5 py-4 text-[14px] leading-snug text-muted-foreground">
      {children}
    </Piece>
  )
}
