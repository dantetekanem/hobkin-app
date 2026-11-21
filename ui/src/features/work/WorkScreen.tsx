import { Map as MapIcon, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { requestCanvasFocus } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { useRunningAgents } from '@/app/running-agents.ts'
import { useStill } from '@/app/still.ts'
import { useStops } from '@/app/stops.ts'
import { Button } from '@/components/ui/button.tsx'
import { SAMPLE_YOLO } from '@/features/settings/yolo.ts'
import { rowVariants, useArriving } from '@/features/reports/list-motion.ts'
import type { WorkState } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { Discovery } from './Discovery.tsx'
import { groupReviews, reviewCounts, type ReviewGroup } from './ai-reviews.ts'
import { AiReviews } from './AiReviews.tsx'
import { DelegationMap } from './DelegationMap.tsx'
import { FinishedSection } from './Finished.tsx'
import { PageTabs, TabCount } from './PageTabs.tsx'
import { WhenWorkComes, WorkPage } from './page-arrival.tsx'
import { SaidLine, Segmented } from './parts.tsx'
import { ProjectsSection, QueueSection } from './Queue.tsx'
import { bindWorldProject, runWork, useWorkUi, useWorkView } from './store.ts'
import { useWorkTab } from './tab.ts'
import { useReviewList } from './use-review-list.ts'
import { bindWorkTarget } from './work-target.ts'
import { yoloAtAGlance } from './yolo-page.ts'

const TABS = ['work', 'reviews'] as const

/**
 * Work: hobkin and the agents it started, live, with the queue, the finished changes and the projects, and every AI
 * review on a page of its own. It draws hobkin's own work mode and calls hobkin's own work actions, and adds no rule
 * of its own. This file is the entry the frame mounts. Spec: 011-work.
 *
 * Its pages are tabs under the heading: Work, and AI Reviews with how many run and how many are ready. On Work, what
 * needs the user comes right after the queue, before the projects.
 *
 * Keys: Up and Down walk the screen. Enter opens or presses what has the keyboard: an agent's canvas, a queue row
 * run next, a change opened in Change Review. Left and Right move along a row to its own choices and back, change a
 * project's setting, and choose the page. Escape steps back from a choice to its row. Tab and Escape on a row are the frame's.
 */
export function WorkScreen() {
  const root = useRef<HTMLDivElement | null>(null)
  const main = useRef<HTMLDivElement | null>(null)
  useStops(main)
  const { work, live } = useWorkView()
  const worldAvailable = new Set(work?.projects.filter(project => project.state === 'chosen' && project.slug).map(project => project.slug)).size >= 3
  useLayoutEffect(() => bindWorldProject(main.current), [])
  // An item opened from another screen, such as an issue's chip on the GitHub page, takes the keyboard as Work arrives.
  useLayoutEffect(() => bindWorkTarget(main.current), [])
  // The same agents the list under the input shows: hobkin's own with a host, the frame's sample without one.
  // A durable hobkin is the user's own and no work of hobkin's, so it is left out here (034-durable-hobkins).
  const listed = useRunningAgents()
  const agents = useMemo(() => listed.filter((agent) => !agent.durable), [listed])
  const still = useStill()
  const arriving = useArriving()
  const variants = useMemo(() => rowVariants(still), [still])
  const tab = useWorkTab((state) => state.tab)
  const chooseTab = useWorkTab((state) => state.choose)
  // Which way the page came along the menu's second row: later pages from the right, earlier from the left.
  const shown = useRef(tab)
  const way = shown.current === tab ? 0 : TABS.indexOf(tab) > TABS.indexOf(shown.current) ? 1 : -1
  useEffect(() => {
    shown.current = tab
  })
  // The tab says how many reviews run and how many are ready, so the list is followed on either page.
  const reviews = useReviewList(live)
  const counts = reviewCounts(groupReviews(reviews.list))

  // Where the keyboard is in the screen, so it stays when what had it leaves: a merged card, a skipped row.
  const keyboard = useRef({ held: false, at: 0 })
  // Discovery slides over the screen: the main stops wait under it, and its trigger gets the keyboard back.
  const [discovering, setDiscovering] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const closeDiscovery = () => {
    setDiscovering(false)
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }
  const stops = () => [...(main.current?.querySelectorAll<HTMLElement>('[data-stop]') ?? [])]
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!main.current?.contains(event.target)) return
    keyboard.current.held = true
    const at = stops().findIndex((stop) => stop === event.target || stop.contains(event.target))
    if (at >= 0) keyboard.current.at = at
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) keyboard.current.held = false
  }
  const keepKeyboard = () => {
    requestAnimationFrame(() => {
      if (discovering) return
      const active = document.activeElement
      if (!keyboard.current.held || (active && active !== document.body)) return
      const all = stops()
      all[Math.min(keyboard.current.at, all.length - 1)]?.focus({ preventScroll: true })
    })
  }
  useEffect(keepKeyboard, [work])

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !(target instanceof HTMLElement)) return
    if (target.matches('input, textarea, [contenteditable="true"]')) return
    // Enter presses whatever has the keyboard, taken here rather than left to the browser. A key held down presses it
    // once: its repeats never give a second click, such as the one that confirms Close without merging.
    if (event.key === 'Enter' && target.matches('button, a[href]')) {
      event.preventDefault()
      if (!event.repeat) target.click()
      return
    }
    const item = target.closest<HTMLElement>('[data-work-item]')
    if (!item) return
    const main = item.matches('[data-work-main]') ? item : item.querySelector<HTMLElement>('[data-work-main]')
    const controls = controlsOf(item)
    const at = controls.indexOf(target)

    // Left and Right move along the row: from the row to its own choices and back. The walk stops at both ends.
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const next = Math.max(-1, Math.min(controls.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)))
      if (next !== at) (next === -1 ? main : controls[next])?.focus()
      event.preventDefault()
      return
    }
    if (at === -1) return
    if (event.key === 'Escape') {
      // One step back, onto the row.
      main?.focus()
      event.preventDefault()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // The walk between rows goes on from the row this choice belongs to.
      main?.focus()
    }
  }

  // Every piece of the lists takes its turn as the screen arrives. Later ones arrive on their own.
  let order = 0
  const turn = () => (arriving ? order++ : -1)
  const shared = { live, variants, turn }

  return (
    <div ref={root} onKeyDownCapture={onKeyDownCapture} onFocus={onFocus} onBlur={onBlur} className="relative h-full overflow-hidden">
      <div ref={main} inert={discovering} className={`${SCREEN_SCROLLER} pb-20`}>
      <div className={`flex flex-col gap-10 ${SCREEN_COLUMN}`}>
        <Hero>
          <Header work={work} live={live} working={agents.length} onOpenWorld={worldAvailable ? openWorld : undefined} />
        </Hero>
        <div className="flex flex-col gap-6">
          <PageTabs
            id="work"
            label="Work pages"
            value={tab}
            onChoose={chooseTab}
            tabs={[
              { value: 'work', label: 'Work' },
              { value: 'reviews', label: 'AI Reviews', extra: <ReviewCounts counts={counts} /> },
            ]}
          />
          {tab === 'reviews' ? (
            <WorkPage key="reviews" way={way} role="tabpanel" id="work-panel-reviews" aria-labelledby="work-tab-reviews">
              <AiReviews live={live} reviews={reviews} />
            </WorkPage>
          ) : (
            <WorkPage key="work" way={way} role="tabpanel" id="work-panel-work" aria-labelledby="work-tab-work" className="flex flex-col gap-10">
              <Rise>
                <section aria-label="At work" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-1">
                    <h2 className="eyebrow">At work</h2>
                    <span className="eyebrow tabular-nums">{agents.length}</span>
                    {agents.some(({ asks }) => asks) ? <span className="text-[11px] font-medium text-sun-fg">· {agents.filter(({ asks }) => asks).length} waiting for you</span> : null}
                    {work ? <AgentsAtOnce work={work} live={live} /> : null}
                  </div>
                  <DelegationMap agents={agents} capacity={work?.agents ?? 0} enabled={work?.enabled ?? false} live={live} />
                </section>
              </Rise>
              {work ? (
                <WhenWorkComes>
                  <Rise>
                    <QueueSection work={work} {...shared} />
                  </Rise>
                  {/* What needs the user comes right after the queue, so it is never a long scroll away. */}
                  <Rise>
                    <FinishedSection work={work} onRowsLeft={keepKeyboard} {...shared} />
                  </Rise>
                  <Rise>
                    <ProjectsSection work={work} onDiscover={() => setDiscovering(true)} discoverRef={trigger} {...shared} />
                  </Rise>
                </WhenWorkComes>
              ) : null}
            </WorkPage>
          )}
        </div>
      </div>
      </div>
      <AnimatePresence>{discovering && work ? <Discovery work={work} live={live} variants={variants} onClose={closeDiscovery} /> : null}</AnimatePresence>
    </div>
  )
}

