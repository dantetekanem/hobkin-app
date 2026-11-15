import { ArrowDown, ArrowUp } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { HOBKIN_MESSAGE_MAX, HOBKIN_TITLE_MAX, hobkinAgentId, hobkinOfAgent, type HobkinConversation, type HobkinSummary } from '#shared/protocol/hobkins.ts'
import { focusAgentsDock } from '@/app/AgentsDock.tsx'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useSplit, useSplitSizes } from '@/features/canvas-panel/use-board.ts'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { TaskList } from '@/features/agent-activity/TaskList.tsx'
import { StepItem } from '@/features/agent-activity/StepView.tsx'
import { useAgentActivity, type AgentActivity } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { MessageText } from '@/features/chat/markdown.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { AgentStopControl, upToAgents, walkSteps } from '@/features/work/AgentScreen.tsx'
import { doingOf, folderName, hasHost, hueOf } from '@/lib/host/frame.ts'
import { hostStore, runCommand, useHost } from '@/lib/host/index.ts'
import { sentAtArg } from '@/lib/host/state.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { firstMessageNext, pageRows, pageState, pageTurns, talkOpen, type PageState, type SendingNote, type SentNote, type ShownTurn } from './conversation.ts'
import { endingOf, pressEndOf, takeBackEnd, useEnding } from './end.ts'
import { engineLabel, stateLabel } from './rules.ts'
import { useNewHobkin } from './store.ts'
import { useConversation, useMarkSeen } from './use-conversation.ts'

/**
 * A durable hobkin's page: the agent screen for the agent id `hobkin:<id>` (`034-durable-hobkins`). Its name, folder,
 * what it runs on and whether it works or waits; then its conversation, each turn's message and answer, with the steps of
 * the turn in flight drawn as any agent's are (`021-agent-rendering`); and the talk box, always there until it is ended.
 *
 * Moving to another durable hobkin, its own pieces cross-fade, as an agent's do. Stop and the talk box stay in place.
 *
 * While its canvas is open the page forms a split with it (`040-canvas-board`): the page takes the chat's place and
 * the canvas the right side. The agents list is covered then, so the page's keys no longer lead to it.
 */
export function HobkinScreen() {
  // A screen on its way out keeps showing its own hobkin while the next one arrives, and the split it had.
  const present = useIsPresent()
  const openAgent = useView((view) => view.openAgent)
  const kept = useRef(openAgent)
  if (present) kept.current = openAgent
  const id = hobkinOfAgent(kept.current)
  const notes = useSentNotes()
  const splitOwner = useSplit()?.owner ?? null
  const keptSplit = useRef(false)
  if (present) keptSplit.current = id !== null && splitOwner === id
  const split = keptSplit.current
  const sizes = useSplitSizes()

  return (
    <div className="relative flex h-full flex-col" onKeyDown={split ? undefined : upToAgents}>
      {/* Where the chat's header was, the window is dragged by the top of the page. */}
      {split ? <div data-tauri-drag-region className="select-none-chrome absolute inset-x-0 top-0 z-10 h-12" /> : null}
      {id ? <StopTurn id={id} shift={split ? sizes.canvasWidth : 0} /> : null}
      <div className="relative min-h-0 flex-1">
        {/* Propagated, so a page leaving with its screen counts as gone, as an agent's does. */}
        <AnimatePresence initial={false} propagate>
          {id ? <Part key={id} id={id} split={split} sent={notes.sent[id] ?? NO_NOTES} sending={notes.sending[id] ?? null} /> : null}
        </AnimatePresence>
      </div>
      {id ? <Talk key={id} id={id} split={split} onSending={(note) => notes.sendingTo(id, note)} onSent={(note) => notes.add(id, note)} /> : null}
    </div>
  )
}

const NO_NOTES: readonly SentNote[] = []

