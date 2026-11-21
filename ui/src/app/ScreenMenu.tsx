import { ChevronRight, Download, ExternalLink, Presentation, RotateCw, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MAIN_CANVAS, type CanvasState } from '#shared/protocol/canvas.ts'
import { agentEntry, entryTransition } from '@/features/work/agent-entry.ts'
import { AgentHood } from '@/components/Mark.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { useActionCount } from '@/features/actions/store.ts'
import { useShellBrowser } from '@/features/canvas-panel/BrowserPane.tsx'
import { canOpenInBrowser, closeCanvas, openInBrowser, reloadCanvas, saveCanvas } from '@/features/canvas-panel/controls.ts'
import { canSave, isOpen, labelFor, mainPill } from '@/features/canvas-panel/rules.ts'
import { useBoard, useSplit } from '@/features/canvas-panel/use-board.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useHasHost, useHost } from '@/lib/host/index.ts'
import { ease, spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { focusBoard, focusTalk, keyboardInCanvas, requestCanvasFocus } from './focus.ts'
import { isUnderSettings, type PageUnderSettings } from './overlays.ts'
import { useRunningAgents } from './running-agents.ts'
import { inMenu, SCREENS, type ScreenId } from './screens.ts'
import { holdStill, useStill } from './still.ts'
import { useView } from './view-store.ts'

const ROW = 'relative flex items-center gap-0.5'
const ITEM =
  'relative flex h-8 items-center gap-1.5 rounded-full px-3 font-heading text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap outline-offset-0 transition-colors duration-[160ms] ease-[ease]'

/**
 * A piece of the second row dropping into place from the row above, after the pieces before it.
 * Each piece plays its own entrance instead of waiting for the row's, so a piece that arrives later
 * (an agent that starts, Integrations opened from Settings) drops in too instead of staying hidden.
 */
function popIn(index: number, still: boolean) {
  const delay = 0.05 + index * 0.03
  return {
    initial: holdStill({ opacity: 0, transform: 'translateY(-18px) scale(0.4)' }, still),
    animate: holdStill(
      {
        opacity: 1,
        transform: 'translateY(0px) scale(1)',
        transition: { transform: { type: 'spring', duration: 0.55, bounce: 0.42, delay }, opacity: { duration: 0.14, delay } },
      } as const,
      still,
    ),
  }
}

/**
 * What the second row holds: the agents, the review, Settings with Integrations under it, a GitHub the menu leaves out,
 * or the main canvas's group on the canvas place.
 */
type Second = 'agents' | 'review' | 'settings' | 'github' | 'canvas'

function secondFor(screen: ScreenId, githubInMenu: boolean, canvasOpen: boolean): Second | null {
  if (screen === 'agent') return 'agents'
  if (screen === 'review') return 'review'
  if (screen === 'settings' || isUnderSettings(screen)) return 'settings'
  if (screen === 'github' && !githubInMenu) return 'github'
  if (screen === 'canvas' && canvasOpen) return 'canvas'
  return null
}

/** How many pieces each row puts before the main canvas's pill, so the pill drops in after them. */
const BEFORE_PILL: Record<Second, number> = { agents: 0, review: 2, settings: 4, github: 2, canvas: 0 }

/** The pieces the second row holds before the main canvas's pill. `canvas` is the main canvas as the window shows it. */
function secondPieces({ second, screen, canvas, split }: {
  second: Second | null
  screen: ScreenId
  canvas: CanvasState | null
  split: ReturnType<typeof useSplit>
}): ReactNode {
  switch (second) {
    case 'agents':
      return (
        <>
          <Agents />
          {/* A durable hobkin's split: its canvas's group after the agents. */}
          {split ? <CanvasGroup owner={split.owner} canvas={split.canvas} active={false} start={0} /> : null}
        </>
      )
    case 'review':
      return <ReviewItem />
    case 'github':
      return <GitHubItem />
    case 'canvas':
      return isOpen(canvas) ? <CanvasGroup owner={MAIN_CANVAS} canvas={canvas} active start={0} /> : null
    case 'settings':
      return <SettingsTrail under={isUnderSettings(screen) ? screen : null} />
    case null:
      return null
  }
}

function iconOf(id: ScreenId): LucideIcon {
  return SCREENS.find((entry) => entry.id === id)!.icon
}

/** The pill that marks where the canvas is. One element shared by both rows, so it travels from one to the other. */
function Marker() {
  const agent = useView((view) => view.screen === 'agent')
  const still = useStill()
  return <motion.span layoutId={still && agent ? undefined : 'screen-menu-marker'} className="absolute inset-0 rounded-full bg-surface-2" transition={entryTransition(agent, still, spring.pill)} />
}

/**
 * The screen menu. It floats over the top of the canvas, as the menu on hobkin.dev floats over the page.
 *
 * It is one surface. The first row never changes: the main screens stay where they are. Whatever is open
 * for now (an agent, a review, Settings and Integrations) is a second row inside the same surface, which
 * grows downward to hold it. Nothing is ever added at the end of the first row, so it never jumps sideways.
 *
 * The main canvas, while it is open, ends the second row as a pill, or holds the row with its controls on its own place.
 * During a durable hobkin's split the right side grows over the chat, and `shift` keeps the menu exactly where it was,
 * over the canvas, on the same spring (`transition`). The menu sizes its labels by its own width, not the right side's.
 */
export function ScreenMenu({ shift = 0, transition }: { shift?: number; transition?: Transition }) {
  const screen = useView((view) => view.screen)
  const openScreen = useView((view) => view.openScreen)
  const githubInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const main = SCREENS.filter((tab) => inMenu(tab.id, githubInMenu))
  // The badge matches the Action Items screen exactly: the same filtered rows it lists, so it never reads "2" over an
  // empty list. Only genuine decisions wait on the user, both in the count and on the screen.
  const badges: Partial<Record<ScreenId, number>> = { actions: useActionCount() }
  const canvas = useBoard(MAIN_CANVAS)
  const split = useSplit()
  const seen = useView((view) => view.canvasSeen[MAIN_CANVAS])
  const second = secondFor(screen, githubInMenu, isOpen(canvas))
  const pill = mainPill({ screen, split: split !== null, main: canvas, seen })
  const row = second ?? (pill ? 'pill' : null)

  return (
    <motion.div
      className="@container select-none-chrome pointer-events-none absolute inset-x-0 top-3.5 z-20 flex justify-center"
      initial={false}
      animate={{ left: shift }}
      transition={transition}
    >
      <Surface>
        <nav aria-label="Screens" className={ROW}>
          {main.map((tab, at) => {
            const active = tab.id === screen || ((screen === 'world' || screen === 'yolo' || screen === 'proof') && tab.id === 'work')
            const badge = badges[tab.id]
            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={tab.label}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        openScreen(tab.id)
                        useView.getState().engageCanvas()
                        requestCanvasFocus()
                      }}
                      className={cn(ITEM, active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    />
                  }
                >
                  {active ? <Marker /> : null}
                  <tab.icon className="relative size-3.5" aria-hidden="true" />
                  {tab.id === 'home' ? null : <span className={cn('relative', !active && '@max-[680px]:hidden')}>{tab.label}</span>}
                  {badge ? (
                    <span className="relative grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                      {badge}
                    </span>
                  ) : null}
                </TooltipTrigger>
                {/* The first row leads Command with a number's walk (`walkScreens`), so the tab at this place opens with this number.
                    A tab that shows its name gets the shortcut alone; Home is only an icon, so it gets its name too. */}
                <TooltipContent side="bottom">
                  {tab.id === 'home' ? `${tab.label} ` : ''}⌘{at + 1}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
        <AnimatePresence mode="popLayout" initial={false}>
          {row ? (
            <Born key={row} label={row === 'agents' ? 'Agents' : 'Open now'}>
              {secondPieces({ second, screen, canvas, split })}
              {pill && isOpen(canvas) ? <CanvasPill canvas={canvas} dot={pill.dot} index={second ? BEFORE_PILL[second] : 0} /> : null}
            </Born>
          ) : null}
        </AnimatePresence>
      </Surface>
    </motion.div>
  )
}

/**
 * The one surface both rows sit on. The rows size it, and it follows their size on a spring, so it grows
 * downward when the second row is born and closes again when that row goes. The surface is a layer of its
 * own behind the rows: it is the only thing that changes size, and its edge and shadow stay true while it does.
 */
function Surface({ children }: { children: ReactNode }) {
  const still = useStill()
  const agent = useView((view) => view.screen === 'agent')
  const rows = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const element = rows.current
    if (!element) return
    const measure = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight }
      setSize((current) => (current && current.width === next.width && current.height === next.height ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rows} className="pointer-events-auto relative flex flex-col items-center gap-1 p-[5px]">
      {size ? (
        <motion.div
          aria-hidden="true"
          className="absolute top-0 left-1/2 -translate-x-1/2 rounded-[21px] border border-border bg-background shadow-float"
          initial={false}
          animate={{ width: size.width, height: size.height }}
          transition={entryTransition(agent, still, still ? { duration: 0 } : spring.pill)}
        />
      ) : null}
      {children}
    </div>
  )
}

/** The second row. */
function Born({ label, children }: { label: string; children: ReactNode }) {
  return (
    <motion.nav
      aria-label={label}
      className={cn(ROW, 'mt-1')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.12 } }}
      exit={{ opacity: 0, transition: { duration: 0.14, ease: ease.out } }}
    >
      {children}
    </motion.nav>
  )
}