/**
 * How many work agents may run at once: hobkin's own setting, as `hobkin work agents` sets it, from one to hobkin's
 * most. Left and Right change it. Running agents finish as they are.
 */
function AgentsAtOnce({ work, live }: { work: WorkState; live: boolean }) {
  const busy = useWorkUi((state) => Boolean(state.busy['agents']))
  const said = useWorkUi((state) => state.said['agents'])
  const options = Array.from({ length: work.maxAgents }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <span className="eyebrow">Agents at once</span>
      <Segmented
        label="Work agents that may run at once"
        name="agents-at-once"
        value={String(work.agentsAllowed)}
        options={options}
        disabled={busy}
        onChoose={(agents) => void runWork({ do: 'agents', agents: Number(agents) }, { live, place: 'agents' })}
      />
      {said?.tone === 'refused' ? <SaidLine tone="refused">{said.text}</SaidLine> : null}
    </div>
  )
}

/** Beside "AI Reviews": how many run and how many are ready to read. Nothing while there are none. */
function ReviewCounts({ counts }: { counts: Record<ReviewGroup, number> }) {
  return (
    <>
      {counts.unmerged ? <TabCount tone="live">{counts.unmerged} not merged</TabCount> : null}
      {counts.running ? <TabCount tone="live">{counts.running} running</TabCount> : null}
      {counts.ready ? <TabCount tone="ok">{counts.ready} ready</TabCount> : null}
    </>
  )
}

