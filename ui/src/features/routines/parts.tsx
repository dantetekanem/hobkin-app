import { motion } from 'motion/react'
import type { Mood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { hueOf } from './look.ts'
import type { RoutineState } from './types.ts'
import { STATE_WORD, type Tone } from './words.ts'

/** Small pieces the Routines screen uses in more than one place. */

const MOOD: Record<RoutineState, Mood> = { on: 'idle', off: 'sleepy', held: 'sad', running: 'working' }

/** The small hobkin that runs a routine. It works while the routine runs and holds still otherwise. */
export function RoutineHood({ id, state, size = 26 }: { id: string; state: RoutineState; size?: number }) {
  return (
    <span className={cn('grid shrink-0 place-items-center transition-opacity duration-[450ms] ease-[ease]', state === 'off' && 'opacity-45')} style={{ width: size + 8, height: size + 8 }}>
      <AgentHood hue={hueOf(id)} size={size} mood={MOOD[state]} working={state === 'running'} />
    </span>
  )
}

const STATE_TONE: Record<RoutineState, string> = {
  on: 'bg-surface-2 text-foreground',
  off: 'bg-surface-2 text-muted-foreground',
  held: 'bg-warn/20 text-warn-fg',
  running: 'bg-ok/18 text-ok-fg',
}

/** On, off, held or running, as a small pill. A running one carries a dot that beats. */
export function StateChip({ state, className }: { state: RoutineState; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 font-heading text-[11px] font-semibold tracking-[0.01em]', STATE_TONE[state], className)}>
      {state === 'running' ? <span className="routines-beat size-1.5 rounded-full bg-ok" aria-hidden="true" /> : null}
      {STATE_WORD[state]}
    </span>
  )
}

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-ok/16 text-ok-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
  warn: 'bg-warn/20 text-warn-fg',
  bad: 'bg-bad/18 text-bad-fg',
}

/** How a run went, as a small pill. */
export function OutcomeChip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 font-heading text-[11px] font-semibold whitespace-nowrap', TONE_CHIP[tone])}>{label}</span>
}

/**
 * A row of choices, one stop in the walk. Left and Right move between them, as in a radio group.
 * The pill that marks the chosen one is thrown across on a spring.
 */
export function Choice<Value extends string>({
  label,
  value,
  options,
  onChoose,
  stop = true,
}: {
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChoose: (value: Value) => void
  stop?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit rounded-full bg-tone-1 p-0.5"
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!delta) return
        event.preventDefault()
        const group = event.currentTarget
        const at = options.findIndex((option) => option.value === value)
        const next = options[Math.min(options.length - 1, Math.max(0, at + delta))]!
        if (next.value === value) return
        onChoose(next.value)
        // The keyboard moves with the choice, so the next arrow starts from it.
        requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus())
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            data-stop={selected && stop ? '' : undefined}
            tabIndex={selected && stop ? 0 : -1}
            onClick={() => onChoose(option.value)}
            className={cn(
              'relative h-8 rounded-full px-3.5 font-heading text-[13px] font-medium whitespace-nowrap outline-offset-0',
              'transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? <motion.span layoutId={`routines-choice-${label}`} className="absolute inset-0 rounded-full bg-surface-2" transition={spring.pill} /> : null}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
