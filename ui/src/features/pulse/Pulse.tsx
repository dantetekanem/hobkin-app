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
 * text with tabular figures, so it sits in any one line slot and its container decides where it is cut. A narrow slot
 * asks for `noticeFirst`, so a run that went quiet says so before the line is cut. `after` follows the line, for a
 * place that goes on showing what it showed before.
 */
interface PulseProps {
  run: string | null
  fallback: ReactNode
  className?: string
  noticeFirst?: boolean
  after?: ReactNode
  /** Only the phase, `Working…`: the time and the count are left to a hover. */
  phaseOnly?: boolean
}

export function Pulse({ run, fallback, className, noticeFirst = false, after = null, phaseOnly = false }: PulseProps) {
  const pulse = usePulse(run)
  if (!pulse) return <>{fallback}</>

  return (
    <>
      <PulseWords pulse={pulse} className={className} noticeFirst={noticeFirst} phaseOnly={phaseOnly} />
      {after}
    </>
  )
}

/** The line itself: the one part that counts the seconds, so only it draws again each second. */
function PulseWords({ pulse, className, noticeFirst, phaseOnly }: { pulse: RunPulse; className?: string; noticeFirst: boolean; phaseOnly: boolean }) {
  const now = useNow(true)
  const { words, phase, notice, tone } = pulseLine(pulse, now)
  const quiet = notice ? <span className={TONE_TEXT[tone]}>{notice}</span> : null

  return (
    <span className={cn('tabular-nums', className)}>
      {quiet && noticeFirst ? <>{quiet} · </> : null}
      {phaseOnly ? phase : words}
      {quiet && !noticeFirst ? <> · {quiet}</> : null}
    </span>
  )
}
