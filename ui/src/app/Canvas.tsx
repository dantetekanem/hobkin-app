import { AnimatePresence, animate, motion, useMotionValue, type MotionValue, type Transition, type Variants } from 'motion/react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ComponentType, type CSSProperties } from 'react'
import { spring, stagger, tween } from '@/lib/motion.ts'
import { HomeScreen } from '@/features/home/HomeScreen.tsx'
import { ReportsScreen } from '@/features/reports/ReportsScreen.tsx'
import { RoutinesScreen } from '@/features/routines/RoutinesScreen.tsx'
import { SettingsScreen } from '@/features/settings/SettingsScreen.tsx'
import { useNeedsSignIn } from '@/features/signin/SignInGate.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { SignInScreen } from '@/features/signin/SignInScreen.tsx'
import { agentEntry, entryTransition } from '@/features/work/agent-entry.ts'
import { AgentScreen } from '@/features/work/AgentScreen.tsx'
import { MainAgentScreen } from '@/features/main-agent/MainAgentScreen.tsx'
import { WorkScreen } from '@/features/work/WorkScreen.tsx'
import { WorldScreen } from '@/features/work/WorldScreen.tsx'
import { YoloScreen } from '@/features/work/YoloScreen.tsx'
import ProjectScreen from '@/features/project/ProjectScreen.tsx'
import { ProofScreen } from '@/features/proofs/ProofScreen.tsx'
import { ActionsScreen } from '@/features/actions/ActionsScreen.tsx'
import { CanvasPane } from '@/features/canvas-panel/CanvasPane.tsx'
import { CanvasScreen } from '@/features/canvas-panel/CanvasScreen.tsx'
import { useSplit, useSplitSizes } from '@/features/canvas-panel/use-board.ts'
import { useCanvasPlace } from '@/features/canvas-panel/use-place.ts'
import { HobkinScreen } from '@/features/hobkins/HobkinScreen.tsx'
import { hobkinOfAgent } from '#shared/protocol/hobkins.ts'
import { NotWiredYet } from './NotWiredYet.tsx'
import { dragLeft, useDragEdge } from './drag-edge.ts'
import { keepAgentPreview } from './keep-agent.ts'
import { ScreenBoundary } from './ScreenBoundary.tsx'
import { PAGE_TOP } from './screen-layout.ts'
import { ScreenMenu } from './ScreenMenu.tsx'
import { useStill } from './still.ts'
import { partScreen } from '@/integration/screens.ts'
import { type CoreScreenId, type ScreenId } from './screens.ts'
import { canvasGrowth, pageInsetMove, useView, type ScreenMotion } from './view-store.ts'

// The menu's screens load with the frame. A screen loaded on demand slides in empty, and React shows it only once its
// fallback has been up for a while, so its content would appear in place after the slide instead of sliding in.
const IntegrationsScreen = lazy(() => import('@/features/integrations/IntegrationsScreen.tsx').then((module) => ({ default: module.IntegrationsScreen })))
const SkillsScreen = lazy(() => import('@/features/skills/SkillsScreen.tsx').then((module) => ({ default: module.SkillsScreen })))
const ExtensionsScreen = lazy(() => import('@/features/extensions/ExtensionsScreen.tsx').then((module) => ({ default: module.ExtensionsScreen })))
const MemoryScreen = lazy(() => import('@/features/memory/MemoryScreen.tsx').then((module) => ({ default: module.MemoryScreen })))
const ReviewScreen = lazy(() => import('@/features/review/ReviewScreen.tsx').then((module) => ({ default: module.ReviewScreen })))

/**
 * Screens that so far can show only sample data. While a host is connected they are not drawn: the user's own
 * hobkin is never shown made-up data. Each leaves this list when it reads hobkin.
 */
const NOT_WIRED: ReadonlySet<ScreenId> = new Set<ScreenId>([])

/** A project's page, for the project the view has open. */
function OpenProjectPage() {
  const project = useView((view) => view.project)
  return <ProjectScreen slug={project ?? ''} />
}

/** Each canvas screen. A feature replaces its placeholder here when it is built. */
const SCREEN_VIEWS: Record<CoreScreenId, ComponentType> = {
  home: HomeScreen,
  work: WorkScreen,
  world: WorldScreen,
  yolo: YoloScreen,
  project: OpenProjectPage,
  proof: ProofScreen,
  routines: RoutinesScreen,
  reports: ReportsScreen,
  actions: ActionsScreen,
  integrations: IntegrationsScreen,
  skills: SkillsScreen,
  extensions: ExtensionsScreen,
  memory: MemoryScreen,
  agent: AgentScreen,
  mind: MainAgentScreen,
  review: ReviewScreen,
  settings: SettingsScreen,
  canvas: CanvasScreen,
}

