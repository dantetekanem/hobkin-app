import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HOBKIN_MESSAGE_MAX, HOBKIN_TITLE_MAX, hobkinAgentId, hobkinOfAgent, type HobkinConversation, type HobkinSummary, type HobkinTurn } from '#shared/protocol/hobkins.ts'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Pals } from '@/avatar/Pals.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useSplit } from '@/features/canvas-panel/use-board.ts'
import { Arrivals, useArrival } from '@/features/agent-activity/arrive.ts'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { AgentLines } from '@/features/agent-activity/AgentLines.tsx'
import { atOf } from '@/features/agent-activity/steps.ts'
import { withRuns, type RunsRow } from '@/features/schedules/runs.ts'
import { ScheduleRunsItem } from '@/features/schedules/ScheduleRuns.tsx'
import { useScheduleRuns } from '@/features/schedules/use-schedule-runs.ts'
import { earlierRow, useNewest, withEarlier } from '@/features/agent-activity/newest.ts'
import { mayHaveOlder, useOlderSteps } from '@/features/agent-activity/older-steps.ts'
import { useReadingPlace } from '@/features/agent-activity/reading-place.ts'
import { EarlierSteps, StepItem, StepJob } from '@/features/agent-activity/StepView.tsx'
import { useAgentActivity, useStepsMood } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { AttachmentTray, SentImages } from '@/features/chat/AttachmentTray.tsx'
import type { Attachment } from '@/features/chat/draft.ts'
import { MessageText } from '@/features/chat/markdown.ts'
import { Pulse } from '@/features/pulse/Pulse.tsx'
import { useModelChoices } from '@/features/tiers/models.ts'
import { focusNewestStep, upToAgents, walkSteps } from '@/features/work/agent-keys.ts'
import { RunPart, RunTalk } from '@/features/work/RunPage.tsx'
import { StopAsk, useStopResult } from '@/features/work/StopAsk.tsx'
import { useAgentImages } from '@/features/work/agent-images.ts'
import { useAgentImageInput } from '@/features/work/use-agent-image-input.ts'
import { doingOf, folderName, hasHost, hueOf } from '@/lib/host/frame.ts'
import { changeLine } from '@/features/chat/change-line.ts'
import { sendChange } from '@/features/chat/send-change.ts'
import { hostStore, runCommand, useHasHost, useHost } from '@/lib/host/index.ts'
import { sentAtArg } from '@/lib/host/state.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import {
  firstMessageNext,
  pageRows,
  pageState,
  pageTurns,
  talkOpen,
  waitsForTurn,
  withDrawnTurns,
  withKept,
  withReceipts,
  type Delivery,
  type PageRow,
  type PageState,
  type SendingNote,
  type SentNote,
  type ShownTurn,
} from './conversation.ts'
import { AgentPromptEditor } from '@/features/chat/PromptEditor.tsx'
import { ContinueButton, imagesLine, QueuedRows, SendButton } from '@/features/chat/TalkControls.tsx'
import { CONTINUE_WORDS, waitingRows, type TalkAgent, type TalkQueue } from '@/features/work/talk.ts'
import { useTalkControls } from '@/features/work/use-talk-controls.ts'
import { PageHeader, pageGutter, PartFrame, splitSpring } from './PageHeader.tsx'
import { engineLabel, stateLabel } from './rules.ts'
import { useNewHobkin } from './store.ts'
import { timeOfTurn, useTurnSteps } from './turn-steps.ts'
import { useConversation, useMarkSeen, usePageShown } from './use-conversation.ts'
import { useOnClaudeCode } from './use-pal.ts'
import { usePageSlash } from '@/features/work/use-agent-slash.ts'
import { AgentSlashOver } from '@/features/work/AgentSlashOver.tsx'
import { DeliveryMark } from '@/features/work/DeliveryMark.tsx'

