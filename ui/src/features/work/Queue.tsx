import { Play } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useState, type KeyboardEvent, type Ref } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { rowLayout } from '@/features/reports/list-motion.ts'
import { timeOf, waited } from '@/features/reports/time.ts'
import type { IssuePickup } from '#shared/protocol/work.ts'
import type { Grade, PrMode, QueueRow, WorkProject, WorkState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { discoverableProjects, trackedProjects } from './projects.ts'
import { GradeChip, IssueLink, PullLink, SaidLine, SectionHeading, Segmented } from './parts.tsx'
import { queueInSight, SHOWN_SHUT, startNowLine } from './queue-rows.ts'
import { runWork, useWorkUi, type Said } from './store.ts'

/**
 * hobkin's queue, in hobkin's order, and the projects work mode works on. A queue row starts now, runs next, is
 * skipped or is put back, as the terminal's keys do. A long queue shows its first five rows until the user asks for
 * all of it (`queue-rows.ts`). A project's priority and where its finished work goes can be changed.
 */

const tokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** What Start now does, in hobkin's terms (`pickNow` in its `src/cli/work/store.mjs`). */
const START_NOW_TITLE = 'Starts it at once, as one extra worker when none is free, without waiting out the gap between starts. A pause, the budget and any stop still hold it.'

interface Shared {
  live: boolean
  variants: Variants
  /** Its turn in the screen's arrival, or -1 once the screen has arrived. */
  turn: () => number
}

/** What hobkin said of the last Start now, kept by the queue: the row may have left it as it started. */
function StartNowTold({ said }: { said: Said }) {
  const still = useStill()
  const forget = useWorkUi((state) => state.forget)
  return (
    <motion.div
      role={said.tone === 'refused' ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded-2xl bg-tone-1 px-4 py-3"
      initial={still ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-8px) scale(0.98)' }}
      animate={still ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px) scale(1)' }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', duration: 0.42, bounce: 0.14 }}
    >
      <p className={cn('min-w-0 flex-1 text-[13.5px] leading-snug', said.tone === 'refused' && 'text-bad-fg')}>{said.text}</p>
      <Button variant="ghost" size="xs" onClick={() => forget('queue')} className="text-muted-foreground">
        Done
      </Button>
    </motion.div>
  )
}

