import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { handOffCanvasFocus } from '@/app/focus.ts'
import { Rise } from '@/app/Reveal.tsx'
import { holdStill, useStill } from '@/app/still.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { sampleAt, sampleLength } from '@/features/agent-activity/sample.ts'
import { familyOf, pauseOf, stepCount, stepsOf } from '@/features/agent-activity/steps.ts'
import { ShowStamps, Stamped } from '@/features/agent-activity/Stamp.tsx'
import { StepItem } from '@/features/agent-activity/StepView.tsx'
import { TaskList } from '@/features/agent-activity/TaskList.tsx'
import { mainTimeOf, type EntryTime } from '@/features/agent-activity/use-agent-activity.ts'
import { useFollow } from '@/features/agent-activity/use-follow.ts'
import { turnStartedAt, doingNow as turnWord } from '@/features/chat/doing.ts'
import { useNow } from '@/features/chat/use-now.ts'
import { ChildFaces } from '@/features/work/ChildAgents.tsx'
import { childrenSummary } from '@/features/work/child-summary.ts'
import { useMainChildren } from '@/features/work/children.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { mainActivityOf, quietLine, quietSince } from './mind.ts'
import { SAMPLE_MAIN } from './sample.ts'

/** When the sample first played, so it plays on from there. */
let sampleStart: number | undefined
/** hobkin's own hue, as its helpers' faces take their colors from it. */
const HUE = 42

/**
 * When the sample's steps first played. The host's are timed as the host sends them, whether the mind is open or not
 * (`mainTimeOf`), so a mind opened late shows its earlier steps' real times.
 */
const times = new Map<string, EntryTime>()
const sampleTimeOf = (id: string) => times.get(id)
function timeSteps(entries: readonly ActivityEntry[], now: number) {
  for (const entry of entries) {
    const time = times.get(entry.id)
    const running = entry.kind === 'tool' && entry.state === 'running'
    if (!time) times.set(entry.id, running ? { seen: now, started: now } : { seen: now })
    else if (!running && time.started !== undefined && time.ended === undefined) time.ended = now
  }
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** The face says what the steps say: a tool running, a pause between steps, or rest between turns. hobkin's thinking itself is never shown. */
function moodOf(entries: readonly ActivityEntry[], busy: boolean): Mood {
  if (!busy) return 'idle'
  const last = entries.at(-1)
  if (last?.kind !== 'tool' || last.state !== 'running') return 'thinking'
  return ['read', 'search', 'list', 'fetch'].includes(familyOf(last.name)) ? 'searching' : 'working'
}

/** The main agent's steps, helpers and turn: the host's while one is connected, the sample's before. */
function useMain() {
  const live = useHasHost()
  const hosted = useHost((state) => mainActivityOf(state.snapshot))
  const hostedBusy = useHost((state) => state.snapshot.busy === true)
  const hostedWord = useHost((state) => turnWord(state.snapshot))
  const [start] = useState(() => (sampleStart ??= Date.now()))
  const now = useNow(!live && Date.now() - start <= sampleLength(SAMPLE_MAIN), 500)
  const playing = now - start < sampleLength(SAMPLE_MAIN)
  const entries = live ? hosted : sampleAt(SAMPLE_MAIN, now - start)
  useMemo(() => !live && entries && timeSteps(entries, Date.now()), [live, entries])
  const turnStart = useHost((state) => turnStartedAt(state.snapshot))
  return {
    live,
    entries,
    timeOf: live ? mainTimeOf : sampleTimeOf,
    turnStart: live ? turnStart : null,
    children: useMainChildren(),
    busy: live ? hostedBusy : playing,
    word: live ? hostedWord : playing ? 'thinking' : null,
    cwd: live ? undefined : SAMPLE_MAIN.cwd,
  }
}

/**
 * Hobkin's mind: its main agent, the one the chat talks to, as it works right now (Command+J). Its steps read as an
 * agent's do, at the newest unless the user scrolls up. The chat stays usable beside it.
 */
export function MainAgentScreen() {
  const still = useStill()
  const { live, entries, timeOf, turnStart, children, busy, word, cwd } = useMain()
  const steps = entries ? stepCount(entries) : 0
  const status = busy ? `${capital(word ?? 'thinking')}${steps ? ` · ${steps === 1 ? '1 step' : `${steps} steps`}` : ''}` : 'Waiting for your next message'

  return (
    <div className="relative flex h-full flex-col">
      <Rise className="flex items-center gap-3 px-[10%] pt-[76px] pb-2">
        <Hob mood={moodOf(entries ?? [], busy)} size={48} still={still} />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[20px] font-semibold tracking-[-0.022em]">Hobkin's mind</h2>
          <p className="truncate text-[13px] text-muted-foreground">{status}</p>
        </div>
        {entries?.length ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Kbd>⌃O</Kbd>
            opens every block
          </span>
        ) : null}
      </Rise>
      {children.length ? <Helpers helpers={children} /> : null}
      {/* Outside the steps' scroller, so it stays in sight as they scroll. Its list opens over them from this row. */}
      {entries?.length ? (
        <div className="relative z-10 flex justify-center px-[10%] pb-2 empty:hidden">
          <TaskList entries={entries} hue={HUE} />
        </div>
      ) : null}
      {entries === null ? (
        <Blank>Hobkin's mind needs hobkin to restart once: the running hobkin is older than this view and does not send its main agent's steps.</Blank>
      ) : entries.length === 0 ? (
        <Blank>{busy ? `${capital(word ?? 'thinking')}. Its steps draw here as it works.` : 'No steps yet. They draw here as hobkin works on your next message.'}</Blank>
      ) : (
        <Exchange entries={entries} timeOf={timeOf} turnStart={turnStart} ended={!busy} cwd={cwd} word={busy && pauseOf(entries) === 'thinking' ? (word ?? 'thinking') : null} sample={!live} />
      )}
    </div>
  )
}

