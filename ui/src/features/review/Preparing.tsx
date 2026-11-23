import { BellRing, FolderGit2, GitPullRequest, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { useStops } from '@/app/stops.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { ReviewLoader } from './loader.ts'
import { LiveLog } from './preparing/LiveLog.tsx'
import { ProgressLine } from './preparing/ProgressLine.tsx'
import { Timeline } from './preparing/Timeline.tsx'
import './preparing/preparing.css'
import { elapsedAt, preparingOf, type Preparing as Run, type Subject } from './preparing-model.ts'
import { useReduced } from './state/context.tsx'

const CARD = 'rounded-3xl bg-background p-5'
const HEADING = 'font-heading text-[14px] font-semibold text-muted-foreground'

/**
 * The review window while a review is being prepared, and the page that waits for "Start AI review" on a pull request.
 * At the top, what is reviewed: the pull request or the project, its title, the commits and the size of the change.
 * Then that the window can be closed, what the run is doing now in large type with how far along it is and the time,
 * its log as it grows, and every step. The loader reads the review's status every second, and the view draws again only
 * when it says something new. The clock moves only the texts of the time: the run's, and its running step's.
 *
 * Purpose of the motion: the view arrives once there is something to say, the sentence of what it does now changes in
 * place, and only the running step breathes. With reduced motion everything is there at once and holds still.
 */
export function Preparing({ loader, closeReview }: { loader: ReviewLoader; closeReview: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const status = useStore(loader, (state) => state.status)
  const preparation = useStore(loader, (state) => state.preparation)
  const startedAt = useStore(loader, (state) => state.startedAt)
  const reduced = useReduced()
  const awaiting = status === 'awaiting'
  // Read at this moment: the texts of the time read it again themselves as the clock moves (`Times`, `Timeline`).
  const run = preparingOf(preparation, startedAt, Date.now())
  useStops(root)
  // "Start AI review" goes once it is pressed. The keyboard stays in the view, on its first control.
  useEffect(() => {
    if (status === 'preparing' && document.activeElement === document.body) root.current?.querySelector<HTMLElement>('[data-stop]')?.focus({ preventScroll: true })
  }, [status])
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: tween.enter }
    : { initial: { opacity: 0, transform: 'translateY(14px)' }, animate: { opacity: 1, transform: 'translateY(0px)' }, transition: { transform: spring.push, opacity: tween.enter } }

  return (
    <div ref={root} data-reduced={reduced} className="@container scroll-quiet h-full overflow-y-auto">
      <motion.div {...enter} className="mx-auto flex w-full max-w-(--page-width) flex-col gap-5 px-6 pt-28 pb-12 @3xl:px-10">
        <Header run={run} awaiting={awaiting} reduced={reduced} />
        {awaiting ? (
          <Ask start={() => void loader.start()} close={closeReview} />
        ) : (
          <>
            <CloseLine close={closeReview} />
            {/* Narrow, one column: now, the steps, the log. Wide, the steps go to the right of the other two. */}
            <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] @3xl:grid-rows-[auto_1fr] @3xl:items-start">
              <Now run={run} startedAt={startedAt} reduced={reduced} />
              <Steps run={run} className="@3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1" />
              <Log run={run} className="@3xl:col-start-1 @3xl:row-start-2" />
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}

/** What is reviewed, and how the review of it stands, with hobkin at work beside it. */
function Header({ run, awaiting, reduced }: { run: Run; awaiting: boolean; reduced: boolean }) {
  const { subject } = run
  const Place = subject?.kind === 'change' ? FolderGit2 : GitPullRequest
  const stopped = !awaiting && run.state === 'failed'
  const mood: Mood = awaiting ? 'hello' : stopped ? 'confused' : run.state === 'queued' ? 'idle' : 'working'
  const standing = awaiting ? 'Not reviewed yet' : stopped ? 'Stopped' : run.state === 'queued' ? 'Waiting its turn' : 'Preparing the review'
  return (
    <header className="flex items-start gap-4 @3xl:gap-5">
      <Hob mood={mood} size={72} stage="var(--card)" still={reduced} className="shrink-0" />
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {subject ? (
            <p className="flex min-w-0 items-center gap-1.5 font-heading text-[14px] font-semibold text-muted-foreground">
              <Place className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{subject.place}</span>
            </p>
          ) : null}
          {subject?.title ? <span className={cn('rounded-full px-2.5 py-0.5 font-heading text-[14px] font-semibold', stopped ? 'bg-bad/15 text-bad-fg' : 'bg-sun/15 text-sun-fg')}>{standing}</span> : null}
        </div>
        <h1 className="mt-1.5 font-heading text-[26px] leading-[1.18] font-semibold tracking-[-0.025em] text-pretty [overflow-wrap:anywhere] @3xl:text-[30px]">
          {subject?.title ?? (awaiting ? 'This pull request has not been reviewed yet' : standing)}
        </h1>
        {subject ? <Facts subject={subject} /> : null}
      </div>
    </header>
  )
}

/** The commits compared and the size of the change, once the run says them. */
function Facts({ subject }: { subject: Subject }) {
  const { commits, files, added, removed } = subject
  if (!commits && files == null && added == null) return null
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground tabular-nums">
      {commits ? <span className="font-mono" title="The commits compared">{commits}</span> : null}
      {commits && files != null ? <span aria-hidden="true">·</span> : null}
      {files != null ? <span>{files === 1 ? '1 file' : `${files} files`}</span> : null}
      {added != null && removed != null ? (
        <>
          <span aria-hidden="true">·</span>
          <span aria-label={`${added} lines added and ${removed} removed`}>
            <span className="font-medium text-ok-fg">+{added}</span> <span className="font-medium text-bad-fg">−{removed}</span>
          </span>
        </>
      ) : null}
    </p>
  )
}

/** A pull request is reviewed only when asked: this is the one thing to do here. */
function Ask({ start, close }: { start: () => void; close: () => void }) {
  return (
    <section aria-label="Start AI review" className="flex flex-col items-start gap-5 rounded-3xl bg-background p-6">
      <p className="max-w-[62ch] text-[16px] leading-relaxed text-pretty">
        hobkin reads the change, runs its tests and rates the risk of each part, then walks you through it. It runs in the background: you can close this window, and hobkin tells you in the chat when the review is ready.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button data-stop="" className="h-11 gap-2 px-5 text-[15px] font-semibold" onClick={start}>
          <Sparkles className="size-[18px]" />
          Start AI review
        </Button>
        <Button data-stop="" variant="ghost" className="h-11 px-4 text-[15px]" onClick={close}>
          Not now
        </Button>
      </div>
    </section>
  )
}

function CloseLine({ close }: { close: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-background px-4 py-3">
      <BellRing className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-[14rem] flex-1 text-[15px] text-pretty">You can close this window. The review will be ready in the background, and hobkin will tell you in the chat.</p>
      <Button data-stop="" variant="outline" className="h-9 px-4 text-[14px]" onClick={close}>
        Close and keep it running
      </Button>
    </div>
  )
}

/** How long the run has taken and about how long is left: the one line of the view that follows the clock. */
function Times({ startedAt, left }: { startedAt: number | null; left: string | null }) {
  const elapsed = elapsedAt(startedAt, useNow(true, 1000))
  const times = [elapsed ? `${elapsed} so far` : 'Just started', left ? `about ${left} left` : null].filter(Boolean).join(' · ')
  return <p className="mt-3 text-[15px] text-muted-foreground tabular-nums">{times}</p>
}

/** What the run does right now, large, and how far along it is. */
function Now({ run, startedAt, reduced }: { run: Run; startedAt: number | null; reduced: boolean }) {
  const change = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: tween.fade }
    : { initial: { opacity: 0, transform: 'translateY(10px)' }, animate: { opacity: 1, transform: 'translateY(0px)' }, exit: { opacity: 0, transform: 'translateY(-10px)' }, transition: { transform: spring.push, opacity: tween.enter } }
  return (
    <section aria-label="Now" className={cn(CARD, 'min-w-0 @3xl:col-start-1 @3xl:row-start-1 @3xl:p-6')}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={HEADING}>Now</h2>
        {run.position ? (
          <span className="text-[14px] text-muted-foreground tabular-nums">
            Step {run.position.step} of {run.position.of}
          </span>
        ) : null}
      </div>
      {/* Said once for a screen reader; the sentence on screen slides from one to the next. */}
      <p className="sr-only" role="status" aria-live="polite">
        {run.now}
      </p>
      <div aria-hidden="true" className="relative mt-2 min-h-[68px] overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p key={run.now} {...change} className="font-heading text-[26px] leading-[1.28] font-semibold tracking-[-0.02em] text-pretty [overflow-wrap:anywhere] @3xl:text-[28px]">
            {run.now}
          </motion.p>
        </AnimatePresence>
      </div>
      {run.error ? <p className="mt-2 text-[15px] text-pretty text-bad-fg [overflow-wrap:anywhere]">{run.error}</p> : null}
      <div className="mt-5 flex items-center gap-4">
        {run.percent != null ? <span className="w-[4ch] shrink-0 font-heading text-[28px] leading-none font-semibold tabular-nums">{run.percent}%</span> : null}
        <ProgressLine percent={run.percent} state={run.state} label="How far along the review is" className="flex-1" />
      </div>
      <Times startedAt={startedAt} left={run.left} />
    </section>
  )
}

function Log({ run, className }: { run: Run; className?: string }) {
  const count = run.log.length
  return (
    <section aria-label="Log" className={cn(CARD, 'min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={HEADING}>Log</h2>
        {count ? <span className="text-[14px] text-muted-foreground tabular-nums">{count === 1 ? '1 line' : `${count} lines`}</span> : null}
      </div>
      <LiveLog lines={run.log} stop className="mt-3 h-[min(300px,42vh)] rounded-2xl bg-code-bg px-4 py-3 text-code-text" />
    </section>
  )
}

function Steps({ run, className }: { run: Run; className?: string }) {
  const ended = run.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length
  return (
    <section aria-label="Steps" className={cn(CARD, className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className={HEADING}>Steps</h2>
        {run.steps.length ? (
          <span className="text-[14px] text-muted-foreground tabular-nums">
            {ended} of {run.steps.length} done
          </span>
        ) : null}
      </div>
      {run.steps.length ? (
        <Timeline steps={run.steps} />
      ) : (
        <p className="text-[15px] text-pretty text-muted-foreground">
          {run.state === 'queued' ? 'It starts as soon as the review before it ends.' : 'First the change is read and its graph is built. The steps of its review show here as soon as it starts.'}
        </p>
      )}
    </section>
  )
}
