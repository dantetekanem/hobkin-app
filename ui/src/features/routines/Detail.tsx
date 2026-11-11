import { ArrowLeft, Play, Reply } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { focusInput } from '@/app/focus.ts'
import { replyToRoutine } from '@/features/reports/reply.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { checkTimes, checkWindow, timesText, type TimesEdit, type WindowEdit } from './edit.ts'
import { Elapsed } from './Lists.tsx'
import { OutcomeChip, RoutineHood, StateChip } from './parts.tsx'
import { Prose } from './Prose.tsx'
import { latestRuns, RUNS_SHOWN, type RoutineFacts } from './rules.ts'
import { useRoutines, type Pending } from './store.ts'
import { clearOf, nextRun, occurrencesBetween } from './timeline.ts'
import type { Routine, RoutinesData, RunLine } from './types.ts'
import { clockText, costText, dayNames, dayWord, durationText, holdEnds, howOften, outcomeOf, routinePath, untilText, whenText, zoneText } from './words.ts'

/**
 * One routine, opened: a card that slides in beside the list of routines, as a report does in Reports. Everything
 * about the routine is here: when it runs and the controls for that, its latest report, its last 20 runs, its
 * working memory (its own, so only it changes it) and its prompt.
 *
 * Keys: Up and Down walk it, Left on the switch turns the routine off and Right turns it on, Enter presses,
 * and Escape or Left anywhere else goes back to the list.
 */

const DAY = 86_400_000

export interface DetailProps {
  facts: RoutineFacts
  data: RoutinesData
  now: number
  zone: string
  /** Host data has the schedules only: the routine's runs, memory and reports are not supplied to this screen. */
  schedulesOnly?: boolean
  /** What hobkin is doing for this routine now, and why it last refused, in its words. */
  pending?: Pending
  refused?: string
  onClose: () => void
  onRun: (id: string) => void
  onEnable: (id: string, enabled: boolean) => void
  /** Null once saved, or why not. */
  onChangeTimes: (id: string, edit: TimesEdit | WindowEdit) => Promise<string | null>
}

