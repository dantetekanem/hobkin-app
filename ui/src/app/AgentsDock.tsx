import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { usePetChoice } from '@/avatar/use-pet.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { agentGroups } from '@/features/hobkins/list.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { ChildCluster, ChildFaces } from '@/features/work/ChildAgents.tsx'
import { agentEntry } from '@/features/work/agent-entry.ts'
import { childrenSummary, helpersNow, HOBKIN_HUE } from '@/features/work/child-summary.ts'
import { useMainChildren } from '@/features/work/children.ts'
import { cn } from '@/lib/utils.ts'
import { requestCanvasFocus } from './focus.ts'
import { agentControls, askAgent, useAgentControl, useAgentWords, useRunningAgents, type RunningAgent } from './running-agents.ts'
import { type Tier } from './sample.ts'
import { holdStill, useStill } from './still.ts'
import { useView } from './view-store.ts'

const TIER_LABEL: Record<Tier, string> = { fast: 'fast', mid: 'mid', high: 'high', max: 'max' }

/**
 * The agents working right now, at the bottom of the chat, under the input.
 *
 * Navigation follows pi-extended-teams' activity card. Down from an empty message enters the list.
 * Moving onto an agent shows its canvas at once. A click on an agent shows its canvas to stay, as it is. Enter does
 * too, and puts the keyboard in the agent's input, which is always at the bottom of its canvas. Escape there comes
 * back onto the same agent. Escape in the list, or Up from the first agent, returns to the input and puts the canvas
 * back as it was. Inside the list only Up and Down move: Tab is the menu's again once the keyboard has left it.
 *
 * Each agent's small face shows what it is doing. An agent that waits for the user (a question, or help it
 * asked for) comes first, wears a question mark, and says what it is waiting on. Enter on it, or Command+G
 * from anywhere, opens its question in the same sheet Action Items uses.
 *
 * An agent that spawned helpers shows their small faces beside its tier, each showing how it stands. They are not
 * rows of their own: hobkin cannot open, stop or message them. The helpers hobkin's own chat spawned stand on one
 * line of their own above the agents while any is out, and the list is drawn for them alone too. Walking passes
 * them by: they are not agents to open.
 *
 * The user's durable hobkins (034-durable-hobkins) come first with no header, then a thin line, then the agents that
 * come and go under their count. With no agents at work there is neither count nor line. Up and Down walk both
 * groups as one list.
 *
 * A new agent pops up into the list like a bubble rising, and the others make room. The list is not drawn
 * when nothing is running. It shows four agents at a time. With more, it follows the selection like a
 * camera: the selected agent glides to the middle, and the edges fade where the list goes on.
 */
