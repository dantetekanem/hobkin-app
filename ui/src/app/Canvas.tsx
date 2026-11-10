import { AnimatePresence, motion, type Variants } from 'motion/react'
import { lazy, Suspense, type ComponentType } from 'react'
import { spring, stagger, staggerDelay, tween } from '@/lib/motion.ts'
import { PagesScreen } from '@/features/pages/PagesScreen.tsx'
import { SettingsScreen } from '@/features/settings/SettingsScreen.tsx'
import { useNeedsSignIn } from '@/features/signin/SignInGate.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { SignInScreen } from '@/features/signin/SignInScreen.tsx'
import { AgentScreen } from '@/features/work/AgentScreen.tsx'
import { NotWiredYet } from './NotWiredYet.tsx'
import { ScreenBoundary } from './ScreenBoundary.tsx'
import { ScreenMenu } from './ScreenMenu.tsx'
import { useStill } from './still.ts'
import { type ScreenId } from './screens.ts'
import { useView, type ScreenMotion } from './view-store.ts'

/** How far the canvas grows over the chat while the user talks to an agent, in pixels. */
export const TALK_GROW = 132
/** How much of the chat stays in view beside a review that has the user's attention, in pixels. */
export const REVIEW_KEEPS = 112

const ActionsScreen = lazy(() => import('@/features/actions/ActionsScreen.tsx').then((module) => ({ default: module.ActionsScreen })))
const GitHubScreen = lazy(() => import('@/features/github/GitHubScreen.tsx').then((module) => ({ default: module.GitHubScreen })))
const IntegrationsScreen = lazy(() => import('@/features/integrations/IntegrationsScreen.tsx').then((module) => ({ default: module.IntegrationsScreen })))
const ReportsScreen = lazy(() => import('@/features/reports/ReportsScreen.tsx').then((module) => ({ default: module.ReportsScreen })))
const ReviewScreen = lazy(() => import('@/features/review/ReviewScreen.tsx').then((module) => ({ default: module.ReviewScreen })))
const WorkScreen = lazy(() => import('@/features/work/WorkScreen.tsx').then((module) => ({ default: module.WorkScreen })))
const RoutinesScreen = lazy(() => import('@/features/routines/RoutinesScreen.tsx').then((module) => ({ default: module.RoutinesScreen })))

/**
 * Screens that so far can show only sample data. While a host is connected they are not drawn: the user's own
 * hobkin is never shown made-up data. Each leaves this list when it reads hobkin.
 */
const NOT_WIRED: ReadonlySet<ScreenId> = new Set(['integrations'])

/** Each canvas screen. A feature replaces its placeholder here when it is built. */
const SCREEN_VIEWS: Record<ScreenId, ComponentType> = {
  work: WorkScreen,
  routines: RoutinesScreen,
  reports: ReportsScreen,
  actions: ActionsScreen,
  integrations: IntegrationsScreen,
  pages: PagesScreen,
  github: GitHubScreen,
  agent: AgentScreen,
  review: ReviewScreen,
  settings: SettingsScreen,
}

const place = (x: number, y: number, scale: number) => `translateX(${x}%) translateY(${y}%) scale(${scale})`

/** Where a screen travels from and to, and whether it may travel at all: under Still it only fades. */
type Travel = ScreenMotion & { still: boolean }

/**
 * A screen crosses the whole canvas. Along the menu it travels sideways, in the direction of its item.
 * Along the agents list it travels up and down, as the list does. The one leaving falls back and fades
 * while the new one arrives on a spring, so a second key press mid-flight simply retargets it.
 */
