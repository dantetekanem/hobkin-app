import { Clock } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useWakeAt } from '@/features/chat/use-now.ts'
import { cn } from '@/lib/utils.ts'
import { faceRing, nextDueAt, placeOfAgent } from './schedules.ts'
import { useSchedules } from './use-schedules.ts'
import './schedule-ring.css'

/**
 * The ring around an agent's face in the agents list, lit in the sun while the agent keeps a live schedule
 * (`056-agent-schedules` A14), and breathing only while one runs or is due (`faceRing`). Its title says "Has schedules".
 * `agentId` names the agent as the window does (`placeOfAgent`), a run's or a durable hobkin's alike.
 *
 * It reads only its own agent's schedules, kept while they say the same (`useSchedules`), so a host message that leaves
 * them alone does not draw it again. The face it holds is drawn by the row, so a change here does not draw the face.
 */
export function ScheduleRing({ agentId, className, children }: { agentId: string; className?: string; children: ReactNode }) {
  const place = useMemo(() => placeOfAgent(agentId), [agentId])
  const schedules = useSchedules(place)
  const now = Date.now()
  const ring = faceRing(schedules, now)
  // It draws again when the soonest comes due, to breathe, and ticks for nothing else.
  useWakeAt(nextDueAt(schedules, now))
  return (
    <span className={cn('schedule-ring', className)} data-schedules={ring ?? undefined} title={ring ? 'Has schedules' : undefined}>
      {children}
      {(ring === 'lit' || ring === 'breathes') && (
        <Clock aria-label="Active schedule" role="img" className="pointer-events-none absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-background text-foreground" />
      )}
    </span>
  )
}
