import { GitMerge } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { rowLayout, type Leaving } from '@/features/reports/list-motion.ts'
import { clockTime, dayLabel, timeOf } from '@/features/reports/time.ts'
import type { FinishedGroup, WorkState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { MergingRow } from '#shared/protocol/work.ts'
import { ChangeRow } from './ChangeRow.tsx'
import { needsFirst } from './finished-cards.ts'
import { StackGroup, type DrawCard } from './StackGroup.tsx'
import { arrange, placeOf, type Arranged } from './stacks.ts'
import { IssueLink, PullLink, SectionHeading } from './parts.tsx'
import { runWork, useWorkUi, type Said } from './store.ts'

/**
 * Finished changes in hobkin's groups, the one that needs the user first, then what runs left for the user, then ready
 * to merge and refresh then merge. Each is a short row (`ChangeRow`, spec 061): its facts, its title with its priority
 * and the level its change review found, the one sentence for its group, and the one action that fits it. A row opens
 * in place to everything a card held, and "Review" opens the change in Change Review. A group's one yes first lists
 * every title it acts on, in the order they go, and then says how each went.
 *
 * A "Left for you" row leads with the note its run left and offers Answer, and no merge: Review, Ask for changes, and
 * Close without merging, which takes a second click. Under the groups, what the user said yes to that is still being
 * brought up to date before it merges.
 */

interface Shared {
  live: boolean
  variants: Variants
  /** Its turn in the screen's arrival, or -1 once the screen has arrived. */
  turn: () => number
  /** Runs once the cards that left have gone, so the keyboard can stay on the screen. */
  onRowsLeft: () => void
}

export function FinishedSection({ work, ...shared }: { work: Pick<WorkState, 'finished' | 'merging'> } & Shared) {
  // A merged change goes on to the right, the way the work goes. One the user said no to is set aside to the left.
  const [leaving, setLeaving] = useState<Leaving>('answered')
  const said = useWorkUi((state) => state.said['finished'])
  const total = work.finished.reduce((sum, { changes }) => sum + changes.length, 0)

  return (
    <section aria-label="Finished changes" className="flex flex-col gap-4">
      <SectionHeading label="Finished changes" count={total} />
      <AnimatePresence>{said ? <Told key={said.text} said={said} /> : null}</AnimatePresence>
      {arrange(needsFirst(work.finished)).map((arranged) => (
        <Group key={arranged.group.name} arranged={arranged} leaving={leaving} onLeaving={setLeaving} {...shared} />
      ))}
      {total === 0 ? <p className="px-1 text-[13.5px] text-muted-foreground">Nothing finished waits for you.</p> : null}
      {work.merging?.length ? <MergingGroup rows={work.merging} variants={shared.variants} turn={shared.turn} /> : null}
    </section>
  )
}

/** When the user said yes, in the conversation's clock, with the day when it was not today. */
function saidYesAt(since: string | null, now: number): string {
  const at = timeOf(since)
  if (at === null) return 'You said yes'
  const day = dayLabel(at, now)
  return `You said yes ${day === 'Today' ? '' : `${day} `}at ${clockTime(at)}`
}

/**
 * What the user said yes to that has not merged yet: an agent brings each up to date and runs its proof again, and
 * hobkin merges it once that run ends well. Nothing here waits on the user, so a row offers nothing but its links.
 */
function MergingGroup({ rows, variants, turn }: { rows: MergingRow[]; variants: Variants; turn: () => number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 pt-1">
        <h3 className="flex items-baseline gap-2 font-heading text-[16px] leading-tight font-semibold tracking-[-0.015em]">
          You said yes, merging
          <span className="text-[13px] font-medium text-muted-foreground tabular-nums">{rows.length}</span>
        </h3>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Nothing waits on you. One that cannot merge after its refresh says why in Chat.</p>
      </div>
      <ul className="relative flex flex-col">
        <AnimatePresence mode="popLayout">
          {rows.map((row) => (
            <MergingItem key={row.key} row={row} variants={variants} order={turn()} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

function MergingItem({ row, variants, order }: { row: MergingRow; variants: Variants; order: number }) {
  const still = useStill()
  const now = useNow(true, 30_000)
  const doing = row.handedOff
    ? "The main agent's session brings it up to date and runs its proof again, then merges it."
    : 'An agent brings it up to date and runs its proof again, then hobkin merges it.'
  const line = `${saidYesAt(row.since, now)}. ${doing}`
  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        data-merging={row.key}
        tabIndex={-1}
        role="group"
        aria-label={`${row.project}: ${row.title}. ${line}`}
        // A click does nothing here, so nothing changes under the pointer (053). The keyboard still shows where it is.
        className="flex min-h-12 scroll-mt-[124px] scroll-mb-6 items-center gap-3 rounded-2xl px-3 py-2 outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease] focus-visible:bg-surface-2"
      >
        <span className="flex w-7 shrink-0 justify-center text-muted-foreground">
          <GitMerge aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13.5px] leading-snug font-medium">
              <span className="text-muted-foreground">{row.project}:</span> {row.title}
            </span>
            <IssueLink issue={row.issue} />
            <PullLink url={row.pr} />
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{line}</span>
        </span>
      </div>
    </motion.li>
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

function Group({ arranged, leaving, onLeaving, live, variants, turn, onRowsLeft }: { arranged: Arranged; leaving: Leaving; onLeaving: (leaving: Leaving) => void } & Shared) {
  const { group, entries } = arranged
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
          {entries.map((entry) => {
            if (entry.kind === 'stack') {
              const drawCard: DrawCard = ({ change, group: own }, place, whole) => (
                <ChangeRow key={change.key} change={change} group={own} place={place} bare={!whole} live={live} variants={variants} order={whole ? turn() : -1} onLeaving={onLeaving} />
              )
              return <StackGroup key={entry.key} entry={entry} live={live} variants={variants} order={turn()} leaving={leaving} onRowsLeft={onRowsLeft} drawCard={drawCard} />
            }
            return <ChangeRow key={entry.key} change={entry.at.change} group={entry.at.group} place={entry.place ? placeOf(entry.place) : null} live={live} variants={variants} order={turn()} onLeaving={onLeaving} />
          })}
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