export function Detail({ facts, data, now, zone, schedulesOnly = false, pending, refused, onClose, onRun, onEnable, onChangeTimes }: DetailProps) {
  const { routine, hold, running } = facts
  const back = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const runs = data.logs[routine.id] ?? []
  const report = data.reports[routine.id]
  const memory = data.memory[routine.id]?.trim()

  // Opening hands the keyboard to the detail, so its keys work at once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => back.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])

  // As a report reply does: the routine goes on the message, and the keyboard goes to the input.
  const reply = () => {
    replyToRoutine({ id: routine.id, title: routine.title, file: routinePath(routine.path) })
    focusInput()
  }

  const goBackOnKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.isDefaultPrevented()) return
    // Left moves the caret in a field, so there only Escape goes back.
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    if (event.key === 'r' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      reply()
      return
    }
    const goesBack = event.key === 'Escape' || (event.key === 'ArrowLeft' && !typing)
    if (!goesBack) return
    event.preventDefault()
    onClose()
  }

  return (
    // Its own container, so its parts lay out for the card's width rather than the canvas's.
    <div role="region" aria-labelledby={titleId} className="@container absolute inset-0 overflow-hidden rounded-[28px] bg-background" onKeyDown={goBackOnKey}>
      <div className="scroll-quiet h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-4 px-6 pt-4 pb-6">
          <div>
            <Button ref={back} variant="ghost" size="sm" data-stop="" onClick={onClose} className="-ml-1.5">
              <ArrowLeft aria-hidden="true" />
              All routines
            </Button>
          </div>

          <Header facts={facts} now={now} titleId={titleId} pending={pending} onRun={onRun} onEnable={onEnable} onReply={reply} />

          <AnimatePresence initial={false}>
            {refused ? (
              <Note key="refused" tone="warn">
                <span className="font-heading text-[14px] font-semibold text-warn-fg">That did not go through</span>
                <span className="text-[14px]">{refused}</span>
              </Note>
            ) : null}
            {running ? (
              <Note key="running" tone="ok">
                <span className="flex items-center gap-2 font-heading text-[14px] font-semibold text-ok-fg">
                  Running for <Elapsed since={running.startedAt} className="text-[14px]" />
                </span>
                <span className="text-[13px] text-muted-foreground">
                  Started {running.trigger === 'manual' ? 'by hand' : 'on time'} at {clockText(running.startedAt, routine.timezone)}. Its run joins the list below when it ends.
                </span>
              </Note>
            ) : null}
            {hold ? (
              <Note key="held" tone="warn">
                <span className="font-heading text-[14px] font-semibold text-warn-fg">
                  Held until {dayWord(holdEnds(hold.until), routine.timezone, now)} {clockText(holdEnds(hold.until), routine.timezone)}
                </span>
                <span className="text-[14px]">{hold.reason}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  After two runs in a row that got nowhere, hobkin waits a day before trying again, twice as long after each one that also gets nowhere, up to a week. Changing its time ends the wait, and Run now runs it anyway.
                </span>
              </Note>
            ) : null}
          </AnimatePresence>

          <div className="grid gap-3 @min-[900px]:grid-cols-2">
            <Section title="When it runs">
              <NextRuns facts={facts} now={now} zone={zone} />
              <TimeForm key={routine.id} routine={routine} now={now} onSave={(edit) => onChangeTimes(routine.id, edit)} />
              <Fields routine={routine} now={now} />
            </Section>

            <Section title="Latest report" stop>
              {schedulesOnly ? (
                <p className="text-[14px] text-muted-foreground">Open Reports to read this routine’s reports.</p>
              ) : report ? <Prose text={report} /> : <p className="text-[14px] text-muted-foreground">No report yet.</p>}
            </Section>

            <Section title={runsTitle(runs.length)} stop className="@min-[900px]:col-span-2">
              {schedulesOnly ? (
                <p className="text-[14px] text-muted-foreground">Run history is not supplied to this screen.</p>
              ) : <Runs routine={routine} runs={runs} now={now} />}
            </Section>

            <Section title="Working memory" stop>
              {schedulesOnly ? (
                <p className="text-[14px] text-muted-foreground">Working memory is not supplied to this screen.</p>
              ) : memory ? <Prose text={memory} className="text-[13.5px]" /> : <p className="text-[14px] text-muted-foreground">It has not written anything yet.</p>}
              <p className="text-[12px] text-muted-foreground">Its own notes, carried from one run to the next. Only the routine changes them.</p>
            </Section>

            <Section title="Prompt" stop>
              <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{routine.prompt}</p>
            </Section>
          </div>

          <DeleteRoutine id={routine.id} />
          <KeyLine />
        </div>
      </div>
    </div>
  )
}

function DeleteRoutine({ id }: { id: string }) {
  const { deletion, askDelete, cancelDelete, confirmDelete } = useRoutines()
  const confirmation = deletion?.id === id ? deletion : null
  return <section aria-label="Delete routine" className="flex flex-wrap items-center gap-2" data-stop="">
    {confirmation ? <>
      <p>Delete this routine? Its reports and run history stay.</p>
      <Button variant="outline" disabled={confirmation.pending} onClick={() => void confirmDelete()}>{confirmation.pending ? 'Deleting…' : 'Confirm delete'}</Button>
      <Button variant="ghost" disabled={confirmation.pending} onClick={cancelDelete}>Cancel</Button>
      <p role="status">{confirmation.refusal}</p>
    </> : <Button variant="outline" onClick={() => askDelete(id)}>Delete routine</Button>}
  </section>
}

interface HeaderProps {
  facts: RoutineFacts
  now: number
  titleId: string
  pending: Pending | undefined
  onRun: (id: string) => void
  onEnable: (id: string, enabled: boolean) => void
  onReply: () => void
}

