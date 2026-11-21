import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils.ts'
import { agentsForKey, clampAgents, FEWEST_AGENTS, HOLD_DELAY_MS, HOLD_REPEAT_MS } from './agents-at-once.ts'

/** Keys pressed in a row are saved once, this long after the last. */
const KEYS_SETTLE_MS = 350

/**
 * How many work agents may run at once: the number between a minus and a plus, for Work and for Settings. The number
 * keeps a width of three digits, so nothing moves as it grows. Left and Right step by one, by ten with Shift, Home and
 * End go to one and the most, and a held button repeats. What the user sets shows at once and is saved once they stop,
 * one save at a time, so a held button or a run of keys asks hobkin once. `onDraft` hears each number on the way and
 * null once the save is in.
 */
export function AgentsStepper({
  value,
  most,
  label,
  compact = false,
  onSave,
  onDraft,
}: {
  value: number
  most: number
  label: string
  /** Work's row of small controls. Settings has the larger size. */
  compact?: boolean
  onSave: (agents: number) => Promise<unknown> | void
  onDraft?: (agents: number | null) => void
}) {
  const [draft, setDraftState] = useState<number | null>(null)
  const shown = clampAgents(draft ?? value, most)
  const latest = useRef(shown)
  latest.current = shown
  const keysTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; stop: () => void } | null>(null)
  const saving = useRef<Promise<unknown> | null>(null)
  const waiting = useRef<number | null>(null)
  const props = useRef({ value, onSave, onDraft })
  props.current = { value, onSave, onDraft }

  const setDraft = (agents: number | null) => {
    setDraftState(agents)
    props.current.onDraft?.(agents)
  }

  const save = (agents: number) => {
    if (saving.current) {
      waiting.current = agents
      return
    }
    if (agents === props.current.value) return setDraft(null)
    saving.current = Promise.resolve(props.current.onSave(agents)).finally(() => {
      saving.current = null
      const next = waiting.current
      waiting.current = null
      if (next !== null && next !== agents) save(next)
      else setDraft(null)
    })
  }

  const stepTo = (agents: number) => {
    latest.current = agents
    setDraft(agents)
  }

  const stopHold = () => {
    if (!hold.current) return
    clearTimeout(hold.current.timer)
    hold.current.stop()
    hold.current = null
    save(latest.current)
  }

  /** One step now, and while the button stays down one after `HOLD_DELAY_MS` and then every `HOLD_REPEAT_MS`, up to the end of the range. */
  const startHold = (delta: -1 | 1) => {
    stopHold()
    const step = () => {
      const next = clampAgents(latest.current + delta, most)
      stepTo(next)
      return delta < 0 ? next > FEWEST_AGENTS : next < clampAgents(most, most)
    }
    if (!step()) return save(latest.current)
    const later = (wait: number) =>
      setTimeout(() => {
        if (!hold.current) return
        if (step()) hold.current.timer = later(HOLD_REPEAT_MS)
        else stopHold()
      }, wait)
    // A release anywhere ends the hold, also over a button that turned disabled at the end of the range.
    const end = () => stopHold()
    const events = ['pointerup', 'pointercancel', 'blur'] as const
    for (const name of events) window.addEventListener(name, end)
    hold.current = { timer: later(HOLD_DELAY_MS), stop: () => events.forEach((name) => window.removeEventListener(name, end)) }
  }

  // Leaving the screen keeps what was set: a save still waiting goes now. What this reads is in refs, so it runs once.
  useEffect(
    () => () => {
      if (keysTimer.current) {
        clearTimeout(keysTimer.current)
        save(latest.current)
      }
      stopHold()
    },
    [],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = agentsForKey(latest.current, event, most)
    if (next === null) return
    event.preventDefault()
    stepTo(next)
    if (keysTimer.current) clearTimeout(keysTimer.current)
    keysTimer.current = setTimeout(() => {
      keysTimer.current = null
      save(latest.current)
    }, KEYS_SETTLE_MS)
  }

  const press = (delta: -1 | 1) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      startHold(delta)
    },
    // A press that comes without a pointer, from assistive technology, is one step.
    onClick: (event: { detail: number }) => {
      if (event.detail !== 0) return
      stepTo(clampAgents(latest.current + delta, most))
      save(latest.current)
    },
  })

  return (
    <div
      role="spinbutton"
      aria-label={label}
      aria-valuemin={FEWEST_AGENTS}
      aria-valuemax={most}
      aria-valuenow={shown}
      aria-valuetext={shown === 1 ? '1 agent' : `${shown} agents`}
      tabIndex={0}
      data-stop=""
      className="flex w-fit shrink-0 items-center gap-1 rounded-full bg-tone-1 p-0.5 outline-offset-2"
      onKeyDown={onKeyDown}
    >
      <StepButton label="One fewer" compact={compact} disabled={shown <= FEWEST_AGENTS} {...press(-1)}>
        <Minus className={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
      </StepButton>
      <span className={cn('w-[3ch] text-center tabular-nums', compact ? 'text-[12.5px] font-medium' : 'text-[14px] font-semibold')}>{shown}</span>
      <StepButton label="One more" compact={compact} disabled={shown >= most} {...press(1)}>
        <Plus className={compact ? 'size-3.5' : 'size-4'} aria-hidden="true" />
      </StepButton>
    </div>
  )
}

function StepButton({
  label,
  compact,
  disabled,
  onPointerDown,
  onClick,
  children,
}: {
  label: string
  compact: boolean
  disabled: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onClick: (event: { detail: number }) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // The group takes the keyboard and the arrows. These are for the pointer.
      tabIndex={-1}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cn(
        'grid place-items-center rounded-full transition-[background-color,transform,opacity] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.94] disabled:opacity-35',
        compact ? 'size-7' : 'size-8',
      )}
    >
      {children}
    </button>
  )
}
