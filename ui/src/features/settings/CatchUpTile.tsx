import { useEffect, useState, type ReactNode } from 'react'
import type { CatchUpState } from '#shared/protocol/reports.ts'
import { Input } from '@/components/ui/input.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { SAMPLE_CATCH_UP, catchUpValue, parseDaily, parsePile, useCatchUp } from './catch-up.ts'
import { Tile } from './SettingsScreen.tsx'

/** The line under the triggers while nothing went wrong. */
function statusLine({ running, uncovered }: CatchUpState): string {
  if (running) return 'A catch-up is being written now.'
  const waiting = uncovered === 0 ? 'Nothing waits for the next one.' : uncovered === 1 ? '1 unread report waits for the next one.' : `${uncovered} unread reports wait for the next one.`
  return `Each catch-up is one call to the fast tier. ${waiting}`
}

/** A field that saves when it is left or Enter is pressed, not on each key, so a half-typed value is never sent. */
function Field({ label, type, value, width, disabled, parse, wrong, onSave }: {
  label: string
  type: 'time' | 'number'
  value: string
  width: string
  disabled: boolean
  parse: (text: string) => string | null
  /** What the line under the tile says when the typed value cannot be saved. */
  wrong: string
  onSave: (text: string) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const save = () => {
    if (text === null) return
    setText(null)
    const parsed = parse(text)
    if (parsed === null) useCatchUp.setState({ problem: wrong })
    else if (parsed !== value) onSave(parsed)
  }
  return (
    <Input
      type={type}
      aria-label={label}
      data-stop=""
      disabled={disabled}
      {...(type === 'number' ? { min: 1, max: 1000, inputMode: 'numeric' as const } : {})}
      className={cn('mx-1 inline-block h-7 px-2 align-middle tabular-nums', width)}
      value={text ?? value}
      onChange={(event) => setText(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
    />
  )
}

/** One trigger: its switch, and its words with the field that sets it. */
function Trigger({ name, on, disabled, onTurn, children, says }: { name: string; on: boolean; disabled: boolean; onTurn: (on: boolean) => void; children: ReactNode; says: string }) {
  return (
    <div className="flex items-start gap-3">
      <Switch aria-label={name} checked={on} disabled={disabled} onCheckedChange={onTurn} data-stop="" className="mt-1.5" />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14px] leading-8 font-medium', !on && 'text-muted-foreground')}>{children}</span>
        <span className="block text-[12px] leading-snug text-muted-foreground">{says}</span>
      </span>
    </div>
  )
}

/**
 * Catch-up (069-report-catch-up): hobkin writes one short report over the unread reports no catch-up has covered,
 * daily at a time and when they pile up. Both triggers are hobkin's, read when the tile mounts; with no host the tile
 * shows hobkin's defaults. A trigger that is off keeps its value, so turning it on again brings it back. The line under
 * the triggers always holds one line, so a problem that shows there moves nothing.
 */
export function CatchUpTile() {
  const hasHost = useHasHost()
  const read = useCatchUp((state) => state.state)
  const kept = useCatchUp((state) => state.kept)
  const problem = useCatchUp((state) => state.problem)

  useEffect(() => {
    if (hasHost) void useCatchUp.getState().load()
  }, [hasHost])

  const shown = hasHost && read ? read : SAMPLE_CATCH_UP
  const disabled = !hasHost || read === null
  const { change, turnDaily, turnPile } = useCatchUp.getState()
  const line = !hasHost ? 'Sample values. hobkin keeps these, and the host is not connected.' : problem ?? (read ? statusLine(read) : "Reading hobkin's catch-up…")

  return (
    <Tile name="Catch-up" value={catchUpValue(shown)} className="col-span-3 @max-[820px]:col-span-2">
      <div className="flex flex-1 flex-col gap-3">
        <Trigger name="Daily catch-up" on={shown.daily !== null} disabled={disabled} onTurn={(on) => void turnDaily(on)} says="When something is unread and no catch-up covered it.">
          Every day at
          <Field
            label="Daily catch-up time"
            type="time"
            width="w-[6.5rem]"
            value={shown.daily ?? kept.daily}
            disabled={disabled || shown.daily === null}
            parse={parseDaily}
            wrong="The daily time is a time of day, such as 08:00."
            onSave={(daily) => void change({ daily })}
          />
        </Trigger>
        <Trigger name="Catch-up when reports pile up" on={shown.pileUp !== null} disabled={disabled} onTurn={(on) => void turnPile(on)} says="hobkin counts them each time a report finishes.">
          When
          <Field
            label="Unread reports that start a catch-up"
            type="number"
            width="w-[4.5rem]"
            value={String(shown.pileUp ?? kept.pileUp)}
            disabled={disabled || shown.pileUp === null}
            parse={(text) => {
              const pileUp = parsePile(text)
              return pileUp === null ? null : String(pileUp)
            }}
            wrong="The pile size is a whole number from 1 to 1000."
            onSave={(text) => void change({ pileUp: Number(text) })}
          />
          unread reports pile up
        </Trigger>
      </div>
      <p role="status" className={cn('min-h-lh text-[12px] leading-snug', hasHost && problem ? 'text-destructive' : 'text-muted-foreground')}>
        {line}
      </p>
    </Tile>
  )
}