/** Its name, its state, how often it runs, and its two controls: on and off, and Run now. */
function Header({ facts, now, titleId, pending, onRun, onEnable, onReply }: HeaderProps) {
  const { routine, state } = facts
  // While hobkin turns it on or off, the switch shows where it is going.
  const enabled = pending?.action === 'enable' ? pending.enabled : routine.enabled

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <RoutineHood id={routine.id} state={state} size={40} />
      <div className="min-w-[15rem] flex-1">
        <div className="flex items-center gap-2.5">
          <h2 id={titleId} className="truncate font-heading text-[26px] leading-tight font-semibold tracking-[-0.022em]">
            {routine.title}
          </h2>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={state}
              initial={{ opacity: 0, transform: 'scale(0.9)' }}
              animate={{ opacity: 1, transform: 'scale(1)', transition: spring.alive }}
              exit={{ opacity: 0, transition: tween.exit }}
            >
              <StateChip state={state} />
            </motion.span>
          </AnimatePresence>
        </div>
        <p className="text-[14px] text-muted-foreground">
          {howOften(routine)}, {zoneText(routine.timezone, now)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          {/* It keeps the keyboard while hobkin works, so it is busy rather than disabled. */}
          <Switch
            checked={enabled}
            data-stop=""
            aria-busy={pending?.action === 'enable'}
            className={cn(pending?.action === 'enable' && 'opacity-60')}
            aria-label={enabled ? 'On. Left turns it off.' : 'Off. Right turns it on.'}
            onCheckedChange={(next) => onEnable(routine.id, next)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              // Left and Right change the switch here, and never leave the detail.
              event.preventDefault()
              const next = event.key === 'ArrowRight'
              if (next !== enabled) onEnable(routine.id, next)
            }}
          />
          <span className="w-6">{enabled ? 'On' : 'Off'}</span>
        </label>
        <Button variant="outline" data-stop="" onClick={onReply}>
          <Reply className="size-3.5" aria-hidden="true" />
          Reply
        </Button>
        {/* It keeps the keyboard while its run goes on, so the keys go on working in the detail. */}
        <Button data-stop="" disabled={state === 'running' || pending !== undefined} focusableWhenDisabled className="data-disabled:opacity-60" onClick={() => onRun(routine.id)}>
          <Play className="size-3.5" aria-hidden="true" />
          {pending?.action === 'run' ? 'Starting…' : state === 'running' ? 'Running' : 'Run now'}
        </Button>
      </div>
    </header>
  )
}

function Note({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <motion.div
      className={cn('flex flex-col gap-1 rounded-2xl px-4 py-3', tone === 'ok' ? 'bg-ok/10' : 'bg-warn/12')}
      initial={{ opacity: 0, transform: 'translateY(10px) scale(0.98)' }}
      animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: 'scale(0.98)', transition: tween.exit }}
    >
      {children}
    </motion.div>
  )
}

/** A part of the detail. A part with only words to read is a stop of its own, so the keyboard can bring it into view. */
function Section({ title, stop = false, className, children }: { title: string; stop?: boolean; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      tabIndex={stop ? 0 : undefined}
      data-stop={stop ? '' : undefined}
      className={cn('flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-4 outline-none', stop && 'focus:[box-shadow:inset_0_0_0_2px_var(--hb-focus)]', className)}
    >
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  )
}

/** "Last 12 runs", up to the 20 the detail shows. */
function runsTitle(count: number): string {
  const shown = Math.min(count, RUNS_SHOWN)
  if (shown === 0) return 'Runs'
  if (shown === 1) return 'Last run'
  return `Last ${shown} runs`
}

const KEYS: [keys: string, does: string][] = [
  ['esc', 'back'],
  ['↑ ↓', 'move'],
  ['← →', 'on and off'],
  ['enter', 'press or save'],
  ['r', 'reply'],
]

/** The keys that matter in the detail, in one quiet line. */
function KeyLine() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
      {KEYS.map(([keys, does]) => (
        <span key={keys} className="flex items-center gap-1">
          <Kbd>{keys}</Kbd> {does}
        </span>
      ))}
    </p>
  )
}

/** The next run, big, and the two after it. */
function NextRuns({ facts, now, zone }: { facts: RoutineFacts; now: number; zone: string }) {
  const { routine, hold, next } = facts
  const own = routine.timezone

  if (!routine.enabled) return <p className="text-[14px] text-muted-foreground">Off, so it does not run by itself. Run now still runs it once.</p>
  if (!next) return <p className="text-[14px] text-muted-foreground">Nothing left to run.</p>

  const after = occurrencesBetween(routine, next.at, next.at + 62 * DAY).slice(0, 2)
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-heading text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{clockText(next.at, own)}</span>
        {/* In another timezone the day is named where the user is, beside the time here. */}
        <span className="text-[14px]">
          {own === zone ? dayWord(next.at, own, now) : zoneText(own, next.at)}, {untilText(next.at, now)}
        </span>
      </p>
      {own === zone ? null : <p className="text-[12.5px] text-muted-foreground">That is {whenText(next.at, zone, now)} where you are.</p>}
      {hold ? <p className="text-[12.5px] text-warn-fg">The first run after its hold.</p> : null}
      {after.length ? <p className="text-[12.5px] text-muted-foreground">Then {after.map((occurrence) => whenText(occurrence.at, own, now)).join(' and ')}.</p> : null}
    </div>
  )
}