/**
 * Between steps the mind says what hobkin is doing and, from two seconds on, how long it has been quiet: since its last
 * step, or since its turn began when that came later (mind.ts), as an agent's canvas counts its Thinking.
 */
function Quiet({ word, entries, timeOf, turnStart }: { word: string; entries: readonly ActivityEntry[]; timeOf: (id: string) => EntryTime | undefined; turnStart: number | null }) {
  const lastStep = useMemo(() => {
    const seen = entries.map((entry) => timeOf(entry.id)).filter((time) => time !== undefined).map((time) => time.ended ?? time.seen)
    return seen.length ? Math.max(...seen) : undefined
  }, [entries, timeOf])
  const since = quietSince(lastStep, turnStart)
  const now = useNow(since !== undefined, 1000)
  return (
    <li className="pl-2.5 text-[13px] text-muted-foreground tabular-nums">
      {/* It is now, so its place in the times' column is empty. */}
      <Stamped line="note">
        <span className="flex items-center gap-2">
          <span className="aa-running size-1.5 rounded-full bg-current" aria-hidden="true" />
          {quietLine(word, since, now)}
        </span>
      </Stamped>
    </li>
  )
}

function Blank({ children }: { children: string }) {
  return <p className="mx-auto mt-[18vh] max-w-[46ch] px-6 text-center text-[15px] leading-relaxed text-muted-foreground">{children}</p>
}

/** The agents the main agent spawned: their faces, each with its story on hover, and the count. They run inside its Pi, so none of their steps are here. */
function Helpers({ helpers }: { helpers: readonly RunChild[] }) {
  const still = useStill()
  return (
    <motion.div className="flex items-center gap-2 px-[10%] pb-2 text-[12px] text-muted-foreground" initial={holdStill({ opacity: 0 }, still)} animate={{ opacity: 1, transition: tween.enter }}>
      <ChildFaces spawned={helpers} hue={HUE} />
      <span className="truncate">{childrenSummary(helpers)}</span>
    </motion.div>
  )
}

/**
 * The main agent's steps, top to bottom, drawn as an agent's canvas draws them, each with when it happened in a column
 * at its left. It opens at the newest and stays there as steps arrive, unless the user scrolled up to read, and then
 * offers the way back down. A keyboard handed to the mind lands here, so the arrows, Page keys, Home and End read it.
 */
function Exchange({ entries, timeOf, turnStart, ended, cwd, word, sample }: { entries: readonly ActivityEntry[]; timeOf: (id: string) => EntryTime | undefined; turnStart: number | null; ended: boolean; cwd?: string; word: string | null; sample: boolean }) {
  const still = useStill()
  const scroll = useFollow(still)
  // The tasks line above the steps is where task calls show.
  const steps = useMemo(() => stepsOf(entries, { ended, cwd, tasksOnLine: true }), [entries, ended, cwd])
  scroll.note()
  useLayoutEffect(scroll.settle, [steps, word, scroll.settle])
  useEffect(() => (scroll.scroller.current ? handOffCanvasFocus(scroll.scroller.current) : undefined), [scroll.scroller])

  return (
    <motion.div
      ref={scroll.scroller}
      onScroll={scroll.onScroll}
      tabIndex={-1}
      className="scroll-quiet relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[10%] outline-none [mask-image:linear-gradient(to_bottom,transparent,black_20px)]"
      initial={holdStill({ opacity: 0, transform: 'translateY(24px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: { transform: spring.rise, opacity: { duration: 0.24, delay: 0.06 } } }, still)}
    >
      <motion.ol ref={scroll.content} style={{ y: scroll.y }} aria-label="What hobkin has done" className="mt-auto flex flex-col gap-3 pt-2 pb-10">
        <ShowStamps>
          <AnimatePresence initial={false}>
            {steps.map((step) => (
              <StepItem key={step.key} step={step} timeOf={timeOf} ended={ended} />
            ))}
          </AnimatePresence>
          {word ? <Quiet word={word} entries={entries} timeOf={timeOf} turnStart={turnStart} /> : null}
        </ShowStamps>
        {sample ? <li className="self-center text-[12px] text-muted-foreground">Sample activity. With a host this is hobkin's own main agent, as it works.</li> : null}
      </motion.ol>
      <div className="pointer-events-none sticky bottom-4 z-10 flex h-0 justify-center">
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