export function AgentsDock() {
  const still = useStill()
  const running = useRunningAgents()
  const { durable, others, walk: agents } = useMemo(() => agentGroups(running), [running])
  const previewAgent = useView((view) => view.previewAgent)
  const endAgentPreview = useView((view) => view.endAgentPreview)
  const openAgentCanvas = useView((view) => view.openAgentCanvas)
  const openAgent = useView((view) => view.openAgent)
  const onAgent = useView((view) => view.screen === 'agent')
  const openTiers = useTiers((state) => state.openTiers)
  const list = useRef<HTMLDivElement | null>(null)
  /** Whether the list goes on above and below what is in view. */
  const [more, setMore] = useState({ above: false, below: false })
  const id = useId()
  const helpers = helpersNow(useMainChildren())
  // With No Pet, hobkin's own face is not drawn, so its row starts at the words.
  const drawsPet = usePetChoice() !== 'none'

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
  const waiting = others.filter((agent) => agent.asks).length

  const select = (index: number, direction: 1 | -1) => {
    previewAgent(agents[index]!.id, direction)
    follow(agents[index]!.id)
  }

  // A durable hobkin is never ended from here: x stops only its turn in flight, and while it waits there is none.
  const stop = (agent: RunningAgent) => {
    if (!agent.durable) agentControls.request(agent.id)
    else if (agent.durable.run) agentControls.request(agent.durable.run)
  }

  const backToInput = () => {
    list.current?.closest('[data-chat-side]')?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }

  // A waiting agent is answered in the question sheet. Any other keeps its canvas, with the keyboard in its input.
  const enter = (index: number) => {
    const agent = agents[index]!
    if (askAgent(agent.id)) return
    openAgentCanvas(agent.id)
    requestCanvasFocus('[data-agent-input]')
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
              {drawsPet ? (
                <span className="grid w-7 shrink-0 place-items-center">
                  <Hob mood="working" size={24} still={still} stage="var(--background)" />
                </span>
              ) : null}
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
            <div
              ref={list}
              role="listbox"
              aria-label="Agents working now"
              aria-activedescendant={at === null ? undefined : `${id}-${agents[at]!.id}`}
              // Reached only by Down from an empty message (011 A11). Tab passes by, so it never swaps the canvas.
              tabIndex={-1}
              data-agents-dock
              // Four rows tall, with room for the headers and the line between the groups. The fades at the edges say the
              // list goes on, instead of a row cut in half.
              className="overflow-x-hidden overflow-y-auto rounded-2xl outline-none [scrollbar-width:none]"
              style={{
                maxHeight: FOUR_ROWS + (others.length ? GROUP_HEAD : 0) + (durable.length && others.length ? GROUP_LINE : 0),
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
                // The Stop confirmation takes the keyboard for a moment. The list keeps its place for the way back.
                if (useAgentControl.getState().target) return
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
                } else if (event.key === 'Enter') enter(current)
                else if (event.key === 'Escape') backToInput()
                else if (event.key === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) stop(agents[current]!)
                else if (event.key === 'i' && !event.metaKey && !event.ctrlKey && !event.altKey) agentControls.interrupt(agents[current]!.id)
                else return
                event.preventDefault()
              }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {agents.flatMap((agent, index) => {
                  const selected = index === at
                  // The agents that come and go start under their count, and under a line when durable hobkins sit above.
                  const heads =
                    index === durable.length
                      ? [
                          durable.length ? <GroupLine key="line" still={still} /> : null,
                          <OthersHead key="head:others" still={still} count={others.length} waiting={waiting} />,
                        ]
                      : []
                  return [
                    ...heads,
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      selected={selected}
                      still={still}
                      listId={id}
                      list={list}
                      openAgentCanvas={openAgentCanvas}
                      openTiers={openTiers}
                    />,
                  ]
                })}
              </AnimatePresence>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface AgentRowProps {
  agent: RunningAgent
  selected: boolean
  still: boolean
  listId: string
  list: RefObject<HTMLDivElement | null>
  openAgentCanvas: (id: string) => void
  openTiers: (tier: Tier) => void
  /** AnimatePresence passes the row's element up through this to measure it as it leaves. */
  ref?: Ref<HTMLDivElement>
}

/**
 * One agent's row. It draws again only when its own agent, or whether it is selected, changes: every row with a
 * layout prop reads the page's layout for each draw, and the list draws for every agent's latest words.
 */
const AgentRow = memo(function AgentRow({ agent, selected, still, listId: id, list, openAgentCanvas, openTiers, ref }: AgentRowProps) {
  const asks = agent.asks
  const waits = agent.durable?.state === 'waiting'
  return (
    <motion.div
      ref={ref}
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      id={`${id}-${agent.id}`}
      role="option"
      aria-selected={selected}
      aria-label={asks ? `${agent.title}, waiting for you: ${asks}` : waits ? `${agent.title}, waiting` : undefined}
      aria-describedby={`${id}-${agent.id}-children`}
      data-agent-row={agent.id}
      data-asking={asks ? true : undefined}
      // A new agent bubbles up from below and overshoots a little, like a bubble reaching the surface.
      initial={holdStill({ opacity: 0, transform: 'translateY(34px) scale(0.5)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.7)', transition: { duration: 0.18 } }, still)}
      // The row keeps the keyboard where it is: a click must not blur the list and end a preview first.
      onMouseDown={(event) => event.preventDefault()}
      // Clicking an agent puts the keyboard on it in the list (once the open has re-rendered), so Up walks
      // to the agent above it, instead of falling back to the message input and recalling the last message.
      onClick={() => {
        openAgentCanvas(agent.id)
        requestAnimationFrame(() => list.current?.focus())
      }}
      // The question mark on the face is the only sign that an agent waits. The row itself stays as any other.
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-[160ms] ease-[ease]',
        selected ? 'bg-surface-2' : 'hover:bg-tone-1',
      )}
    >
      <span className="grid w-7 shrink-0 place-items-center">
        {/* A durable hobkin stays: its face sits in a faint ring, apart from the agents that come and go. */}
        <span className={cn('grid place-items-center rounded-full', agent.durable && 'size-7 ring-1 ring-border-strong/50')}>
          <AgentHood hue={agent.hue} size={agent.durable ? 22 : 24} mood={agent.mood} asking={Boolean(asks)} working={!waits} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight">{agent.title}</span>
        <AgentWords agent={agent} />
      </span>
      <ChildCluster runId={agent.durable?.run ?? agent.id} hue={agent.hue} summaryId={`${id}-${agent.id}-children`} />
      {agent.durable && agent.durable.engine.kind !== 'tier' ? (
        <span className="rounded-full border border-border px-1.5 text-[10px] leading-4 font-medium text-muted-foreground">
          {agent.durable.engine.kind === 'claude' ? 'claude' : 'custom'}
        </span>
      ) : (
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
      )}
    </motion.div>
  )
})