/** What the user sent from the page, by hobkin, and the message on its way now. Kept while the window is open. */
function useSentNotes() {
  const [sent, setSent] = useState<Record<string, readonly SentNote[]>>({})
  const [sending, setSending] = useState<Record<string, SendingNote | null>>({})

  const add = useCallback((id: string, note: SentNote) => {
    setSent((all) => ({ ...all, [id]: [...(all[id] ?? []), note] }))
  }, [])

  const sendingTo = useCallback((id: string, note: SendingNote | null) => {
    setSending((all) => ({ ...all, [id]: note }))
  }, [])

  return { sent, sending, add, sendingTo }
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

/** The split's spring: it forms on the screens' spring and undoes on their exit spring. */
const splitSpring = (split: boolean) => (split ? spring.screen : spring.screenExit)

/**
 * Stop for the turn in flight: the one an agent's screen has for its run. While the hobkin waits there is nothing to stop.
 * In the split it keeps its place at the window's top right, over the canvas, while the page narrows under it (`shift`).
 * Only the split forming or undoing moves it, on the split's spring; a resize puts it straight there.
 */
function StopTurn({ id, shift }: { id: string; shift: number }) {
  const still = useStill()
  const run = useHost((state) => state.snapshot.hobkins?.find((summary) => summary.id === id)?.run ?? null)
  const inSplit = shift > 0
  const was = useRef(inSplit)
  const turned = inSplit !== was.current
  useEffect(() => {
    was.current = inSplit
  })
  const transition = still || !turned ? { duration: 0 } : splitSpring(inSplit)
  // As wide as the page, so Stop lays out as it always has, and no taller than nothing, so it covers nothing around Stop.
  return run ? (
    <motion.div className="absolute inset-x-0 top-0 z-10" initial={false} animate={{ x: shift }} transition={transition}>
      <AgentStopControl key={run} agentId={run} />
    </motion.div>
  ) : null
}

const RISE_IN = {
  initial: { opacity: 0, transform: 'translateY(22px) scale(0.96)' },
  animate: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } },
} as const

/** The hobkin's own pieces: its header and its conversation. Leaving, it takes no keyboard and no pointer. */
function Part({ id, split, sent, sending }: { id: string; split: boolean; sent: readonly SentNote[]; sending: SendingNote | null }) {
  const present = useIsPresent()
  const { hobkin, state, connected, fresh } = useHobkin(id)
  const onPage = useView((view) => view.screen === 'agent' && view.openAgent === hobkinAgentId(id))
  useMarkSeen(hobkin, onPage && present, connected)
  const { conversation, problem } = useConversation(id, hobkin, connected)

  // Before the first read answers, a turn in flight still shows, with the message that began it.
  const read = useMemo<HobkinConversation | null>(() => conversation ?? (hobkin?.run ? { hobkin, turns: [] } : null), [conversation, hobkin])
  const turns = useMemo(() => pageTurns(read, hobkin, sent), [read, hobkin, sent])
  // The live turn's steps: the one in flight, or the one just over until a read has its answer. The host keeps them.
  const activity = useAgentActivity(turns.find((turn) => turn.live)?.run ?? null)
  const mood = hobkin?.state === 'working' ? doingOf(activity ? [...activity.entries] : undefined).mood : 'idle'

  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      inert={!present}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
    >
      <Header id={id} hobkin={hobkin} state={state} mood={mood} split={split} />
      {/* The tasks of the turn in flight, as one line that stays in sight above the conversation and opens over it. */}
      <div className="relative z-10 flex shrink-0 justify-center px-[10%]">
        <TaskList entries={activity?.entries} hue={hueOf(id)} />
      </div>
      <Conversation
        turns={turns}
        activity={activity}
        cwd={hobkin?.cwd}
        sending={sending}
        problem={problem}
        // A hobkin with no turn yet has no conversation to read: the page waits for its first message.
        loading={state === 'live' && read === null && !problem && !fresh}
      />
    </motion.div>
  )
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Its face, its name (renamed in place), its folder, what it runs on and whether it works; and End, which asks once.
 * Control+X presses End too (`end.ts`), so the key and the button share the ask.
 *
 * Its top leaves room for the floating menu above it. In the split the menu is over the canvas and the page is where the
 * chat is, so it leaves room for the window's own buttons and a drag strip instead.
 */