/** A row's own choices that can be pressed now, in reading order. A row inside a row keeps its choices to itself. */
function controlsOf(item: HTMLElement): HTMLElement[] {
  const all = [...item.querySelectorAll<HTMLElement>('[data-row-control]')]
  return all.filter((control) => {
    const ownRow = control.closest('[data-work-item]') === item
    const pressable = !control.matches(':disabled, [aria-disabled="true"]')
    return ownRow && pressable
  })
}

/** World is a page of its own, opened from Work. Coming back lands on a project, so Work comes back on its own page. */
function openWorld() {
  useWorkTab.getState().choose('work')
  useView.getState().openScreen('world')
  useView.getState().engageCanvas()
  requestCanvasFocus()
}

/** YOLO mode is a page of its own too. Coming back lands on the button that opened it, on whichever page of Work was showing. */
function openYolo() {
  useView.getState().openScreen('yolo')
  useView.getState().engageCanvas()
  requestCanvasFocus()
}

/**
 * Work's heading: what is going on, the ways to YOLO mode and World beside the mode switch on the same line, and what
 * the mode means. The buttons and the switch are one group of controls: the same height, centered on the title's line,
 * and kept at the right edge even when they wrap under a long title. The YOLO mode button says how it stands, and it is
 * first, so a longer word grows it to the left and moves nothing beside it.
 */
