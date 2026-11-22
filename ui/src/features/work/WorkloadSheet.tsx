import { Dialog } from '@base-ui/react/dialog'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { tokenWords } from '@/features/numbers/format.ts'
import type { ReviewPulls, WorkHours, WorkState } from '#shared/protocol/work.ts'
import { cn } from '@/lib/utils.ts'
import { AgentsStepper } from './AgentsStepper.tsx'
import { Segmented } from './parts.tsx'
import { runWork, useWorkUi } from './store.ts'
import {
  capChoices,
  capOf,
  capValue,
  forecastWords,
  hoursFrom,
  millionsOf,
  OFFICE_HOURS,
  pullsOf,
  pullsShown,
  tokensFromWords,
  workloadAction,
  workloadOf,
  type WorkloadChange,
  type WorkloadSetting,
} from './workload.ts'

/** The most finished changes ship first can wait for. */
const SHIP_FIRST_MOST = 50

/**
 * The workload sheet (_specs/053-work-control-room, "Workload"): how much automated work runs, opened over Work by the
 * button at the end of the status line or by W. Each of its eight settings says in a line what it does and is saved as
 * it changes: no Save button. What it is saving and what was saved shows beside it, and a refusal from hobkin in place
 * of its line. The forecast for the settings as they stand is at the foot. Escape closes it, and the keyboard goes back
 * to the Workload button.
 */
interface WorkloadSheetProps {
  open: boolean
  /** The setting that has the keyboard first, or null for the first one. */
  at: WorkloadSetting | null
  work: WorkState
  live: boolean
  onClose: () => void
  /** The Workload button, which has the keyboard again once the sheet closes. */
  returnTo: RefObject<HTMLButtonElement | null>
}

