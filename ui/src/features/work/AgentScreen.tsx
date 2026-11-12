import { ArrowDown, ArrowUp } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { agentControls, answerAgent, questionOf, useAgent, useAgentControl, useRunningAgents, type RunningAgent } from '@/app/running-agents.ts'
import { holdStill, stillVariants, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { ActivityModeSwitch } from '@/features/agent-activity/ActivityModeSwitch.tsx'
import { callsOf, type CallRow } from '@/features/agent-activity/calls.ts'
import { CallItem } from '@/features/agent-activity/CodeMode.tsx'
import { doingNow, exchangeOf, pauseOf, stepCount, type Doing, type ExchangeItem } from '@/features/agent-activity/steps.ts'
import { StepItem } from '@/features/agent-activity/StepView.tsx'
import { useAgentActivity, type AgentActivity } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { agentsFrom } from '@/lib/host/frame.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { useAgentThreads, type AgentNote } from './agent-threads.ts'
import { ChildCluster, ChildHood } from './ChildAgents.tsx'
import { childHue, childLine, childrenSummary, describeChild, satellitesOf } from './child-summary.ts'
import { useRunChildren } from './children.ts'
import { sayToAgent } from './say.ts'
import { agentEntry, agentReading } from './agent-entry.ts'
import { executionKey, executionTargets } from './actions.ts'
import { useExecution } from './store.ts'

/** Where the small screen's header starts, below the menu and its second row. */
const HEADER_TOP = 152
/** The header shrinks into a bar at the top when the user steps in. */
const FULL = 'translateY(0px) scale(1)'
const COMPACT = 'translateY(-36px) scale(0.56)'
/** Where the switch between transcript and code sits, under the shrunken header. */
const SWITCH_TOP = 214
/** Where the exchange starts below the shrunken header and the switch, and the room always kept for the input. */
const EXCHANGE_TOP = 252
const INPUT_ROOM = 124

type Mode = 'transcript' | 'code'
/** How runs are read, the same for every agent while the window is open. */
const useMode = create<{ mode: Mode; setMode: (mode: Mode) => void }>((set) => ({ mode: 'transcript', setMode: (mode) => set({ mode }) }))

/**
 * One agent's canvas. This file is the entry the frame mounts. Specs: 011-work, 021-agent-rendering.
 *
 * Every entry route draws existing activity immediately, already anchored to its newest step. An empty agent
 * shows its face and current task. Stepping in raises an input into the room kept for it; Escape returns to reading.
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
  const talking = useView((view) => view.agentTalk)
  const mode = useMode((state) => state.mode)
  const running = useAgent(agentId)
  const agent = useLastSeen(agentId, running)
  // With a host an agent leaves the running list when its run ends. Its canvas stays readable (011 A3).
  const finished = agent !== undefined && running === undefined
  const question = questionOf(agentId)
  const waiting = Boolean(running?.asks)
  const activity = useAgentActivity(agentId)
  const notes = useAgentThreads((threads) => (agentId ? threads.notes[agentId] : undefined))
  const still = useStill()
  const reading = agentReading(Boolean(agent && agentId), (activity?.entries.length ?? 0) > 0 || Boolean(notes?.length) || Boolean(question), talking)
  const compact = talking || reading
  // The canvas supplies the entry movement; snapshot content never waits for a second entrance.
  const Lift = Plain
  const Rise = Plain

  return (
    // A click inside a canvas previewed from the agents list keeps it open: the list losing the keyboard ends a preview.
    <div className="relative h-full overflow-hidden" onPointerDownCapture={() => present && agentId && keepPreview(agentId)}>
      {/* Moving to another agent changes the agent's own pieces in place. The controls stay where they are. */}
      <AnimatePresence initial={false} custom={side}>
        <AgentPart key={agentId} className="absolute inset-x-0 top-0">
          <motion.div
            className="absolute inset-x-[10%] flex origin-top flex-col items-center gap-4 text-center"
            style={{ top: HEADER_TOP }}
            initial={false}
            animate={{ transform: compact ? COMPACT : FULL }}
            transition={agentEntry(still)}
          >
            {agent ? (
              <Passing side={side}>
                <AgentHood hue={agent.hue} size={120} mood={finished ? 'idle' : agent.mood} asking={waiting} working={!finished} />
              </Passing>
            ) : null}
            <Lift>
              <p className="font-heading text-[22px] font-semibold tracking-[-0.022em]">{agent ? agent.title : 'This agent has finished'}</p>
            </Lift>
            {/* The rest of the small screen gives way to the exchange while it is read. */}
            <motion.div
              className={cn('flex w-full flex-col items-center gap-4', compact && 'pointer-events-none')}
              initial={false}
              animate={{ opacity: compact ? 0 : 1 }}
              transition={agentEntry(still)}
            >
              {agent ? (
                <Rise>
                  <p className="text-[15px] text-muted-foreground">
                    {agent.project} · {finished ? 'finished' : waiting ? 'waiting for you' : agent.doing} · {agent.tier}
                  </p>
                </Rise>
              ) : null}
              {agentId && (agent || activity) ? (
                <Rise className="w-full">
                  <Glance agentId={agentId} hue={agent?.hue ?? 0} question={question} waiting={waiting} activity={activity} />
                </Rise>
              ) : null}
              {agentId && agent ? (
                <Rise className="w-full">
                  <HelpersGlance runId={agentId} hue={agent.hue} />
                </Rise>
              ) : null}
            </motion.div>
          </motion.div>
          {/* Drawn with the screen, the switch and the exchange are simply there. Arriving later, they rise in. */}
          <AnimatePresence initial={false}>
            {reading && agent && agentId ? (
              <motion.div
                key="switch"
                className="absolute inset-x-0 flex justify-center"
                style={{ top: SWITCH_TOP }}
                initial={holdStill({ opacity: 0 }, still)}
                animate={holdStill({ opacity: 1, transition: agentEntry(still) }, still)}
                exit={holdStill({ opacity: 0, transition: tween.exit }, still)}
              >
                <ModeSwitch />
                {/* Beside the switch, so helpers arriving never move the exchange below. */}
                <div className="absolute inset-y-0 right-[10%] left-[calc(50%+80px)] flex items-center">
                  <HelpersStrip runId={agentId} hue={agent.hue} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </AgentPart>
      </AnimatePresence>
      <AgentStopControl key={agentId} agentId={agentId} />
      <AnimatePresence initial={false}>
        <AgentPart key={agentId} className="pointer-events-none absolute inset-0">
          <AnimatePresence initial={false}>
            {reading && agent && agentId ? <Exchange key={`${agentId}:${mode}`} agentId={agentId} hue={agent.hue} question={question} waiting={waiting} activity={activity} mode={mode} /> : null}
          </AnimatePresence>
        </AgentPart>
      </AnimatePresence>
      <AnimatePresence>
        {talking && agent && agentId ? (
          <TalkInput key={agentId} agentId={agentId} name={agent.title} hue={agent.hue} mood={agent.mood} answering={waiting} finished={finished} walkable={(activity?.entries.length ?? 0) > 0} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

const Plain = ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>

/** An agent previewed from the list stays open, as one chosen in the menu does, so the list's blur does not end it. */
function keepPreview(agentId: string) {
  const view = useView.getState()
  if (view.screen === 'agent' && view.openAgent === agentId && view.previewReturn !== null && !view.agentTalk) view.openAgentCanvas(agentId)
}

/** Which way the user moved: 1 to an agent later in the list, -1 to one before it. */
type Side = 1 | -1

/**
 * Which side the agent now shown comes in from. The agents keep the list's order, left to right in the menu, so one
 * later in the list comes in from the right and one before it from the left. With the last one gone from the list,
 * it goes the way the canvas was asked to move.
 */
function useSide(agentId: string | null): Side {
  const agents = useRunningAgents()
  const asked = useView((view) => view.screenMotion.direction)
  const last = useRef<{ agentId: string | null; side: Side }>({ agentId, side: asked })
  if (last.current.agentId !== agentId) {
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

function AgentStopControl({ agentId }: { agentId: string | null }) {
  const { target, result } = useAgentControl()
  const host = useHost(state => state)
  const control = executionTargets(host).find(row => row.kind === 'run' && row.runId === agentId)
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
      </button>
      {!control ? <p className="text-muted-foreground">Live cancellation capability unknown.</p> : null}
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

/**
 * The bottom of the small screen: the agent's question, or what it is doing this moment and how many steps it
 * has taken, or the last thing said to it. Never more, so walking the agents list stays light.
 */
function Glance({ agentId, hue, question, waiting, activity }: { agentId: string; hue: number; question?: string; waiting: boolean; activity: AgentActivity | null }) {
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const last = notes?.at(-1)
  const steps = activity ? stepCount(activity.entries) : 0
  const doing = useMemo(() => (activity ? doingNow(activity.entries, { ended: activity.ended, cwd: activity.cwd }) : null), [activity])

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
          {notes?.length ? ` · ${notes.length === 1 ? '1 message' : `${notes.length} messages`}` : ''} · Enter to talk
        </p>
      </div>
    )
  }
  if (last) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <p className="line-clamp-2 max-w-[72%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] leading-relaxed">{last.text}</p>
        <p className="text-[12px] text-muted-foreground">
          {notes!.length === 1 ? '1 message' : `${notes!.length} messages`} · Enter to talk
        </p>
      </div>
    )
  }
  return <p className="text-[15px] text-muted-foreground">No steps yet. They draw here as it works.</p>
}

/**
 * What the agent is doing this moment, in one or two lines: the tool it runs or just ran, or the last thing it
 * said. A new step takes the place of the last one by rising into it. Words arriving in the same sentence do not move it.
 */
function NowLine({ doing }: { doing: Doing }) {
  const still = useStill()
  const key = doing.subject === undefined ? 'says' : `${doing.lead}:${doing.subject}`
  return (
    <div className="relative grid min-h-[3.4em] w-full max-w-[72%] place-items-center">
      <AnimatePresence initial={false} mode="popLayout">
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
              {doing.code ? <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.87em] break-all">{doing.subject}</code> : doing.subject}
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

/** While the run is read, its helpers sit beside the switch: their small faces, each with its story on hover, and the count. */
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

/** Transcript or code: the same run read as the agent's steps, or as each tool call's task, parameters and output. */
function ModeSwitch() {
  const still = useStill()
  const mode = useMode((state) => state.mode)
  const setMode = useMode((state) => state.setMode)
  return <ActivityModeSwitch mode={mode} onChange={setMode} label="Show the run as" layoutId="agent-mode" transition={agentEntry(still)} />
}

const RISE_IN = {
  initial: { opacity: 0, transform: 'translateY(22px) scale(0.92)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
} as const

/** The steps and messages of the exchange, top to bottom, for the keyboard. */
const walkable = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(':scope > [data-step]')]
const focusTalkInput = () => document.querySelector<HTMLTextAreaElement>('[data-agent-input]')?.focus({ preventScroll: true })

/** Moves the keyboard from the input up onto the newest step. False when there is nothing to walk. */
function focusNewestStep(): boolean {
  const list = document.querySelector<HTMLElement>('[data-agent-exchange]')
  const newest = list ? walkable(list).at(-1) : undefined
  newest?.focus()
  return Boolean(newest)
}

/**
 * The exchange's keys (021 A9): Up and Down move between steps, Right or Enter opens a group or a change, Left
 * closes it, Home and End go to the first and the newest, and Down from the newest or Escape goes back to the input.
 */
function walkSteps(event: KeyboardEvent<HTMLOListElement>) {
  const items = walkable(event.currentTarget)
  const current = (event.target as HTMLElement).closest<HTMLElement>('[data-step]')
  const at = current ? items.indexOf(current) : -1
  if (!current || at === -1) return
  // Inside a step, its own controls keep their keys. Escape still leads back.
  if (event.target !== current && event.key !== 'Escape') return
  const toggle = (expanded: boolean) => current.querySelector<HTMLElement>(`[data-step-toggle][aria-expanded="${expanded}"]`)
  if (event.key === 'ArrowUp') items[Math.max(0, at - 1)]?.focus()
  else if (event.key === 'ArrowDown') {
    if (at < items.length - 1) items[at + 1]!.focus()
    else focusTalkInput()
  } else if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items.at(-1)?.focus()
  else if (event.key === 'ArrowRight' || event.key === 'Enter') toggle(false)?.click()
  else if (event.key === 'ArrowLeft') toggle(true)?.click()
  else if (event.key === 'Escape') focusTalkInput()
  else return
  event.preventDefault()
}

/**
 * The whole exchange, drawn while it is read: the agent's steps with the user's messages where they were sent, or in
 * code mode each tool call with the agent's words between them. It fills the room between the shrunken header and the
 * input's room, opens at its newest step and stays there as steps arrive, unless the user has scrolled up to read, and
 * then offers the way back down. Each step is drawn only while it is in view, so a long run, code included, costs what fits on screen.
 */
function Exchange({ agentId, hue, question, waiting, activity, mode }: { agentId: string; hue: number; question?: string; waiting: boolean; activity: AgentActivity | null; mode: Mode }) {
  const still = useStill()
  const live = useHasHost()
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const scroll = useFollow(still)
  const items = useMemo<ExchangeItem[]>(
    () =>
      mode === 'code'
        ? []
        : activity
          ? exchangeOf(activity.entries, notes ?? [], { seenAt: (id) => activity.timeOf(id)?.seen, ended: activity.ended, cwd: activity.cwd })
          : (notes ?? []).map((note) => ({ kind: 'note', key: `note:${note.id}`, note })),
    [activity, notes, mode],
  )
  const rows = useMemo<CallRow[]>(() => (mode === 'code' && activity ? callsOf(activity.entries, { ended: activity.ended, cwd: activity.cwd }) : []), [activity, mode])
  const thinking = activity !== null && !waiting && pauseOf(activity.entries, { ended: activity.ended }) === 'thinking'
  // Where the list is on screen before the new steps are in place, so it can glide from there rather than jump.
  scroll.note()
  useLayoutEffect(scroll.settle, [items, rows, thinking, scroll.settle])

  return (
    <motion.div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      // Steps scrolled up under the switch fade out rather than being cut.
      className="scroll-quiet pointer-events-auto absolute inset-x-0 bottom-0 overflow-x-hidden overflow-y-auto px-[10%] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
      style={{ top: EXCHANGE_TOP, paddingBottom: INPUT_ROOM }}
      initial={holdStill({ opacity: 0, transform: 'translateY(24px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: agentEntry(still) }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(16px)', transition: { duration: 0.16, ease: 'linear' } } as const, still)}
    >
      <motion.ol ref={scroll.content} style={{ y: scroll.y }} data-agent-exchange onKeyDown={walkSteps} aria-label={mode === 'code' ? "The agent's tool calls" : 'What the agent has done'} className="flex min-h-full flex-col justify-end gap-3 pt-2">
        {question ? (
          <li data-step="question" tabIndex={-1} className="flex flex-col gap-2 rounded-[18px] outline-none [contain-intrinsic-size:auto_64px] [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
            <QuestionBubble hue={hue} question={question} waiting={waiting} />
            <p className="flex h-6 items-center self-start pl-8 text-[12px] text-muted-foreground">{waiting ? 'Your answer goes in the box below.' : 'Answered.'}</p>
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {mode === 'code'
            ? rows.map((row) => <CallItem key={row.key} row={row} timeOf={activity!.timeOf} ended={activity!.ended} />)
            : items.map((item) => (item.kind === 'note' ? <Said key={item.key} note={item.note} /> : <StepItem key={item.key} step={item} timeOf={activity!.timeOf} ended={activity!.ended} />))}
        </AnimatePresence>
        {/* It leaves in the same moment the next step arrives, so the list glides once instead of settling twice. */}
        <AnimatePresence initial={false}>{thinking ? <Thinking key="thinking" activity={activity} /> : null}</AnimatePresence>
        {activity?.sample ? (
          <li className="self-center text-[12px] text-muted-foreground">Sample activity. With a host this is the agent's own work, as it happens.</li>
        ) : !live && notes?.length ? (
          <li className="self-end text-[12px] text-muted-foreground">Sample data. The host will deliver these to the agent as it works.</li>
        ) : null}
      </motion.ol>
      {/* Stays above the input while the user reads further up, and takes them back to the newest step. */}
      <div className="pointer-events-none sticky bottom-[136px] z-10 flex h-0 justify-center">
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
 * long, counted from its last step (021 A6).
 */
function Thinking({ activity }: { activity: AgentActivity | null }) {
  const still = useStill()
  const since = useMemo(() => {
    const times = (activity?.entries ?? []).map((entry) => activity?.timeOf(entry.id)).filter((time) => time !== undefined)
    return times.length ? Math.max(...times.map((time) => time.ended ?? time.seen)) : undefined
  }, [activity])
  const now = useNow(since !== undefined, 1000)
  const seconds = since === undefined ? 0 : Math.max(0, Math.round((now - since) / 1000))
  return (
    <motion.li
      initial={holdStill({ opacity: 0, transform: 'translateY(12px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: { ...tween.enter, delay: 0.4 } } }, still)}
      className="flex items-center gap-2 pl-2.5 text-[13px] text-muted-foreground tabular-nums"
    >
      <span className="aa-running size-1.5 rounded-full bg-current" aria-hidden="true" />
      Thinking{seconds >= 2 ? ` · ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`}` : ''}
    </motion.li>
  )
}

function Said({ note }: { note: AgentNote }) {
  const still = useStill()
  return (
    <motion.li
      data-step="note"
      tabIndex={-1}
      initial={holdStill(RISE_IN.initial, still)}
      animate={holdStill(RISE_IN.animate, still)}
      className="max-w-[72%] self-end rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-left text-[15px] leading-relaxed whitespace-pre-wrap outline-none [contain-intrinsic-size:auto_48px] [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]"
    >
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
    </motion.li>
  )
}

/** The input for talking to one agent. It rises from the bottom of the canvas into the room kept for it, and leaves the same way. */
function TalkInput({ agentId, name, hue, mood, answering, finished, walkable }: { agentId: string; name: string; hue: number; mood: Mood; answering: boolean; finished: boolean; walkable: boolean }) {
  const leaveAgentTalk = useView((view) => view.leaveAgentTalk)
  const still = useStill()
  const sendNote = useAgentThreads((threads) => threads.send)
  const live = useHasHost()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const canSend = draft.trim().length > 0 && !finished

  // Stepping in hands the keyboard to this input. Without preventScroll the browser would scroll the canvas
  // to show the input while it is still below the edge, and the whole canvas would jump.
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const send = async () => {
    if (!canSend) return
    const text = draft.trim()
    setProblem(null)
    // Record before awaiting: changing canvases must not hide a pending message or lose a refusal.
    setDraft('')
    const result = await sendNote(agentId, text, (noteId) => sayToAgent(agentId, text, { live, noteId }))
    if (!result.sent) {
      setProblem(result.why)
      return
    }
    // The sample question is local; real questions remain owned by the host.
    if (answering && !live) answerAgent(agentId)
  }

  const stepOut = () => {
    leaveAgentTalk()
    // Back onto the same agent in the list, where Enter was pressed.
    focusAgentsDock()
  }

  const label = finished ? `${name} has finished` : answering ? `Answer ${name}` : `Message ${name}`

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 px-[10%] pt-2 pb-5"
      initial={holdStill({ opacity: 0, transform: 'translateY(100%)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0%)', transition: agentEntry(still) }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(100%)', transition: agentEntry(still) }, still)}
    >
      <form
        className="flex items-end gap-2 rounded-[26px] border-[1.5px] border-input bg-background py-2 pr-2 pl-3 shadow-panel transition-colors duration-[160ms] ease-[ease] focus-within:border-ring"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center">
          <AgentHood hue={hue} size={26} mood={finished ? 'idle' : answering ? 'listening' : mood} working={!finished} />
        </span>
        <textarea
          ref={input}
          data-agent-input
          value={draft}
          readOnly={finished}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // The key is used here, so the frame leaves it alone.
              event.preventDefault()
              stepOut()
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
            } else if (event.key === 'ArrowUp' && !draft && focusNewestStep()) {
              // Up from an empty input walks the agent's steps, newest first.
              event.preventDefault()
            }
          }}
          rows={1}
          placeholder={label}
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
      </form>
      {problem ? (
        <p role="alert" className="mt-1.5 px-3 text-[11px] text-bad-fg">
          {problem}
        </p>
      ) : (
        <p className="mt-1.5 px-3 text-[11px] text-muted-foreground">
          {finished ? 'It has finished, so nothing more reaches it. ' : 'Enter sends. '}
          {walkable ? '↑ walks its steps. ' : ''}Esc steps back out.
        </p>
      )}
    </motion.div>
  )
}
