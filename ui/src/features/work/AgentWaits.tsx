import { useAgent } from '@/app/running-agents.ts'
import { Stamped } from '@/features/agent-activity/Stamp.tsx'

/**
 * Where "Thinking" stands while an agent works, for a run that waits for its time (spec 053): until when, and the
 * agent's own note of what it will do then. For a living job idle between its turns (spec 072): since when, and that it
 * waits for a message. Its dot holds still, as nothing runs. Nothing for any other agent.
 */
export function AgentWaits({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId)
  if (!agent?.waits && !agent?.idle) return null

  const when = agent.doing.charAt(0).toUpperCase() + agent.doing.slice(1)
  const line = agent.idle ? `${when} · waiting for a message` : agent.waits?.note ? `${when} · ${agent.waits.note}` : when
  return (
    <li className="pl-2.5 text-[13px] text-muted-foreground tabular-nums">
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          {line}
        </span>
      </Stamped>
    </li>
  )
}