/**
 * Every agent's page, the one the frame opens for the agent screen (`034-durable-hobkins`, `021-agent-rendering`): a
 * durable hobkin's, `hobkin:<id>`, and a run's. Its face, name, where it works and how it stands, with End; its lines;
 * then its conversation, with the steps of the turn in flight drawn as any agent's are; and the talk box. A durable
 * hobkin's conversation is each turn's message and answer, and it lives on after each turn until it is ended. A run's is
 * its steps, and it ends with its work (`RunPage.tsx`). The user, 2026-11-25: "the UI of durable is much better, that
 * should be the only UI".
 *
 * Moving to another agent, durable or not, its own pieces cross-fade and the talk box stays in place.
 *
 * While a durable hobkin's canvas is open the page forms a split with it (`040-canvas-board`): the page takes the chat's
 * place and the canvas the right side. The agents list is covered then, so the page's keys no longer lead to it.
 */
export function HobkinScreen() {
  // A screen on its way out keeps showing its own agent while the next one arrives, and the split it had.
  const present = useIsPresent()
  const openAgent = useView((view) => view.openAgent)
  const kept = useRef(openAgent)
  if (present) kept.current = openAgent
  const agentId = kept.current
  const id = hobkinOfAgent(agentId)
  const notes = useSentNotes()
  const splitOwner = useSplit()?.owner ?? null
  const keptSplit = useRef(false)
  if (present) keptSplit.current = id !== null && splitOwner === id
  const split = keptSplit.current
  const still = useStill()

  return (
    // In the split the page's gutter is the chat's, and it travels there with the split (`pageGutter`).
    <motion.div
      className="relative flex h-full flex-col"
      onKeyDown={split ? undefined : upToAgents}
      initial={false}
      animate={{ '--page-gutter': pageGutter(split) }}
      transition={still ? { duration: 0 } : splitSpring(split)}
    >
      {/* Where the chat's header was, the window is dragged by the top of the page. */}
      {split ? <div data-tauri-drag-region className="select-none-chrome absolute inset-x-0 top-0 z-10 h-12" /> : null}
      {id ? <TurnStopAsk id={id} /> : agentId ? <StopAsk key={agentId} runId={agentId} /> : null}
      <div className="relative min-h-0 flex-1">
        {/* Propagated, so a page leaving with its screen counts as gone. */}
        <AnimatePresence initial={false} propagate>
          {id ? (
            <Part key={agentId} id={id} split={split} sent={notes.sent[id] ?? NO_NOTES} sending={notes.sending[id] ?? null} recall={notes.recall} />
          ) : agentId ? (
            <RunPart key={agentId} agentId={agentId} />
          ) : null}
        </AnimatePresence>
      </div>
      {id ? (
        <Talk
          key={agentId}
          id={id}
          split={split}
          sent={notes.sent[id] ?? NO_NOTES}
          sending={notes.sending[id] ?? null}
          onSending={(note) => notes.sendingTo(id, note)}
          onSent={(note) => notes.add(id, note)}
          onTakenBack={(noteIds) => notes.drop(id, noteIds)}
        />
      ) : agentId ? (
        <RunTalk key={agentId} agentId={agentId} />
      ) : null}
    </motion.div>
  )
}

const NO_NOTES: readonly SentNote[] = []

/**
 * What the user sent from the page, by hobkin, and the message on its way now. Kept while the page is open, and read back
 * from what hobkin keeps with each turn once the page is back from a reload, a hot update or another screen. hobkin's
 * receipts mark what each turn read in as they come.
 */
function useSentNotes() {
  const [sent, setSent] = useState<Readonly<Record<string, readonly SentNote[]>>>({})
  const [sending, setSending] = useState<Record<string, SendingNote | null>>({})

  const add = useCallback((id: string, note: SentNote) => {
    setSent((all) => {
      // A read can bring hobkin's copy back before the say answers: this window's own, with its images, takes its place.
      const others = (all[id] ?? []).filter((each) => note.noteId === undefined || each.noteId !== note.noteId)
      // A receipt that came before the say answered counts too.
      return withReceipts({ ...all, [id]: [...others, note] }, hostStore.getState().snapshot.steeringReceipts)
    })
  }, [])

  const recall = useCallback((id: string, turns: readonly HobkinTurn[]) => {
    setSent((all) => {
      const notes = all[id] ?? NO_NOTES
      const recalled = withKept(notes, turns)
      return recalled === notes ? all : withReceipts({ ...all, [id]: recalled }, hostStore.getState().snapshot.steeringReceipts)
    })
  }, [])

  useEffect(() => {
    return hostStore.subscribe(({ snapshot }, { snapshot: before }) => {
      if (snapshot.steeringReceipts === before.steeringReceipts) return
      setSent((all) => withReceipts(all, snapshot.steeringReceipts))
    })
  }, [])

  const sendingTo = useCallback((id: string, note: SendingNote | null) => {
    setSending((all) => ({ ...all, [id]: note }))
  }, [])

  // Notes the user took back into the box leave the page.
  const drop = useCallback((id: string, noteIds: readonly string[]) => {
    if (!noteIds.length) return
    setSent((all) => ({ ...all, [id]: (all[id] ?? []).filter((note) => !note.noteId || !noteIds.includes(note.noteId)) }))
  }, [])

  return { sent, sending, add, recall, sendingTo, drop }
}

