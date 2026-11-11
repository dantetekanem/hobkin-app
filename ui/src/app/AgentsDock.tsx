import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useTiers } from '@/features/tiers/store.ts'
import { ChildCluster, ChildFaces } from '@/features/work/ChildAgents.tsx'
import { agentEntry } from '@/features/work/agent-entry.ts'
import { childrenSummary, helpersNow, HOBKIN_HUE } from '@/features/work/child-summary.ts'
import { useMainChildren } from '@/features/work/children.ts'
import { cn } from '@/lib/utils.ts'
import { agentControls, askAgent, useAgentControl, useRunningAgents } from './running-agents.ts'
import { type Tier } from './sample.ts'
import { holdStill, useStill } from './still.ts'
import { useView } from './view-store.ts'

const TIER_LABEL: Record<Tier, string> = { fast: 'fast', mid: 'mid', high: 'high', max: 'max' }

/**
 * The agents working right now, at the bottom of the chat, under the input.
 *
 * Navigation follows pi-extended-teams' activity card. Down from an empty message enters the list.
 * Moving onto an agent shows its canvas at once. Enter steps into that agent to talk to it: the canvas grows,
 * the chat dims, and an input rises in the canvas. Escape there steps back out onto the same agent.
 * Escape in the list, or Up from the first agent, returns to the input and puts the canvas back as it was.
 * Inside the list only Up and Down move: Tab is the menu's again once the keyboard has left it.
 *
 * Each agent's small face shows what it is doing. An agent that waits for the user (a question, or help it
 * asked for) comes first, wears a question mark, and says what it is waiting on. Enter on it, or Command+G
 * from anywhere, opens its question in the same sheet Action Items uses.
 *
 * An agent that spawned helpers shows their small faces beside its tier, each showing how it stands. They are not
 * rows of their own: hobkin cannot open, stop or message them. The helpers hobkin's own chat spawned stand on one
 * line of their own above the agents while any is out, and the list is drawn for them alone too. Walking passes
 * them by: they are not agents to step into.
 *
 * A new agent pops up into the list like a bubble rising, and the others make room. The list is not drawn
 * when nothing is running. It shows four agents at a time. With more, it follows the selection like a
 * camera: the selected agent glides to the middle, and the edges fade where the list goes on.
 */