const PAGE_START = { '--page-top': `${PAGE_TOP}px` } as CSSProperties

const place = (x: number, y: number, scale: number) => `translateX(${x}%) translateY(${y}%) scale(${scale})`

/** Where a screen travels from and to, and whether it may travel at all: under Still it only fades. */
type Travel = ScreenMotion & { still: boolean; agent: boolean }

/**
 * A screen crosses the whole canvas. Along the menu it travels sideways, in the direction of its item.
 * Along the agents list it travels up and down, as the list does. The new one pushes the one leaving off the
 * canvas: both travel the full width together on one spring, so the eye follows them across, and a second key
 * press mid-flight simply retargets them.
 */
const travel: Variants = {
  enter: ({ axis, direction, still }: Travel) =>
    still ? { opacity: 0 } : { opacity: 1, transform: axis === 'x' ? place(direction * 100, 0, 1) : place(0, direction * 100, 1) },
  // Under Still a screen never travels, and one caught mid-travel when Still was chosen is set straight at once.
  center: ({ still, agent }: Travel) => ({
    opacity: 1,
    transform: place(0, 0, 1),
    transition: entryTransition(agent, still, { transform: still ? { duration: 0 } : spring.push, opacity: tween.enter }),
  }),
  exit: ({ axis, direction, still, agent }: Travel) =>
    still
      ? { opacity: 0, transition: entryTransition(agent, still, { opacity: { duration: 0.2, ease: 'linear' } }) }
      : { transform: axis === 'x' ? place(-direction * 100, 0, 1) : place(0, -direction * 100, 1), transition: entryTransition(agent, still, { transform: spring.push }) },
}

/**
 * The pieces of a screen land one after another as it travels in (Hero and Rise in Reveal.tsx), so they are seen
 * arriving with it. A screen that loads on demand mounts after its section has started, and its pieces would then
 * wait for an entrance that already happened and stay hidden. So every screen gets an entrance of its own, played
 * when the screen itself mounts.
 */
const arrive: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger } },
}

/**
 * How the right side grows over the chat: on the screens' spring, as it always has. A durable hobkin's split forms on
 * that spring and undoes on the exit spring. Under Still it is set at once.
 */
function useGrowth(split: boolean, enteringAgent: boolean, still: boolean): Transition {
  const was = useRef(split)
  const undoing = was.current && !split
  useEffect(() => {
    was.current = split
  })
  if (still) return { duration: 0 }
  if (split) return spring.screen
  if (undoing) return spring.screenExit
  return entryTransition(enteringAgent, still, spring.screen)
}

/**
 * How far a durable hobkin's page is inset from the right, to give its split's canvas the room. The split forming or
 * undoing on the page moves it on the split's spring; arriving on the page, a resize or Still put it straight there. A
 * page on its way out keeps the width it had, as everything else on it does.
 */
function usePageInset(onPage: boolean, split: boolean, canvasWidth: number, still: boolean): MotionValue<number> {
  const inset = useMotionValue(split ? canvasWidth : 0)
  const was = useRef({ onPage, split, sent: split ? canvasWidth : 0 })
  // Checked on every draw, so a split the window missed does not leave the page wide.
  useLayoutEffect(() => {
    const before = was.current
    const move = pageInsetMove({ onPage, wasOnPage: before.onPage, split, wasSplit: before.split, sent: before.sent, canvasWidth, still })
    const target = split ? canvasWidth : 0
    was.current = { onPage, split, sent: move === 'leave' ? before.sent : target }
    if (move === 'jump') inset.jump(target)
    else if (move === 'travel') animate(inset, target, split ? spring.screen : spring.screenExit)
  })
  return inset
}

/**
 * The canvas: the right side of a two-sided app. It runs flush to the top, bottom and right of the window,
 * and its left edge, rounded and shadowed, is the one division, where it lies over the chat.
 * The screen menu floats over its top. A screen fills it edge to edge, so its content may pass under the menu.
 *
 * The main hobkin's canvas is a screen of its own here, `canvas` (040-canvas-board). A durable hobkin's canvas forms a
 * split with its page instead: the right side grows over the whole chat, the page takes the chat's place, and the
 * canvas slides in at the right side's usual width. The menu, the drag strip and the page's top-right control keep
 * their places over the canvas, on the same spring.
 */