/** The agents working now. The one on the canvas carries its name, and one that is waiting for the user says so. */
function Agents() {
  const still = useStill()
  const agents = useRunningAgents()
  const openAgent = useView((view) => view.openAgent)
  const previewAgent = useView((view) => view.previewAgent)
  const at = agents.findIndex((agent) => agent.id === openAgent)

  return (
    <>
      {agents.map((agent, index) => {
        const active = agent.id === openAgent
        return (
          <motion.button
            key={agent.id}
            layout={!still}
            transition={agentEntry(still)}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={agent.asks ? `${agent.title}, waiting for you` : agent.title}
            title={agent.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              previewAgent(agent.id, index > at ? 1 : -1)
              // A menu choice stays open when focus leaves the agents list, keeping the preview's travel direction.
              useView.getState().openAgentCanvas(agent.id)
              requestCanvasFocus()
            }}
            className={cn(ITEM, 'px-2', active ? 'pr-3 text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {active ? <Marker /> : null}
            <motion.span layout={still ? false : 'position'} transition={agentEntry(still)} className="relative">
              <motion.span className="block" initial={holdStill({ opacity: 0, transform: 'translateY(-18px) scale(0.96)' }, still)} animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }}>
                <AgentHood hue={agent.hue} size={20} mood={agent.mood} asking={Boolean(agent.asks)} />
              </motion.span>
            </motion.span>
            {active ? (
              <motion.span
                layout={still ? false : 'position'}
                transition={agentEntry(still)}
                className="relative max-w-[24ch] truncate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: agentEntry(still) }}
              >
                {agent.title}
              </motion.span>
            ) : null}
          </motion.button>
        )
      })}
    </>
  )
}