function Header({ id, hobkin, state, mood, split }: { id: string; hobkin: HobkinSummary | undefined; state: PageState; mood: ReturnType<typeof doingOf>['mood']; split: boolean }) {
  const still = useStill()
  const top = split ? 56 : 76
  const models = useModelChoices()
  const [naming, setNaming] = useState<string | null>(null)
  const [renamed, setRenamed] = useState<string | null>(null)
  const ending = useEnding((store) => endingOf(store, id))
  const endProblem = useEnding((store) => (store.id === id ? store.problem : null))
  const [renameProblem, setProblem] = useState<string | null>(null)
  const problem = endProblem ?? renameProblem
  const nameButton = useRef<HTMLButtonElement | null>(null)
  // Leaving the page takes the ask back, as it always has.
  useEffect(() => () => takeBackEnd(id, false), [id])
  /** The name being typed, read once: Enter and the blur as the field goes must not both send it. */
  const draft = useRef<string | null>(null)
  const title = renamed !== null && renamed !== hobkin?.title ? renamed : hobkin?.title
  const shownTitle = title ?? (state === 'starting' ? 'Starting the new hobkin' : 'This hobkin has ended')

  const beginRename = (current: string) => {
    draft.current = current
    setNaming(current)
  }

  const stopRenaming = () => {
    draft.current = null
    setNaming(null)
    requestAnimationFrame(() => nameButton.current?.focus({ preventScroll: true }))
  }

  const rename = async () => {
    if (draft.current === null) return
    const next = draft.current.trim()
    stopRenaming()
    if (!hobkin || !next || next === hobkin.title) return
    setProblem(null)
    setRenamed(next)
    try {
      await runCommand('hobkin.rename', { id, title: next })
    } catch (error) {
      setRenamed(null)
      setProblem(message(error))
    }
  }

  const pressEnd = () => {
    setProblem(null)
    pressEndOf(id)
  }
  const stopAsking = () => takeBackEnd(id, true)

  return (
    <motion.div
      className="flex flex-col gap-2 px-[10%] pb-3"
      initial={{ ...holdStill(RISE_IN.initial, still), paddingTop: top }}
      animate={{
        ...holdStill(RISE_IN.animate, still),
        paddingTop: top,
        transition: { ...RISE_IN.animate.transition, paddingTop: still ? { duration: 0 } : splitSpring(split) },
      }}
    >
      <div className="flex items-center gap-3">
        <AgentHood hue={hueOf(id)} size={48} mood={mood} working={hobkin?.state === 'working'} />
        <div className="min-w-0 flex-1">
          {naming !== null ? (
            <input
              autoFocus
              aria-label="Name"
              value={naming}
              maxLength={HOBKIN_TITLE_MAX}
              onChange={(event) => {
                draft.current = event.target.value
                setNaming(event.target.value)
              }}
              onBlur={() => void rename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void rename()
                } else if (event.key === 'Escape') {
                  // The rename is let go, and the screen stays.
                  event.preventDefault()
                  stopRenaming()
                }
              }}
              className="w-full rounded-lg bg-surface-2 px-2 py-0.5 font-heading text-[20px] font-semibold tracking-[-0.022em] outline-none select-text"
            />
          ) : (
            <h2 className="truncate font-heading text-[20px] font-semibold tracking-[-0.022em]">
              {hobkin ? (
                <button
                  ref={nameButton}
                  type="button"
                  title="Rename"
                  onClick={() => beginRename(title ?? '')}
                  className="max-w-full truncate rounded-lg px-2 py-0.5 -mx-2 text-left transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
                >
                  {shownTitle}
                </button>
              ) : (
                shownTitle
              )}
            </h2>
          )}
          {hobkin ? (
            <p className="truncate text-[13px] text-muted-foreground" title={hobkin.cwd}>
              {folderName(hobkin.cwd)} · {engineLabel(hobkin.engine, models)} · {stateLabel(hobkin.state)}
            </p>
          ) : null}
        </div>
        {hobkin && ending === 'no' ? (
          <Button data-end-hobkin={id} variant="ghost" size="sm" onClick={pressEnd}>
            End <Kbd>⌃X</Kbd>
          </Button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {hobkin && ending !== 'no' ? (
          <motion.div
            key="end"
            role="group"
            aria-label={`End ${shownTitle}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface-2 px-4 py-3"
            initial={holdStill({ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }, still)}
            animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }, still)}
            exit={holdStill({ opacity: 0, transform: 'translateY(-6px) scale(0.98)', transition: tween.exit }, still)}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Escape' || ending === 'busy') return
              event.preventDefault()
              stopAsking()
            }}
          >
            <p className="min-w-0 flex-1 basis-60 text-[13.5px] leading-snug">
              <span className="font-medium">End {shownTitle}?</span>{' '}
              <span className="text-muted-foreground">Its turn stops and it leaves the list. Its conversation stays on disk.</span>
            </p>
            <Button variant="destructive" size="sm" disabled={ending === 'busy'} onClick={pressEnd}>
              End it <Kbd>⌃X</Kbd>
            </Button>
            <Button data-end-keep={id} variant="ghost" size="sm" disabled={ending === 'busy'} onClick={stopAsking}>
              Keep it
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {problem ? (
        <p role="alert" className="text-[12px] text-bad-fg">
          {problem}
        </p>
      ) : null}
    </motion.div>
  )
}

/** The newest step, from the talk box with Up. False when there is nothing to walk. */
function focusNewestStep(input: Element): boolean {
  const list = input.closest('[data-canvas-screen]')?.querySelector<HTMLElement>('[data-agent-exchange]')
  const steps = list ? [...list.querySelectorAll<HTMLElement>(':scope > [data-step]')] : []
  const newest = steps.at(-1)
  newest?.focus()
  return Boolean(newest)
}

interface ConversationProps {
  turns: readonly ShownTurn[]
  activity: AgentActivity | null
  cwd?: string
  /** The message on its way to the host now. */
  sending: SendingNote | null
  problem: string | null
  loading: boolean
}

/**
 * Each turn's message and answer, oldest at the top, and the turn in flight last with its steps. It opens at the newest
 * and stays there as steps arrive, unless the user scrolled up to read. Up and Down walk it, as an agent's steps. A hobkin
 * with no turn yet has nothing here until its first message is sent. Each row keeps its key while the host catches up
 * with a message sent (`pageRows`), so none is drawn twice. Every row says when it happened, in a column at its left.
 */
function Conversation({ turns, activity, cwd, sending, problem, loading }: ConversationProps) {
  const still = useStill()
  const scroll = useFollow(still)
  const rows = useMemo(
    () => pageRows(turns, { sending, activity: activity ? { entries: activity.entries, cwd: activity.cwd ?? cwd, seenAt: (id) => activity.timeOf(id)?.seen } : null }),
    [turns, sending, activity, cwd],
  )
  scroll.note()
  useLayoutEffect(scroll.settle, [rows, scroll.settle])

  return (
    <div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      className="scroll-quiet relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[10%] [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
    >
      <motion.ol
        ref={scroll.content}
        style={{ y: scroll.y }}
        data-agent-exchange
        onKeyDown={walkSteps}
        aria-label="The conversation"
        className="mt-auto flex flex-col gap-3 pt-2 pb-3"
      >
        <ShowStamps>
          <AnimatePresence initial={false}>
            {rows.map((row) =>
              row.kind === 'said' ? (
                <Said key={row.key} text={row.text} at={row.at} added={row.tag === 'added'} sending={row.tag === 'sending'} from={row.from} />
              ) : row.kind === 'step' ? (
                <StepItem key={row.key} step={row.step} timeOf={activity!.timeOf} ended={row.ended} />
              ) : row.kind === 'answer' ? (
                <Answer key={row.key} turn={row.turn} at={row.at} />
              ) : (
                <Working key={row.key} />
              ),
            )}
          </AnimatePresence>
        </ShowStamps>
        {loading ? <li className="self-center text-[13px] text-muted-foreground">Reading the conversation.</li> : null}
        {problem ? (
          <li role="alert" className="self-center text-[13px] text-bad-fg">
            The conversation could not be read: {problem}
          </li>
        ) : null}
      </motion.ol>
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
 * What began a turn, or what the user added while it worked. The user's own words sit on their side. Words another
 * hobkin sent (`from`) are an agent's, so they keep to the left, outlined, under who sent them. The row spans the
 * page, so its time stands in the column with the others, and the bubble takes the keyboard's ring.
 */
function Said({ text, at, added = false, sending = false, from = null }: { text: string; at: number | null; added?: boolean; sending?: boolean; from?: string | null }) {
  const still = useStill()
  return (
    <motion.li
      data-step="note"
      tabIndex={-1}
      initial={holdStill(RISE_IN.initial, still)}
      animate={holdStill(RISE_IN.animate, still)}
      style={{ transformOrigin: from ? '0% 100%' : '100% 100%' }}
      className="group w-full min-w-0 px-2.5 outline-none [contain-intrinsic-size:auto_48px] [content-visibility:auto]"
    >
      <Stamped at={at} line={from ? 'from' : 'bubble'}>
        <div
          className={cn(
            'w-fit max-w-[72%] rounded-2xl px-3.5 py-2 text-left text-[15px] leading-relaxed break-words group-focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
            from ? 'rounded-bl-md border border-border' : 'ml-auto rounded-br-md bg-secondary',
          )}
        >
          {from ? <p className="mb-1 text-[11px] leading-normal text-muted-foreground">From {from}</p> : null}
          <MessageText text={text} role="user" />
          {added || sending ? <p className="mt-1 text-[11px] leading-normal text-muted-foreground">{sending ? 'Sending' : 'Added while it worked'}</p> : null}
        </div>
      </Stamped>
    </motion.li>
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
  const still = useStill()
  const why = whyOf(turn)
  const wentWrong = turn.status === 'failed' || turn.status === 'interrupted'
  return (
    <motion.li
      data-step="says"
      tabIndex={-1}
      initial={holdStill(RISE_IN.initial, still)}
      animate={holdStill(RISE_IN.animate, still)}
      style={{ transformOrigin: '0% 100%' }}
      className={cn('w-full min-w-0 px-2.5 text-left [contain-intrinsic-size:auto_56px]', STEP)}
    >
      <Stamped at={at} line={turn.reply ? 'text' : 'note'}>
        {turn.reply ? (
          <div className="max-w-[92%] text-[15px] leading-relaxed break-words">
            <MessageText text={turn.reply} role="assistant" />
          </div>
        ) : null}
        {why ? <p className={cn('text-[13px] leading-snug', wentWrong ? 'text-bad-fg' : 'text-muted-foreground', turn.reply && 'mt-1.5')}>{why}</p> : null}
      </Stamped>
    </motion.li>
  )
}

/** Between steps of the turn in flight. hobkin keeps none of its thinking. It is now, so its place in the times' column is empty. */
function Working() {
  const still = useStill()
  return (
    <motion.li
      initial={holdStill({ opacity: 0, transform: 'translateY(12px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: { ...tween.enter, delay: 0.3 } } }, still)}
      exit={{ opacity: 0, transition: tween.exit }}
      className="pl-2.5 text-[13px] text-muted-foreground"
    >
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="aa-running size-1.5 rounded-full bg-current" aria-hidden="true" />
          Thinking
        </span>
      </Stamped>
    </motion.li>
  )
}

/**
 * The talk box, at the bottom for as long as the hobkin lives. While it waits a message starts its next turn, its first
 * one included; while it works the message reaches the turn in flight. It takes the keyboard when clicked, or when the
 * page is entered for it. Under it is only what the user cannot see otherwise: a refusal, or that nothing can be sent.
 */
function Talk({ id, split, onSending, onSent }: { id: string; split: boolean; onSending: (note: SendingNote | null) => void; onSent: (note: SentNote) => void }) {
  const { hobkin, state, connected, fresh } = useHobkin(id)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = hobkin?.title ?? 'the new hobkin'
  const working = hobkin?.state === 'working'
  const text = draft.trim()
  const canSend = connected && !busy && text.length > 0 && text.length <= HOBKIN_MESSAGE_MAX

  if (!talkOpen(state)) {
    return <p className="shrink-0 px-[10%] pt-2 pb-6 text-center text-[13px] text-muted-foreground">This hobkin has ended. Its conversation stays on disk.</p>
  }

  const send = async () => {
    if (!canSend) return
    // When Enter was pressed keys the message's row, on its way and once sent.
    const at = Date.now()
    setBusy(true)
    setProblem(null)
    setDraft('')
    onSending({ text, at })
    try {
      // When Enter was pressed goes with the words, for the timing of the turn, to a host that takes it.
      const said = await runCommand('hobkin.say', { id, text, ...sentAtArg(hostStore.getState(), at) })
      onSent({ text, at, run: said.run, started: said.started })
    } catch (error) {
      setProblem(message(error))
      // Nothing was sent: the words come back to the box, unless the user has typed again.
      setDraft((now) => now || text)
    } finally {
      onSending(null)
      setBusy(false)
    }
  }

  const label = working ? `Add to what ${name} is doing` : `Message ${name}`
  const placeholder = fresh && !working ? 'What should it do first?' : label

  return (
    <div className="shrink-0 px-[10%] pt-2 pb-5">
      <form
        className="flex items-end gap-2 rounded-[26px] border-[1.5px] border-input bg-background py-2 pr-2 pl-3 shadow-panel transition-colors duration-[160ms] ease-[ease] focus-within:border-ring"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center">
          <AgentHood hue={hueOf(id)} size={26} mood={working ? 'working' : 'listening'} working={working} />
        </span>
        <textarea
          data-agent-input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // Back onto the hobkin in the list. Without the list, or with the split over it, the frame leaves the page.
              if (!split && focusAgentsDock()) event.preventDefault()
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send()
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
        <button
          type="submit"
          disabled={!canSend}
          aria-label={working ? 'Send to the turn in flight' : 'Send'}
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
      ) : connected ? null : (
        <p className="mt-1.5 px-3 text-[11px] text-muted-foreground">hobkin is not connected, so nothing can be sent.</p>
      )}
    </div>
  )
}