/**
 * What the row says under the agent's name. It follows the agent's latest words itself, so the row, which reads the
 * page's layout each time it draws, does not draw again for each of them.
 */
const AgentWords = memo(function AgentWords({ agent }: { agent: RunningAgent }) {
  const update = useAgentWords(agent)
  const asks = agent.asks
  const waits = agent.durable?.state === 'waiting'
  return asks ? (
      <span className="block truncate text-[11px] text-muted-foreground">{asks}</span>
    ) : waits ? (
      // Waiting for the next message, with what it said last. One the user has not looked at says so a little louder.
      <span className="block truncate text-[11px] text-muted-foreground">
        <span className={cn(agent.durable?.unseen && 'font-medium text-sun-fg')}>waiting</span>
        {' · '}
        {update ?? agent.project}
      </span>
    ) : update ? (
      // Its own latest words, small and cut to one line; a hover opens the whole line in the app's
      // soft, animated tooltip rather than the browser's plain one.
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate text-[11px] text-muted-foreground" />}>
          {agent.project} · {update}
        </TooltipTrigger>
        <TooltipContent side="right" align="center" sideOffset={10} className="max-w-xs text-left leading-snug whitespace-normal">
          {update}
        </TooltipContent>
      </Tooltip>
    ) : (
      // Before it speaks, the plain phase ("running the tests") stands in.
      <span className="block truncate text-[11px] text-muted-foreground">
        {agent.project} · {agent.doing}
      </span>
    )
})

/** Four rows of the list, in pixels. Each group's header and the line between the groups add their own height. */
const FOUR_ROWS = 188
const GROUP_HEAD = 24
const GROUP_LINE = 13

/** A group's small header in the list. It walks with its rows, and Up and Down pass it by. */
function GroupHead({ still, children }: { still: boolean; children: ReactNode }) {
  return (
    <motion.div
      aria-hidden="true"
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      initial={holdStill({ opacity: 0 }, still)}
      animate={holdStill({ opacity: 1 }, still)}
      exit={holdStill({ opacity: 0, transition: { duration: 0.18 } }, still)}
      className="flex h-6 items-center gap-2 px-2"
    >
      {children}
    </motion.div>
  )
}

/** The thin line between the durable hobkins and the other agents. */
const GroupLine = memo(function GroupLine({ still }: { still: boolean }) {
  return (
    <motion.div
      aria-hidden="true"
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      initial={holdStill({ opacity: 0 }, still)}
      animate={holdStill({ opacity: 1 }, still)}
      exit={holdStill({ opacity: 0, transition: { duration: 0.18 } }, still)}
      className="mx-2 my-1.5 h-px bg-border"
    />
  )
})

/** The header over the agents that come and go: how many work, and how many need the user. Draws again only for those two. */
const OthersHead = memo(function OthersHead({ still, count, waiting }: { still: boolean; count: number; waiting: number }) {
  return (
    <GroupHead still={still}>
      <span className="eyebrow">{count} working</span>
      {waiting ? (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-sun-fg">
          <span aria-hidden="true">·</span>
          {waiting === 1 ? '1 needs you' : `${waiting} need you`}
          <Kbd>⌘G</Kbd>
        </span>
      ) : null}
    </GroupHead>
  )
})

/** Moves the keyboard into the agents list. The input calls this when Down is pressed in an empty message. */
export function focusAgentsDock(): boolean {
  const dock = document.querySelector<HTMLElement>('[data-agents-dock]')
  dock?.focus()
  return Boolean(dock)
}
