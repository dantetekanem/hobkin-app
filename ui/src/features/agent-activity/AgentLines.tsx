import { TeamsStrip } from '@/features/teams/TeamsStrip.tsx'
import { HelpersLine } from '@/features/work/ChildAgents.tsx'
import { cn } from '@/lib/utils.ts'
import { useAgentJobs, useJobsHelpers, useJobsSkills, useJobsTasks } from './agent-jobs.ts'
import { Skills } from './SkillsLine.tsx'
import { Tasks } from './TaskList.tsx'

/**
 * One agent's lines, held under its header while its steps scroll by: its tasks (Control+Option+T), the agents its own
 * Pi started with pi-extended-teams, the helpers hobkin started for it, and the skills it loaded, in that order, each
 * drawn only when it has something. The same for every agent (the user, 2026-11-25: "durable agents should have the same
 * subagents, tasks, schedule and loaded skills, they all should share the same things"): `agentId` names it as the window
 * does, a run by its id, a durable hobkin as `hobkin:<id>`, hobkin's main agent as `MAIN_ACTIVITY`, and its lines read
 * all its jobs (`agent-jobs.ts`). Its schedules are the line under its talk box (056-agent-schedules).
 *
 * Mount it outside the steps' scroller: the lists it opens hang from this row over them. Each line reads what it shows
 * itself, so a step draws none of them.
 */
export function AgentLines({ agentId, hue, name, className }: { agentId: string; hue: number; name: string; className?: string }) {
  const jobs = useAgentJobs(agentId)
  return (
    <div className={cn('relative z-10 flex min-w-0 shrink-0 gap-3', className)}>
      <TasksLine jobs={jobs} hue={hue} />
      {/* Shown, never controlled: they are the agent's own Pi's (046-teams-layer). */}
      <TeamsStrip runs={jobs} hue={hue} runName={name} />
      <HelpersOf jobs={jobs} hue={hue} />
      {/* Last, so it only adds at the row's end. */}
      <SkillsOf jobs={jobs} hue={hue} />
    </div>
  )
}

function TasksLine({ jobs, hue }: { jobs: readonly string[]; hue: number }) {
  return <Tasks tasks={useJobsTasks(jobs)} hue={hue} />
}

function HelpersOf({ jobs, hue }: { jobs: readonly string[]; hue: number }) {
  return <HelpersLine helpers={useJobsHelpers(jobs)} hue={hue} />
}

function SkillsOf({ jobs, hue }: { jobs: readonly string[]; hue: number }) {
  return <Skills skills={useJobsSkills(jobs)} hue={hue} />
}