export function WorkloadSheet({ open, at, work, live, onClose, returnTo }: WorkloadSheetProps) {
  const still = useStill()
  const popup = useRef<HTMLDivElement | null>(null)
  const fade = still
    ? 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
    : 'transition-[translate,scale,opacity] duration-[360ms] ease-[var(--ease-drawer)] data-[starting-style]:translate-y-[-46%] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms]'
  // The setting the sheet was opened at, as from "Raise the cap", has the keyboard first.
  const initialFocus = () => {
    const row = at ? popup.current?.querySelector(`[data-setting="${at}"]`) : popup.current?.querySelector('[data-setting]')
    row?.scrollIntoView({ block: 'nearest' })
    return row?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [role="spinbutton"]') ?? null
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={cn('fixed inset-0 z-50 bg-scrim backdrop-blur-sm transition-opacity duration-[240ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0')} />
        <Dialog.Popup
          ref={popup}
          initialFocus={initialFocus}
          finalFocus={returnTo}
          className={cn(
            'scroll-quiet fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(780px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[28px] bg-background shadow-float outline-none',
            fade,
          )}
        >
          {open ? <WorkloadForm work={work} live={live} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function WorkloadForm({ work, live }: { work: WorkState; live: boolean }) {
  const now = useNow(true, 30_000)
  const { settings, known } = workloadOf(work)
  return (
    <div className="flex flex-col px-7 pt-6 pb-6">
      <header className="flex items-start gap-4 pb-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em]">Workload</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            How much automated work runs. Each setting is saved as you change it; running agents finish as they are.
          </Dialog.Description>
        </div>
        <Dialog.Close render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
          Close <Kbd>esc</Kbd>
        </Dialog.Close>
      </header>

      <div className="flex flex-col">
        <AgentsRow value={settings.agents} most={work.maxAgents} live={live} />
        <SwitchRow
          setting="autoPick"
          label="Pick work by itself"
          line={settings.autoPick ? 'hobkin starts the top of the queue by itself.' : 'Off: only what you start runs, and work on finished changes.'}
          value={settings.autoPick}
          live={live}
          change={(autoPick) => ({ autoPick })}
        />
        <CapRow value={settings.changesADay} live={live} />
        <TokensRow value={settings.dailyTokens} spent={work.tokensToday ?? null} live={live} />
        <HoursRow value={settings.hours} live={live} />
        <ShipFirstRow on={settings.shipFirst} at={settings.shipFirstAt} live={live} />
        <SwitchRow
          setting="reviewOnFinish"
          label="Score finished changes"
          line="hobkin rates each finished change by itself, as YOLO mode needs, at the cost of a review run each."
          value={settings.reviewOnFinish}
          live={live}
          change={(reviewOnFinish) => ({ reviewOnFinish })}
        />
        <PullsRow value={settings.reviewPulls} live={live} />
      </div>

      <footer className="mt-2 flex flex-col gap-1 border-t border-border pt-4">
        <p className="text-[13.5px] leading-relaxed font-medium" aria-live="polite">
          {forecastWords(work, now)}
        </p>
        {known ? null : <p className="text-[12.5px] leading-relaxed text-muted-foreground">This host does not report the workload yet, so these are hobkin's defaults. Changing one asks hobkin, and an older one says it cannot.</p>}
      </footer>
    </div>
  )
}

/** How long "Saved" stays beside a setting. */
const SAVED_MS = 1800

/** Two values of a setting are the same when they read the same: hours are an object, the rest plain values. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * One setting's save: the value chosen shows at once and stays until hobkin's own value says the same, what is under way
 * and what was saved show beside it, and a refusal shows by it, in hobkin's words, with the value it had put back.
 */
function useSave<Value>(name: WorkloadSetting | 'shipFirstAt', held: Value, live: boolean) {
  const place = `workload:${name}`
  const busy = useWorkUi((state) => Boolean(state.busy[place]))
  const said = useWorkUi((state) => state.said[place])
  const [chosen, setChosen] = useState<{ value: Value } | null>(null)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (chosen && same(chosen.value, held)) setChosen(null)
  }, [held, chosen])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const save = async (value: Value, change: WorkloadChange) => {
    if (same(value, chosen?.value ?? held)) return
    setChosen({ value })
    setSaved(false)
    const result = await runWork(workloadAction(change), { live, place })
    if (result.tone !== 'done') {
      setChosen(null)
      return
    }
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setSaved(false)
      // hobkin's value is the one that stands now.
      setChosen(null)
    }, SAVED_MS)
  }
  return {
    value: chosen ? chosen.value : held,
    busy,
    saved,
    refused: said?.tone === 'refused' ? said.text : null,
    save,
  }
}

interface RowProps {
  setting: WorkloadSetting
  label: string
  /** What the setting does, in a line. */
  line: string
  /** Why hobkin refused the last change, shown in place of the line. */
  refused: string | null
  busy: boolean
  saved: boolean
  children: ReactNode
}

/** One row: the setting's name and what it does (or why hobkin refused it), its control, and what its save is doing. */
function Row({ setting, label, line, refused, busy, saved, children }: RowProps) {
  const words = refused ?? line
  return (
    // A row whose controls do not fit beside its words puts them under, at the right, so neither is squeezed.
    <div data-setting={setting} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 py-3 first:border-t-0">
      <div className="min-w-[240px] flex-1">
        <p className="font-heading text-[14px] leading-snug font-medium">{label}</p>
        <p role={refused ? 'alert' : undefined} title={words} className={cn('mt-0.5 line-clamp-2 min-h-[18px] text-[12.5px] leading-[18px]', refused ? 'text-bad-fg' : 'text-muted-foreground')}>
          {words}
        </p>
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
        {children}
        <span aria-live="polite" className="flex h-5 w-16 shrink-0 items-center gap-1 text-[12px] whitespace-nowrap text-muted-foreground">
          {busy ? 'Saving…' : null}
          {!busy && saved ? (
            <>
              <Check aria-hidden="true" className="size-3.5 text-ok-fg" />
              Saved
            </>
          ) : null}
        </span>
      </div>
    </div>
  )
}

