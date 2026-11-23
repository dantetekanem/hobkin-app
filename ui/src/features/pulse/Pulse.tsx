import type { ReactNode } from 'react'
import { pulseLine, pulsesOf, type PulseTone, type RunPulse } from '#shared/protocol/pulse.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'

const TONE_TEXT: Record<PulseTone, string | undefined> = { plain: undefined, warn: 'text-warn-fg', bad: 'text-bad-fg' }

/** The pulse the window's snapshot carries for `run`, or null while it carries none. */
export function usePulse(run: string | null): RunPulse | null {
  return useHost((state) => {
    const pulses = pulsesOf(state.snapshot)
    return run !== null && Object.hasOwn(pulses, run) ? pulses[run]! : null
  })
}

/**
 * One run's working line while the host sends its pulse (`054-working-line`): `Working… (7m 7s · ↓ 30.0k tokens)`,
 * then the quiet notice in its tone. Without a pulse it shows `fallback`, what the place showed before. It is inline
 * text with tabular figures, so it sits in any one line slot and its container decides where it is cut.
 */
export function Pulse({ run, fallback, className }: { run: string | null; fallback: ReactNode; className?: string }) {
  const pulse = usePulse(run)
  return pulse ? <PulseWords pulse={pulse} className={className} /> : <>{fallback}</>
}

/** The line itself: the one part that counts the seconds, so only it draws again each second. */
function PulseWords({ pulse, className }: { pulse: RunPulse; className?: string }) {
  const now = useNow(true)
  const { words, notice, tone } = pulseLine(pulse, now)
  return (
    <span className={cn('tabular-nums', className)}>
      {words}
      {notice ? <span className={TONE_TEXT[tone]}> · {notice}</span> : null}
    </span>
  )
}