const field =
  'h-9 rounded-full border border-input bg-background px-3.5 font-heading text-[14px] font-medium tabular-nums outline-none transition-[border-color,box-shadow] duration-[160ms] ease-[ease] focus:border-ring focus:[box-shadow:0_0_0_3px_color-mix(in_oklab,var(--hb-focus)_22%,transparent)] aria-invalid:border-bad-fg'

/** What the form holds while it is being changed: the time field as typed, or the window's three fields. */
type Draft = { kind: 'times'; at: string } | { kind: 'window'; start: string; end: string; everyMinutes: string }

/** What the form says under the fields: a hint, that it is saving, the reason a value was refused, or that it was saved. */
type FormMessage = { kind: 'saving' | 'refused' | 'saved'; text: string } | null

function draftOf(routine: Routine): Draft {
  const window = routine.window
  if (window) return { kind: 'window', start: window.start, end: window.end, everyMinutes: String(window.everyMinutes) }
  return { kind: 'times', at: timesText(routine) }
}

const HINTS: Record<Draft['kind'], string> = {
  times: 'Several times go with commas, like 09:00, 13:00. Enter saves.',
  window: 'A check at the start, then one every so many minutes, none after the end. Enter saves.',
}

/**
 * Changing when it runs. A routine with times takes a new time or list of times, a window takes a new
 * start, end and gap. The value is checked before anything is written. A refused value says why in the form.
 */
function TimeForm({ routine, now, onSave }: { routine: Routine; now: number; onSave: (edit: TimesEdit | WindowEdit) => Promise<string | null> }) {
  const original = draftOf(routine)
  const [draft, setDraft] = useState<Draft>(original)
  const [message, setMessage] = useState<FormMessage>(null)
  const messageId = useId()
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const refused = message?.kind === 'refused'
  const saving = message?.kind === 'saving'

  const save = async () => {
    if (saving) return
    const checked = draft.kind === 'times' ? checkTimes(draft.at) : checkWindow(draft)
    if (!checked.ok) {
      setMessage({ kind: 'refused', text: checked.message })
      return
    }

    const { at: _at, window: _window, ...rest } = routine
    const saved: Routine = { ...rest, ...checked.value }
    const next = nextRun(saved, clearOf(now, null))
    setMessage({ kind: 'saving', text: 'Saving…' })
    // hobkin checks it again as it checks every routine file, and says why when it will not write it.
    const refusal = await onSave(checked.value)
    if (refusal !== null) {
      setMessage({ kind: 'refused', text: refusal })
      return
    }
    // The field shows the value as it was written, so "9:30" reads back as 09:30.
    setDraft(draftOf(saved))
    setMessage({ kind: 'saved', text: next ? `Saved. It runs next ${whenText(next.at, routine.timezone, now)}.` : 'Saved.' })
  }

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape' && dirty) {
      // A change not yet saved is dropped first. The next Escape goes back.
      event.preventDefault()
      setDraft(original)
      setMessage(null)
    }
  }

  const change = (next: Draft) => {
    setDraft(next)
    if (refused) setMessage(null)
  }

  const fieldProps = { invalid: refused, describedBy: messageId, onKeyDown: keys }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {draft.kind === 'times' ? (
          <TimeField
            label={`${[routine.at].flat().length > 1 ? 'Times' : 'Time'}, in 24-hour time`}
            value={draft.at}
            width="w-[13rem]"
            onChange={(at) => change({ ...draft, at })}
            {...fieldProps}
          />
        ) : (
          <>
            <TimeField label="From" value={draft.start} width="w-[6.5rem]" onChange={(start) => change({ ...draft, start })} {...fieldProps} />
            <TimeField label="To" value={draft.end} width="w-[6.5rem]" onChange={(end) => change({ ...draft, end })} {...fieldProps} />
            <TimeField label="Minutes apart" value={draft.everyMinutes} width="w-[6.5rem]" onChange={(everyMinutes) => change({ ...draft, everyMinutes })} {...fieldProps} />
          </>
        )}
        <Button type="submit" variant="outline" tabIndex={-1} disabled={!dirty || saving}>
          Save
        </Button>
      </div>
      <p
        id={messageId}
        aria-live="polite"
        className={cn('min-h-[18px] text-[12.5px]', (message === null || saving) && 'text-muted-foreground', message?.kind === 'saved' && 'text-ok-fg', refused && 'text-bad-fg')}
      >
        {message?.text ?? HINTS[draft.kind]}
      </p>
    </form>
  )
}

