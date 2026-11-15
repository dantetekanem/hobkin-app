import { ChevronLeft } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useMemo, useRef } from 'react'
import { AgentHood } from '@/components/Mark.tsx'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { exchangeOf } from '@/features/agent-activity/steps.ts'
import { StepItem } from '@/features/agent-activity/StepView.tsx'
import { childHue } from '@/features/work/child-summary.ts'
import { cn } from '@/lib/utils.ts'
import { MEANING, endText, firstLine, startText, standing, whatIsKept, whoSaid, type ShownTeamsAgent } from './rules.ts'

/**
 * A run's pi-extended-teams agent, opened from its strip (`046-teams-layer`): read only. What it was asked, how it stands
 * and when, its last steps from its own session when teams kept one, and the messages between it and the run. There is
 * no input and no stop: hobkin shows these agents and never reaches them.
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
function faceHue(hue: number, name: string): number {
  let sum = 0
  for (const char of name) sum = (sum * 31 + char.charCodeAt(0)) % 9973
  return childHue(hue, sum % 8)
}

/** When it started and, once it ended, when it finished or failed. One still out says since when. */
export function TimesOf({ agent, now }: { agent: ShownTeamsAgent; now: number }) {
  const started = startText(agent, now)
  const ended = endText(agent, now)
  const out = agent.state === 'running' || agent.state === 'queued'
  return (
    <span className="shrink-0 text-muted-foreground tabular-nums">
      {out && started ? `since ${started}` : started}
      {ended ? ` → ${ended}` : ''}
    </span>
  )
}

/** One agent as a row of a list: face, name, the first line of its task, how it stands and its times. */
export function TeamsRow({ agent, hue, now, onOpen }: { agent: ShownTeamsAgent; hue: number; now: number; onOpen: (opener: HTMLElement) => void }) {
  const { note } = standing(agent, now)
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[12.5px] transition-[background-color,transform] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.99] outline-none focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
    >
      <TeamsFace agent={agent} hue={hue} size={16} />
      <span className="shrink-0 font-medium">{agent.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{firstLine(agent.task)}</span>
      <span className={cn('shrink-0', agent.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>
        {agent.state}
        {note ? ` · ${note}` : ''}
      </span>
      <TimesOf agent={agent} now={now} />
    </button>
  )
}

export type SheetOpen = { agent: string } | 'all' | null

interface SheetProps {
  agents: readonly ShownTeamsAgent[]
  open: SheetOpen
  onOpen: (next: SheetOpen) => void
  hue: number
  /** The run's own agent, as the messages name it: the routine's or the durable hobkin's name. */
  runName: string
  /** Where the keyboard goes back to when the sheet closes. */
  opener: () => HTMLElement | null
}

export function TeamsAgentSheet({ agents, open, onOpen, hue, runName, opener }: SheetProps) {
  const close = useRef<HTMLButtonElement | null>(null)
  const agent = open !== null && open !== 'all' ? agents.find((row) => row.id === open.agent) : undefined
  // An agent that left the list while open shows the list in its place.
  const showing = open === null ? null : agent ?? 'all'

  return (
    <Dialog
      open={showing !== null && agents.length > 0}
      onOpenChange={(next, details) => {
        // Escape closes the sheet only, never the page or the canvas behind it.
        if (details.reason === 'escape-key') {
          details.event.preventDefault()
          details.event.stopPropagation()
        }
        if (!next) onOpen(null)
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        finalFocus={() => {
          const back = opener()
          return back?.isConnected ? back : false
        }}
        // Portals still bubble through React: none of these keys belong to the page under the sheet.
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onOpen(null)
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="z-[60] flex max-h-[84dvh] w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[600px] motion-reduce:animate-none"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          {showing !== 'all' && showing && agents.length > 1 ? (
            <button
              type="button"
              onClick={() => onOpen('all')}
              aria-label="All teams agents"
              className="-ml-1.5 grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-semibold">{showing === 'all' || !showing ? 'Teams agents' : showing.name}</DialogTitle>
          <DialogClose ref={close} render={<button type="button" className="rounded-lg border border-border px-3 py-1 text-[13px] outline-offset-2" />}>
            Close
          </DialogClose>
        </header>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3" tabIndex={0} aria-label={showing === 'all' ? 'The run’s teams agents' : 'What this agent did'}>
          {showing === 'all' ? (
            <ul className="-mx-2 flex flex-col">
              {agents.map((row) => (
                <li key={row.id}>
                  <TeamsRow agent={row} hue={hue} now={Date.now()} onOpen={() => onOpen({ agent: row.id })} />
                </li>
              ))}
            </ul>
          ) : showing ? (
            <TeamsAgentBody agent={showing} hue={hue} runName={runName} now={Date.now()} />
          ) : null}
        </div>
        <p className="shrink-0 border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
          {showing === 'all'
            ? 'From the run’s own calls to pi-extended-teams, and its files where it kept them.'
            : showing?.from === 'teams'
              ? 'Read from pi-extended-teams’ own files.'
              : 'From the run’s own calls to pi-extended-teams.'}{' '}
          hobkin shows these agents and does not control them.
        </p>
      </DialogContent>
    </Dialog>
  )
}

const SECTION = 'mb-1.5 text-[11.5px] font-medium tracking-[0.01em] text-muted-foreground'

/** Everything hobkin has of one agent, top to bottom. Exported for still renders. */
export function TeamsAgentBody({ agent, hue, runName, now }: { agent: ShownTeamsAgent; hue: number; runName: string; now: number }) {
  const { note } = standing(agent, now)
  const kept = whatIsKept(agent)
  const ended = endText(agent, now)
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
            {agent.modelSlot ? <span className="text-muted-foreground"> · {agent.modelSlot}</span> : null}
          </p>
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
