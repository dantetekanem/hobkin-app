import { ExternalLink, Waypoints } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Button, buttonVariants } from '@/components/ui/button.tsx'
import { openOnGitHub } from '@/features/github/open.ts'
import { finishedReviewId } from '@/features/review/entry.ts'
import { rowLayout, type Leaving } from '@/features/reports/list-motion.ts'
import { useGitHub, type FinishedChange, type FinishedGroup, type GitHubPull, type WorkState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { HobkinChoice } from './actions.ts'
import { GradeChip, ReviewBadge, SaidLine, SectionHeading } from './parts.tsx'
import { saysHigh } from './review-badge.ts'
import { underWay } from './review-follow.ts'
import { runWork, useWorkUi, type Said } from './store.ts'
import { useChangeReview } from './use-change-review.ts'

/**
 * Finished changes in hobkin's three groups: ready to merge, refresh then merge, and needs you. Each card says what
 * the change is, its proof, its grade, the level its change review found (spec 032), why it is in its group and what
 * a yes does, and offers hobkin's choices in hobkin's order. "Review" opens it in Change Review, "Review again" runs
 * the change review once more instead of hobkin's agent review, and a change on GitHub links to its pull request.
 * A group's one yes first lists every title it acts on, in the order they go, and then says how each went.
 */

interface Shared {
  live: boolean
  variants: Variants
  /** Its turn in the screen's arrival, or -1 once the screen has arrived. */
  turn: () => number
  /** Runs once the cards that left have gone, so the keyboard can stay on the screen. */
  onRowsLeft: () => void
}

export function FinishedSection({ work, ...shared }: { work: WorkState } & Shared) {
  // A merged change goes on to the right, the way the work goes. One the user said no to is set aside to the left.
  const [leaving, setLeaving] = useState<Leaving>('answered')
  const said = useWorkUi((state) => state.said['finished'])
  const total = work.finished.reduce((sum, { changes }) => sum + changes.length, 0)

  return (
    <section aria-label="Finished changes" className="flex flex-col gap-4">
      <SectionHeading label="Finished changes" count={total} />
      <AnimatePresence>{said ? <Told key={said.text} said={said} /> : null}</AnimatePresence>
      {work.finished.map((group) => (
        <Group key={group.name} group={group} leaving={leaving} onLeaving={setLeaving} {...shared} />
      ))}
      {total === 0 ? <p className="px-1 text-[13.5px] text-muted-foreground">Nothing finished waits for you.</p> : null}
    </section>
  )
}

/** What hobkin said the last time something here was carried out, with a line for each row of a group. */
function Told({ said }: { said: Said }) {
  const still = useStill()
  const forget = useWorkUi((state) => state.forget)
  return (
    <motion.div
      data-finished-said=""
      tabIndex={-1}
      role="status"
      className="flex items-start gap-3 rounded-2xl bg-tone-1 px-4 py-3 outline-offset-[-2px]"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-8px) scale(0.98)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', duration: 0.42, bounce: 0.14 }}
    >
      <div className="min-w-0 flex-1">
        {said.lines?.length ? (
          <ol className="mb-1.5 flex flex-col gap-1 text-[13px] leading-snug">
            {said.lines.map((line, index) => (
              <li key={`${index}:${line}`} className="flex gap-2">
                <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{index + 1}.</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <p className={cn('text-[13px] leading-snug', said.tone === 'refused' ? 'text-bad-fg' : said.lines?.length ? 'font-medium' : '')}>{said.text}</p>
      </div>
      <Button variant="ghost" size="xs" onClick={() => forget('finished')} className="text-muted-foreground">
        Done
      </Button>
    </motion.div>
  )
}

function Group({ group, leaving, onLeaving, live, variants, turn, onRowsLeft }: { group: FinishedGroup; leaving: Leaving; onLeaving: (leaving: Leaving) => void } & Shared) {
  const place = `group:${group.name}`
  const busy = useWorkUi((state) => Boolean(state.busy[place]))
  const [asking, setAsking] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)

  const answer = async (yes: boolean) => {
    setAsking(false)
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }))
    if (!yes) return
    onLeaving('answered')
    const said = await runWork({ do: 'group', group }, { live, place })
    useWorkUi.getState().forget(place)
    useWorkUi.getState().note('finished', said)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1 pt-1">
        <div className="min-w-0">
          <h3 className="flex items-baseline gap-2 font-heading text-[16px] leading-tight font-semibold tracking-[-0.015em]">
            {group.heading}
            <span className="text-[13px] font-medium text-muted-foreground tabular-nums">{group.changes.length}</span>
          </h3>
          {group.why ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{group.why}</p> : null}
        </div>
        {group.action ? (
          <Button
            ref={button}
            variant={group.name === 'merge' ? 'default' : 'outline'}
            data-stop=""
            aria-expanded={asking}
            disabled={busy}
            focusableWhenDisabled
            onClick={() => setAsking(true)}
            className="scroll-mt-[124px] scroll-mb-6"
          >
            {busy ? group.action.underWay : group.action.label}
          </Button>
        ) : null}
      </div>
      <AnimatePresence>{asking && group.action ? <GroupQuestion key="asking" group={group} onAnswer={(yes) => void answer(yes)} /> : null}</AnimatePresence>
      <ul className="relative flex flex-col gap-2">
        <AnimatePresence mode="popLayout" custom={leaving} onExitComplete={onRowsLeft}>
          {group.changes.map((change) => (
            <ChangeCard key={change.key} change={change} group={group} live={live} variants={variants} order={turn()} onLeaving={onLeaving} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

/** The page a group's yes is given on: every title it acts on, numbered in the order they go, under their projects, and what the yes does. */
function GroupQuestion({ group, onAnswer }: { group: FinishedGroup; onAnswer: (yes: boolean) => void }) {
  const still = useStill()
  const yes = useRef<HTMLButtonElement | null>(null)
  const action = group.action!
  useEffect(() => yes.current?.focus({ preventScroll: true }), [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From "Not now" Escape first steps back to the yes. From the yes it leaves the question, and the frame leaves the key alone.
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onAnswer(false)
  }

  return (
    <motion.div
      data-work-item=""
      role="group"
      aria-label={action.question}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-3xl bg-background px-5 py-4 shadow-panel"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-10px) scale(0.98)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
      exit={still ? { opacity: 0, transition: { duration: 0.14 } } : { opacity: 0, transform: 'translateY(-6px) scale(0.98)', transition: { duration: 0.14 } }}
      transition={{ type: 'spring', duration: 0.42, bounce: 0.12 }}
    >
      <p className="font-heading text-[15px] leading-snug font-semibold tracking-[-0.01em]">{action.question}</p>
      <div className="flex flex-col gap-2.5">
        {action.plan.projects.map((project) => (
          <div key={project.slug}>
            <p className="eyebrow">{project.project}</p>
            <ol className="mt-1 flex flex-col gap-1">
              {project.steps.map((step) => (
                <li key={step.number} className="flex gap-2 text-[13.5px] leading-snug">
                  <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{step.number}.</span>
                  <span className="min-w-0">
                    {step.title} <span className="text-muted-foreground">· {step.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground">{action.plan.about}</p>
      <div className="flex flex-wrap gap-2">
        <Button ref={yes} variant={group.name === 'merge' ? 'default' : 'outline'} data-stop="" data-work-main="" onClick={() => onAnswer(true)}>
          {action.label}
        </Button>
        <Button variant="ghost" tabIndex={-1} data-row-control="" onClick={() => onAnswer(false)}>
          Not now
        </Button>
      </div>
    </motion.div>
  )
}

const REVIEW_STATE: Record<GitHubPull['review'], { label: string; tone: string } | null> = {
  approved: { label: 'Approved', tone: 'bg-ok/15 text-ok-fg' },
  'changes-requested': { label: 'Changes requested', tone: 'bg-bad/15 text-bad-fg' },
  waiting: { label: 'Waiting for review', tone: 'bg-surface-2 text-muted-foreground' },
  none: null,
}
const CHECKS_STATE: Record<GitHubPull['checks'], { label: string; tone: string } | null> = {
  passing: { label: 'Checks pass', tone: 'bg-ok/15 text-ok-fg' },
  failing: { label: 'Checks fail', tone: 'bg-bad/15 text-bad-fg' },
  pending: { label: 'Checks running', tone: 'bg-surface-2 text-muted-foreground' },
  none: null,
}

/** Where a change's pull request stands on GitHub, when gh has read it. */
function PullStatus({ pull }: { pull: GitHubPull | undefined }) {
  if (!pull) return null
  return (
    <>
      {[REVIEW_STATE[pull.review], CHECKS_STATE[pull.checks], pull.draft ? { label: 'Draft', tone: 'bg-surface-2 text-muted-foreground' } : null]
        .filter((said): said is { label: string; tone: string } => said !== null)
        .map(({ label, tone }) => (
          <span key={label} className={cn('inline-flex h-5 items-center rounded-full px-2 font-heading text-[11px] font-medium whitespace-nowrap', tone)}>
            {label}
          </span>
        ))}
    </>
  )
}

const prNumber = (url: string) => /\/pull\/(\d+)/.exec(url)?.[1]

/** What a choice says while hobkin carries it out. */
const UNDER_WAY: Partial<Record<HobkinChoice, string>> = { merge: 'Merging…', mergePr: 'Merging…', refreshMerge: 'Asking for its refresh…' }

/** The card's own "Review again", in place of hobkin's "Get it reviewed": the change review once more, never an agent run. */
const REVIEW_AGAIN_TITLE = 'Runs the change review again at this commit: its tests and one model pass.'
const SAMPLE_REVIEW_AGAIN = 'This is sample data, so no change review runs here.'

/** The yes that lands a change stands out, unless its change review says it needs the user. Every other choice stays quiet. */
function variantOf(choice: HobkinChoice, risky: boolean): 'default' | 'outline' | 'ghost' {
  const lands = choice === 'merge' || choice === 'mergePr' || choice === 'refreshMerge' || choice === 'rebase'
  if (!lands) return 'ghost'
  return risky ? 'outline' : 'default'
}

function ChangeCard({ change, group, live, variants, order, onLeaving }: { change: FinishedChange; group: FinishedGroup; live: boolean; variants: Variants; order: number; onLeaving: (leaving: Leaving) => void }) {
  const still = useStill()
  const busy = useWorkUi((state) => Boolean(state.busy[change.key] || state.busy[`group:${group.name}`]))
  const said = useWorkUi((state) => state.said[change.key])
  const github = useGitHub()
  const [chosen, setChosen] = useState<HobkinChoice | null>(null)
  const [noting, setNoting] = useState(false)
  const pull = change.pr ? [...github.pulls, ...github.reviews].find(({ url }) => url === change.pr) : undefined
  const reviewId = finishedReviewId(change, live)
  // A sample card has no change review, so nothing is asked for it.
  const { assessment, again } = useChangeReview(live ? reviewId : null, change.head)
  const risky = saysHigh(assessment)

  const review = () => {
    if (reviewId) useView.getState().openReviewFor(reviewId)
  }

  // "Review again" runs the change review once more in the host. hobkin's own review, an agent run, is never asked for.
  const reviewAgain = async () => {
    if (!live) {
      useWorkUi.getState().note(change.key, { tone: 'refused', text: SAMPLE_REVIEW_AGAIN })
      return
    }
    try {
      await again()
      useWorkUi.getState().forget(change.key)
    } catch (error) {
      useWorkUi.getState().note(change.key, { tone: 'refused', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const choose = async (choice: Exclude<HobkinChoice, 'review'>, note?: string) => {
    setChosen(choice)
    onLeaving(choice === 'decline' ? 'deleted' : 'answered')
    const result = await runWork({ do: 'change', change, choice, ...(note === undefined ? {} : { note }) }, { live, place: change.key })
    setChosen(null)
    if (result.tone !== 'done') return
    // The card leaves with its answer, so what hobkin said goes to the section.
    setNoting(false)
    useWorkUi.getState().forget(change.key)
    if (result.text) useWorkUi.getState().note('finished', result)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter on the card opens it in Change Review, to read before saying yes. Its choices are to its right.
    if (event.target !== event.currentTarget || event.key !== 'Enter') return
    event.preventDefault()
    review()
  }

  // A choice under way keeps the keyboard where it is: a plain disabled button would drop it.
  const control = { tabIndex: -1, 'data-row-control': '', size: 'sm' as const, disabled: busy, focusableWhenDisabled: true }

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        data-change={change.key}
        tabIndex={-1}
        role="group"
        aria-label={`${change.project}: ${change.title}. ${change.reason} Enter opens it in Review.`}
        onKeyDown={onKeyDown}
        className="flex scroll-mt-[124px] scroll-mb-6 flex-col gap-2.5 rounded-3xl bg-background p-5 outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] focus-visible:bg-tone-2"
      >
        <div className="flex items-start gap-3">
          <span className="mt-[3px] w-7 shrink-0">
            <GradeChip grade={change.grade} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{change.project}</p>
            <h4 className="mt-0.5 font-heading text-[16px] leading-snug font-semibold tracking-[-0.01em] text-balance">{change.title}</h4>
            {change.about ? <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed">{change.about}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
              <ReviewBadge status={assessment} />
              {change.size ? (
                <span className="tabular-nums">
                  {change.size.lines} {change.size.lines === 1 ? 'line' : 'lines'} · {change.size.files} {change.size.files === 1 ? 'file' : 'files'}
                </span>
              ) : null}
              {change.behind > 0 ? <span className="tabular-nums">· {change.behind} behind</span> : null}
              <PullStatus pull={pull} />
            </div>
            <p className="mt-2 text-[12.5px] leading-snug">
              <span className="text-muted-foreground">Proof: </span>
              {change.proof ?? 'No proof: nothing recorded shows it works.'}
            </p>
            <p className={cn('mt-1 text-[12.5px] leading-snug', group.name === 'needs' ? 'text-warn-fg' : 'text-muted-foreground')}>{change.reason}</p>
            <p className="mt-1 text-[12px] leading-snug break-words text-muted-foreground">{change.yes}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pl-10">
          {change.choices.map(({ value, label }) => {
            if (value === 'diff') {
              return (
                <Button key={value} variant="outline" {...control} disabled={false} onClick={review}>
                  <Waypoints aria-hidden="true" />
                  Review
                </Button>
              )
            }
            if (value === 'open') {
              return change.pr ? (
                <a
                  key={value}
                  href={change.pr}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={-1}
                  data-row-control=""
                  onClick={(event) => openOnGitHub(event, change.pr!)}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  Open PR #{prNumber(change.pr)}
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : null
            }
            if (value === 'review') {
              return (
                <Button key={value} {...control} disabled={busy || underWay(assessment)} variant="ghost" title={REVIEW_AGAIN_TITLE} onClick={() => void reviewAgain()}>
                  Review again
                </Button>
              )
            }
            return (
              <Button key={value} {...control} variant={variantOf(value, risky)} className={cn(value === 'decline' && 'text-bad-fg')} onClick={() => void choose(value)}>
                {busy && chosen === value ? (UNDER_WAY[value] ?? `${label}…`) : label}
              </Button>
            )
          })}
          <Button {...control} variant="ghost" aria-expanded={noting} onClick={() => setNoting((open) => !open)}>
            Ask for changes
          </Button>
        </div>

        <AnimatePresence>{noting ? <AskForChanges key="noting" busy={busy} onSend={(note) => void choose('changes', note)} onCancel={() => setNoting(false)} /> : null}</AnimatePresence>
        {said?.tone === 'refused' ? (
          <SaidLine tone="refused" className="pl-10">
            {said.text}
          </SaidLine>
        ) : null}
      </div>
    </motion.li>
  )
}

/** The user's own words for what to change. An agent goes back to the change with them, first in the queue. */
function AskForChanges({ busy, onSend, onCancel }: { busy: boolean; onSend: (note: string) => void; onCancel: () => void }) {
  const still = useStill()
  const [note, setNote] = useState('')
  const field = useRef<HTMLInputElement | null>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])
  const words = note.trim()

  return (
    <motion.div
      className="flex items-center gap-2 pl-10"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-6px)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', duration: 0.36, bounce: 0.1 }}
    >
      <input
        ref={field}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && words && !busy) {
            event.preventDefault()
            onSend(words)
          } else if (event.key === 'Escape') {
            // Used here, so the frame leaves it alone.
            event.preventDefault()
            onCancel()
          }
        }}
        placeholder="Type the changes, then Enter"
        aria-label="The changes to ask for"
        className="h-8 min-w-0 flex-1 rounded-full border-[1.5px] border-input bg-surface px-3.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <Button size="sm" disabled={!words || busy} onClick={() => onSend(words)}>
        Send
      </Button>
    </motion.div>
  )
}
