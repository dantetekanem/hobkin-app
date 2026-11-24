import { ArrowDown, ArrowUp } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { agentControls, answerAgent, questionOf, runningAgents, useAgent, useAgentControl, type RunningAgent } from '@/app/running-agents.ts'
import { holdStill, stillVariants, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { Pals } from '@/avatar/Pals.tsx'
import { FilePath } from '@/components/FilePath.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { exchangeOf, pauseOf, type Doing, type ExchangeItem } from '@/features/agent-activity/steps.ts'
import { Arrivals, useArrival } from '@/features/agent-activity/arrive.ts'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { earlierRow, useNewest } from '@/features/agent-activity/newest.ts'
import { mayHaveOlder, useOlderSteps } from '@/features/agent-activity/older-steps.ts'
import { useReadingPlace } from '@/features/agent-activity/reading-place.ts'
import { EarlierSteps, StepItem, StepJob } from '@/features/agent-activity/StepView.tsx'
import { AgentTaskList } from '@/features/agent-activity/TaskList.tsx'
import { lastStepTime, useActivityPresence, useAgentActivity, useAgentGlance, type AgentActivity } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { AttachmentTray, SentImages } from '@/features/chat/AttachmentTray.tsx'
import { releaseImages } from '@/features/chat/image-uploads.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { Pulse } from '@/features/pulse/Pulse.tsx'
import { PAGE_ROOM, ScheduleLine } from '@/features/schedules/ScheduleLine.tsx'
import { TeamsStrip } from '@/features/teams/TeamsStrip.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { agentsFrom, sameFields } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost, useHostEqual } from '@/lib/host/index.ts'
import { useAgentThreads, type AgentNote } from './agent-threads.ts'
import { AgentWaits } from './AgentWaits.tsx'
import { ChildCluster, ChildHood } from './ChildAgents.tsx'
import { childHue, childLine, childrenSummary, describeChild, satellitesOf } from './child-summary.ts'
import { useRunChildren } from './children.ts'
import { changeLine } from '@/features/chat/change-line.ts'
import { sendChange } from '@/features/chat/send-change.ts'
import { sayToAgent } from './say.ts'
import { useAgentImages } from './agent-images.ts'
import { useAgentImageInput } from './use-agent-image-input.ts'
import { agentEntry, agentReading, keepsPreview } from './agent-entry.ts'
import { executionKey, executionTargets } from './actions.ts'
import { useExecution } from './store.ts'

/** Where the small screen's header starts, below the menu and its second row. */
const HEADER_TOP = 152
/** The header shrinks into a bar at the top while there is an exchange to read. */
const FULL = 'translateY(0px) scale(1)'
const COMPACT = 'translateY(-36px) scale(0.56)'
/** Where the agent's helpers sit, under the shrunken header. */
const HELPERS_TOP = 214
/** Where the exchange starts, below the shrunken header and the helpers. */
const EXCHANGE_TOP = 252

/**
 * One agent's canvas. This file is the entry the frame mounts. Specs: 011-work, 021-agent-rendering.
 *
 * Every entry route draws existing activity immediately, already anchored to its newest step, which rests just above
 * the input. An empty agent shows its face and current task. The input to talk to the agent is always at the bottom.
 * Only transforms and opacity move, and steps out of view are not drawn.
 */
export function AgentScreen() {
  // A screen on its way out keeps showing its own agent while the next one arrives.
  const present = useIsPresent()
  const openAgent = useView((view) => view.openAgent)
  const kept = useRef(openAgent)
  if (present) kept.current = openAgent
  const agentId = kept.current
  const side = useSide(agentId)
  const running = useAgent(agentId)
  const agent = useLastSeen(agentId, running)
  // With a host an agent leaves the running list when its run ends. Its canvas stays readable (011 A3).
  const finished = agent !== undefined && running === undefined
  const question = questionOf(agentId)
  const waiting = Boolean(running?.asks)
  // Only whether there are steps: each part below reads what it shows of them itself, so a step draws only those parts.
  const presence = useActivityPresence(agentId)
  const notes = useAgentThreads((threads) => (agentId ? threads.notes[agentId] : undefined))
  const still = useStill()
  const reading = agentReading(Boolean(agent && agentId), presence === 'some' || Boolean(notes?.length) || Boolean(question))
  // The canvas supplies the entry movement; snapshot content never waits for a second entrance.
  const Lift = Plain

  return (
    // A click inside a canvas previewed from the agents list keeps it open: the list losing the keyboard ends a preview.
    <div className="relative h-full overflow-hidden" onKeyDown={upToAgents} onPointerDownCapture={() => present && agentId && keepPreview(agentId)}>
      {/* Moving to another agent changes the agent's own pieces in place. The controls stay where they are. */}
      <AnimatePresence initial={false} custom={side}>
        <AgentPart key={agentId} className="absolute inset-x-0 top-0">
          <motion.div
            className="absolute inset-x-[10%] flex origin-top flex-col items-center gap-4 text-center"
            style={{ top: HEADER_TOP }}
            initial={false}
            animate={{ transform: reading ? COMPACT : FULL }}
            transition={agentEntry(still)}
          >
            {agent ? (
              <Passing side={side}>
                {/* A run on Claude Code has the crab pal beside its face. A finished run's record says how it ended. */}
                {agent.onClaudeCode ? (
                  <Pals id={agent.id} hue={agent.hue} size={120} mood={finished ? 'idle' : agent.mood} asking={waiting} working={!finished} endedWell={finished && agent.doing === 'completed'} />
                ) : (
                  <AgentHood hue={agent.hue} size={120} mood={finished ? 'idle' : agent.mood} asking={waiting} working={!finished} />
                )}
              </Passing>
            ) : null}
            <Lift>
              <p className="font-heading text-[22px] font-semibold tracking-[-0.022em]">{agent ? agent.title : 'This agent has finished'}</p>
            </Lift>
            {/* The rest of the small screen gives way to the exchange while it is read. */}
            <motion.div
              className={cn('flex w-full flex-col items-center gap-4', reading && 'pointer-events-none')}
              initial={false}
              animate={{ opacity: reading ? 0 : 1 }}
              transition={agentEntry(still)}
            >
              <Overview agentId={agentId} agent={agent} finished={finished} waiting={waiting} question={question} held={presence !== 'none'} hidden={reading} />
            </motion.div>
          </motion.div>
          {/* Drawn with the screen, the helpers and the exchange are simply there. Arriving later, they rise in. */}
          <AnimatePresence initial={false}>
            {reading && agent && agentId ? (
              <motion.div
                key="helpers"
                // In a row of their own, so helpers and tasks arriving never move the exchange below.
                className="absolute inset-x-[10%] flex justify-center gap-3"
                style={{ top: HELPERS_TOP }}
                initial={holdStill({ opacity: 0 }, still)}
                animate={holdStill({ opacity: 1, transition: agentEntry(still) }, still)}
                exit={holdStill({ opacity: 0, transition: tween.exit }, still)}
              >
                <HelpersStrip runId={agentId} hue={agent.hue} />
                {/* The agents its own Pi started with pi-extended-teams: shown, never controlled (046-teams-layer). A spawn
                    call is a step, so a run that has any is always read here. */}
                <TeamsStrip runs={[agentId]} hue={agent.hue} runName={agent.title} variant="line" />
                <AgentTaskList agentId={agentId} hue={agent.hue} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </AgentPart>
      </AnimatePresence>
      <AgentStopControl key={agentId} agentId={agentId} forceKey />
      {/* The exchange fills the room between the shrunken header and the input, which is always there under it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col" style={{ top: EXCHANGE_TOP }}>
        <div className="relative min-h-0 flex-1">
          <AnimatePresence initial={false}>
            <AgentPart key={agentId} className="absolute inset-0 flex flex-col">
              <AnimatePresence initial={false}>
                {reading && agent && agentId ? <Exchange key={agentId} agentId={agentId} hue={agent.hue} question={question} waiting={waiting} /> : null}
              </AnimatePresence>
            </AgentPart>
          </AnimatePresence>
        </div>
        {agent && agentId ? (
          <TalkInput key={agentId} agentId={agentId} name={agent.title} hue={agent.hue} mood={agent.mood} answering={waiting} finished={finished} />
        ) : null}
      </div>
    </div>
  )
}

const Plain = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>

/** An agent previewed from the list stays open, as one chosen in the menu does, so the list's blur does not end it. */
function keepPreview(agentId: string) {
  const view = useView.getState()
  if (keepsPreview(view, agentId)) view.openAgentCanvas(agentId)
}

/** Which way the user moved: 1 to an agent later in the list, -1 to one before it. */
type Side = 1 | -1

/**
 * Which side the agent now shown comes in from. The agents keep the list's order, left to right in the menu, so one
 * later in the list comes in from the right and one before it from the left. With the last one gone from the list,
 * it goes the way the canvas was asked to move.
 */
function useSide(agentId: string | null): Side {
  const asked = useView((view) => view.screenMotion.direction)
  const last = useRef<{ agentId: string | null; side: Side }>({ agentId, side: asked })
  if (last.current.agentId !== agentId) {
    // The list is read as it is when the agent changes: its steps arriving do not draw the screen again.
    const agents = runningAgents()
    const from = agents.findIndex((agent) => agent.id === last.current.agentId)
    const to = agents.findIndex((agent) => agent.id === agentId)
    last.current = { agentId, side: from === -1 || to === -1 ? asked : to > from ? 1 : -1 }
  }
  return last.current.side
}

/**
 * One agent's own pieces: its face, its name and its work. Moving to another agent, the next agent's pieces fade in
 * over these as these fade out, and the pieces leaving take no keyboard and no pointer. The controls around them stay
 * where they are and act on the agent now shown.
 */
function AgentPart({ className, children }: { className: string; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      className={className}
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
    >
      {children}
    </motion.div>
  )
}

/** How far a hobkin passes sideways, in percent of its own width: a little more than its width, so the two never overlap. */
const PASS = 120

/**
 * Moving to another agent, its hobkin comes in from the side and the last one leaves the other way, on the spring the
 * menu's marker rides to the same agent: from the right for an agent later in the list, from the left for one before
 * it. Under Still nothing travels, and only the fade around it plays.
 */
const passing = {
  enter: (side: Side) => ({ transform: `translateX(${side * PASS}%)` }),
  center: { transform: 'translateX(0%)' },
  exit: (side: Side) => ({ transform: `translateX(${-side * PASS}%)` }),
}

function Passing({ side, children }: { side: Side; children: ReactNode }) {
  const still = useStill()
  return (
    <motion.div custom={side} variants={stillVariants(passing, still)} initial="enter" animate="center" exit="exit" transition={agentEntry(still)}>
      {children}
    </motion.div>
  )
}

/**
 * Stop Agent and Force Stop, each asking first. `forceKey`: Control+X presses Force Stop on this page (`force-stop.ts`), so
 * the control shows it. Not on a durable hobkin's page, where the key is End.
 */
export function AgentStopControl({ agentId, forceKey = false }: { agentId: string | null; forceKey?: boolean }) {
  const { target, result } = useAgentControl()
  // Only this run's control: the host's other messages do not draw the buttons again.
  const control = useHostEqual((state) => executionTargets(state).find(row => row.kind === 'run' && row.runId === agentId), sameFields)
  const execution = useExecution()
  const pending = (mode: 'stop' | 'force') => agentControls.pending(agentId, mode) || (control !== undefined && execution.pending[executionKey(control, mode)] === true)
  const executionResult = Object.values(execution.results).find(result => result.receipt?.target.kind === 'run' && result.receipt.target.runId === agentId)
  const busy = pending(target?.mode ?? 'stop')
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const cancel = () => {
    if (busy) return
    dialog.current?.close()
    agentControls.cancel()
    opener.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!target || target.id !== agentId) return
    const element = dialog.current
    const section = element?.closest<HTMLElement>('[data-canvas-screen]')
    if (section?.dataset.canvasScreen !== element?.closest<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      const view = useView.getState()
      if (view.screen === 'agent' && view.openAgent === agentId && element?.contains(document.activeElement)) opener.current?.focus({ preventScroll: true })
      if (useAgentControl.getState().target === target) agentControls.cancel()
    }
  }, [target, agentId])
  return (
    <div className="absolute right-6 top-6 z-10 text-sm">
      <button
        type="button"
        disabled={!control?.canStop || pending('stop')}
        onClick={() => agentId && agentControls.request(agentId)}
        className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
      >
        Stop Agent
      </button>
      <button
        type="button"
        disabled={!control?.canForce || pending('force')}
        onClick={() => agentId && agentControls.request(agentId, 'force')}
        className="ml-2 rounded-lg border border-border px-3 py-1.5 disabled:opacity-40"
      >
        Force Stop
        {forceKey ? <Kbd className="ml-1.5">⌃X</Kbd> : null}
      </button>
      {executionResult || result?.id === agentId ? (
        <p role="status" className="mt-2 max-w-72 text-muted-foreground">
          {executionResult?.text ?? result?.text}
        </p>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="agent-stop-title"
        aria-describedby="agent-stop-description"
        onCancel={(event) => {
          event.preventDefault()
          cancel()
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className="m-auto max-w-md rounded-2xl border border-border bg-background p-6 text-foreground backdrop:bg-black/40"
      >
        <h2 id="agent-stop-title" className="text-lg font-semibold">
          {target?.mode === 'force' ? 'Force Stop' : 'Stop'} this run?
        </h2>
        <p id="agent-stop-description" className="my-4">
          {target?.title} · {target?.project}. Cancellation and captured closure are reported separately. Detached cleanup remains unknown.
        </p>
        <div className="flex justify-end gap-4">
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !(target?.mode === 'force' ? control?.canForce : control?.canStop) || target?.id !== agentId}
            onClick={() => void agentControls.confirm()}
          >
            {target?.mode === 'force' ? 'Confirm Force Stop' : 'Stop run'}
            {forceKey && target?.mode === 'force' ? <Kbd className="ml-1.5">⌃X</Kbd> : null}
          </button>
        </div>
      </dialog>
    </div>
  )
}

/** Keep the canvas readable after completion, including when it mounts from a reconnected snapshot. */
function useLastSeen(agentId: string | null, running: RunningAgent | undefined): RunningAgent | undefined {
  const run = useHost((state) => state.snapshot.runs?.find(({ id }) => id === agentId))
  const recorded = useMemo(() => (run ? agentsFrom({ runs: [run] }, { includeEnded: true })[0] : undefined), [run])
  const current = running ?? recorded
  const seen = useRef<RunningAgent | undefined>(undefined)
  if (current) seen.current = current
  else if (seen.current?.id !== agentId) seen.current = undefined
  return current ?? seen.current
}

interface OverviewProps {
  agentId: string | null
  agent: RunningAgent | undefined
  finished: boolean
  waiting: boolean
  question?: string
  /** The agent has activity, even with no step in it yet. */
  held: boolean
  /** It gives way to the exchange while that is read, and draws nothing new until it is back in sight. */
  hidden: boolean
}

/** Hidden before and still hidden: nothing it would draw could be seen, so it keeps what it drew. */
const stillHidden = (before: OverviewProps, after: OverviewProps) => before.hidden && after.hidden

/** The rest of the small screen, under the face and the name: where the agent works, the glance at it and its helpers. */
const Overview = memo(function Overview({ agentId, agent, finished, waiting, question, held, hidden }: OverviewProps) {
  return (
    <>
      {agent ? (
        <Plain>
          <p className="text-[15px] text-muted-foreground">
            {agent.project} · {finished ? 'finished' : waiting ? 'waiting for you' : agent.doing} · {agent.tier}
          </p>
        </Plain>
      ) : null}
      {agentId && (agent || held) ? (
        <Plain className="w-full">
          <Glance agentId={agentId} hue={agent?.hue ?? 0} question={question} waiting={waiting} hidden={hidden} />
        </Plain>
      ) : null}
      {agentId && agent ? (
        <Plain className="w-full">
          <HelpersGlance runId={agentId} hue={agent.hue} />
        </Plain>
      ) : null}
    </>
  )
}, stillHidden)

/**
 * The bottom of the small screen: the agent's question, or what it is doing this moment and how many steps it
 * has taken, or the last thing said to it. Never more, so walking the agents list stays light.
 */
const Glance = memo(function Glance({ agentId, hue, question, waiting, hidden }: { agentId: string; hue: number; question?: string; waiting: boolean; hidden: boolean }) {
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const last = notes?.at(-1)
  // Hidden behind the steps while they are read, it keeps what it showed and draws nothing new until it is in sight.
  const { steps, doing } = useAgentGlance(agentId, hidden)

  if (waiting && question) {
    return (
      <div className="flex w-full flex-col gap-2">
        <QuestionBubble hue={hue} question={question} waiting />
        <p className="flex h-6 items-center gap-1.5 self-start pl-8 text-[12px] text-muted-foreground">
          Answer with <Kbd>⌘G</Kbd> or Enter on it in the list.
        </p>
      </div>
    )
  }
  if (steps && doing) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <NowLine doing={doing} />
        <p className="text-[12px] text-muted-foreground tabular-nums">
          {steps === 1 ? '1 step' : `${steps} steps`}
          {notes?.length ? ` · ${notes.length === 1 ? '1 message' : `${notes.length} messages`}` : ''}
        </p>
      </div>
    )
  }
  if (last) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <p className="line-clamp-2 max-w-[72%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] leading-relaxed">{last.text}</p>
        <p className="text-[12px] text-muted-foreground">{notes!.length === 1 ? '1 message' : `${notes!.length} messages`}</p>
      </div>
    )
  }
  return <p className="text-[15px] text-muted-foreground">No steps yet. They draw here as it works.</p>
})

/**
 * What the agent is doing this moment, in one or two lines: the tool it runs or just ran, or the last thing it
 * said. A new step takes the place of the last one by rising into it. Words arriving in the same sentence do not move it.
 * The leaving line and the new one share the grid's one cell, so the swap adds no style sheet to the page (popLayout does).
 */
function NowLine({ doing }: { doing: Doing }) {
  const still = useStill()
  const key = doing.subject === undefined ? 'says' : `${doing.lead}:${doing.subject}`
  return (
    <div className="relative grid min-h-[3.4em] w-full max-w-[72%] place-items-center">
      <AnimatePresence initial={false}>
        <motion.p
          key={key}
          initial={holdStill({ opacity: 0, transform: 'translateY(14px)' }, still)}
          animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: tween.enter } }, still)}
          exit={holdStill({ opacity: 0, transform: 'translateY(-10px)', transition: tween.exit }, still)}
          className={cn('col-start-1 row-start-1 line-clamp-2 text-[15px] leading-relaxed', doing.failed && 'text-bad-fg')}
        >
          {doing.lead}
          {doing.subject ? (
            <>
              {' '}
              {doing.path ? (
                // A path wider than the line loses its first folders, never its file's name.
                <span className="inline-flex max-w-full align-bottom">
                  <FilePath path={doing.subject} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.87em]" />
                </span>
              ) : doing.code ? (
                <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.87em] break-all">{doing.subject}</code>
              ) : (
                doing.subject
              )}
            </>
          ) : null}
          {doing.note ? <span className="text-muted-foreground"> · {doing.note}</span> : null}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