interface TimeFieldProps {
  label: string
  value: string
  /** Its width, as a Tailwind class. */
  width: string
  invalid: boolean
  describedBy: string
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

function TimeField({ label, value, width, invalid, describedBy, onChange, onKeyDown }: TimeFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <input
        value={value}
        data-stop=""
        inputMode="numeric"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(field, width)}
      />
    </label>
  )
}

const mono = 'font-mono text-[12px] break-all'

/** The rest of the routine's file, as it is written. */
function Fields({ routine, now }: { routine: Routine; now: number }) {
  const rows: [name: string, value: ReactNode][] = [
    ['Folder', <span className={mono}>routines/{routine.cadence}</span>],
    ['Timezone', `${routine.timezone}, ${zoneText(routine.timezone, now)}`],
  ]
  if (routine.cadence === 'weekly') rows.push(['Days', dayNames(routine.weekday)])
  if (routine.cadence === 'monthly') rows.push(['Day', `${routine.day} of each month`])
  if (routine.cadence === 'once') rows.push(['Date', routine.date ?? ''])

  const reads = routine.context.length ? <span className={mono}>{routine.context.join(', ')}</span> : 'Nothing more than its prompt'
  rows.push(
    ['Model', `${routine.model ?? "Pi's default"}, ${routine.effort} effort`],
    ['Works in', <span className={mono}>{routine.cwd}</span>],
    ['Reads', reads],
    [
      'File',
      <span className={mono} title={routine.path}>
        {routinePath(routine.path)}
      </span>,
    ],
  )

  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border pt-3 text-[13px]">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const newRun = {
  initial: { opacity: 0, transform: 'translateY(-10px) scale(0.98)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.alive, opacity: tween.enter } },
  exit: { opacity: 0, transition: tween.exit },
}

/** The last 20 runs, newest first: when each finished, what started it, how it went, how long it took and what it cost. */
function Runs({ routine, runs, now }: { routine: Routine; runs: readonly RunLine[]; now: number }) {
  const latest = latestRuns(runs)
  if (latest.length === 0) return <p className="text-[14px] text-muted-foreground">It has not run yet.</p>

  return (
    <div className="flex flex-col">
      <div className="flex gap-x-3 border-b border-border pb-1.5 text-[11px] font-medium text-muted-foreground @max-[760px]:hidden" aria-hidden="true">
        <span className="w-[8.5rem]">Finished</span>
        <span className="w-[4.75rem]">Started</span>
        <span className="w-[6.5rem]">Outcome</span>
        <span className="w-[4.5rem] text-right">Took</span>
        <span className="w-[4rem] text-right">Cost</span>
        <span className="min-w-0 flex-1">What it said</span>
      </div>
      <ol className="flex flex-col">
        <AnimatePresence initial={false}>
          {latest.map((run) => (
            <motion.li
              key={run.finishedAt}
              layout="position"
              {...newRun}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/70 py-1.5 text-[12.5px] last:border-b-0"
            >
              <span className="w-[8.5rem] tabular-nums" title={new Date(run.finishedAt).toISOString()}>
                {whenText(Date.parse(run.finishedAt), routine.timezone, now)}
              </span>
              <span className="w-[4.75rem] text-muted-foreground">{run.trigger === 'manual' ? 'By hand' : 'On time'}</span>
              <span className="w-[6.5rem]">
                <OutcomeChip {...outcomeOf(run)} />
              </span>
              <span className="w-[4.5rem] text-right tabular-nums">{durationText(run.seconds)}</span>
              <span className={cn('w-[4rem] text-right tabular-nums', run.usd === null && 'text-muted-foreground')}>{run.usd === null ? 'none' : costText(run.usd)}</span>
              <span className="min-w-[12rem] flex-1 truncate text-muted-foreground" title={run.summary}>
                {run.summary}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
