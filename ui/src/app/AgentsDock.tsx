import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Hob } from '@/avatar/Hob.tsx'
import { PalCrab } from '@/avatar/Pals.tsx'
import { usePetChoice } from '@/avatar/use-pet.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { agentGroups } from '@/features/hobkins/list.ts'
import { Pulse } from '@/features/pulse/Pulse.tsx'
import { useTiers } from '@/features/tiers/store.ts'
import { ChildCluster, ChildFaces } from '@/features/work/ChildAgents.tsx'
import { agentEntry } from '@/features/work/agent-entry.ts'
import { childrenSummary, helpersNow, HOBKIN_HUE } from '@/features/work/child-summary.ts'
import { useMainChildren } from '@/features/work/children.ts'
import { cn } from '@/lib/utils.ts'
import { centeredOn, dockHeight, followedAgent, headsOf, listHeight, ROW, rowsInView, rowTop, stepped, type DockShape } from './dock-rows.ts'
import { requestCanvasFocus } from './focus.ts'
import { agentControls, agentCounts, askAgent, atRest, othersCount, useAgentControl, useAgentWords, useRunningAgents, waitingRowWords, type RunningAgent } from './running-agents.ts'
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
 * camera: the selected agent glides to the middle, and the edges fade where the list goes on. Only the rows in view
 * are drawn, each at its place in the whole list, with the selected one wherever it is (`dock-rows.ts`).
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
  /** How far the list is scrolled, which says which rows it draws. */
  const [scrollTop, setScrollTop] = useState(0)
  /** One row's height as the page draws it, which every row's place follows. */
  const [row, setRow] = useState(ROW)
  const shape: DockShape = { durable: durable.length, others: others.length, row }
  /** The agents now, and the ones the list has drawn before: a row of one of those that comes into view does not arrive again. */
  const present = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents])
  const known = useRef<ReadonlySet<string>>(present)
  const id = useId()
  const helpers = helpersNow(useMainChildren())
  // With No Pet, hobkin's own face is not drawn, so its row starts at the words.
  const drawsPet = usePetChoice() !== 'none'

  const measure = () => {
    const element = list.current
    if (!element) return
    setScrollTop(element.scrollTop)
    const above = element.scrollTop > 2
    const below = element.scrollTop + element.clientHeight < element.scrollHeight - 2
    setMore((current) => (current.above === above && current.below === below ? current : { above, below }))
  }
  // Agents arriving or leaving change how far the list goes on.
  useEffect(measure, [agents.length])
  useEffect(() => {
    known.current = present
  })
  // A row is as tall as its lines; the first one drawn says how tall, before the page shows the list.
  const hasRows = agents.length > 0
  useLayoutEffect(() => {
    const element = list.current?.querySelector('[data-agent-row]')
    const height = element ? Number.parseFloat(getComputedStyle(element).height) : 0
    if (height > 0) setRow(height)
  }, [hasRows])
  // Whatever chose the agent on the canvas, the list brings its row to the middle, drawn there before the page shows it,
  // as soon as the list has it.
  const followed = followedAgent(onAgent, openAgent, agents)
  useLayoutEffect(() => {
    if (followed) follow(agents.findIndex((agent) => agent.id === followed))
  }, [followed])

  /** Selection is visible immediately; browser-defined smooth scrolling has no entry deadline. */
  const follow = (index: number) => {
    const element = list.current
    if (!element || index < 0) return
    const top = centeredOn(shape, index)
    element.scrollTop = top
    setScrollTop(top)
  }

  if (agents.length === 0 && helpers.length === 0) return null
  // The selected agent is the one on the canvas.
  const shown = onAgent ? agents.findIndex((agent) => agent.id === openAgent) : -1
  const at = shown < 0 ? null : shown
  const counts = agentCounts(others)
  const heads = headsOf(shape)

  const select = (index: number, direction: 1 | -1) => {
    previewAgent(agents[index]!.id, direction)
    follow(index)
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
              // list goes on, instead of a row cut in half. A list that goes on nowhere has no fade to draw.
              className="overflow-x-hidden overflow-y-auto rounded-2xl outline-none [scrollbar-width:none]"
              style={{
                maxHeight: dockHeight(shape),
                maskImage:
                  more.above || more.below
                    ? `linear-gradient(to bottom, ${more.above ? 'transparent' : 'black'}, black 30px, black calc(100% - 30px), ${more.below ? 'transparent' : 'black'})`
                    : undefined,
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
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  // Up from the first agent goes back to the input, the way the list was entered.
                  const next = stepped(current, event.key, agents.length)
                  if (next === 'input') backToInput()
                  else if (next !== current) select(next, event.key === 'ArrowDown' ? 1 : -1)
                } else if (event.key === 'Enter') enter(current)
                else if (event.key === 'Escape') backToInput()
                else if (event.key === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) stop(agents[current]!)
                else if (event.key === 'i' && !event.metaKey && !event.ctrlKey && !event.altKey) agentControls.interrupt(agents[current]!.id)
                else return
                event.preventDefault()
              }}
            >
              {/* The whole list's height, with each piece at its own place in it, so rows out of view need not be drawn. */}
              <div className="relative" style={{ height: listHeight(shape) }}>
                <AnimatePresence initial={false} custom={present}>
                  {/* The agents that come and go start under their count, and under a line when durable hobkins sit above. */}
                  {heads.line === null ? null : <GroupLine key="line" still={still} top={heads.line} />}
                  {heads.head === null ? null : <OthersHead key="head:others" still={still} top={heads.head} count={othersCount(counts)} needYou={counts.needYou} />}
                  {rowsInView(shape, scrollTop, at).map((index) => {
                    const agent = agents[index]!
                    return (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        top={rowTop(shape, index)}
                        known={known}
                        selected={index === at}
                        still={still}
                        listId={id}
                        list={list}
                        openAgentCanvas={openAgentCanvas}
                        openTiers={openTiers}
                      />
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface AgentRowProps {
  agent: RunningAgent
  /** Where the row sits in the whole list, in pixels. */
  top: number
  /** The agents the list drew before this row was drawn. */
  known: RefObject<ReadonlySet<string>>
  selected: boolean
  still: boolean
  listId: string
  list: RefObject<HTMLDivElement | null>
  openAgentCanvas: (id: string) => void
  openTiers: (tier: Tier) => void
}

/**
 * One agent's row. It draws again only when its own agent, or whether it is selected, changes: every row with a
 * layout prop reads the page's layout for each draw, and the list draws for every agent's latest words.
 */
const AgentRow = memo(function AgentRow({ agent, top, known, selected, still, listId: id, list, openAgentCanvas, openTiers }: AgentRowProps) {
  const asks = agent.asks
  // A durable hobkin between turns, or a run waiting for its time: its face holds still and its label says it waits.
  const waits = atRest(agent)
  return (
    <motion.div
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      id={`${id}-${agent.id}`}
      role="option"
      aria-selected={selected}
      aria-label={asks ? `${agent.title}, waiting for you: ${asks}` : waits ? `${agent.title}, ${agent.waits ? agent.doing : 'waiting'}` : undefined}
      aria-describedby={`${id}-${agent.id}-children`}
      data-agent-row={agent.id}
      data-asking={asks ? true : undefined}
      // A new agent bubbles up from below and overshoots a little, like a bubble reaching the surface. One the list
      // drew before, scrolled into view, is simply there.
      initial={known.current.has(agent.id) ? false : holdStill({ opacity: 0, transform: 'translateY(34px) scale(0.5)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }, still)}
      // An agent that leaves shrinks away where it stood. A row only scrolled out of view goes at once.
      variants={{
        gone: (present?: ReadonlySet<string>) =>
          present?.has(agent.id) ? {} : holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.7)', transition: { duration: 0.18 } }, still),
      }}
      exit="gone"
      style={{ top }}
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
        'absolute inset-x-0 flex cursor-default items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-[160ms] ease-[ease]',
        selected ? 'bg-surface-2' : 'hover:bg-tone-1',
      )}
    >
      <span className="grid w-7 shrink-0 place-items-center">
        {/* A durable hobkin stays: its face sits in a faint ring, apart from the agents that come and go. */}
        <span className={cn('grid place-items-center rounded-full', agent.durable && 'size-7 ring-1 ring-border-strong/50')}>
          <AgentHood hue={agent.hue} size={agent.durable ? 22 : 24} mood={agent.mood} asking={Boolean(asks)} working={!waits} />
        </span>
      </span>
      {/* On Claude Code the crab pal stands still beside the face, drawn up close. A row on Pi keeps its layout. */}
      {agent.onClaudeCode ? <PalCrab className="-ml-2" size={agent.durable ? 22 : 24} mood={agent.mood} asking={Boolean(asks)} working={!waits} /> : null}
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
 * page's layout each time it draws, does not draw again for each of them. While the host sends its run's pulse, the
 * working line goes ahead of those words, and the whole of them opens on hover.
 */
const AgentWords = memo(function AgentWords({ agent }: { agent: RunningAgent }) {
  const update = useAgentWords(agent)
  const asks = agent.asks
  const waits = agent.durable?.state === 'waiting'
  const run = agent.durable ? agent.durable.run : agent.id
  return asks ? (
      <span className="block truncate text-[11px] text-muted-foreground">{asks}</span>
    ) : agent.waits ? (
      // A run waiting for its time: until when, then its note, in the same one line.
      <span className="block truncate text-[11px] text-muted-foreground">{waitingRowWords(agent, update)}</span>
    ) : waits ? (
      // Waiting for the next message, with what it said last. One the user has not looked at says so a little louder.
      <span className="block truncate text-[11px] text-muted-foreground">
        <span className={cn(agent.durable?.unseen && 'font-medium text-sun-fg')}>waiting</span>
        {' · '}
        {update ?? agent.project}
      </span>
    ) : (
      // Its project, the phase alone and its latest words, cut to one line. The time and the count are the hover's
      // (the user, 2026-11-24: "i dont need time and token count in these agents. can show when hovering"), with the
      // whole of its words, in the app's soft tooltip rather than the browser's plain one. Before it speaks, the plain
      // phase ("running the tests") stands in for its words.
      <Tooltip>
        <TooltipTrigger render={<span className="block truncate text-[11px] text-muted-foreground" />}>
          {agent.project} · <Pulse run={run} fallback={update ?? agent.doing} noticeFirst phaseOnly after={<> · {update ?? agent.doing}</>} />
        </TooltipTrigger>
        <TooltipContent side="right" align="center" sideOffset={10} className="max-w-xs text-left leading-snug whitespace-normal">
          <span className="block">
            <Pulse run={run} fallback={null} />
          </span>
          {update ?? agent.doing}
        </TooltipContent>
      </Tooltip>
    )
})

/** A group's small header in the list. It walks with its rows, and Up and Down pass it by. */
function GroupHead({ still, top, children }: { still: boolean; top: number; children: ReactNode }) {
  return (
    <motion.div
      aria-hidden="true"
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      initial={holdStill({ opacity: 0 }, still)}
      animate={holdStill({ opacity: 1 }, still)}
      exit={holdStill({ opacity: 0, transition: { duration: 0.18 } }, still)}
      style={{ top }}
      className="absolute inset-x-0 flex h-6 items-center gap-2 px-2"
    >
      {children}
    </motion.div>
  )
}

/** The thin line between the durable hobkins and the other agents. */
const GroupLine = memo(function GroupLine({ still, top }: { still: boolean; top: number }) {
  return (
    <motion.div
      aria-hidden="true"
      layout={still ? false : 'position'}
      transition={agentEntry(still)}
      initial={holdStill({ opacity: 0 }, still)}
      animate={holdStill({ opacity: 1 }, still)}
      exit={holdStill({ opacity: 0, transition: { duration: 0.18 } }, still)}
      style={{ top }}
      className="absolute inset-x-0 mx-2 my-1.5 h-px bg-border"
    />
  )
})

/**
 * The header over the agents that come and go: how many work, how many wait for their time when some do, and how many
 * need the user. Draws again only for those.
 */
const OthersHead = memo(function OthersHead({ still, top, count, needYou }: { still: boolean; top: number; count: string; needYou: number }) {
  return (
    <GroupHead still={still} top={top}>
      <span className="eyebrow">{count}</span>
      {needYou ? (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-sun-fg">
          <span aria-hidden="true">·</span>
          {needYou === 1 ? '1 needs you' : `${needYou} need you`}
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
