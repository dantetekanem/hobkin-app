import { AnimatePresence } from 'motion/react'
import { useMemo } from 'react'
import { AgentHood } from '@/components/Mark.tsx'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { exchangeOf } from '@/features/agent-activity/steps.ts'
import { StepItem } from '@/features/agent-activity/StepView.tsx'
import { useModelChoices } from '@/features/tiers/models.ts'
import { childHue } from '@/features/work/child-summary.ts'
import { cn } from '@/lib/utils.ts'
import { MEANING, endText, standing, startText, whatIsKept, whoSaid, type ShownTeamsAgent } from './rules.ts'
import { runsOnFull, runsOnWords } from './runs-on.ts'

/**
 * A run's pi-extended-teams agent as the navigator shows it (`046-teams-layer`, `SubagentActivity.tsx`): read only. What
 * it was asked, how it stands and when, its last steps from its own session when teams kept one, and the messages
 * between it and the run. There is no input and no stop: hobkin shows these agents and never reaches them.
 */

/** Its face: a running one moves, a queued one waits faint, one hobkin lost track of is grey, and an ended one wears its mark. */
export function TeamsFace({ agent, hue, size = 14 }: { agent: ShownTeamsAgent; hue: number; size?: number }) {
  const running = agent.state === 'running'
  return (
    <span className={cn('relative block shrink-0', agent.state === 'queued' && 'opacity-45', agent.state === 'unknown' && 'opacity-60 grayscale')}>
      <AgentHood hue={faceHue(hue, agent.name)} size={size} mood={running ? 'working' : 'idle'} working={running} />
      {agent.state === 'done' || agent.state === 'failed' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-[3px] -bottom-[2px] size-[5px] rounded-full',
            agent.state === 'done' ? 'bg-[var(--hb-wire-pulse)] shadow-[0_0_0_1px_var(--hb-wire-active),0_0_0_2.5px_var(--background)]' : 'bg-bad shadow-[0_0_0_1.5px_var(--background)]',
          )}
        />
      ) : null}
    </span>
  )
}

/** A face keeps its hue by its name, so an agent changing place in the list keeps its look. */
export function faceHue(hue: number, name: string): number {
  let sum = 0
  for (const char of name) sum = (sum * 31 + char.charCodeAt(0)) % 9973
  return childHue(hue, sum % 8)
}

const SECTION = 'mb-1.5 text-[11.5px] font-medium tracking-[0.01em] text-muted-foreground'

/** Everything hobkin has of one agent, top to bottom. */
export function TeamsAgentBody({ agent, hue, runName, now }: { agent: ShownTeamsAgent; hue: number; runName: string; now: number }) {
  const models = useModelChoices()
  const { note } = standing(agent, now)
  const kept = whatIsKept(agent)
  const ended = endText(agent, now)
  const runsOn = runsOnWords(agent, models)
  // Nothing of an agent that is no longer out still runs, so none of its steps is drawn as running.
  const settled = agent.state !== 'running' && agent.state !== 'queued'
  const steps = useMemo(() => {
    const kept = agent.steps ?? []
    const seenAt = (id: string) => kept.find((step) => step.id === id)?.at
    return kept.length ? exchangeOf(kept, [], { seenAt, ended: settled }) : []
  }, [agent.steps, settled])
  // A step's time is the one hobkin read for it from the agent's session.
  const timeOf = (id: string) => {
    const at = agent.steps?.find((step) => step.id === id)?.at
    return at === undefined ? undefined : { seen: at }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <TeamsFace agent={agent} hue={hue} size={30} />
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <p>
            <span className={cn('font-medium', agent.state === 'failed' && 'text-bad-fg')}>{agent.state}</span>
            {note ? <span className="text-muted-foreground"> · {note}</span> : null}
          </p>
          {/* The tier, model and thinking level it runs on, as far as its records say. The whole model is on hover. */}
          {runsOn.length ? <p title={runsOnFull(agent)} className="text-muted-foreground">{runsOn.join(' · ')}</p> : null}
          <p className="text-muted-foreground tabular-nums">
            Started {startText(agent, now) || 'at a time hobkin did not see'}
            {ended ? ` · ${agent.state === 'done' ? 'finished' : 'failed'} ${ended}` : ''}
          </p>
          {MEANING[agent.state] ? <p className="mt-0.5 text-[12px] text-muted-foreground">{MEANING[agent.state].replace(/^./, (first) => first.toUpperCase())}.</p> : null}
        </div>
      </div>

      <section>
        <h3 className={SECTION}>What it was asked</h3>
        <p className="max-h-40 overflow-y-auto rounded-xl bg-surface-2 px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{agent.task || 'No task was given.'}</p>
      </section>

      {agent.summary ? (
        <section>
          <h3 className={SECTION}>Its report</h3>
          <p className="text-[13.5px] leading-relaxed break-words">{agent.summary}</p>
        </section>
      ) : null}

      {kept.steps ? (
        <section>
          <h3 className={SECTION}>Its last steps</h3>
          <ShowStamps>
            <ol aria-label={`What ${agent.name} did last`} className="-mx-2.5 flex flex-col gap-2">
              {/* The steps there when the sheet opens are simply there. One arriving while it is open rises in. */}
              <AnimatePresence initial={false}>
                {steps.map((step) => (step.kind === 'note' ? null : <StepItem key={step.key} step={step} timeOf={timeOf} ended={settled} />))}
              </AnimatePresence>
            </ol>
          </ShowStamps>
        </section>
      ) : null}

      {kept.messages ? (
        <section>
          <h3 className={SECTION}>Messages with the run</h3>
          <ShowStamps>
            <ol className="flex flex-col gap-2">
              {agent.messages!.map((message, index) => (
                <li key={`${message.at ?? 0}:${index}`}>
                  <Stamped at={message.at} line="from">
                    {/* No one here is the user, so every message keeps to the left, under who wrote it. Its own are filled. */}
                    <div className={cn('w-fit max-w-[88%] rounded-2xl rounded-bl-md px-3 py-1.5 text-[13.5px] leading-relaxed break-words', message.by === 'agent' ? 'bg-surface-2' : 'border border-border')}>
                      <p className="mb-0.5 text-[11px] leading-normal text-muted-foreground">{whoSaid(message, agent.name, runName)}</p>
                      {message.text}
                    </div>
                  </Stamped>
                </li>
              ))}
            </ol>
          </ShowStamps>
        </section>
      ) : null}

      {!kept.steps && !kept.messages ? (
        <p className="text-[13px] text-muted-foreground">hobkin has nothing more of its work to show: pi-extended-teams kept no session or messages of it that hobkin can read.</p>
      ) : null}
    </div>
  )
}
