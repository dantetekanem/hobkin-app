import { SchedulesLine } from '@/features/schedules/SchedulesLine.tsx'
import { cn } from '@/lib/utils.ts'
import { useAgentJobs, useJobsSkills, useJobsTasks } from './agent-jobs.ts'
import { Skills } from './SkillsLine.tsx'
import { Tasks } from './TaskList.tsx'

/**
 * One agent's lines, held under its header while its steps scroll by: its tasks (Control+Option+T), its schedules
 * (Control+Option+W), and the skills it loaded, in that order, each drawn only when it has something. Its agents, those
 * its own Pi started with pi-extended-teams and the helpers hobkin started for it, are under its input instead
 * (`SubagentActivity.tsx`), as pi-extended-teams draws them. The same for every agent (the user, 2026-11-25:
 * "durable agents should have the same subagents, tasks, schedule and loaded skills, they all should share the same
 * things"): `agentId` names it as the window does, a run by its id, a durable hobkin as `hobkin:<id>`, hobkin's main
 * agent as `MAIN_ACTIVITY`, and its lines read all its jobs (`agent-jobs.ts`). Its schedules are its own, a durable
 * hobkin's from every turn (056-agent-schedules).
 *
 * Mount it outside the steps' scroller: the lists it opens hang from this row over them. Each line reads what it shows
 * itself, so a step draws none of them.
 */
export function AgentLines({ agentId, hue, className }: { agentId: string; hue: number; className?: string }) {
  const jobs = useAgentJobs(agentId)
  return (
    <div className={cn('relative z-10 flex min-w-0 shrink-0 gap-3', className)}>
      <TasksLine jobs={jobs} hue={hue} />
      <SchedulesLine agentId={agentId} hue={hue} />
      {/* Last, so it only adds at the row's end. */}
      <SkillsOf jobs={jobs} hue={hue} />
    </div>
  )
}

function TasksLine({ jobs, hue }: { jobs: readonly string[]; hue: number }) {
  return <Tasks tasks={useJobsTasks(jobs)} hue={hue} />
}

function SkillsOf({ jobs, hue }: { jobs: readonly string[]; hue: number }) {
  return <Skills skills={useJobsSkills(jobs)} hue={hue} />
}