/**
 * One durable hobkin as the host has it, whether it is there (being started, alive, or ended), and whether its first
 * message is still to come.
 */
function useHobkin(id: string): { hobkin: HobkinSummary | undefined; state: PageState; connected: boolean; fresh: boolean } {
  const hobkin = useHost((state) => state.snapshot.hobkins?.find((summary) => summary.id === id))
  const ready = useHost((state) => state.snapshotReady)
  const connected = useHost((state) => hasHost(state) && state.link === 'open')
  const started = useNewHobkin((state) => state.started?.id === id)
  const known = useRef(false)
  if (hobkin) known.current = true

  const state = pageState(hobkin, { known: known.current, started, ready })
  return { hobkin, state, connected, fresh: firstMessageNext({ hobkin, started }) }
}

/** A stop of the turn in flight asked from the agents list asks on the page first. While the hobkin waits there is nothing to stop. */
function TurnStopAsk({ id }: { id: string }) {
  const run = useHost((state) => state.snapshot.hobkins?.find((summary) => summary.id === id)?.run ?? null)
  return run ? <StopAsk key={run} runId={run} /> : null
}

interface PartProps {
  id: string
  split: boolean
  sent: readonly SentNote[]
  sending: SendingNote | null
  /** Takes what hobkin kept of the notes the user added to these turns, for those the page no longer has. */
  recall: (id: string, turns: readonly HobkinTurn[]) => void
}

