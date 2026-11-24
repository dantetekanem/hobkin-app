import { ChevronDown, ChevronRight, ExternalLink, Waypoints } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Button, buttonVariants } from '@/components/ui/button.tsx'
import { finishedReviewId } from '@/features/review/entry.ts'
import { rowLayout, type Leaving } from '@/features/reports/list-motion.ts'
import { ProofCheckLine, ProofChips } from '@/features/proofs/ProofChips.tsx'
import { usePullRequests } from '@/integration/use-pulls.ts'
import { type FinishedChange, type FinishedGroup } from '@/lib/host/index.ts'
import { openLink } from '@/lib/open-link.ts'
import { cn } from '@/lib/utils.ts'
import type { HobkinChoice } from './actions.ts'
import { actionOf, factsOf, placeBefore, rowKey, sentenceOf, type Fact, type Tone } from './change-row.ts'
import { ClampedLine, CloseWithoutMerging, REVIEW_AGAIN_TITLE, ReplyBox, SAMPLE_REVIEW_AGAIN, UNDER_WAY, prNumber, variantOf } from './change-controls.tsx'
import { endAtWord } from './finished-cards.ts'
import { GradeChip, IssueLink, PullLink, ReviewBadge, SaidLine } from './parts.tsx'
import { saysHigh } from './review-badge.ts'
import { underWay } from './review-follow.ts'
import { clickPressesRow } from './row-press.ts'
import { sampleAssessmentOf } from './sample-reviews.ts'
import { runWork, useWorkUi } from './store.ts'
import { useChangeReview } from './use-change-review.ts'

/**
 * A finished change as a short row that opens in place (_specs/061-finished-changes-rows). Closed, it is three lines:
 * the facts, the title with its priority and its review's state, and the one sentence for its group, with the one
 * action for its group and a chevron at the right. Open, it shows everything a card held in two columns, under the
 * same three lines, which do not move.
 */

interface Props {
  change: FinishedChange
  group: FinishedGroup
  /** "2 of 5", when the change is a layer of a stack whose place the caller knows. A stack's own layers say it themselves. */
  place?: string | null
  /** A stack layer's open row: only what an open row holds, since the layer's line above it says its place and title. */
  bare?: boolean
  /** Opens drawn already open, and with the reply box under the note: for a stack's layers and for pictures. */
  initiallyOpen?: boolean
  live: boolean
  variants: Variants
  order: number
  onLeaving: (leaving: Leaving) => void
}

const TONE: Record<Tone, string> = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: '' }

function FactPart({ fact, change }: { fact: Fact; change: FinishedChange }): ReactNode {
  if (fact.kind === 'project') return <span className="font-medium">{fact.text}</span>
  if (fact.kind === 'issue') return <IssueLink issue={change.issue} />
  if (fact.kind === 'pull') return <PullLink url={change.pr} />
  if (fact.kind === 'pull-state') return <span className={cn('whitespace-nowrap', TONE[fact.tone])}>{fact.text}</span>
  if (fact.kind === 'models') return <span className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 font-heading text-[11px] font-medium whitespace-nowrap">{fact.text}</span>
  return <span className="whitespace-nowrap tabular-nums">{fact.text}</span>
}