function AgentsRow({ value, most, live }: { value: number; most: number; live: boolean }) {
  const { value: shown, busy, saved, refused, save } = useSave('agents', value, live)
  return (
    <Row setting="agents" label="Agents at once" line="How many agents may work together. Lowering it stops none: running agents finish." refused={refused} busy={busy} saved={saved}>
      <AgentsStepper compact label="Agents at once" value={shown} most={most} onSave={(agents) => save(agents, { agents })} />
    </Row>
  )
}

interface SwitchRowProps {
  setting: WorkloadSetting
  label: string
  line: string
  value: boolean
  live: boolean
  /** The change that turning the switch on or off sends. */
  change: (on: boolean) => WorkloadChange
}

function SwitchRow({ setting, label, line, value, live, change }: SwitchRowProps) {
  const { value: on, busy, saved, refused, save } = useSave(setting, value, live)
  return (
    <Row setting={setting} label={label} line={line} refused={refused} busy={busy} saved={saved}>
      <span className="w-7 text-right text-[12.5px] text-muted-foreground">{on ? 'On' : 'Off'}</span>
      <Switch aria-label={label} checked={on} onCheckedChange={(next) => void save(next, change(next))} />
    </Row>
  )
}

function CapRow({ value, live }: { value: number | null; live: boolean }) {
  const { value: cap, busy, saved, refused, save } = useSave('changesADay', value, live)
  return (
    <Row setting="changesADay" label="Changes a day" line="The most changes that start in a day. Past it only what you start runs, until midnight." refused={refused} busy={busy} saved={saved}>
      <Segmented label="Changes a day" name="workload-cap" value={capValue(cap)} options={capChoices(cap)} onChoose={(choice) => void save(capOf(choice), { changesADay: capOf(choice) })} />
    </Row>
  )
}

function TokensRow({ value, spent, live }: { value: number; spent: number | null; live: boolean }) {
  const { value: tokens, busy, saved, refused, save } = useSave('dailyTokens', value, live)
  const [draft, setDraft] = useState<string | null>(null)
  const [wrong, setWrong] = useState<string | null>(null)
  const shown = draft ?? String(millionsOf(tokens))
  const spentToday = spent === null ? '' : `: ${tokenWords(spent)} spent today`
  const commit = () => {
    if (draft === null) return
    const typed = tokensFromWords(draft)
    if (typed === null) {
      setWrong('A whole number of millions, from 1 up.')
      return
    }
    setWrong(null)
    setDraft(null)
    void save(typed, { dailyTokens: typed })
  }
  return (
    <Row
      setting="dailyTokens"
      label="Tokens a day"
      line={`Fresh tokens work mode may spend in a day${spentToday}. At the limit nothing new starts until midnight.`}
      refused={wrong ?? refused}
      busy={busy}
      saved={saved}
    >
      <label className="flex h-8 items-center gap-1 rounded-full border-[1.5px] border-input bg-background pr-3 pl-1 focus-within:border-ring">
        <span className="sr-only">Tokens a day, in millions</span>
        <input
          inputMode="numeric"
          value={shown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape' && draft !== null) {
              // The first Escape puts the number back; the next closes the sheet.
              event.preventDefault()
              event.stopPropagation()
              setDraft(null)
              setWrong(null)
            }
          }}
          className="h-full w-[6ch] bg-transparent text-right font-mono text-[13px] tabular-nums outline-none"
        />
        <span className="text-[13px] text-muted-foreground">M</span>
      </label>
    </Row>
  )
}

const HOURS_CHOICES = [
  { value: 'always', label: 'Always' },
  { value: 'set', label: 'Set hours' },
] as const

