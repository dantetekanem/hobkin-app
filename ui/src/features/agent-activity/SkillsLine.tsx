import { memo, useMemo, useRef } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import './agent-activity.css'
import { glowIn } from './glow.ts'
import { sameSkills, skillsCount, skillsOf } from './skills.ts'
import { useAgentSkills } from './use-agent-activity.ts'

const NO_SKILLS: readonly string[] = []

/**
 * The skills the agent loaded (skills.ts) in one line beside its tasks, "3 loaded skills" (_specs/070-load-skill). Hover
 * or keyboard focus lists their names in the order it loaded them, and nothing opens on a click. It is the tasks line's
 * pill with its still ring and never glows: a load is over at once. Its loads are not drawn as steps (steps.ts,
 * `tasksOnLine`): this is where they show. Nothing shows before the agent loads a skill.
 *
 * Mount it last in its row, so it only adds at the row's end and nothing beside it moves as it appears or grows. With
 * too little room it gives way first, and its words are cut.
 */
export function AgentSkillsLine({ agentId, hue }: { agentId: string | null; hue: number }) {
  return <Skills skills={useAgentSkills(agentId)} hue={hue} />
}

/** The line for steps read elsewhere, kept as it is until the agent loads another skill: it draws again only then. */
export function SkillsLine({ entries, hue }: { entries: readonly ActivityEntry[] | null; hue: number }) {
  const loaded = useMemo(() => (entries ? skillsOf(entries) : NO_SKILLS), [entries])
  const held = useRef(loaded)
  if (!sameSkills(held.current, loaded)) held.current = loaded
  return <Skills skills={held.current} hue={hue} />
}

const Skills = memo(function Skills({ skills, hue }: { skills: readonly string[]; hue: number }) {
  if (skills.length === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger
        // Hover and focus show the names. A click opens nothing, and does not hide them either.
        closeOnClick={false}
        render={<span tabIndex={0} />}
        style={glowIn(hue)}
        className="aa-glow flex h-7 min-w-0 shrink-100 cursor-default items-center rounded-full bg-surface-2 px-2.5 text-[12px] text-muted-foreground tabular-nums outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
      >
        <span className="truncate">{skillsCount(skills.length)}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" sideOffset={8} className="max-w-xs text-left leading-snug">
        <ol aria-label="Loaded skills, in the order loaded" className="flex min-w-0 flex-col gap-0.5">
          {skills.map((name) => (
            <li key={name} className="break-words">
              {name}
            </li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
  )
})