/** A small label over a part of an open row. Quieter than the text under it. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11.5px] leading-none text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function openingMotion({ still, bare }: { still: boolean; bare: boolean }) {
  if (still) return { initial: bare ? false : { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.1 } } }
  const shut = { height: 0, opacity: 0, overflow: 'hidden' }
  return {
    initial: bare ? false : shut,
    animate: { height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } },
    exit: { ...shut, transition: { duration: 0.16 } },
  }
}

export function ChangeRow({ change, group, place = null, bare = false, initiallyOpen = false, live, variants, order, onLeaving }: Props) {
  const still = useStill()
  const busy = useWorkUi((state) => Boolean(state.busy[change.key] || state.busy[`group:${group.name}`]))
  const said = useWorkUi((state) => state.said[change.key])
  const pulls = usePullRequests()
  const [chosen, setChosen] = useState<HobkinChoice | null>(null)
  const [noting, setNoting] = useState(false)
  const [opened, setOpened] = useState(initiallyOpen)
  const open = bare || opened
  const pull = change.pr ? pulls.find(({ url }) => url === change.pr) : undefined
  const reviewId = finishedReviewId(change, live)
  // A sample row's change review is the sample's, so nothing is asked for it.
  const followed = useChangeReview(live ? reviewId : null, change.head)
  const assessment = live ? followed.assessment : sampleAssessmentOf(change)
  const { again } = followed
  const risky = saysHigh(assessment)
  const facts = factsOf(change, pull)
  const sentence = sentenceOf(change, group)
  const action = actionOf(change, group)
  const placed = place ?? placeBefore(change.stack)

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
    // What merges goes on to the right; what is set aside, said no to or closed unmerged, goes to the left.
    onLeaving(choice === 'decline' || choice === 'done' ? 'deleted' : 'answered')
    const result = await runWork({ do: 'change', change, choice, ...(note === undefined ? {} : { note }) }, { live, place: change.key })
    setChosen(null)
    if (result.tone !== 'done') return
    // The row leaves with its answer, so what hobkin said goes to the section.
    setNoting(false)
    useWorkUi.getState().forget(change.key)
    if (result.text) useWorkUi.getState().note('finished', result)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = rowKey({ key: event.key, onRow: event.target === event.currentTarget })
    if (key === null) return
    // Space would scroll the page, so the row takes it.
    event.preventDefault()
    if (key === 'review') review()
    else if (!bare) setOpened((was) => !was)
  }
  // A click on the row does what Enter does (053). One on its controls, links and chips is theirs.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (clickPressesRow(event)) review()
  }

  // A choice under way keeps the keyboard where it is: a plain disabled button would drop it.
  const control = { tabIndex: -1, 'data-row-control': '', size: 'sm' as const, disabled: busy, focusableWhenDisabled: true }
  const Chevron = open ? ChevronDown : ChevronRight

  const closedAction = () => {
    if (action.kind === 'review') {
      return (
        <Button {...control} disabled={false} variant="outline" onClick={review}>
          Review
        </Button>
      )
    }
    const choice = action.choice as Exclude<HobkinChoice, 'review'>
    const label = busy && chosen === choice ? (UNDER_WAY[choice] ?? `${action.label}…`) : action.label
    return (
      <Button {...control} variant={variantOf(choice, risky)} title={change.yes} onClick={() => void choose(choice)} className="max-w-[16rem] min-w-0">
        <span className="truncate">{label}</span>
      </Button>
    )
  }

  // A row opens with a short height and opacity change, and under Still with opacity alone.
  const opening = openingMotion({ still, bare })

  const body = (
    <div className={cn('flex flex-col gap-3 pb-1', !bare && 'border-t border-border/60 pt-3')}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 @[900px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3 empty:hidden">
          {change.about ? (
            <Part label="What it did">
              <p className="text-[13px] leading-relaxed break-words">{change.about}</p>
            </Part>
          ) : null}
          {change.left ? (
            <Part label="Its note to you">
              <p className="text-[13px] leading-relaxed break-words">{change.left}</p>
            </Part>
          ) : null}
          <AnimatePresence>{noting ? <ReplyBox key="noting" busy={busy} onSend={(note) => void choose('changes', note)} onCancel={() => setNoting(false)} /> : null}</AnimatePresence>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Part label="Proof">
            <ClampedLine lines={4} text={change.proof ? endAtWord(change.proof) : 'No proof: nothing recorded shows it works.'} />
          </Part>
          {change.scores ? (
            <Part label="Scores">
              <p className="text-[12.5px] leading-snug break-words">{change.scores}</p>
            </Part>
          ) : null}
          {change.proofCheck ? <ProofCheckLine check={change.proofCheck} /> : null}
          {change.models?.length ? (
            <Part label="Model checks">
              <ProofChips project={change.slug} item={change.item} head={change.head} models={change.models} />
            </Part>
          ) : null}
        </div>
      </div>
      <p className="text-[12px] leading-snug break-words text-muted-foreground">
        {change.reason} {change.yes}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
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
                onClick={(event) => openLink(event, change.pr!)}
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
          if (value === 'done') return <CloseWithoutMerging key={value} label={label} busy={busy} onClose={() => choose('done')} />
          return (
            <Button key={value} {...control} variant={variantOf(value, risky)} title={change.yes} className={cn(value === 'decline' && 'text-bad-fg')} onClick={() => void choose(value)}>
              {busy && chosen === value ? (UNDER_WAY[value] ?? `${label}…`) : label}
            </Button>
          )
        })}
        <Button {...control} variant="ghost" aria-expanded={noting} onClick={() => setNoting((was) => !was)}>
          Ask for changes
        </Button>
      </div>
      {said?.tone === 'refused' ? <SaidLine tone="refused">{said.text}</SaidLine> : null}
    </div>
  )

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        data-change={change.key}
        tabIndex={-1}
        role="group"
        aria-label={`${change.project}: ${change.title}. ${sentence?.text ?? ''} A click or Enter opens it in Review. Space opens or closes it.`}
        onKeyDown={onKeyDown}
        onClick={onClick}
        className={cn('@container flex scroll-mt-[124px] scroll-mb-6 flex-col rounded-2xl bg-background px-4 outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] focus-visible:bg-tone-2', 'py-3', reviewId && 'pressable')}
      >
        {bare ? null : (
          <div className="flex items-center gap-3">
            <div className="order-2 flex shrink-0 items-center">{closedAction()}</div>
            <div className="order-1 flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex h-5 min-w-0 items-center gap-x-1.5 overflow-hidden text-[12px] text-muted-foreground">
                {facts.map((fact, index) => (
                  <span key={fact.kind + index} className="flex shrink-0 items-center gap-1.5">
                    {index > 0 ? <span aria-hidden="true">·</span> : null}
                    <FactPart fact={fact} change={change} />
                  </span>
                ))}
              </div>
              <div className="flex h-6 min-w-0 items-center gap-2">
                <GradeChip grade={change.grade} />
                {placed ? <span className="shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">{placed}</span> : null}
                <h4 title={change.title} className="min-w-0 truncate font-heading text-[15px] leading-6 font-semibold tracking-[-0.01em]">
                  {change.title}
                </h4>
                <ReviewBadge status={assessment} />
              </div>
              {sentence ? (
                <p className="line-clamp-2 text-[13.5px] leading-[19px] break-words">
                  {sentence.kind === 'note' ? (
                    <>
                      <span aria-hidden="true" title="Its run's own words to you" className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-warn-fg" />
                      <span className="sr-only">Its note to you: </span>
                    </>
                  ) : null}
                  {sentence.text}
                </p>
              ) : null}
            </div>
            <Button
              {...control}
              disabled={false}
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-label={open ? 'Close the details' : 'Open the details'}
              title={open ? 'Close the details (Space)' : 'Open the details (Space)'}
              onClick={() => setOpened((was) => !was)}
              className="order-3 shrink-0 text-muted-foreground"
            >
              <Chevron aria-hidden="true" />
            </Button>
          </div>
        )}
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="open"
              initial={opening.initial}
              animate={opening.animate}
              exit={opening.exit}
              transition={{ type: 'spring', duration: 0.32, bounce: 0 }}
              className={bare ? '' : 'pt-3'}
            >
              {body}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.li>
  )
}
