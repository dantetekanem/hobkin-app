import { useAgent } from '@/app/running-agents.ts'
import { Stamped } from '@/features/agent-activity/Stamp.tsx'

/**
 * Where "Thinking" stands while an agent works, for a run that waits for its time (spec 053): until when, and the
 * agent's own note of what it will do then. Its dot holds still, as nothing runs. Nothing for any other agent.
 */
export function AgentWaits({ agentId }: { agentId: string }) {
  const agent = useAgent(agentId)
  if (!agent?.waits) return null

  const until = agent.doing.charAt(0).toUpperCase() + agent.doing.slice(1)
  return (
    <li className="pl-2.5 text-[13px] text-muted-foreground tabular-nums">
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          {agent.waits.note ? `${until} · ${agent.waits.note}` : until}
        </span>
      </Stamped>
    </li>
  )
}