function Header({ work, live, working, onOpenWorld }: { work: WorkState | null; live: boolean; working: number; onOpenWorld?: () => void }) {
  const busy = useWorkUi((state) => Boolean(state.busy['mode']))
  const said = useWorkUi((state) => state.said['mode'])
  const [askingFolder, setAskingFolder] = useState(false)

  const turn = (on: boolean, folder?: string) => {
    // The first start needs to know where to look for projects.
    if (on && !folder && !work?.folder) return setAskingFolder(true)
    setAskingFolder(false)
    // The button or the folder question goes away, so the keyboard moves to the switch, where the change shows.
    document.querySelector<HTMLElement>('[data-work-switch]')?.focus({ preventScroll: true })
    void runWork({ do: 'mode', on, ...(folder ? { folder } : {}) }, { live, place: 'mode' })
  }

  if (!work) {
    return (
      <header className="flex flex-col gap-2 px-1">
        <h1 className="eyebrow">Work</h1>
        <p className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]">Work mode is not known yet</p>
        <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-muted-foreground">
          This host has not said anything about work mode yet.
        </p>
      </header>
    )
  }

  const yolo = live ? (work.yolo ?? null) : SAMPLE_YOLO
  const finished = work.finished.reduce((sum, { changes }) => sum + changes.length, 0)
  const title = work.enabled ? `${working} working, ${work.queued} queued, ${finished} finished` : 'Work mode is off'
  const line = work.enabled
    ? (work.forecast ?? (work.autoPick ? 'The top of the queue starts by itself.' : 'Auto-pick is off, so only what you start runs.'))
    : 'Nothing new starts. Agents that are running finish what they started, and projects, items and branches stay.'

  return (
    <header className="flex flex-col gap-2 px-1">
      <h1 className="eyebrow">Work</h1>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.025em]" aria-live="polite">
          {title}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {yolo ? (
            <Button variant="outline" data-stop="" data-opens="yolo" onClick={openYolo}>
              <Zap aria-hidden="true" />
              YOLO mode
              <span className="text-muted-foreground tabular-nums">{yoloAtAGlance(yolo)}</span>
            </Button>
          ) : null}
          {onOpenWorld ? (
            <Button variant="outline" data-stop="" data-opens="world" onClick={onOpenWorld}>
              <MapIcon aria-hidden="true" />
              Open world
            </Button>
          ) : null}
          <ModeSwitch on={work.enabled} busy={busy} onToggle={() => turn(!work.enabled)} />
        </div>
      </div>
      <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">{line}</p>
      {work.enabled && work.held ? <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-warn-fg">{work.held}</p> : null}
      {!work.enabled ? (
        <div className="mt-2 flex flex-col gap-2">
          {askingFolder ? (
            <FolderQuestion onStart={(folder) => turn(true, folder)} onCancel={() => setAskingFolder(false)} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button data-stop="" disabled={busy} focusableWhenDisabled onClick={() => turn(true)}>
                Turn work mode on
              </Button>
              <span className="text-[12.5px] text-muted-foreground">It starts nothing by itself: what runs is what you start, unless you chose auto-pick.</span>
            </div>
          )}
        </div>
      ) : null}
      {said?.tone === 'refused' ? <SaidLine tone="refused">{said.text}</SaidLine> : null}
      {live ? null : <p className="text-[12px] text-muted-foreground">Sample data. No host is running, so nothing here reaches hobkin.</p>}
    </header>
  )
}

/** Work mode's switch. Its knob travels on a spring, and under Still it is simply where it belongs. */
function ModeSwitch({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  const still = useStill()
  const knob = `translateX(${on ? 16 : 0}px)`
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Work mode"
      data-stop=""
      data-work-switch=""
      // Under way it stays focusable, so the keyboard stays on it.
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onToggle()
      }}
      className="inline-flex h-8 scroll-mt-[124px] items-center gap-2.5 rounded-full pr-3.5 pl-1 outline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:bg-tone-1 aria-disabled:opacity-60"
    >
      <span className={cn('relative h-6 w-10 rounded-full transition-colors duration-[220ms] ease-[ease]', on ? 'bg-primary' : 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--hb-border-strong)]')}>
        <motion.span
          className="absolute top-1 left-1 size-4 rounded-full bg-background shadow-panel"
          style={still ? { transform: knob } : undefined}
          initial={false}
          animate={still ? {} : { transform: knob }}
          transition={spring.pill}
        />
      </span>
      <span className="font-heading text-[13px] font-medium">Work mode {on ? 'on' : 'off'}</span>
    </button>
  )
}

/** The first start needs the folder to look for projects in, as `hobkin work start <folder>` does. */
function FolderQuestion({ onStart, onCancel }: { onStart: (folder: string) => void; onCancel: () => void }) {
  const [folder, setFolder] = useState('')
  const field = useRef<HTMLInputElement | null>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])
  const typed = folder.trim()
  return (
    <div className="flex max-w-[560px] flex-col gap-1.5">
      <label htmlFor="work-folder" className="text-[13.5px] font-medium">
        Start from which folder? hobkin looks there for projects to propose.
      </label>
      <div className="flex items-center gap-2">
        <input
          id="work-folder"
          ref={field}
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && typed) {
              event.preventDefault()
              onStart(typed)
            } else if (event.key === 'Escape') {
              // Used here, so the frame leaves it alone.
              event.preventDefault()
              onCancel()
            }
          }}
          placeholder="~/code"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-full border-[1.5px] border-input bg-background px-4 font-mono text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        <Button disabled={!typed} onClick={() => onStart(typed)}>
          Start
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">Enter starts. Esc cancels.</p>
    </div>
  )
}