function QuestionBubble({ hue, question, waiting }: { hue: number; question: string; waiting: boolean }) {
  return (
    <div className="flex max-w-[72%] items-end gap-2 self-start text-left">
      <span className="mb-0.5 shrink-0">
        <AgentHood hue={hue} size={22} mood="confused" working={waiting} />
      </span>
      <span className="rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2 text-[15px] leading-relaxed">{question}</span>
    </div>
  )
}

/** How many helpers the small screen names. More are counted, so it stays a line or two however many there are. */
const GLANCE_HELPERS = 4

/**
 * The helpers the agent spawned through pi-extended-teams, each with how it stood when the run last checked. They run
 * inside the agent's own Pi, so hobkin has no steps of theirs, and they cannot be opened, stopped or messaged.
 */
function HelpersGlance({ runId, hue }: { runId: string; hue: number }) {
  const children = useRunChildren(runId)
  if (children.length === 0) return null
  const { shown, more } = satellitesOf(children, GLANCE_HELPERS)
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[12px] text-muted-foreground">{childrenSummary(children)}</p>
      <ul className="flex max-w-[72%] flex-wrap justify-center gap-1.5 text-[12px]">
        {shown.map((child) => (
          <li key={child.name} title={describeChild(child)} aria-label={describeChild(child)} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pr-2.5 pl-1.5">
            <ChildHood child={child} hue={childHue(hue, children.indexOf(child))} size={14} />
            <span className="font-medium">{child.name}</span>
            <span className="text-muted-foreground">{childLine(child)}</span>
          </li>
        ))}
        {more ? <li className="py-1 text-muted-foreground">+{more} more</li> : null}
      </ul>
    </div>
  )
}