/**
 * One step of a trail. The step that is open carries the marker. One above it is a way back up.
 * Always the same element, open or not, so moving down the trail keeps it in place while the marker travels.
 */
function Crumb({ id, label, index, active, onClick }: { id: ScreenId; label: string; index: number; active: boolean; onClick?: () => void }) {
  const Icon = iconOf(id)
  const still = useStill()
  return (
    <motion.button
      layout="position"
      transition={spring.pill}
      type="button"
      aria-current={active ? 'page' : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!active) onClick?.()
        useView.getState().engageCanvas()
        requestCanvasFocus()
      }}
      className={cn(ITEM, active ? 'cursor-default text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {active ? <Marker /> : null}
      <motion.span className="relative flex items-center gap-1.5" {...popIn(index, still)}>
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </motion.span>
    </motion.button>
  )
}

/** A round button of the second row, named by its label, dropping in after the pieces before it. */
function IconButton({ label, icon: Icon, index, onClick }: { label: string; icon: LucideIcon; index: number; onClick: () => void }) {
  const still = useStill()
  return (
    <motion.button
      layout="position"
      transition={spring.pill}
      type="button"
      {...popIn(index, still)}
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-muted-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </motion.button>
  )
}

function CloseButton({ label, index, onClick }: { label: string; index: number; onClick: () => void }) {
  return <IconButton label={label} icon={X} index={index} onClick={onClick} />
}

/**
 * A canvas's group (040-canvas-board): its name, then Reload, Save for a drawing while a host is connected, Open in the
 * browser, and Close. A page in the shell's browser keeps Reload and Open in the browser in its own bar. The group is
 * the canvas's too: Escape here closes it (`keys.ts`).
 */