export function AgentsDock() {
  const still = useStill()
  const agents = useRunningAgents()
  const previewAgent = useView((view) => view.previewAgent)
  const endAgentPreview = useView((view) => view.endAgentPreview)
  const enterAgentTalk = useView((view) => view.enterAgentTalk)
  const openAgent = useView((view) => view.openAgent)
  const onAgent = useView((view) => view.screen === 'agent')
  const openTiers = useTiers((state) => state.openTiers)
  const list = useRef<HTMLDivElement | null>(null)
  /** Whether the list goes on above and below what is in view. */
  const [more, setMore] = useState({ above: false, below: false })
  const id = useId()
  const helpers = helpersNow(useMainChildren())

  const measure = () => {
    const element = list.current
    if (!element) return
    const above = element.scrollTop > 2
    const below = element.scrollTop + element.clientHeight < element.scrollHeight - 2
    setMore((current) => (current.above === above && current.below === below ? current : { above, below }))
  }
  // Agents arriving or leaving change how far the list goes on.
  useEffect(measure, [agents.length])
  // Whatever chose the agent on the canvas, the list brings its row to the middle.
  useEffect(() => {
    if (onAgent && openAgent) follow(openAgent)
  }, [onAgent, openAgent])

  /** Selection is visible immediately; browser-defined smooth scrolling has no entry deadline. */
  const follow = (agentId: string) => {
    list.current?.querySelector(`[data-agent-row="${agentId}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }

  if (agents.length === 0 && helpers.length === 0) return null
  // The selected agent is the one on the canvas.
  const shown = onAgent ? agents.findIndex((agent) => agent.id === openAgent) : -1
  const at = shown < 0 ? null : shown
  const waiting = agents.filter((agent) => agent.asks).length

  const select = (index: number, direction: 1 | -1) => {
    previewAgent(agents[index]!.id, direction)
    follow(agents[index]!.id)
  }

  const backToInput = () => {
    list.current?.closest('[data-chat-side]')?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }

  // A waiting agent is answered in the question sheet. Any other is stepped into, to talk to it.
  const stepInto = (index: number) => {
    const agent = agents[index]!
    if (!askAgent(agent.id)) enterAgentTalk(agent.id)
  }

  return (
    <div className="select-none-chrome shrink-0 px-3 pb-2">
      <div className="mx-auto max-w-[640px]">
        <AnimatePresence initial={false}>
          {helpers.length ? (
            <motion.div
              key="helpers"
              data-main-helpers
              initial={holdStill({ opacity: 0, transform: 'translateY(34px) scale(0.5)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.7)', transition: { duration: 0.18 } }, still)}
              className="flex items-center gap-2.5 px-2 py-1.5"
            >
              <span className="grid w-7 shrink-0 place-items-center">
                <Hob mood="working" size={24} still={still} stage="var(--background)" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-tight">hobkin's helpers</span>
                <span className="block truncate text-[11px] text-muted-foreground">{childrenSummary(helpers)}</span>
              </span>
              <ChildFaces spawned={helpers} hue={HOBKIN_HUE} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {agents.length ? (
          <>
            <div className="flex items-center gap-2 px-2 pb-1">
              <span className="eyebrow">{agents.length} working</span>
              {waiting ? (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-sun-fg">
                  <span aria-hidden="true">·</span>
                  {waiting === 1 ? '1 needs you' : `${waiting} need you`}
                  <Kbd>⌘G</Kbd>
                </span>
              ) : null}
            </div>
            <div
              ref={list}
              role="listbox"
              aria-label="Agents working now"
              aria-activedescendant={at === null ? undefined : `${id}-${agents[at]!.id}`}
              // Reached only by Down from an empty message (011 A11). Tab passes by, so it never swaps the canvas.
              tabIndex={-1}
              data-agents-dock
              // Four rows tall. The fades at the edges say the list goes on, instead of a row cut in half.
              className="max-h-[188px] overflow-x-hidden overflow-y-auto rounded-2xl outline-none [scrollbar-width:none]"
              style={{
                maskImage: `linear-gradient(to bottom, ${more.above ? 'transparent' : 'black'}, black 30px, black calc(100% - 30px), ${more.below ? 'transparent' : 'black'})`,
              }}
              onScroll={measure}
              onFocus={() => {
                if (at === null) select(0, 1)
              }}
              onBlur={(event) => {
                const next = event.relatedTarget
                if (next instanceof Element && next.closest('[data-canvas-screen^="agent:"]')) {
                  const view = useView.getState()
                  if (view.openAgent) view.openAgentCanvas(view.openAgent)
                  return
                }
                // Stepping into an agent takes the keyboard to its input. The list keeps its place for the way back.
                if (useView.getState().agentTalk || useAgentControl.getState().target) return
                // Leaving the list by any other road ends the preview, and the list drifts back to its top.
                endAgentPreview()
                list.current?.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'still' ? 'auto' : 'smooth' })
              }}
              onKeyDown={(event) => {
                const current = at ?? 0
                if (event.key === 'ArrowDown') {
                  if (current < agents.length - 1) select(current + 1, 1)
                } else if (event.key === 'ArrowUp') {
                  // Up from the first agent goes back to the input, the way the list was entered.
                  if (current === 0) backToInput()
                  else select(current - 1, -1)
                } else if (event.key === 'Enter') stepInto(current)
                else if (event.key === 'Escape') backToInput()
                else if (event.key === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) agentControls.request(agents[current]!.id)
                else if (event.key === 'i' && !event.metaKey && !event.ctrlKey && !event.altKey) agentControls.interrupt(agents[current]!.id)
                else return
                event.preventDefault()
              }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {agents.map((agent, index) => {
                  const asks = agent.asks
                  const selected = index === at
                  return (
                    <motion.div
                      key={agent.id}
                      layout={still ? false : 'position'}
                      transition={agentEntry(still)}
                      id={`${id}-${agent.id}`}
                      role="option"
                      aria-selected={selected}
                      aria-label={asks ? `${agent.title}, waiting for you: ${asks}` : undefined}
                      aria-describedby={`${id}-${agent.id}-children`}
                      data-agent-row={agent.id}
                      data-asking={asks ? true : undefined}
                      // A new agent bubbles up from below and overshoots a little, like a bubble reaching the surface.
                      initial={holdStill({ opacity: 0, transform: 'translateY(34px) scale(0.5)' }, still)}
                      animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }, still)}
                      exit={holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.7)', transition: { duration: 0.18 } }, still)}
                      // The row keeps the keyboard where it is: a click must not blur the list and end a preview first.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => stepInto(index)}
                      // The question mark on the face is the only sign that an agent waits. The row itself stays as any other.
                      className={cn(
                        'flex cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-[160ms] ease-[ease]',
                        selected ? 'bg-surface-2' : 'hover:bg-tone-1',
                      )}
                    >
                      <span className="grid w-7 shrink-0 place-items-center">
                        <AgentHood hue={agent.hue} size={24} mood={agent.mood} asking={Boolean(asks)} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] leading-tight">{agent.title}</span>
                        {asks ? (
                          <span className="block truncate text-[11px] text-muted-foreground">{asks}</span>
                        ) : (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {agent.project} · {agent.doing}
                          </span>
                        )}
                      </span>
                      <ChildCluster runId={agent.id} hue={agent.hue} summaryId={`${id}-${agent.id}-children`} />
                      <button
                        type="button"
                        // Reached with the mouse here, and through Settings from the keyboard.
                        tabIndex={-1}
                        title="Models for this tier"
                        onClick={(event) => {
                          event.stopPropagation()
                          openTiers(agent.tier)
                        }}
                        className="rounded-full border border-border px-1.5 text-[10px] leading-4 font-medium text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:border-border-strong hover:text-foreground"
                      >
                        {TIER_LABEL[agent.tier]}
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** Moves the keyboard into the agents list. The input calls this when Down is pressed in an empty message. */
export function focusAgentsDock(): boolean {
  const dock = document.querySelector<HTMLElement>('[data-agents-dock]')
  dock?.focus()
  return Boolean(dock)
}