/** While the run is read, its helpers sit under the shrunken header: their small faces, each with its story on hover, and the count. */
function HelpersStrip({ runId, hue }: { runId: string; hue: number }) {
  const children = useRunChildren(runId)
  const id = useId()
  if (children.length === 0) return null
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
      <ChildCluster runId={runId} hue={hue} summaryId={id} />
      <span className="truncate" title={childrenSummary(children)}>
        {childrenSummary(children)}
      </span>
    </div>
  )
}

/** The steps and messages of the exchange, top to bottom, for the keyboard. */
const walkable = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(':scope > [data-step]')]
/** A screen on its way out keeps its own input and exchange: each is found from within its own screen. */
const screenOf = (element: Element) => element.closest('[data-canvas-screen]')
const focusTalkInput = (from: Element) => screenOf(from)?.querySelector<HTMLTextAreaElement>('[data-agent-input]')?.focus({ preventScroll: true })

/** Moves the keyboard from the input up onto the newest step. False when there is nothing to walk. */
function focusNewestStep(input: Element): boolean {
  const list = screenOf(input)?.querySelector<HTMLElement>('[data-agent-exchange]')
  const newest = list ? walkable(list).at(-1) : undefined
  newest?.focus()
  return Boolean(newest)
}

/**
 * Up on the agent screen is navigation, never a jump into the input: Up and Down walk the steps and, past them, the agents.
 *  - On the canvas (focus on the screen itself, not a step or control): Up moves to the agents list, this agent's row.
 *  - In the steps: Up walks to the previous step; from the first step it spills to the agents list.
 *  - In an empty input: Up walks the steps, newest first; with no steps it goes to the agents list.
 *  - In the agents list (AgentsDock): Up walks to the previous agent, and from the first agent to the main chat input.
 * The input is reached by Down from the newest step, or Escape — not by Up.
 */
