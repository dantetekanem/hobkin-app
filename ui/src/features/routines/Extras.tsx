import { FileWarning, MessageCircle, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { askForFirstRoutine, askForTemplate, askToFix } from './ask.ts'
import { stopIf } from './look.ts'
import { Choice } from './parts.tsx'
import { byNextRun, type RoutineFacts } from './rules.ts'
import { Sky, type SkyProps } from './Sky.tsx'
import type { RoutinesView } from './store.ts'
import type { DefinitionError, RoutineTemplate } from './types.ts'
import { clockText, dateLabel, dayWord, errorFile, errorText, untilText, zoneText } from './words.ts'

/** The pieces of the Routines screen around its lists: the sky and its headline, broken files, templates, the empty home. */

const VIEWS: readonly { value: RoutinesView; label: string }[] = [
  { value: 'all', label: 'All routines' },
  { value: 'week', label: 'Next 7 days' },
]

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "Inbox watch is running.", or "2 routines are held." Nothing when no routine is in that state. */
function stateNote(facts: RoutineFacts[], state: 'running' | 'held'): string | null {
  const inState = facts.filter((item) => item.state === state)
  if (inState.length === 0) return null
  if (inState.length === 1) return `${inState[0]!.routine.title} is ${state}.`
  return `${inState.length} routines are ${state}.`
}

/** What the headline says: what runs next, and what is running now. */
function headlineOf(facts: RoutineFacts[], now: number, zone: string): { title: string; sub: string } {
  if (facts.length === 0) return { title: 'No routines yet', sub: 'Ask hobkin for a first one below.' }

  const notes = [stateNote(facts, 'running'), stateNote(facts, 'held')].filter((note) => note !== null)
  // byNextRun puts a routine with no next run last, so the first one runs soonest, if any does.
  const soonest = facts.toSorted(byNextRun)[0]!
  const next = soonest.next
  if (!next) return { title: 'Nothing is due to run', sub: ['Every routine is off or done.', ...notes].join(' ') }

  const own = soonest.routine.timezone
  const at = own === zone ? clockText(next.at, own) : `${clockText(next.at, own)} ${zoneText(own, next.at)}`
  const when = `${capitalised(dayWord(next.at, own, now))}, ${untilText(next.at, now)}.`
  return {
    title: `${soonest.routine.title} runs next, at ${at}`,
    sub: [when, ...notes].join(' '),
  }
}

interface SkyTileProps extends SkyProps {
  facts: RoutineFacts[]
  view: RoutinesView
  onView: (view: RoutinesView) => void
  walkable: boolean
  onNewRoutine: () => void
  empty: boolean
  readOnly?: boolean
}

/** The sky with its headline over it, the choice of view and the way to a new routine. */
export function SkyTile({ facts, view, onView, walkable, onNewRoutine, empty, readOnly = false, ...sky }: SkyTileProps) {
  const { title, sub } = headlineOf(facts, sky.now, sky.zone)

  return (
    <section aria-label="Today" className="overflow-hidden rounded-3xl bg-tone-2">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {dateLabel(sky.now, sky.zone)}, {clockText(sky.now, sky.zone)} {zoneText(sky.zone, sky.now)}
          </p>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={title} initial={{ opacity: 0, transform: 'translateY(10px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: tween.enter } }} exit={{ opacity: 0, transform: 'translateY(-8px)', transition: tween.exit }}>
              <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">{title}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{readOnly && !facts.some((fact) => fact.next) ? 'No upcoming run in the host snapshot.' : sub}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        {empty ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Choice label="Show" value={view} options={VIEWS} onChoose={onView} stop={walkable} />
            {!readOnly ? (
              <Button variant="outline" {...stopIf(walkable)} onClick={onNewRoutine}>
                <Plus aria-hidden="true" />
                New routine
              </Button>
            ) : null}
          </div>
        )}
      </header>
      <Sky {...sky} />
    </section>
  )
}

/** A few words that confirm a message went to hobkin, gone again after a moment. */
export function Suggested({ shown }: { shown: boolean }) {
  return (
    <AnimatePresence>
      {shown ? (
        <motion.p
          role="status"
          className="flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground"
          initial={{ opacity: 0, transform: 'translateY(6px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.alive, opacity: tween.enter } }}
          exit={{ opacity: 0, transition: tween.exit }}
        >
          <MessageCircle className="size-3.5" aria-hidden="true" />A message for hobkin is ready to send.
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}

/** Files hobkin's loader could not read, each with its path. The other routines load as usual. */
export function BrokenFiles({ errors, walkable, onAsked }: { errors: DefinitionError[]; walkable: boolean; onAsked: () => void }) {
  return (
    <section aria-label="Routine files that did not load" className="flex flex-col gap-2 rounded-2xl bg-bad/10 p-4">
      <h3 className="eyebrow flex items-center gap-1.5 !text-bad-fg">
        <FileWarning className="size-3.5" aria-hidden="true" />
        {errors.length === 1 ? 'One routine file did not load' : `${errors.length} routine files did not load`}
      </h3>
      <ul className="flex flex-col gap-2">
        {errors.map((error) => (
          <li key={error.path} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12.5px] break-all" title={error.path}>
                {errorFile(error)}
              </p>
              <p className="text-[13.5px]">{capitalised(errorText(error))}.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              {...stopIf(walkable)}
              onClick={() => {
                askToFix(errorFile(error), errorText(error))
                onAsked()
              }}
            >
              Ask hobkin to fix it
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-muted-foreground">The other routines load as usual. This one runs again once its file reads.</p>
    </section>
  )
}

/** hobkin's templates. Left and Right move between them, Enter asks hobkin to set that one up. */
export function Templates({ templates, walkable, onAsked }: { templates: RoutineTemplate[]; walkable: boolean; onAsked: () => void }) {
  const [current, setCurrent] = useState(0)
  if (templates.length === 0) return null

  return (
    <section aria-label="Templates" className="flex flex-col gap-3 rounded-2xl bg-background p-4">
      <div>
        <h3 className="eyebrow">Start from a template</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">hobkin sets it up in a conversation, and asks what it needs.</p>
      </div>
      <div
        role="group"
        aria-label="Templates"
        className="flex flex-wrap gap-2"
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!delta) return
          event.preventDefault()
          const next = Math.min(templates.length - 1, Math.max(0, current + delta))
          setCurrent(next)
          const group = event.currentTarget
          requestAnimationFrame(() => group.querySelectorAll<HTMLElement>('button')[next]?.focus())
        }}
      >
        {templates.map((template, index) => (
          <button
            key={template.id}
            type="button"
            title={template.summary}
            aria-label={`${template.title}, ${template.recurrence}. ${template.summary}`}
            data-stop={walkable && index === current ? '' : undefined}
            tabIndex={walkable && index === current ? 0 : -1}
            onFocus={() => setCurrent(index)}
            onClick={() => {
              askForTemplate(template)
              onAsked()
            }}
            className={cn(
              'flex max-w-[19rem] flex-col items-start gap-0.5 rounded-2xl bg-surface px-3.5 py-2.5 text-left outline-none',
              'transition-[background-color,transform,box-shadow] duration-[160ms] ease-out hover:bg-tone-1 active:scale-[0.98]',
              'focus:bg-surface-2 focus:[box-shadow:inset_0_0_0_1.5px_var(--hb-focus)]',
            )}
          >
            <span className="font-heading text-[14px] font-semibold">{template.title}</span>
            <span className="text-[12px] text-muted-foreground">{template.recurrence}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** No routines yet: what a routine is, and the one way to get the first one. */
export function EmptyHome({ walkable, onAsked, asked }: { walkable: boolean; onAsked: () => void; asked: boolean }) {
  return (
    <section aria-label="No routines yet" className="flex flex-col items-center gap-4 rounded-3xl bg-background px-6 py-10 text-center">
      <Hob mood="hello" size={92} stage="var(--background)" />
      <div className="flex max-w-[50ch] flex-col gap-2">
        <h3 className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.022em]">A routine is a check hobkin runs by itself</h3>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          You choose what it looks at and when: every day, every week, every month, or once. Each run reports what it found, and a run that finds nothing new stays quiet.
        </p>
      </div>
      <Button
        size="lg"
        {...stopIf(walkable)}
        onClick={() => {
          askForFirstRoutine()
          onAsked()
        }}
        className="px-4"
      >
        <MessageCircle aria-hidden="true" />
        Ask hobkin for a first routine
      </Button>
      <Suggested shown={asked} />
    </section>
  )
}

/** One quiet line: this is sample data, and a way to see the screen with none. */
export function SampleLine({ sample, walkable, onToggle }: { sample: 'full' | 'empty'; walkable: boolean; onToggle: () => void }) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-2 px-2 pt-1 text-[12px] text-muted-foreground">
      <span>Sample routines, not your own. hobkin's real ones show here once the host is connected.</span>
      <button
        type="button"
        {...stopIf(walkable)}
        onClick={onToggle}
        className="rounded-full px-1.5 underline decoration-border-strong underline-offset-2 outline-none hover:text-foreground focus:text-foreground focus:[box-shadow:0_0_0_1.5px_var(--hb-focus)]"
      >
        {sample === 'full' ? 'See an empty home' : 'Bring the sample back'}
      </button>
    </p>
  )
}
