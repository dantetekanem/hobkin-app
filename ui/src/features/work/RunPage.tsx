import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { answerAgent, questionOf, useAgent, type RunningAgent } from '@/app/running-agents.ts'
import { holdStill, useStill } from '@/app/still.ts'
import type { Mood } from '@/avatar/moods.tsx'
import { Pals } from '@/avatar/Pals.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { AgentLines } from '@/features/agent-activity/AgentLines.tsx'
import { Arrivals, useArrival } from '@/features/agent-activity/arrive.ts'
import { earlierRow, useNewest } from '@/features/agent-activity/newest.ts'
import { mayHaveOlder, useOlderSteps } from '@/features/agent-activity/older-steps.ts'
import { useReadingPlace } from '@/features/agent-activity/reading-place.ts'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { exchangeOf, pauseOf, type ExchangeItem } from '@/features/agent-activity/steps.ts'
import { EarlierSteps, StepItem, StepJob } from '@/features/agent-activity/StepView.tsx'
import { lastStepTime, useAgentActivity, type AgentActivity } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { AttachmentTray, SentImages } from '@/features/chat/AttachmentTray.tsx'
import { changeLine } from '@/features/chat/change-line.ts'
import { releaseImages } from '@/features/chat/image-uploads.ts'
import { sendChange } from '@/features/chat/send-change.ts'
import { imagesLine, QueuedRows, SendButton } from '@/features/chat/TalkControls.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { PageHeader, PartFrame } from '@/features/hobkins/PageHeader.tsx'
import { Pulse } from '@/features/pulse/Pulse.tsx'
import { agentsFrom } from '@/lib/host/frame.ts'
import { runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { focusNewestStep, walkSteps } from './agent-keys.ts'
import { useAgentImages } from './agent-images.ts'
import { useAgentThreads, waitsForTurn, type AgentNote } from './agent-threads.ts'
import { AgentSlashOver } from './AgentSlashOver.tsx'
import { AgentWaits } from './AgentWaits.tsx'
import { DeliveryMark } from './DeliveryMark.tsx'
import { sayToAgent } from './say.ts'
import { useStopResult } from './StopAsk.tsx'
import { endTarget, waitingRows, type TalkAgent, type TalkQueue } from './talk.ts'
import { usePageSlash } from './use-agent-slash.ts'
import { useAgentImageInput } from './use-agent-image-input.ts'
import { useTalkControls } from './use-talk-controls.ts'

/**
 * A run's own parts on the one agent page (`021-agent-rendering`, `034-durable-hobkins`): its header, lines and steps
 * (`RunPart`) and its talk box (`RunTalk`). The page is the durable hobkin's (`HobkinScreen.tsx`); a run differs only in
 * what it shows there, and in that it ends with its work, where a durable hobkin lives on after each turn.
 */

/** What End says it does to a run, after the question. */
const RUN_END = 'It stops at once, even in the middle of a step.'

/** The run, from the running list while it works and from its record once it has finished, so its page stays readable (011 A3). */
function useRun(agentId: string): { agent: RunningAgent | undefined; finished: boolean } {
  const running = useAgent(agentId)
  const run = useHost((state) => state.snapshot.runs?.find(({ id }) => id === agentId))
  const recorded = useMemo(() => (run ? agentsFrom({ runs: [run] }, { includeEnded: true })[0] : undefined), [run])
  const seen = useRef<RunningAgent | undefined>(undefined)
  const current = running ?? recorded
  if (current) seen.current = current
  else if (seen.current?.id !== agentId) seen.current = undefined
  const agent = current ?? seen.current
  // With a host a run leaves the running list when it ends.
  return { agent, finished: agent !== undefined && running === undefined }
}

/** A run's header, lines and steps. */
export function RunPart({ agentId }: { agentId: string }) {
  const { agent, finished } = useRun(agentId)
  const question = questionOf(agentId)
  const waiting = Boolean(agent?.asks) && !finished
  // A living job between its turns (spec 072): its face rests, and the steps say it is idle rather than thinking.
  const idle = agent?.idle !== undefined && !finished
  const canEnd = useHost((state) => endTarget(state, agentId) !== null)
  const status = useStopResult(agentId)
  const hue = agent?.hue ?? 0
  const mood = finished ? 'idle' : (agent?.mood ?? 'idle')
  const standing = finished ? 'finished' : waiting ? 'waiting for you' : agent?.doing
  const line = agent ? `${agent.project} · ${standing} · ${agent.tier}` : null

  return (
    <PartFrame>
      <PageHeader
        agentId={agentId}
        split={false}
        face={
          // A run on Claude Code has the crab pal beside its face. A finished run's record says how it ended.
          agent?.onClaudeCode ? (
            <Pals id={agentId} hue={hue} size={48} mood={mood} asking={waiting} working={!finished && !idle} endedWell={finished && agent.doing === 'completed'} />
          ) : (
            <AgentHood hue={hue} size={48} mood={mood} asking={waiting} working={Boolean(agent) && !finished && !idle} />
          )
        }
        title={agent?.title ?? 'This agent has finished'}
        line={line}
        end={agent && !finished ? { ready: canEnd, why: RUN_END } : null}
        status={status}
      />
      {agent ? <AgentLines agentId={agentId} hue={hue} name={agent.title} className="mx-[10%]" /> : null}
      <Exchange agentId={agentId} hue={hue} question={question} waiting={waiting} idle={idle} />
    </PartFrame>
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

/**
 * The run's steps with the user's messages where they were sent, each with when it happened in a column at its left. It
 * opens at its newest step, just above the talk box, and stays there as steps arrive, unless the user has scrolled up to
 * read, and then offers the way back down. A long run draws only its newest steps, with a row above them that draws
 * more, and each step drawn paints only while it is in view. It reads the run's activity itself, so a step draws the
 * steps alone.
 */
const Exchange = memo(ExchangeSteps)

function ExchangeSteps({ agentId, hue, question, waiting, idle }: { agentId: string; hue: number; question?: string; waiting: boolean; idle: boolean }) {
  const activity = useAgentActivity(agentId)
  const still = useStill()
  const live = useHasHost()
  const allNotes = useAgentThreads((threads) => threads.notes[agentId])
  // What the user said to it while it worked comes back from hobkin, for a page a reload or a hot update took it from.
  // A host from before has no such read, and the page shows what it has.
  useEffect(() => {
    if (!live) return
    runCommand('agent.notes', { run: agentId }).then(
      ({ notes: kept }) => useAgentThreads.getState().recall(agentId, kept),
      () => {},
    )
  }, [agentId, live])
  // What waits for the run's turn shows above the box until the turn reads it (`QueuedRows`).
  const notes = useMemo(() => allNotes?.filter((note) => !waitsForTurn(note)), [allNotes])
  const scroll = useFollow()
  // The run's feed keeps its newest steps. The ones it let go are read from the run's saved session, a page at a time,
  // and come before them.
  const job = live && activity && !activity.sample ? agentId : null
  const older = useOlderSteps(job)
  const entries = useMemo(() => (activity && older.steps.length ? [...older.steps, ...activity.entries] : activity?.entries), [activity, older.steps])
  const items = useMemo<ExchangeItem[]>(
    () =>
      activity && entries
        ? // The tasks line above the steps is where task calls show.
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
  const thinking = activity !== null && !waiting && !idle && pauseOf(activity.entries, { ended: activity.ended }) === 'thinking'
  const empty = items.length === 0 && !question && !thinking

  return (
    <div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      className="scroll-quiet relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[10%] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
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
        {empty ? <li className="self-center text-[13px] text-muted-foreground">No steps yet. They draw here as it works.</li> : null}
        {activity?.sample ? (
          <li className="self-center text-[12px] text-muted-foreground">Sample activity. With a host this is the agent's own work, as it happens.</li>
        ) : !live && notes?.length ? (
          <li className="self-end text-[12px] text-muted-foreground">Sample data. The host will deliver these to the agent as it works.</li>
        ) : null}
      </ol>
      {/* Stays just above the talk box while the user reads further up, and takes them back to the newest step. */}
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
    </div>
  )
}

/**
 * Between steps the agent is thinking. hobkin keeps none of its thinking, so the page only says so, and for how
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
          <DeliveryMark delivery={note.delivery} why={note.why} />
        </div>
      </Stamped>
    </li>
  )
}

/** The talk box for a run, at the bottom of its page for as long as the page shows it. Nothing for an agent with no record. */
export function RunTalk({ agentId }: { agentId: string }) {
  const { agent, finished } = useRun(agentId)
  if (!agent) return null
  return <TalkInput agentId={agentId} name={agent.title} hue={agent.hue} mood={agent.mood} answering={Boolean(agent.asks) && !finished} finished={finished} />
}

/**
 * The input for talking to a run. It takes the keyboard when the user clicks it or presses Enter on the agent in the
 * list, never on its own, so walking the list keeps the keyboard there. Images pasted or dropped on it go with the
 * words, as in the main input. It draws again only when what it shows changes.
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
  const notes = useAgentThreads((threads) => threads.notes[agentId])
  const rows = useMemo(
    () => waitingRows((notes ?? []).map((note) => ({ ...note, text: note.text || imagesLine(note.images?.length ?? 0), waiting: waitsForTurn(note) }))),
    [notes],
  )
  const agent = useMemo<TalkAgent>(() => ({ kind: 'run', run: agentId }), [agentId])
  const controls = useTalkControls(agent, {
    canSend,
    empty: !draft.trim() && images.attachments.length === 0,
    queued: rows.length > 0,
    send: (words, queue) => void send(words, queue),
    setDraft,
    dropNotes: (noteIds) => useAgentThreads.getState().drop(agentId, noteIds),
    setProblem,
  })
  const box = useRef<HTMLFormElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  // A message that starts with a slash lists what Pi offers this agent's own session, and /model its tier or model.
  const slash = usePageSlash({
    agentId,
    agent: live ? { run: agentId } : null,
    text: draft,
    setText: setDraft,
    open: !finished,
    setProblem,
    setSaid,
    onSent: (words) => useAgentThreads.getState().say(agentId, words),
  })

  // `queue` is how the words wait for the turn in flight. An interrupting message starts a turn of its own, so it waits for none.
  const send = async (words?: string, queue?: TalkQueue) => {
    if (!canSend) return
    const text = (words ?? draft).trim()
    setProblem(null)
    setSaid(null)
    useAgentImages.getState().clearProblem(agentId)
    // A command its session offers runs there, and a bare /model opens the choice of tier or model.
    if (!images.attachments.length && slash.sendCommand(text)) return
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
    // Record before awaiting: changing pages must not hide a pending message or lose a refusal. The images go with the
    // words, and the note keeps them to show.
    setDraft('')
    const attached = useAgentImages.getState().take(agentId)
    const handles = attached.flatMap(({ handle }) => (handle ? [handle] : []))
    const waits = controls.working && queue !== 'interrupt' ? (queue ?? 'steer') : undefined
    const result = await sendNote(agentId, text, (noteId) => sayToAgent(agentId, text, { live, noteId, images: handles, ...(queue ? { queue } : {}) }), attached, waits)
    if (result.sent && result.unsent) controls.giveBack(result.unsent)
    if (!result.sent) {
      // hobkin lets go of images that did not reach the agent. The note still shows them.
      releaseImages(attached)
      setProblem(result.why)
      return
    }
    // The sample question is local; real questions remain owned by the host.
    if (answering && !live) answerAgent(agentId)
  }

  const label = finished ? `${name} has finished` : answering ? `Reply to ${name}` : `Message ${name}`

  return (
    <div className="shrink-0 px-[10%] pt-2 pb-2">
      <QueuedRows rows={rows} className="pl-4" />
      <form
        ref={box}
        className={cn(
          'relative rounded-[26px] border-[1.5px] bg-background py-2 pr-2 pl-3 shadow-panel transition-colors duration-[160ms] ease-[ease] focus-within:border-ring',
          images.dropping ? 'border-ring' : 'border-input',
        )}
        {...images.dropTarget}
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <AgentSlashOver slash={slash} agentId={agentId} box={box} input={input} />
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
            ref={input}
            {...slash.inputProps}
            value={draft}
            readOnly={finished}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={images.onPaste}
            onKeyDown={(event) => {
              // While the list of commands is open its keys come first, then the keys every message box shares.
              if (slash.onKeyDown(event) || images.removeLast(event)) return
              if (controls.onKeyDown(event)) return event.preventDefault()
              if (event.key === 'Escape') {
                // Back onto the same agent in the list. One the list no longer holds leaves the key to the frame,
                // which leaves the page.
                if (!finished && focusAgentsDock()) event.preventDefault()
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
          <SendButton
            turnRunning={controls.working}
            canSend={canSend}
            stopping={controls.stopping}
            onStop={controls.stop}
            sendLabel={answering ? 'Send the answer' : 'Send to this agent'}
            stopLabel="Stop this agent"
            className="size-9"
          />
        </div>
      </form>
      {/* Always there, so the box does not move when words come and go. Its schedules are a line under its header (056). */}
      <div className="relative mt-1 flex min-h-6 items-start gap-3 px-3">
        <div className="min-w-0 flex-1 py-1 text-[11px] leading-4">
          {problem || images.problem ? (
            <p role="alert" className="text-bad-fg">
              {problem ?? images.problem}
            </p>
          ) : controls.stopArmed ? (
            <p role="status" className="text-muted-foreground">
              <Kbd>esc</Kbd> again to stop, or <Kbd>⌃C</Kbd>
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
      </div>
    </div>
  )
}
