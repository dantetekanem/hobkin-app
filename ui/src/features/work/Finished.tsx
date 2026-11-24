import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useMemo, useState } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import type { Leaving } from '@/features/reports/list-motion.ts'
import { useHost, type WorkState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { ChangeRow } from './ChangeRow.tsx'
import { entriesOf, lowestOf, projectsOf, sortEntries, tallyOf, tallyWords, type ProjectRows } from './change-list.ts'
import { OrderControl } from './OrderControl.tsx'
import { useOrderChoice } from './order-choice.ts'
import { StackGroup, type DrawCard } from './StackGroup.tsx'
import { placeOf } from './stacks.ts'
import { SectionHeading } from './parts.tsx'
import { useWorkUi, type Said } from './store.ts'

/**
 * Finished changes as one list (_specs/066-work-one-list). Every change is a short row (`ChangeRow`, spec 061) with
 * the general rate and the five grades in front, its title with its priority and small tags, one sentence, and the one
 * action that fits it. The projects are quiet headings over their rows, a visual aid only, and the chips above the
 * page filter them. An order control and a tally line sit under the heading. hobkin's groups are not shown: the host
 * still sends them, and they are flattened here. A row opens in place to everything a card held.
 *
 * What the user said merge to leaves at once (the user, 2026-11-24: "when i do a merge it should IMMEDIATELLY remove the
 * nodes/cards"): it has no row here while it is brought up to date.
 */

interface Shared {
  live: boolean
  variants: Variants
  /** Its turn in the screen's arrival, or -1 once the screen has arrived. */
  turn: () => number
  /** Runs once the cards that left have gone, so the keyboard can stay on the screen. */
  onRowsLeft: () => void
}

export function FinishedSection({ work, only, ...shared }: { work: Pick<WorkState, 'finished' | 'merging'>; /** The name of the one project the page shows, when it does. */ only?: string } & Shared) {
  // A merged change goes on to the right, the way the work goes. One the user said no to is set aside to the left.
  const [leaving, setLeaving] = useState<Leaving>('answered')
  const said = useWorkUi((state) => state.said['finished'])
  const order = useOrderChoice((state) => state.order)
  const chooseOrder = useOrderChoice((state) => state.choose)
  const { finished } = work
  // The user's lowest rate, which a row's Merge needs. A number, so the section draws again only when it changes.
  const lowest = useHost((state) => lowestOf(state.work?.yolo))
  // Everything below is derived from the state, the filter and the order alone, so it is worked out once for each.
  const entries = useMemo(() => entriesOf(finished), [finished])
  const projects = useMemo(() => projectsOf(sortEntries(entries, order)), [entries, order])
  const tally = useMemo(() => tallyOf(entries, lowest), [entries, lowest])

  return (
    <section aria-label="Finished changes" className="flex flex-col gap-3">
      <SectionHeading label="Finished changes" count={tally.changes}>
        <div className="ml-auto min-w-0">
          <OrderControl value={order} onChoose={chooseOrder} />
        </div>
      </SectionHeading>
      <p className="min-h-5 px-1 text-[13px] leading-5 text-muted-foreground tabular-nums">
        {tally.changes === 0 && only ? `Nothing finished for ${only} waits for you.` : tallyWords(tally, lowest)}
      </p>
      <AnimatePresence>{said ? <Told key={said.text} said={said} /> : null}</AnimatePresence>
      {projects.map((project) => (
        <Project key={project.slug} project={project} lowest={lowest} leaving={leaving} onLeaving={setLeaving} {...shared} />
      ))}
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

/** One project's rows under its quiet heading: its name and how many changes it holds. A visual aid only. */
function Project({ project, lowest, leaving, onLeaving, live, variants, turn, onRowsLeft }: { project: ProjectRows; lowest: number; leaving: Leaving; onLeaving: (leaving: Leaving) => void } & Shared) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 px-1 pt-1 text-[12.5px] leading-5 font-medium text-muted-foreground">
        {project.name}
        <span className="font-normal tabular-nums opacity-70">{project.count}</span>
      </h3>
      <ul className="relative flex flex-col gap-2">
        <AnimatePresence mode="popLayout" custom={leaving} onExitComplete={onRowsLeft}>
          {project.entries.map((entry) => {
            if (entry.kind === 'stack') {
              const drawCard: DrawCard = ({ change }, place, whole) => (
                <ChangeRow key={change.key} change={change} lowest={lowest} place={place} bare={!whole} live={live} variants={variants} order={whole ? turn() : -1} onLeaving={onLeaving} />
              )
              return <StackGroup key={entry.key} entry={entry} live={live} variants={variants} order={turn()} leaving={leaving} onRowsLeft={onRowsLeft} lowest={lowest} onLeaving={onLeaving} drawCard={drawCard} />
            }
            return <ChangeRow key={entry.key} change={entry.at.change} lowest={lowest} place={entry.place ? placeOf(entry.place) : null} live={live} variants={variants} order={turn()} onLeaving={onLeaving} />
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