const travel: Variants = {
  enter: ({ axis, direction, still }: Travel) =>
    still ? { opacity: 0 } : { opacity: 0, transform: axis === 'x' ? place(direction * 100, 0, 0.94) : place(0, direction * 100, 0.94) },
  // Under Still a screen never travels, and one caught mid-travel when Still was chosen is set straight at once.
  center: ({ still }: Travel) => ({
    opacity: 1,
    transform: place(0, 0, 1),
    transition: { transform: still ? { duration: 0 } : spring.screen, opacity: tween.enter, staggerChildren: stagger, delayChildren: staggerDelay },
  }),
  exit: ({ axis, direction, still }: Travel) =>
    still
      ? { opacity: 0, transition: { opacity: { duration: 0.2, ease: 'linear' } } }
      : {
          opacity: 0,
          transform: axis === 'x' ? place(-direction * 46, 0, 0.9) : place(0, -direction * 46, 0.9),
          transition: { transform: spring.screenExit, opacity: { duration: 0.28, ease: 'linear' } },
        },
}

/**
 * The pieces of a screen land one after another once it has arrived (Hero and Rise in Reveal.tsx). A screen
 * that loads on demand mounts after its section has already arrived, and its pieces would then wait for an
 * entrance that already happened and stay hidden. So every screen gets an entrance of its own, played when
 * the screen itself mounts, with the same timing as the section's.
 */
const arrive: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}

/**
 * The canvas: the right side of a two-sided app. It runs flush to the top, bottom and right of the window,
 * and its left edge, rounded and shadowed, is the one division, where it lies over the chat.
 * The screen menu floats over its top. A screen fills it edge to edge, so its content may pass under the menu.
 */
export function Canvas() {
  const screen = useView((view) => view.screen)
  const motionOf = useView((view) => view.screenMotion)
  const openAgent = useView((view) => view.openAgent)
  const talking = useView((view) => view.agentTalk)
  const engaged = useView((view) => view.canvasEngaged)
  const engageCanvas = useView((view) => view.engageCanvas)
  const conversationWidth = useView((view) => view.conversationWidth)
  // While Pi can use no model (or a sign-in is under way), "Connect a model" is the canvas, and the screens wait.
  const needsModel = useNeedsSignIn()
  const hasHost = useHasHost()
  const still = useStill()
  const travelOf: Travel = { ...motionOf, still }
  const View = needsModel ? SignInScreen : SCREEN_VIEWS[screen]
  // A review that has the user's attention takes almost the whole window. Talking to an agent takes a little.
  const grow = screen === 'review' && engaged ? Math.max(0, conversationWidth - REVIEW_KEEPS) : talking ? TALK_GROW : 0
  // Each agent is its own screen, so moving from one agent to the next travels too.
  const key = needsModel ? 'connect' : screen === 'agent' ? `agent:${openAgent}` : screen

  return (
    <motion.main
      aria-label="Canvas"
      className="@container relative z-30 min-w-0 flex-1"
      // The canvas takes room from the chat by sliding its left edge over it. The chat itself does not move.
      initial={false}
      animate={{ marginLeft: -grow }}
      transition={still ? { duration: 0 } : spring.screen}
      // A click in the canvas is as good as stepping into it with the keyboard.
      onPointerDown={engageCanvas}
    >
      {/* The empty top of the canvas, around the menu, is a title bar: it drags the window and a double-click zooms it.
          It never starts a text selection, which the Mac window would paint as a band of the selection color. */}
      <div data-tauri-drag-region className="select-none-chrome absolute inset-x-0 top-0 z-10 h-14" />
      {needsModel ? null : <ScreenMenu />}
      <div className="relative grid h-full overflow-hidden rounded-l-[26px] bg-surface shadow-float">
        <AnimatePresence initial={false} custom={travelOf}>
          <motion.section
            key={key}
            custom={travelOf}
            variants={travel}
            initial="enter"
            animate="center"
            exit="exit"
            tabIndex={-1}
            data-canvas-screen
            className="col-start-1 row-start-1 min-h-0 min-w-0 rounded-l-[26px] outline-none will-change-transform focus-visible:[box-shadow:inset_0_0_0_2px_var(--hb-focus)]"
          >
            <ScreenBoundary>
              <Suspense fallback={null}>
                <motion.div className="h-full" variants={arrive} initial="enter" animate="center">
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