export function upToAgents(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowUp' || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
  const target = event.target as HTMLElement
  if (target.closest('[data-step], input, textarea, select, button, a, dialog, [contenteditable="true"], [role="dialog"]')) return
  // Not into the input: Up leaves the canvas for the agents list, where Up and Down then walk between agents.
  if (focusAgentsDock()) event.preventDefault()
}

/**
 * The exchange's keys (021 A9): Up and Down move between steps, Right or Enter opens a group or a change, Left
 * closes it, Home and End go to the first and the newest, and Down from the newest or Escape goes back to the input.
 */
export function walkSteps(event: KeyboardEvent<HTMLOListElement>) {
  const items = walkable(event.currentTarget)
  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-step]')
  const at = current ? items.indexOf(current) : -1
  if (!current || at === -1) return
  // Inside a step, its own controls keep their keys. Escape still leads back.
  if (event.target !== current && event.key !== 'Escape') return
  const toggle = (expanded: boolean) => current.querySelector<HTMLElement>(`[data-step-toggle][aria-expanded="${expanded}"]`)
  if (event.key === 'ArrowUp') {
    // Up from the first step spills to the agents list, on this agent. Without a list it stays.
    if (at > 0) items[at - 1]!.focus()
    else focusAgentsDock()
  }
  else if (event.key === 'ArrowDown') {
    if (at < items.length - 1) items[at + 1]!.focus()
    else focusTalkInput(current)
  } else if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items.at(-1)?.focus()
  else if (event.key === 'ArrowRight' || event.key === 'Enter') toggle(false)?.click()
  else if (event.key === 'ArrowLeft') toggle(true)?.click()
  else if (event.key === 'Escape') focusTalkInput(current)
  else return
  event.preventDefault()
}