function CanvasGroup({ owner, canvas, active, start }: { owner: string; canvas: CanvasState & { url: string }; active: boolean; start: number }) {
  const hasHost = useHasHost()
  const connected = useHost((state) => state.link === 'open')
  const browser = useShellBrowser()
  const kind = canvas.kind ?? 'page'
  const ownBar = browser !== null && kind === 'page'
  const buttons = [
    ownBar ? null : { label: 'Reload', icon: RotateCw, onClick: () => reloadCanvas(owner) },
    canSave(kind) && connected ? { label: 'Save', icon: Download, onClick: () => saveCanvas(owner) } : null,
    !ownBar && canOpenInBrowser(hasHost) ? { label: 'Open in the browser', icon: ExternalLink, onClick: () => openInBrowser(canvas.url) } : null,
  ].filter((button) => button !== null)
  const close = () => {
    // A split undoes as its canvas closes: the keyboard that was in it goes to the page's talk box. The main canvas's
    // place sends it home itself.
    const inCanvas = keyboardInCanvas()
    closeCanvas(owner)
    if (inCanvas && owner !== MAIN_CANVAS) focusTalk()
  }

  return (
    <div data-canvas-controls={owner} data-canvas-kind={kind} className="contents">
      <CanvasName owner={owner} label={labelFor(canvas.url, canvas.title, kind)} index={start} active={active} />
      {buttons.map((button, at) => (
        <IconButton key={button.label} label={button.label} icon={button.icon} index={start + 1 + at} onClick={button.onClick} />
      ))}
      <CloseButton label="Close the canvas" index={start + 1 + buttons.length} onClick={close} />
    </div>
  )
}

/** The canvas's name with its icon. On the canvas place it carries the marker. A click puts the keyboard in the canvas. */
function CanvasName({ owner, label, index, active }: { owner: string; label: string; index: number; active: boolean }) {
  const still = useStill()
  return (
    <motion.button
      layout="position"
      transition={spring.pill}
      type="button"
      aria-current={active ? 'page' : undefined}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => focusBoard(owner)}
      className={cn(ITEM, 'max-w-[32ch]', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {active ? <Marker /> : null}
      <motion.span className="relative flex min-w-0 items-center gap-1.5" {...popIn(index, still)}>
        <Presentation className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </motion.span>
    </motion.button>
  )
}

/**
 * The main canvas while another screen shows: its name at the end of the second row, with a dot once it is redrawn and
 * not seen since. It goes back to the canvas, as Command with its number does.
 */
function CanvasPill({ canvas, dot, index }: { canvas: CanvasState & { url: string }; dot: boolean; index: number }) {
  const still = useStill()
  const label = labelFor(canvas.url, canvas.title, canvas.kind)
  return (
    <motion.button
      layout="position"
      transition={spring.pill}
      type="button"
      title={label}
      aria-label={dot ? `${label}, redrawn` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        useView.getState().openCanvasPlace()
        useView.getState().engageCanvas()
        requestCanvasFocus()
      }}
      className={cn(ITEM, 'max-w-[24ch] text-muted-foreground hover:text-foreground')}
    >
      <motion.span className="relative flex min-w-0 items-center gap-1.5" {...popIn(index, still)}>
        <Presentation className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {dot ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
      </motion.span>
    </motion.button>
  )
}

function ReviewItem() {
  const closeReview = useView((view) => view.closeReview)
  return (
    <>
      <Crumb id="review" label="Review" index={0} active />
      <CloseButton label="Close the review" index={1} onClick={closeReview} />
    </>
  )
}

/** How the close button names a page under Settings, in the middle of a sentence. */
const CLOSING: Record<PageUnderSettings, string> = { integrations: 'integrations', skills: 'skills', extensions: 'Pi extensions' }

/** Settings, and the page under it: Settings › Integrations, Settings › Skills or Settings › Pi extensions. Settings is the way back up. */
function SettingsTrail({ under }: { under: PageUnderSettings | null }) {
  const still = useStill()
  const toggleSettings = useView((view) => view.toggleSettings)
  const closeSettings = useView((view) => view.closeSettings)

  return (
    <>
      <Crumb id="settings" label="Settings" index={0} active={!under} onClick={toggleSettings} />
      {under ? (
        <>
          <motion.span layout="position" transition={spring.pill} {...popIn(1, still)} aria-hidden="true" className="grid place-items-center text-muted-foreground">
            <ChevronRight className="size-3.5" />
          </motion.span>
          <Crumb id={under} label={SCREENS.find((entry) => entry.id === under)!.label} index={2} active />
        </>
      ) : null}
      <CloseButton label={under ? `Close ${CLOSING[under]} and settings` : 'Close settings'} index={3} onClick={closeSettings} />
    </>
  )
}

/** GitHub, opened from Integrations or the spotlight while the user keeps it out of the menu. It is open only for now. */
function GitHubItem() {
  const closeGitHub = useView((view) => view.closeGitHub)
  return (
    <>
      <Crumb id="github" label="GitHub" index={0} active />
      <CloseButton label="Close GitHub" index={1} onClick={closeGitHub} />
    </>
  )
}
