import { ArrowDown, ArrowUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { agentControls, answerAgent, questionOf, useAgent, useAgentControl, type RunningAgent } from '@/app/running-agents.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
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
import { sayToAgent } from './say.ts'

/** Where the small screen's header starts, below the menu and its second row. */
const HEADER_TOP = 152
/** The header shrinks into a bar at the top when the user steps in. */
const FULL = 'translateY(0px) scale(1)'
const COMPACT = 'translateY(-36px) scale(0.56)'
/** Where the exchange starts below the shrunken header, and the room always kept for the input. */
const EXCHANGE_TOP = 224
const INPUT_ROOM = 124

/**
 * One agent's canvas. This file is the entry the frame mounts. Specs: 011-work, 021-agent-rendering.
 *
 * While the user walks the agents list, each agent shows its small screen: its face, its title, what it is
 * on, and its question, or what it is doing this moment with how many steps it has taken. It is the same size
 * for every agent however long its work is, so moving between agents is always the same light movement, and
 * nothing long is drawn for an agent the user only passes.
 *
 * Stepping in (Enter on it in the list, or Command+G when it waits for the user) draws the whole exchange: the
 * agent's steps as they happen (what it said, its commands, its changes, what it read) with the user's messages
 * where they were sent. The header shrinks into a bar at the top, the exchange fades in below it already at its
 * newest step, and an input rises into the room kept for it. Escape steps back out the same way.
 * Only transforms and opacity move, and steps out of view are not drawn.
 */
export function AgentScreen() {
  const agentId = useView((view) => view.openAgent)
  const talking = useView((view) => view.agentTalk)
  const running = useAgent(agentId)
  const agent = useLastSeen(agentId, running)
  // With a host an agent leaves the running list when its run ends. Its canvas stays readable (011 A3).
  const finished = agent !== undefined && running === undefined
  const question = questionOf(agentId)
  const waiting = Boolean(running?.asks)
  const activity = useAgentActivity(agentId)
  const still = useStill()

  return (
    <div className="relative h-full overflow-hidden">
      <motion.div
        className="absolute inset-x-[10%] flex origin-top flex-col items-center gap-4 text-center"
        style={{ top: HEADER_TOP }}
        initial={false}
        animate={{ transform: talking ? COMPACT : FULL }}
        transition={still ? { duration: 0 } : spring.screen}
      >
        {agent ? (
          <Hero>
            <AgentHood hue={agent.hue} size={120} mood={finished ? 'idle' : agent.mood} asking={waiting} working={!finished} />
          </Hero>
        ) : null}
        <Rise>
          <p className="font-heading text-[22px] font-semibold tracking-[-0.022em]">{agent ? agent.title : 'This agent has finished'}</p>
        </Rise>
        {/* The rest of the small screen gives way to the exchange while the user is in. */}
        <motion.div
          className={cn('flex w-full flex-col items-center gap-4', talking && 'pointer-events-none')}
          initial={false}
          animate={{ opacity: talking ? 0 : 1 }}
          transition={{ duration: talking ? 0.14 : 0.24, ease: 'linear' }}
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
        </motion.div>
      </motion.div>
      <AgentStopControl key={agentId} agentId={agentId} finished={!running} />
      <AnimatePresence>
        {talking && agent && agentId ? <Exchange key={agentId} agentId={agentId} hue={agent.hue} question={question} waiting={waiting} activity={activity} /> : null}
      </AnimatePresence>
      <AnimatePresence>
        {talking && agent && agentId ? (
          <TalkInput key={agentId} agentId={agentId} name={agent.title} hue={agent.hue} mood={agent.mood} answering={waiting} finished={finished} walkable={(activity?.entries.length ?? 0) > 0} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function AgentStopControl({ agentId, finished }: { agentId: string | null; finished: boolean }) {
  const { target, busy, result } = useAgentControl()
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
      <button type="button" disabled={finished || busy || agentControls.stopped(agentId)} onClick={() => agentId && agentControls.request(agentId)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">Stop agent</button>
      {result?.id === agentId ? <p role="status" className="mt-2 max-w-72 text-muted-foreground">{result.text}</p> : null}
      <dialog ref={dialog} aria-labelledby="agent-stop-title" aria-describedby="agent-stop-description" onCancel={(event) => { event.preventDefault(); cancel() }} onKeyDown={(event) => event.stopPropagation()} className="m-auto max-w-md rounded-2xl border border-border bg-background p-6 text-foreground backdrop:bg-black/40">
        <h2 id="agent-stop-title" className="text-lg font-semibold">Stop {target?.kind === 'routine' ? 'routine' : 'agent'}?</h2>
        <p id="agent-stop-description" className="my-4">{target?.title} · {target?.project}. {target?.kind === 'work' ? 'Its branch stays and its item goes to the end of the queue.' : 'The current run will be cancelled.'}</p>
        <div className="flex justify-end gap-4">
          <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
          <button type="button" disabled={busy || finished || target?.id !== agentId} onClick={() => void agentControls.confirm()}>{busy ? 'Stopping…' : 'Stop run'}</button>
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
          {notes?.length ? ` · ${notes.length === 1 ? '1 message' : `${notes.length} messages`}` : ''} · Enter to step in
        </p>
      </div>
    )
  }
  if (last) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <p className="line-clamp-2 max-w-[72%] rounded-2xl bg-secondary px-3.5 py-2 text-[15px] leading-relaxed">{last.text}</p>
        <p className="text-[12px] text-muted-foreground">
          {notes!.length === 1 ? '1 message' : `${notes!.length} messages`} · Enter to step in
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
 * The whole exchange, drawn only while the user is in: the agent's steps with the user's messages where they were
 * sent. It fills the room between the shrunken header and the input, opens at its newest step and stays there as
 * steps arrive, unless the user has scrolled up to read, and then offers the way back down.
 * Each step is drawn only while it is in view, so a long run, code included, costs what fits on screen.
 */
function Exchange({ agentId, hue, question, waiting, activity }: { agentId: string; hue: number; question?: string; waiting: boolean; activity: AgentActivity | null }) {
  const still = useStill()
  const live = useHasHost()
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const scroll = useFollow(still)
  const items = useMemo<ExchangeItem[]>(
    () =>
      activity
        ? exchangeOf(activity.entries, notes ?? [], { seenAt: (id) => activity.timeOf(id)?.seen, ended: activity.ended, cwd: activity.cwd })
        : (notes ?? []).map((note) => ({ kind: 'note', key: `note:${note.id}`, note })),
    [activity, notes],
  )
  const thinking = activity !== null && !waiting && pauseOf(activity.entries, { ended: activity.ended }) === 'thinking'
  // Where the list is on screen before the new steps are in place, so it can glide from there rather than jump.
  scroll.note()
  useLayoutEffect(scroll.settle, [items, thinking, scroll.settle])

  return (
    <motion.div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      className="scroll-quiet absolute inset-x-0 bottom-0 overflow-y-auto px-[10%]"
      style={{ top: EXCHANGE_TOP, paddingBottom: INPUT_ROOM }}
      initial={holdStill({ opacity: 0, transform: 'translateY(24px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: { duration: 0.24, delay: 0.06 } } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(16px)', transition: { duration: 0.16, ease: 'linear' } } as const, still)}
    >
      <motion.ol ref={scroll.content} style={{ y: scroll.y }} data-agent-exchange onKeyDown={walkSteps} aria-label="What the agent has done" className="flex min-h-full flex-col justify-end gap-3 pt-2">
        {question ? (
          <li data-step="question" tabIndex={-1} className="flex flex-col gap-2 rounded-[18px] outline-none [contain-intrinsic-size:auto_64px] [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]">
            <QuestionBubble hue={hue} question={question} waiting={waiting} />
            <p className="flex h-6 items-center self-start pl-8 text-[12px] text-muted-foreground">{waiting ? 'Your answer goes in the box below.' : 'Answered.'}</p>
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {items.map((item) => (item.kind === 'note' ? <Said key={item.key} note={item.note} /> : <StepItem key={item.key} step={item} timeOf={activity!.timeOf} ended={activity!.ended} />))}
        </AnimatePresence>
        {/* It leaves in the same moment the next step arrives, so the list glides once instead of settling twice. */}
        {thinking ? <Thinking activity={activity} /> : null}
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
              Newest
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
    </motion.li>
  )
}

/** The input for talking to one agent. It rises from the bottom of the canvas into the room kept for it, and leaves the same way. */
function TalkInput({ agentId, name, hue, mood, answering, finished, walkable }: { agentId: string; name: string; hue: number; mood: Mood; answering: boolean; finished: boolean; walkable: boolean }) {
  const leaveAgentTalk = useView((view) => view.leaveAgentTalk)
  const still = useStill()
  const say = useAgentThreads((threads) => threads.say)
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
    // With a host the words reach the running agent as steering. They show here only once they were sent.
    const result = await sayToAgent(agentId, text, { live })
    if (!result.sent) {
      setProblem(result.why)
      return
    }
    say(agentId, text)
    // The answer is what the agent was waiting for: it gets on with its work.
    if (answering) answerAgent(agentId)
    setDraft('')
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
      animate={holdStill({ opacity: 1, transform: 'translateY(0%)', transition: { transform: spring.screen, opacity: tween.enter } }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(100%)', transition: { transform: spring.screenExit, opacity: { duration: 0.2 } } }, still)}
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