export function QueueSection({ work, live, variants, turn }: { work: WorkState } & Shared) {
  const [open, setOpen] = useState(false)
  const told = useWorkUi((state) => state.said['queue'])
  const { rows, hidden } = queueInSight(work.queue, open)
  const urgent = work.queue.filter(({ grade, skipped }) => grade === 'P0' && !skipped).length
  // hobkin can count more in its queue than the rows it lists.
  const unlisted = work.queued - work.queue.filter(({ skipped }) => !skipped).length
  const toggles = hidden > 0 || (open && work.queue.length > SHOWN_SHUT)

  return (
    <section aria-label="Queue" className="flex flex-col gap-2">
      <SectionHeading label="Queue" count={`${urgent ? `${urgent} P0 · ` : ''}${work.queued} queued`} />
      <AnimatePresence>{told ? <StartNowTold key={told.text} said={told} /> : null}</AnimatePresence>
      {rows.length ? (
        <ul className="relative flex flex-col">
          <AnimatePresence mode="popLayout">
            {rows.map((row) => (
              <QueueItem key={row.key} row={row} live={live} variants={variants} order={turn()} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="px-1 text-[13.5px] text-muted-foreground">{work.enabled ? 'Nothing is queued. The next look comes round by itself.' : 'Nothing is queued.'}</p>
      )}
      {toggles || unlisted > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          {toggles ? (
            <Button variant="ghost" size="sm" data-stop="" aria-expanded={open} onClick={() => setOpen(!open)} className="text-muted-foreground">
              {open ? 'Show fewer' : `Show all ${work.queue.length}`}
            </Button>
          ) : null}
          {unlisted > 0 && !hidden ? <span className="px-2 text-[12.5px] text-muted-foreground">and {unlisted} more queued</span> : null}
        </div>
      ) : null}
    </section>
  )
}

function QueueItem({ row, live, variants, order }: { row: QueueRow; live: boolean; variants: Variants; order: number }) {
  const still = useStill()
  const busy = useWorkUi((state) => Boolean(state.busy[row.key]))
  const said = useWorkUi((state) => state.said[row.key])
  const act = (action: 'run' | 'skip' | 'back') => void runWork({ do: 'queue', key: row.key, action }, { live, place: row.key })
  const primary = row.skipped ? () => act('back') : () => act('run')
  const [starting, setStarting] = useState(false)

  const startNow = async () => {
    setStarting(true)
    const answer = await runWork({ do: 'queue', key: row.key, action: 'now' }, { live, place: row.key })
    setStarting(false)
    // The row may leave the queue as it starts, so what hobkin said is the queue's to keep.
    const { forget, note } = useWorkUi.getState()
    forget(row.key)
    note('queue', startNowLine(row.title, answer))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter on the row runs it next, as Enter does in the terminal, or puts a skipped row back.
    if (event.target !== event.currentTarget || event.key !== 'Enter') return
    event.preventDefault()
    if (!busy) primary()
  }

  const words = row.skipped ? 'skipped' : row.waiting ? `waiting: ${row.waiting}` : row.why
  const cost = row.tokens ? `~${tokens.format(row.tokens).toLowerCase()}` : null

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        data-queue-row={row.key}
        tabIndex={-1}
        role="group"
        aria-label={`${row.grade ?? ''} ${row.project}: ${row.title}. ${words ?? ''}. Enter ${row.skipped ? 'puts it back' : 'runs it next'}.`}
        onKeyDown={onKeyDown}
        className={cn(
          'group flex min-h-12 scroll-mt-[124px] scroll-mb-6 items-center gap-3 rounded-2xl px-3 py-2 outline-offset-[-2px] transition-colors duration-[160ms] ease-[ease]',
          'hover:bg-tone-1 focus-visible:bg-surface-2',
          row.skipped && 'text-muted-foreground',
        )}
      >
        <span className="w-7 shrink-0">
          <GradeChip grade={row.grade} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13.5px] leading-snug font-medium">
              <span className="text-muted-foreground">{row.project}:</span> {row.title}
            </span>
            <IssueLink issue={row.issue} />
            <PullLink url={row.pr} />
            {row.picked && !row.skipped ? <span className="eyebrow shrink-0 text-sun-fg">Picked</span> : null}
          </span>
          <span className={cn('mt-0.5 block truncate text-[12px]', row.waiting && !row.skipped ? 'text-warn-fg' : 'text-muted-foreground')}>
            {[words, cost].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {row.skipped ? (
            <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled onClick={() => act('back')}>
              Put back
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled title={START_NOW_TITLE} onClick={() => void startNow()}>
                <Play aria-hidden="true" />
                {busy && starting ? 'Starting…' : 'Start now'}
              </Button>
              <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled onClick={() => act('run')}>
                Run next
              </Button>
              <Button variant="ghost" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled onClick={() => act('skip')} className="text-muted-foreground">
                Skip
              </Button>
            </>
          )}
        </span>
      </div>
      {/* What hobkin said of Run next, Skip or Put back, or why it could not. Start now's line is the queue's. */}
      {said ? (
        <SaidLine tone={said.tone} className="px-13 pb-2">
          {said.text}
        </SaidLine>
      ) : null}
    </motion.li>
  )
}

const PRIORITIES: readonly { value: Grade; label: string }[] = [
  { value: 'P0', label: 'P0' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
]

/** Where a project's finished work goes, in hobkin's terms (`prModes`). */
const LANDINGS: readonly { value: PrMode; label: string }[] = [
  { value: 'off', label: 'Local branch' },
  { value: 'draft', label: 'Draft PR' },
  { value: 'published', label: 'PR' },
]

/** Which of a project's open GitHub issues hobkin files as work by itself, every 15 minutes (`issueModes` in hobkin). */
const PICKUPS: readonly { value: IssuePickup; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'labeled', label: 'Labeled hobkin' },
  { value: 'all', label: 'All' },
]

const plural = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`

/** What a project has going, as the terminal's Work tab says it (`projectStatus` in hobkin's `src/cli/ui.mjs`). */
function factsOf(project: WorkProject, now: number): string {
  const next = timeOf(project.nextLookAt)
  const facts = [
    project.open ? plural(project.open, 'item') : '',
    project.prs ? plural(project.prs, 'PR') : '',
    project.branches ? plural(project.branches, 'branch', 'branches') : '',
    project.left ? `${project.left} left for you` : '',
    project.unmerged ? `${project.unmerged} unmerged` : '',
    next !== null && next > now ? `next look in ${waited(now, next)}` : '',
  ].filter(Boolean)
  return [project.level, ...(facts.length ? facts : ['not looked at yet'])].join(' · ')
}

export function ProjectsSection({ work, live, now, variants, turn, onDiscover, discoverRef }: { work: WorkState; now: number; onDiscover: () => void; discoverRef: Ref<HTMLButtonElement> } & Shared) {
  const tracked = trackedProjects(work.projects)
  const waiting = discoverableProjects(work.projects)
  const proposed = waiting.filter(({ state }) => state === 'proposed').length

  return (
    <section aria-label="Projects" className="flex flex-col gap-2">
      <SectionHeading label="Projects" count={`${tracked.length} taken`}>
        <Button ref={discoverRef} variant="ghost" size="sm" data-stop="" className="ml-auto text-muted-foreground" onClick={onDiscover}>
          Discover projects{waiting.length ? ` · ${waiting.length}${proposed ? `, ${proposed} proposed` : ''}` : ''}
        </Button>
      </SectionHeading>
      {tracked.length ? (
        <ul className="relative flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {tracked.map((project) => (
              <ProjectItem key={project.slug} project={project} live={live} now={now} variants={variants} order={turn()} />
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="px-1 text-[13.5px] leading-relaxed text-muted-foreground">
          {work.folder ? `No project is taken yet. Discover projects lists what hobkin found in ${work.folder}, to take or skip.` : 'hobkin proposes the projects it finds once work mode is on. Discover projects lists them.'}
        </p>
      )}
    </section>
  )
}

const STATE_WORDS: Record<Exclude<WorkProject['state'], 'chosen'>, string> = {
  proposed: 'Proposed',
  skipped: 'Skipped',
  dropped: 'Dropped',
}

/**
 * A project hobkin knows and does not work on: a proposal waits for the user's yes or no, as y and n answer it in
 * the terminal, and a project left alone can be taken again. Enter on the row takes it.
 */
export function ProposalItem({ project, live, variants, order }: { project: WorkProject; live: boolean; variants: Variants; order: number }) {
  const still = useStill()
  const busy = useWorkUi((state) => Boolean(state.busy[project.slug]))
  const said = useWorkUi((state) => state.said[project.slug])
  const answer = (answer: 'take' | 'skip') => void runWork({ do: 'proposal', slug: project.slug, answer }, { live, place: project.slug })
  // A host older than this screen sends no state: the row still draws, with a neutral word.
  const standing = project.state === 'chosen' ? 'Taken' : (STATE_WORDS[project.state as keyof typeof STATE_WORDS] ?? 'Known')

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return
    event.preventDefault()
    if (!busy) answer('take')
  }

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div
        data-work-item=""
        data-work-main=""
        data-stop=""
        tabIndex={-1}
        role="group"
        data-world-project={project.slug}
        aria-label={`${project.name}, ${standing.toLowerCase()}, ${project.level}. Enter takes it.`}
        onKeyDown={onKeyDown}
        className="flex scroll-mt-[124px] scroll-mb-6 flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl border border-dashed border-border px-5 py-3.5 outline-offset-[-2px] focus-visible:bg-surface-2"
      >
        <div className="min-w-[180px] flex-1">
          <p className="flex items-baseline gap-2 font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]">
            {project.name}
            <span className="eyebrow">{standing}</span>
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{project.level}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled onClick={() => answer('take')}>
            Take it
          </Button>
          {project.state === 'proposed' ? (
            <Button variant="ghost" size="sm" tabIndex={-1} data-row-control="" disabled={busy} focusableWhenDisabled onClick={() => answer('skip')} className="text-muted-foreground">
              Skip
            </Button>
          ) : null}
        </span>
      </div>
      {said?.tone === 'refused' ? (
        <SaidLine tone="refused" className="px-5 pt-1.5">
          {said.text}
        </SaidLine>
      ) : null}
    </motion.li>
  )
}

function ProjectItem({ project, live, now, variants, order }: { project: WorkProject; live: boolean; now: number; variants: Variants; order: number }) {
  const still = useStill()
  const busy = useWorkUi((state) => Boolean(state.busy[project.slug]))
  const said = useWorkUi((state) => state.said[project.slug])
  const place = { live, place: project.slug }

  return (
    <motion.li layout={still ? false : 'position'} variants={variants} custom={order} initial="enter" animate="center" exit="gone" transition={rowLayout} className="relative">
      <div data-world-project={project.slug} data-stop="" data-work-item="" data-work-main="" tabIndex={-1} role="group" aria-label={`${project.name} project controls`} className="flex scroll-mt-[124px] flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl bg-background px-5 py-4 outline-offset-2">
        <div className="min-w-[180px] flex-1">
          <p className="flex items-baseline gap-2 font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]">
            {project.name}
            {project.paused ? <span className="eyebrow">Paused</span> : null}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{factsOf(project, now)}</p>
          {project.lookError ? <p className="mt-1 text-[12.5px] leading-snug text-bad-fg">Last look failed: {project.lookError}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Priority</span>
            <Segmented
              label={`Priority of ${project.name}`}
              name={`priority-${project.slug}`}
              value={project.priority}
              options={PRIORITIES}
              disabled={busy}
              onChoose={(priority) => void runWork({ do: 'priority', slug: project.slug, priority }, place)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Finished work</span>
            <Segmented
              label={`Where finished work on ${project.name} goes`}
              name={`prs-${project.slug}`}
              value={project.prMode}
              options={LANDINGS}
              disabled={busy}
              onChoose={(prs) => void runWork({ do: 'prs', slug: project.slug, prs }, place)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Pick up issues</span>
            <Segmented
              label={`Which open GitHub issues ${project.name} files as work by itself`}
              name={`issues-${project.slug}`}
              value={project.issues ?? 'off'}
              options={PICKUPS}
              disabled={busy}
              onChoose={(issues) => void runWork({ do: 'issues', slug: project.slug, issues }, place)}
            />
          </div>
        </div>
      </div>
      {said?.tone === 'refused' ? (
        <SaidLine tone="refused" className="px-5 pt-1.5">
          {said.text}
        </SaidLine>
      ) : null}
    </motion.li>
  )
}