/**
 * The whole exchange, drawn while it is read: the agent's steps with the user's messages where they were sent, each
 * with when it happened in a column at its left. It fills the room between the shrunken header and the input, opens at
 * its newest step, just above the input, and stays there as steps arrive, unless the user has scrolled up to read, and
 * then offers the way back down. A long run draws only its newest steps, with a row above them that draws more, and each
 * step drawn paints only while it is in view. It reads the agent's activity itself, so a step draws the exchange alone.
 */
const Exchange = memo(ExchangeSteps)

function ExchangeSteps({ agentId, hue, question, waiting }: { agentId: string; hue: number; question?: string; waiting: boolean }) {
  const activity = useAgentActivity(agentId)
  const still = useStill()
  const live = useHasHost()
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const scroll = useFollow()
  // The run's feed keeps its newest steps. The ones it let go are read from the run's saved session, a page at a time,
  // and come before them.
  const job = live && activity && !activity.sample ? agentId : null
  const older = useOlderSteps(job)
  const entries = useMemo(() => (activity && older.steps.length ? [...older.steps, ...activity.entries] : activity?.entries), [activity, older.steps])
  const items = useMemo<ExchangeItem[]>(
    () =>
      activity && entries
        ? // The tasks line above the exchange is where task calls show.
          exchangeOf(entries, notes ?? [], { seenAt: (id) => activity.timeOf(id)?.seen, ended: activity.ended, cwd: activity.cwd, tasksOnLine: true })
        : (notes ?? []).map((note) => ({ kind: 'note', key: `note:${note.id}`, note })),
    [activity, entries, notes],
  )
  // A long run draws only its newest steps, with a row above them for the ones before (newest.ts). Once every step held
  // is drawn, the row reads older ones, and the step being read stays where it was when they come.
  const newest = useNewest(agentId, items)
  const earlier = earlierRow(newest.earlier, { more: older.more, loading: older.loading, mayHaveOlder: job !== null && mayHaveOlder(activity?.entries) })
  const holdPlace = useReadingPlace(scroll.scroller, older.steps)
  const showEarlier = () => {
    if (earlier?.kind === 'held') return newest.more()
    holdPlace()
    newest.toCome()
    older.loadMore()
  }
  const thinking = activity !== null && !waiting && pauseOf(activity.entries, { ended: activity.ended }) === 'thinking'

  return (
    <motion.div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      // Steps scrolled up under the helpers fade out rather than being cut.
      className="scroll-quiet pointer-events-auto relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[10%] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
      initial={holdStill({ opacity: 0, transform: 'translateY(24px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: agentEntry(still) }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(16px)', transition: { duration: 0.16, ease: 'linear' } } as const, still)}
    >
      <ol ref={scroll.content} data-agent-exchange onKeyDown={walkSteps} aria-label="What the agent has done" className="mt-auto flex flex-col gap-3 pt-2 pb-3">
        {question ? (
          <li data-step="question" tabIndex={-1} className="flex flex-col gap-2 rounded-[18px] outline-none [contain-intrinsic-size:auto_64px] [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
            <QuestionBubble hue={hue} question={question} waiting={waiting} />
            <p className="flex h-6 items-center self-start pl-8 text-[12px] text-muted-foreground">{waiting ? 'Your answer goes in the box below.' : 'Answered.'}</p>
          </li>
        ) : null}
        {earlier ? <EarlierSteps row={earlier} onMore={showEarlier} /> : null}
        <ShowStamps>
          {/* The steps drawn with the page are simply there. Later ones arrive, and nothing leaves with a motion. */}
          <Arrivals>
            <StepJob.Provider value={job}>
              {newest.shown.map((item) => (item.kind === 'note' ? <Said key={item.key} note={item.note} /> : <StepItem key={item.key} step={item} timeOf={activity!.timeOf} ended={activity!.ended} />))}
            </StepJob.Provider>
            {/* It goes in the same moment the next step arrives. */}
            {thinking ? <Thinking key="thinking" activity={activity} run={agentId} /> : <AgentWaits key="waits" agentId={agentId} />}
          </Arrivals>
        </ShowStamps>
        {activity?.sample ? (
          <li className="self-center text-[12px] text-muted-foreground">Sample activity. With a host this is the agent's own work, as it happens.</li>
        ) : !live && notes?.length ? (
          <li className="self-end text-[12px] text-muted-foreground">Sample data. The host will deliver these to the agent as it works.</li>
        ) : null}
      </ol>
      {/* Stays just above the input while the user reads further up, and takes them back to the newest step. */}
      <div className="pointer-events-none sticky bottom-3 z-10 flex h-0 justify-center">
        <AnimatePresence>
          {scroll.pinned ? null : (
            <motion.button
              type="button"
              onClick={scroll.jumpToLatest}
              initial={holdStill({ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(10px) scale(0.96)', transition: tween.exit }, still)}
              className="pointer-events-auto absolute bottom-0 flex h-8 items-center gap-1.5 rounded-full border border-border bg-card pr-1.5 pl-3 text-[12px] font-medium shadow-panel transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              Newest message
              <Kbd>End</Kbd>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/**
 * Between steps the agent is thinking. hobkin keeps none of its thinking, so the canvas only says so, and for how
 * long, counted from its last step (021 A6). While the host sends the run's pulse, its working line says it instead.
 */
function Thinking({ activity, run }: { activity: AgentActivity | null; run: string }) {
  const arrival = useArrival()
  // Worked out again only when the steps change, not when the run ends or the clock ticks.
  const entries = activity?.entries
  const timeOf = activity?.timeOf
  const since = useMemo(() => (entries && timeOf ? lastStepTime(entries, timeOf) : undefined), [entries, timeOf])
  const now = useNow(since !== undefined, 1000)
  const seconds = since === undefined ? 0 : Math.max(0, Math.round((now - since) / 1000))
  return (
    // It waits a moment before it shows, so a quick step after the last one does not flash it.
    <li data-arrive="late" className={cn('pl-2.5 text-[13px] text-muted-foreground tabular-nums', arrival)}>
      {/* It is now, so its place in the times' column is empty. */}
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="aa-running size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <Pulse
            run={run}
            fallback={<>Thinking{seconds >= 2 ? ` · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`}` : ''}</>}
            className="min-w-0 truncate"
          />
        </span>
      </Stamped>
    </li>
  )
}

/** What the user said to the agent, on their side, timed by when they pressed Enter. The bubble takes the keyboard's ring. */
function Said({ note }: { note: AgentNote }) {
  const arrival = useArrival()
  return (
    <li data-step="note" tabIndex={-1} className={cn('group w-full min-w-0 px-2.5 outline-none [contain-intrinsic-size:auto_48px] [content-visibility:auto]', arrival)}>
      <Stamped at={note.at} line="bubble">
        <div className="ml-auto w-fit max-w-[72%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-left text-[15px] leading-relaxed whitespace-pre-wrap group-focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
          {note.images ? <SentImages attachments={note.images} /> : null}
          {note.text}
          {note.delivery ? (
            <p role="status" className={cn('mt-1 text-[11px] leading-normal', note.delivery === 'refused' || note.delivery === 'unconfirmed' ? 'text-bad-fg' : 'text-muted-foreground')}>
              {note.delivery === 'sending' ? 'Sending · waiting for the host.'
                : note.delivery === 'received' ? 'Received · admitted into a Pi turn.'
                : note.delivery === 'waiting' ? 'Waiting · queued for the agent’s next step; receipt not yet confirmed.'
                  : note.delivery === 'refused' ? `Not sent · ${note.why}`
                    : note.delivery === 'unconfirmed' ? `Delivery not confirmed · ${note.why}`
                      : 'Sample message · kept in this window only.'}
            </p>
          ) : null}
        </div>
      </Stamped>
    </li>
  )
}

/**
 * The input for talking to one agent, always at the bottom of its canvas. It takes the keyboard when the user clicks
 * it or presses Enter on the agent in the list, never on its own, so walking the list keeps the keyboard there.
 * Images pasted or dropped on it go with the words, as in the main input. It draws again only when what it shows changes.
 */
const TalkInput = memo(TalkBox)

function TalkBox({ agentId, name, hue, mood, answering, finished }: { agentId: string; name: string; hue: number; mood: Mood; answering: boolean; finished: boolean }) {
  const sendNote = useAgentThreads((threads) => threads.send)
  const live = useHasHost()
  const images = useAgentImageInput(agentId, !finished)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  /** What a /model or /effort line did, under the box. */
  const [said, setSaid] = useState<string | null>(null)
  const canSend = (draft.trim().length > 0 || images.attachments.length > 0) && images.ready && !finished

  const send = async () => {
    if (!canSend) return
    const text = draft.trim()
    setProblem(null)
    setSaid(null)
    useAgentImages.getState().clearProblem(agentId)
    // A /model or /effort line changes how the agent works instead of being sent to it.
    const change = changeLine(text)
    if (change) {
      if ('problem' in change) return setProblem(change.problem)
      setDraft('')
      const done = await sendChange({ agent: agentId }, change, { live, run: (name, args) => runCommand(name, args as never) })
      if (done.ok) setSaid(done.message)
      else {
        setProblem(done.why)
        setDraft((now) => now || text)
      }
      return
    }
    // Record before awaiting: changing canvases must not hide a pending message or lose a refusal. The images go
    // with the words, and the note keeps them to show.
    setDraft('')
    const attached = useAgentImages.getState().take(agentId)
    const handles = attached.flatMap(({ handle }) => (handle ? [handle] : []))
    const result = await sendNote(agentId, text, (noteId) => sayToAgent(agentId, text, { live, noteId, images: handles }), attached)
    if (!result.sent) {
      // hobkin lets go of images that did not reach the agent. The note still shows them.
      releaseImages(attached)
      setProblem(result.why)
      return
    }
    // The sample question is local; real questions remain owned by the host.
    if (answering && !live) answerAgent(agentId)
  }

  const label = finished ? `${name} has finished` : answering ? `Answer ${name}` : `Message ${name}`

  return (
    <div className="pointer-events-auto mt-auto shrink-0 px-[10%] pt-2 pb-2">
      <form
        className={cn(
          'rounded-[26px] border-[1.5px] bg-background py-2 pr-2 pl-3 shadow-panel transition-colors duration-[160ms] ease-[ease] focus-within:border-ring',
          images.dropping ? 'border-ring' : 'border-input',
        )}
        {...images.dropTarget}
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <AttachmentTray attachments={images.attachments} onRemove={images.remove} />
        <div className="flex items-end gap-2">
          <span className="grid size-9 shrink-0 place-items-center">
            <AgentHood hue={hue} size={26} mood={finished ? 'idle' : answering ? 'listening' : mood} working={!finished} />
          </span>
          <textarea
            // macOS would offer its own corrections in a bubble over the field; the user writes as they mean.
            autoCorrect="off"
            autoCapitalize="off"
            data-agent-input
            value={draft}
            readOnly={finished}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={images.onPaste}
            onKeyDown={(event) => {
              if (images.removeLast(event)) return
              if (event.key === 'Escape') {
                // Back onto the same agent in the list. One the list no longer holds leaves the key to the frame,
                // which leaves the canvas.
                if (!finished && focusAgentsDock()) event.preventDefault()
              } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              } else if (event.key === 'ArrowUp' && !draft && !event.defaultPrevented) {
                // Up from an empty input walks the agent's steps, newest first, or else goes to the agents list.
                if (focusNewestStep(event.currentTarget) || (!finished && focusAgentsDock())) event.preventDefault()
              }
            }}
            rows={1}
            placeholder={images.dropping ? 'Drop the image to attach it' : label}
            aria-label={label}
            className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label={answering ? 'Send the answer' : 'Send to this agent'}
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground',
              'transition-[transform,opacity] duration-[140ms] ease-out active:scale-[0.97] disabled:opacity-40',
            )}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </div>
      </form>
      {/* Always there, so the box does not move when words or a schedule come and go: the words at the left, the
          agent's own schedules at the right (056), whose list rises from this row. */}
      <div className="relative mt-1 flex min-h-6 items-start gap-3 px-3">
        <div className="min-w-0 flex-1 py-1 text-[11px] leading-4">
          {problem || images.problem ? (
            <p role="alert" className="text-bad-fg">
              {problem ?? images.problem}
            </p>
          ) : said ? (
            <p role="status" className="text-muted-foreground">
              {said}
            </p>
          ) : finished ? (
            // Only what the user cannot tell by looking: the keys are in the key list, not under every input.
            <p className="text-muted-foreground">It has finished, so nothing more reaches it.</p>
          ) : null}
        </div>
        <ScheduleLine place={{ kind: 'run', id: agentId }} style={{ width: PAGE_ROOM }} />
      </div>
    </div>
  )
}