/** The hobkin's own pieces: its header, its lines and its conversation. Leaving, they take no keyboard and no pointer. */
function Part({ id, split, sent, sending, recall }: PartProps) {
  const present = useIsPresent()
  const { hobkin, state, connected, fresh } = useHobkin(id)
  const onPage = useView((view) => view.screen === 'agent' && view.openAgent === hobkinAgentId(id))
  useMarkSeen(hobkin, onPage && present, connected)
  usePageShown(hobkin, onPage && present, connected)
  const { conversation, problem } = useConversation(id, hobkin, connected)
  // Each read brings back what the user added to its turns, so a page that lost its copy shows them again.
  useEffect(() => {
    if (conversation) recall(id, conversation.turns)
  }, [conversation, id, recall])

  // Before the first read answers, a turn in flight still shows, with the message that began it.
  const read = useMemo<HobkinConversation | null>(() => conversation ?? (hobkin?.run ? { hobkin, turns: [] } : null), [conversation, hobkin])
  // What waits for the turn in flight shows above the box until the turn reads it (`QueuedRows`).
  const shownSent = useMemo(() => sent.filter((note) => !waitsForTurn(note, hobkin)), [sent, hobkin])
  const shownSending = sending && waitsForTurn(sending, hobkin) ? null : sending
  const turns = useMemo(() => pageTurns(read, hobkin, shownSent), [read, hobkin, shownSent])
  // The live turn's steps: the one in flight, or the one just over until a read has its answer. The host keeps them.
  const liveRun = turns.find((turn) => turn.live)?.run ?? null
  // The face reads only the mood the live turn's steps give it. The tasks line and the conversation read the steps themselves.
  const stepsMood = useStepsMood(liveRun)
  const mood = hobkin?.state === 'working' ? stepsMood : 'idle'

  return (
    <PartFrame>
      <Header id={id} hobkin={hobkin} state={state} mood={mood} split={split} />
      {/* Its tasks, teams agents, helpers and loaded skills from all the turns hobkin holds, in sight above the
          conversation, each opening over it: every agent's page has the same lines. */}
      <AgentLines agentId={hobkinAgentId(id)} hue={hueOf(id)} name={hobkin?.title ?? 'This hobkin'} className="mx-[var(--page-gutter,10%)]" />
      <Conversation
        id={id}
        turns={turns}
        cwd={hobkin?.cwd}
        sending={shownSending}
        problem={problem}
        // A hobkin with no turn yet has no conversation to read: the page waits for its first message.
        loading={state === 'live' && read === null && !problem && !fresh}
      />
    </PartFrame>
  )
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What End says it does to a durable hobkin, after the question. */
const HOBKIN_END = 'Its turn stops and it leaves the list. Its conversation stays on disk.'

/** The hobkin's header: its face, its name, renamed in place, its folder, what it runs on and whether it works. */
function Header({ id, hobkin, state, mood, split }: { id: string; hobkin: HobkinSummary | undefined; state: PageState; mood: ReturnType<typeof doingOf>['mood']; split: boolean }) {
  const models = useModelChoices()
  const onClaudeCode = useOnClaudeCode(id, hobkin)
  const status = useStopResult(hobkin?.run ?? null)
  const title = hobkin?.title ?? (state === 'starting' ? 'Starting the new hobkin' : 'This hobkin has ended')
  const rename = useMemo(() => {
    const send = async (title: string) => {
      await runCommand('hobkin.rename', { id, title })
    }
    return { max: HOBKIN_TITLE_MAX, send }
  }, [id])
  const line = hobkin ? `${folderName(hobkin.cwd)} · ${engineLabel(hobkin.engine, models)} · ${stateLabel(hobkin.state)}` : null
  return (
    <PageHeader
      agentId={hobkinAgentId(id)}
      split={split}
      face={
        // On Claude Code the crab pal stands beside the face, and while it waits long they fall asleep together.
        onClaudeCode ? (
          <Pals id={id} hue={hueOf(id)} size={48} mood={mood} working={hobkin?.state === 'working'} restingSince={hobkin?.waiting ? Date.parse(hobkin.waiting.since) : undefined} />
        ) : (
          <AgentHood hue={hueOf(id)} size={48} mood={mood} working={hobkin?.state === 'working'} />
        )
      }
      title={title}
      rename={hobkin ? rename : undefined}
      line={line}
      lineTitle={hobkin?.cwd}
      end={hobkin ? { ready: true, why: HOBKIN_END } : null}
      status={status}
    />
  )
}

/** A row of the conversation, a run of its schedules, or the row that reads the live turn's older steps from its run's saved session. */
type ShownRow = PageRow | RunsRow | { kind: 'older'; key: 'older' }

/** When a row happened, for the schedules' runs to stand among the rows (`withRuns`). Thinking is now, after every run. */
function rowTime(row: PageRow): number | null {
  if (row.kind === 'thinking') return Infinity
  if (row.kind === 'step') return atOf(row.step) ?? null
  return row.at
}
const OLDER_ROW: ShownRow = { kind: 'older', key: 'older' }

interface ConversationProps {
  /** The hobkin's id: how many of its newest rows are drawn is kept by it. */
  id: string
  turns: readonly ShownTurn[]
  cwd?: string
  /** The message on its way to the host now. */
  sending: SendingNote | null
  problem: string | null
  loading: boolean
}

/**
 * Each turn's message, its steps and its answer, oldest at the top, and the turn in flight last. It opens at the newest
 * and stays there as steps arrive, unless the user scrolled up to read. Up and Down walk it, as an agent's steps. A hobkin
 * with no turn yet has nothing here until its first message is sent. Each row keeps its key while the host catches up
 * with a message sent (`pageRows`), so none is drawn twice. Every row says when it happened, in a column at its left. It
 * reads the turns' steps itself, so a step draws the conversation alone: the live turn's, and those of each turn that is
 * over from the time it is drawn (`turn-steps.ts`).
 */
const Conversation = memo(ConversationRows)

function ConversationRows({ id, turns, cwd, sending, problem, loading }: ConversationProps) {
  const still = useStill()
  const live = useHasHost()
  const scroll = useFollow()
  // The live turn's feed keeps its newest steps. The ones it let go are read from its run's saved session, a page at a
  // time, and come after the turn's message, where the row that reads them stands.
  const run = turns.find((turn) => turn.live)?.run ?? null
  const activity = useAgentActivity(run)
  const job = live && activity && !activity.sample ? run : null
  const older = useOlderSteps(job)
  const saved = earlierRow(0, { more: older.more, loading: older.loading, mayHaveOlder: job !== null && mayHaveOlder(activity?.entries) })
  const offersOlder = saved !== null
  // The steps of each turn drawn so far, the one in flight among them, so they stay when it ends (`withDrawnTurns`).
  const [drawn, setDrawn] = useState<readonly string[]>([])
  const turnsWithSteps = useMemo(() => (run && !drawn.includes(run) ? [...drawn, run] : drawn), [drawn, run])
  const finished = useTurnSteps(turnsWithSteps, { live: run, cwd })
  // A step reads a whole output from its own turn's run, and its times as that run's.
  const jobOf = (turnRun: string) => (turnRun === run ? job : live ? turnRun : null)
  const timeOfStep = (turnRun: string) => (turnRun === run && activity ? activity.timeOf : timeOfTurn(turnRun))
  // Each run of the hobkin's schedules stands where it happened, from hobkin's record of them (056).
  const runs = useScheduleRuns({ kind: 'hobkin', id })
  const rows = useMemo(() => {
    const entries = activity && older.steps.length ? [...older.steps, ...activity.entries] : activity?.entries
    const liveSteps = activity && entries ? { entries, cwd: activity.cwd ?? cwd, seenAt: (id: string) => activity.timeOf(id)?.seen } : null
    const said = pageRows(turns, { sending, activity: liveSteps, finished })
    const page: readonly ShownRow[] = withRuns(said, runs, rowTime)
    return offersOlder && job ? withEarlier(page, (row) => row.kind === 'step' && row.key.startsWith(`${job}:`), OLDER_ROW) : page
  }, [turns, sending, activity, older.steps, cwd, offersOlder, job, runs, finished])
  // A long conversation draws only its newest rows, with a row above them for the ones before (newest.ts). The step
  // being read stays where it was when older steps come.
  const newest = useNewest(id, rows)
  useEffect(() => setDrawn((held) => withDrawnTurns(held, newest.shown)), [newest.shown])
  const holdPlace = useReadingPlace(scroll.scroller, older.steps)
  const readOlder = () => {
    holdPlace()
    newest.toCome()
    older.loadMore()
  }

  return (
    <div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      className="scroll-quiet relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[var(--page-gutter,10%)] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
    >
      <ol ref={scroll.content} data-agent-exchange onKeyDown={walkSteps} aria-label="The conversation" className="mt-auto flex flex-col gap-3 pt-2 pb-3">
        {newest.earlier ? <EarlierSteps row={{ kind: 'held', count: newest.earlier }} onMore={newest.more} /> : null}
        <ShowStamps>
          {/* The rows drawn with the page are simply there. Later ones arrive, and nothing leaves with a motion. */}
          <Arrivals>
            {newest.shown.map((row) =>
              row.kind === 'older' ? (
                saved ? <EarlierSteps key={row.key} row={saved} onMore={readOlder} /> : null
              ) : row.kind === 'said' ? (
                <Said key={row.key} text={row.text} images={row.images} at={row.at} delivery={row.delivery} from={row.from} />
              ) : row.kind === 'step' ? (
                // The same element whether its turn is in flight or over, so a step keeps its place as its turn ends.
                <StepJob.Provider key={row.key} value={jobOf(row.run)}>
                  <StepItem step={row.step} timeOf={timeOfStep(row.run)} ended={row.ended} />
                </StepJob.Provider>
              ) : row.kind === 'answer' ? (
                <Answer key={row.key} turn={row.turn} at={row.at} />
              ) : row.kind === 'schedule' ? (
                <ScheduleRunsItem key={row.key} row={row} />
              ) : (
                <Working key={row.key} run={run} />
              ),
            )}
          </Arrivals>
        </ShowStamps>
        {loading ? <li className="self-center text-[13px] text-muted-foreground">Reading the conversation.</li> : null}
        {problem ? (
          <li role="alert" className="self-center text-[13px] text-bad-fg">
            The conversation could not be read: {problem}
          </li>
        ) : null}
      </ol>
      {/* Stays just above the talk box while the user reads further up, and takes them back to the newest. */}
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

const STEP = 'rounded-[18px] outline-none [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]'

/**
 * What began a turn, or what the user added while it worked. The user's own words sit on their side, marked as on an
 * agent's page with how far they have got. Words another hobkin sent (`from`) are an agent's, so they keep to the left,
 * outlined, under who sent them. The row spans the page, so its time stands in the column with the others, and the
 * bubble takes the keyboard's ring.
 */
function Said({ text, images, at, delivery, from = null }: { text: string; images?: readonly Attachment[]; at: number | null; delivery: Delivery | null; from?: string | null }) {
  const arrival = useArrival()
  return (
    <li data-step="note" tabIndex={-1} className={cn('group w-full min-w-0 px-2.5 outline-none [contain-intrinsic-size:auto_48px] [content-visibility:auto]', arrival)}>
      <Stamped at={at} line={from ? 'from' : 'bubble'}>
        <div
          className={cn(
            'w-fit max-w-[72%] rounded-2xl px-3.5 py-2 text-left text-[15px] leading-relaxed break-words group-focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
            from ? 'rounded-bl-md border border-border' : 'ml-auto rounded-br-md bg-secondary',
          )}
        >
          {from ? <p className="mb-1 text-[11px] leading-normal text-muted-foreground">From {from}</p> : null}
          {images ? <SentImages attachments={images} /> : null}
          {/* Its own box, so the last paragraph keeps no space under it above the mark. */}
          <div>
            <MessageText text={text} role="user" />
          </div>
          <DeliveryMark delivery={delivery} why="The turn ended without a confirmed receipt." />
        </div>
      </Stamped>
    </li>
  )
}

/** Why a turn shows no answer, or what went wrong with it. Null for an answer that needs no word. */
function whyOf(turn: ShownTurn): string | null {
  const detail = turn.error ? `: ${turn.error}` : '.'
  if (turn.status === 'failed') return `This turn failed${detail}`
  if (turn.status === 'interrupted') return `This turn was cut off${detail}`
  if (turn.status === 'running') return 'Still at work when this was read.'
  return turn.reply ? null : 'It ended without an answer.'
}

/** A finished turn's answer, or why it has none, timed by when the turn ended. */
function Answer({ turn, at }: { turn: ShownTurn; at: number | null }) {
  const arrival = useArrival()
  const why = whyOf(turn)
  const wentWrong = turn.status === 'failed' || turn.status === 'interrupted'
  return (
    <li data-step="says" tabIndex={-1} className={cn('w-full min-w-0 px-2.5 text-left [contain-intrinsic-size:auto_56px]', STEP, arrival)}>
      <Stamped at={at} line={turn.reply ? 'text' : 'note'}>
        {turn.reply ? (
          <div className="max-w-[92%] text-[15px] leading-relaxed break-words">
            <MessageText text={turn.reply} role="assistant" />
          </div>
        ) : null}
        {why ? <p className={cn('text-[13px] leading-snug', wentWrong ? 'text-bad-fg' : 'text-muted-foreground', turn.reply && 'mt-1.5')}>{why}</p> : null}
      </Stamped>
    </li>
  )
}

/**
 * Between steps of the turn in flight: its working line while the host sends the run's pulse, else that it thinks. hobkin
 * keeps none of its thinking. It is now, so its place in the times' column is empty. It waits a moment before it shows,
 * so a quick step after the last one does not flash it, and it goes at once.
 */
function Working({ run }: { run: string | null }) {
  const arrival = useArrival()
  return (
    <li data-arrive="late" className={cn('pl-2.5 text-[13px] text-muted-foreground', arrival)}>
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="aa-running size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <Pulse run={run} fallback="Thinking" className="min-w-0 truncate" />
        </span>
      </Stamped>
    </li>
  )
}

/**
 * The talk box, at the bottom for as long as the hobkin lives. While it waits a message starts its next turn, its first
 * one included; while it works the message reaches the turn in flight. It takes the keyboard when clicked, or when the
 * page is entered for it. Under it is only what the user cannot see otherwise: a refusal, or that nothing can be sent.
 */
interface TalkProps {
  id: string
  split: boolean
  /** What the user sent from the page, and the message on its way now: what waits for the turn in flight shows above the box. */
  sent: readonly SentNote[]
  sending: SendingNote | null
  onSending: (note: SendingNote | null) => void
  onSent: (note: SentNote) => void
  /** Notes the user took back into the box, by their ids. */
  onTakenBack: (noteIds: readonly string[]) => void
}

function Talk({ id, split, sent, sending, onSending, onSent, onTakenBack }: TalkProps) {
  const { hobkin, state, connected, fresh } = useHobkin(id)
  // Images pasted or dropped on the box go with the words, as in the main input.
  const agent = hobkinAgentId(id)
  const images = useAgentImageInput(agent, true)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  /** What a /model or /effort line did, under the box. */
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = hobkin?.title ?? 'the new hobkin'
  const working = hobkin?.state === 'working'
  const text = draft.trim()
  const canSend = connected && !busy && (text.length > 0 || images.attachments.length > 0) && images.ready && text.length <= HOBKIN_MESSAGE_MAX
  const box = useRef<HTMLFormElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)
  // A message that starts with a slash lists what Pi offers this hobkin's own session, and /model its tier or model.
  const slash = usePageSlash({
    agentId: agent,
    agent: { hobkin: id },
    text: draft,
    setText: setDraft,
    open: connected && talkOpen(state),
    setProblem,
    setSaid,
    onSent: (words, sent) => onSent({ text: words, at: Date.now(), ...sent }),
  })
  // The keys and the button every message box shares, with this hobkin's own commands behind them.
  const talkAgent = useMemo<TalkAgent>(() => ({ kind: 'hobkin', id }), [id])
  const rows = useMemo(() => {
    const notes = sending ? [...sent, sending] : sent
    return waitingRows(notes.map((note) => ({ ...note, id: String(note.at), text: note.text || imagesLine(note.images?.length ?? 0), waiting: waitsForTurn(note, hobkin) })))
  }, [sent, sending, hobkin])
  const controls = useTalkControls(talkAgent, {
    canSend,
    empty: !text && images.attachments.length === 0,
    queued: rows.length > 0,
    send: (words, queue) => void send(words, queue),
    setDraft,
    dropNotes: onTakenBack,
    setProblem,
  })

  if (!talkOpen(state)) {
    return <p className="shrink-0 px-[var(--page-gutter,10%)] pt-2 pb-6 text-center text-[13px] text-muted-foreground">This hobkin has ended. Its conversation stays on disk.</p>
  }

  // `words` are sent in place of the draft, which stays: Continue. `queue` is how they wait for the turn in flight; an
  // interrupting message starts a turn of its own, so it waits for none.
  const send = async (words?: string, queue?: TalkQueue) => {
    if (words === undefined ? !canSend : !connected || busy) return
    const text = (words ?? draft).trim()
    setSaid(null)
    useAgentImages.getState().clearProblem(agent)
    // A command its session offers runs there, and a bare /model opens the choice of tier or model.
    if (!images.attachments.length && slash.sendCommand(text)) return
    // A /model or /effort line changes how the hobkin works instead of being sent to it.
    const change = changeLine(text)
    if (change) {
      if ('problem' in change) return setProblem(change.problem)
      setBusy(true)
      setProblem(null)
      setDraft('')
      const done = await sendChange({ hobkin: id }, change, { live: true, run: (name, args) => runCommand(name, args as never) })
      if (done.ok) setSaid(done.message)
      else {
        setProblem(done.why)
        setDraft((now) => now || text)
      }
      setBusy(false)
      return
    }
    // When Enter was pressed keys the message's row, on its way and once sent. The images go with the words, and the id
    // hobkin's receipt names once the turn in flight reads them in.
    const at = Date.now()
    const noteId = crypto.randomUUID()
    const attached = words === undefined ? useAgentImages.getState().take(agent) : []
    const pictures = attached.length ? { images: attached } : {}
    const waits = working && queue !== 'interrupt' ? (queue ?? 'steer') : undefined
    setBusy(true)
    setProblem(null)
    if (words === undefined) setDraft('')
    onSending({ text, at, ...pictures, ...(waits ? { queue: waits } : {}) })
    try {
      // When Enter was pressed goes with the words, for the timing of the turn, to a host that takes it.
      const handles = attached.flatMap(({ handle }) => (handle ? [handle] : []))
      const said = await controls.talk.say({ text, noteId, images: handles, ...sentAtArg(hostStore.getState(), at), ...(queue ? { queue } : {}) })
      onSent({ text, at, run: said.run, started: said.started, noteId, ...pictures, ...(waits && !said.started ? { queue: waits } : {}) })
      controls.giveBack(said.unsent)
    } catch (error) {
      setProblem(message(error))
      // Nothing was sent: the words and images come back to the box, unless the user has written or attached again.
      if (words === undefined) setDraft((now) => now || text)
      useAgentImages.getState().restore(agent, attached)
    } finally {
      onSending(null)
      setBusy(false)
    }
  }

  const label = working ? `Add to what ${name} is doing` : `Message ${name}`
  const placeholder = images.dropping ? 'Drop the image to attach it' : fresh && !working ? 'What should it do first?' : label

  return (
    <div className="shrink-0 px-[var(--page-gutter,10%)] pt-2 pb-2">
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
        <AgentSlashOver slash={slash} agentId={agent} box={box} input={input} />
        <AttachmentTray attachments={images.attachments} onRemove={images.remove} />
        <div className="flex items-end gap-2">
          <span className="grid size-9 shrink-0 place-items-center">
            <AgentHood hue={hueOf(id)} size={26} mood={working ? 'working' : 'listening'} working={working} />
          </span>
          <textarea
            // macOS would offer its own corrections in a bubble over the field; the user writes as they mean.
            autoCorrect="off"
            autoCapitalize="off"
            // Which agent the box writes to, so the full prompt opened from it writes there too.
            data-agent-input={agent}
            ref={input}
            {...slash.inputProps}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={images.onPaste}
            onKeyDown={(event) => {
              // While the list of commands is open its keys come first, then the keys every message box shares.
              if (slash.onKeyDown(event) || images.removeLast(event)) return
              if (controls.onKeyDown(event)) return event.preventDefault()
              if (event.key === 'Escape') {
                // Back onto the hobkin in the list. Without the list, or with the split over it, the frame leaves the page.
                if (!split && focusAgentsDock()) event.preventDefault()
              } else if (event.key === 'ArrowUp' && !draft && !event.defaultPrevented) {
                if (focusNewestStep(event.currentTarget) || (!split && focusAgentsDock())) event.preventDefault()
              }
            }}
            rows={1}
            maxLength={HOBKIN_MESSAGE_MAX}
            placeholder={placeholder}
            aria-label={label}
            // In the split the page is the chat's width, where a hobkin's long name would wrap the placeholder out of sight.
            className={cn(
              'field-sizing-content max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-snug outline-none placeholder:text-muted-foreground',
              split && 'placeholder:truncate',
            )}
          />
          <SendButton
            turnRunning={controls.working}
            canSend={canSend}
            stopping={controls.stopping}
            onStop={controls.stop}
            sendLabel={working ? 'Send to the turn in flight' : 'Send'}
            stopLabel="Stop this turn"
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
          ) : controls.stopped && connected ? (
            // The turn the user stopped is the last thing above the box, so it goes on from here.
            <ContinueButton className="-my-1" onContinue={() => void send(CONTINUE_WORDS)} />
          ) : connected ? null : (
            <p className="text-muted-foreground">hobkin is not connected, so nothing can be sent.</p>
          )}
        </div>
      </div>
      {/* Control+Option+P here opens the full prompt on this box's message, sent as the box sends it. */}
      <AgentPromptEditor
        agent={agent}
        to={{
          name,
          face: <AgentHood hue={hueOf(id)} size={22} mood={working ? 'working' : 'listening'} working={working} />,
        }}
        text={draft}
        setText={setDraft}
        canSend={canSend}
        turnRunning={controls.working}
        send={(queue) => void send(undefined, queue)}
      />
    </div>
  )
}