export function Canvas() {
  const screen = useView((view) => view.screen)
  const motionOf = useView((view) => view.screenMotion)
  const openAgent = useView((view) => view.openAgent)
  const engaged = useView((view) => view.canvasEngaged)
  const engageCanvas = useView((view) => view.engageCanvas)
  const conversationWidth = useView((view) => view.conversationWidth)
  // Model setup replaces ordinary screens, but never the screens holding agent controls.
  const needsModel = useNeedsSignIn()
  const hasHost = useHasHost()
  const still = useStill()
  const enteringAgent = screen === 'agent' && !needsModel
  const travelOf: Travel = { ...motionOf, still, agent: enteringAgent }
  // A durable hobkin is an agent with a page of its own (034-durable-hobkins). Moving between it and an agent travels.
  const durable = enteringAgent && hobkinOfAgent(openAgent) !== null
  const View = needsModel ? SignInScreen : durable ? HobkinScreen : SCREEN_VIEWS[screen as CoreScreenId] ?? partScreen(screen)?.component ?? WorkScreen
  const splitNow = useSplit()
  const split = needsModel ? null : splitNow
  const sizes = useSplitSizes()
  const trail = useView((view) => view.trail)
  const grow = canvasGrowth({ screen, canvasEngaged: engaged, conversationWidth, trail, split: split !== null })
  // The main canvas moves the view, unless the right side covers the chat right then.
  useCanvasPlace({ covered: grow > 0, split: split ? { owner: split.owner, revision: split.canvas.revision } : null })
  const growth = useGrowth(split !== null, enteringAgent, still)
  const pageInset = usePageInset(durable, split !== null, sizes.canvasWidth, still)
  // While the split grows the right side over the chat, what floats over the canvas moves back by as much.
  const shift = split ? grow : 0
  const dragEdge = useDragEdge((state) => state.edge)
  // Each agent has a key of its own, which focus and the keys go by. The agents share one section, though: moving from
  // one agent to the next keeps the canvas and its controls in place, and only the agent's own pieces change on it.
  // Each project's page is its own too, so going from one project to another travels.
  const project = useView((view) => view.project)
  const key = needsModel
    ? 'connect'
    : screen === 'agent'
      ? `agent:${openAgent}`
      : screen === 'project'
        ? `project:${project}`
        : screen
  const section = enteringAgent ? (durable ? 'hobkin' : 'agent') : key

  return (
    <motion.main
      data-active-canvas-screen={key}
      className="@container relative z-30 min-w-0 flex-1"
      // The canvas takes room from the chat by sliding its left edge over it. The chat itself does not move.
      initial={false}
      animate={{ marginLeft: -grow }}
      transition={growth}
      // A click in the canvas is as good as stepping into it with the keyboard.
      onPointerDown={engageCanvas}
      // A click on an agent previewed from the agents list keeps it open, before the list lets the keyboard go.
      onPointerDownCapture={keepAgentPreview}
    >
      {/* The empty top of the canvas, around the menu, is a title bar: it drags the window and a double-click zooms it.
          It never starts a text selection, which the Mac window would paint as a band of the selection color. */}
      {/* The empty top is a window-drag title bar, but it must not cover the top-right controls (Nerd stats, close,
          Stop) that some screens place there, or it swallows their clicks. Leave that corner out of the drag region. */}
      <motion.div
        data-tauri-drag-region
        className="select-none-chrome absolute top-0 right-80 z-10 h-14"
        initial={false}
        animate={{ left: dragLeft(shift, dragEdge) }}
        transition={growth}
      />
      {needsModel ? null : <ScreenMenu shift={shift} transition={growth} />}
      {/* Every page starts at the same height under the menu and the trail, whatever the menu shows (screen-layout.ts). */}
      <div className="relative grid h-full overflow-hidden rounded-l-[26px] bg-surface shadow-float" style={PAGE_START}>
        {/* A durable hobkin's canvas in its split. Before the screens, so the page's own top-right control shows over it. */}
        <AnimatePresence initial={false}>
          {split ? <CanvasPane key="split" owner={split.owner} width={sizes.canvasWidth} /> : null}
        </AnimatePresence>
        <AnimatePresence initial={false} custom={travelOf}>
          <motion.section
            key={section}
            custom={travelOf}
            variants={travel}
            initial="enter"
            animate="center"
            exit="exit"
            tabIndex={-1}
            data-canvas-screen={key}
            // A durable hobkin's page narrows to the chat's place while its canvas is open beside it.
            style={section === 'hobkin' ? { marginRight: pageInset } : undefined}
            className="col-start-1 row-start-1 min-h-0 min-w-0 rounded-l-[26px] outline-none will-change-transform"
          >
            <ScreenBoundary of={key}>
              <Suspense fallback={null}>
                <motion.div className="h-full" variants={enteringAgent ? { enter: {}, center: { transition: agentEntry(still) } } : arrive} initial="enter" animate="center">
                  {hasHost && !needsModel && NOT_WIRED.has(screen) ? <NotWiredYet screen={screen} /> : <View />}
                </motion.div>
              </Suspense>
            </ScreenBoundary>
          </motion.section>
        </AnimatePresence>
      </div>
    </motion.main>
  )
}