function HoursRow({ value, live }: { value: WorkHours | null; live: boolean }) {
  const { value: hours, busy, saved, refused, save } = useSave('hours', value, live)
  // The window last set, kept while it is turned off, so the fields keep their place and their times.
  const [ends, setEnds] = useState<WorkHours>(value ?? OFFICE_HOURS)
  const [wrong, setWrong] = useState<string | null>(null)
  useEffect(() => {
    if (value) setEnds(value)
  }, [value])
  const set = (next: WorkHours) => {
    const checked = hoursFrom(next.from, next.to)
    if ('refused' in checked) {
      setWrong(checked.refused)
      return
    }
    setWrong(null)
    void save(checked, { hours: checked })
  }
  const choose = (choice: (typeof HOURS_CHOICES)[number]['value']) => {
    if (choice === 'always') void save(null, { hours: null })
    else set(ends)
  }
  const field = (end: 'from' | 'to') => (
    <input
      type="time"
      aria-label={end === 'from' ? 'Work starts at' : 'Work ends at'}
      disabled={!hours}
      value={ends[end]}
      onChange={(event) => setEnds({ ...ends, [end]: event.target.value })}
      onBlur={() => {
        if (hours && (ends.from !== hours.from || ends.to !== hours.to)) set(ends)
      }}
      className="h-8 w-[96px] rounded-full border-[1.5px] border-input bg-background px-2.5 font-mono text-[12.5px] tabular-nums outline-none focus-visible:border-ring disabled:opacity-45"
    />
  )
  return (
    <Row setting="hours" label="Hours" line="Outside these hours nothing new starts by itself, and running agents finish." refused={wrong ?? refused} busy={busy} saved={saved}>
      <Segmented label="Hours" name="workload-hours" value={hours ? 'set' : 'always'} options={HOURS_CHOICES} onChoose={choose} />
      {field('from')}
      <span className="text-[12.5px] text-muted-foreground">to</span>
      {field('to')}
    </Row>
  )
}

function ShipFirstRow({ on, at, live }: { on: boolean; at: number; live: boolean }) {
  const toggle = useSave('shipFirst', on, live)
  const number = useSave('shipFirstAt', at, live)
  return (
    <Row
      setting="shipFirst"
      label="Ship first"
      line={`Hold new work while ${number.value} or more finished changes wait for your yes or no.`}
      refused={toggle.refused ?? number.refused}
      busy={toggle.busy || number.busy}
      saved={toggle.saved || number.saved}
    >
      <AgentsStepper compact label="Finished changes that hold new work" value={number.value} most={SHIP_FIRST_MOST} onSave={(shipFirstAt) => number.save(shipFirstAt, { shipFirstAt })} />
      <span className="w-7 text-right text-[12.5px] text-muted-foreground">{toggle.value ? 'On' : 'Off'}</span>
      <Switch aria-label="Ship first" checked={toggle.value} onCheckedChange={(next) => void toggle.save(next, { shipFirst: next })} />
    </Row>
  )
}

function PullsRow({ value, live }: { value: ReviewPulls; live: boolean }) {
  const { value: pulls, busy, saved, refused, save } = useSave('reviewPulls', value, live)
  const shown = pullsShown(pulls)
  const flip = (part: 'mine' | 'waiting') => {
    const next = pullsOf({ ...shown, [part]: !shown[part] })
    void save(next, { reviewPulls: next })
  }
  return (
    <Row setting="reviewPulls" label="AI review starts by itself for" line="Finished changes always get one. Pull requests get one too when you say so, which spends tokens on each." refused={refused} busy={busy} saved={saved}>
      <Toggle on disabled label="Finished changes" />
      <Toggle on={shown.mine} label="My pull requests" onFlip={() => flip('mine')} />
      <Toggle on={shown.waiting} label="Waiting for my review" onFlip={() => flip('waiting')} />
    </Row>
  )
}

/** A choice that is on or off, as a chip with a check. */
function Toggle({ on, label, disabled = false, onFlip }: { on: boolean; label: string; disabled?: boolean; onFlip?: () => void }) {
  return (
    <Button variant="outline" size="sm" aria-pressed={on} disabled={disabled} focusableWhenDisabled={disabled} onClick={onFlip} className={cn('gap-1.5', on ? 'border-foreground/25 text-foreground' : 'text-muted-foreground', disabled && 'opacity-70')}>
      <Check aria-hidden="true" className={cn('size-3.5 transition-opacity', on ? 'opacity-100' : 'opacity-0')} />
      {label}
    </Button>
  )
}
