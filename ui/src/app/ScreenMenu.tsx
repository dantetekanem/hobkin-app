import { Download, ExternalLink, Presentation, RotateCw, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
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
import { estimatedRow, putBack, rowPieces, type AroundMenu, type RowGeometry } from './menu-agents.ts'
import { menuLayout, type SecondRow } from './menu-rows.ts'
import { useRunningAgents, type RunningAgent } from './running-agents.ts'
import { inMenu, SCREENS, type ScreenId } from './screens.ts'
import { holdStill, useStill } from './still.ts'
import { Trail } from './Trail.tsx'
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
 * The pieces the second row holds before the main canvas's pill: the agents, or the main canvas's group on the canvas
 * place (`menu-rows.ts`). Where the user is is the trail's to say, under the menu (Trail.tsx). `canvas` is the main
 * canvas as the window shows it.
 */
function secondPieces({ second, canvas, split, drawn }: {
  second: SecondRow | null
  canvas: CanvasState | null
  split: ReturnType<typeof useSplit>
  drawn: object
}): ReactNode {
  switch (second) {
    case 'agents':
      return (
        <>
          <Agents drawn={drawn} />
          {/* A durable hobkin's split: its canvas's group after the agents. */}
          {split ? <CanvasGroup owner={split.owner} canvas={split.canvas} active={false} start={0} /> : null}
        </>
      )
    case 'canvas':
      return isOpen(canvas) ? <CanvasGroup owner={MAIN_CANVAS} canvas={canvas} active start={0} /> : null
    case null:
      return null
  }
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
 * It is one surface. The first row never changes: the main screens stay where they are. A page that keeps a second
 * row while it shows (an agent's page has the agents, the canvas place its controls) has it inside the same surface,
 * which grows downward to hold it. Nothing is ever added at the end of the first row, so it never jumps sideways.
 *
 * The main canvas, while it is open, ends the agents' row as a pill, or holds the row with its controls on its own place.
 * Under the menu, on every page, the trail says where the user is and how they came (Trail.tsx); on a page with one
 * row the canvas's pill ends the trail's line instead, so the menu grows no row for it and the page never moves.
 * During a durable hobkin's split the right side grows over the chat, and `shift` keeps the menu exactly where it was,
 * over the canvas, on the same spring (`transition`). The menu sizes its labels by its own width, not the right side's.
 */
export function ScreenMenu({ shift = 0, transition }: { shift?: number; transition?: Transition }) {
  const screen = useView((view) => view.screen)
  const openMenuScreen = useView((view) => view.openMenuScreen)
  const githubInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const main = SCREENS.filter((tab) => inMenu(tab.id, githubInMenu))
  // The badge matches the Action Items screen exactly: the same filtered rows it lists, so it never reads "2" over an
  // empty list. Only genuine decisions wait on the user, both in the count and on the screen.
  const badges: Partial<Record<ScreenId, number>> = { actions: useActionCount() }
  const canvas = useBoard(MAIN_CANVAS)
  const split = useSplit()
  const seen = useView((view) => view.canvasSeen[MAIN_CANVAS])
  const pill = mainPill({ screen, split: split !== null, main: canvas, seen })
  const { second, pillOn } = menuLayout({ screen, canvasOpen: isOpen(canvas), pill: pill !== null })
  // New each time the menu draws. The second row is centered, so what the menu draws again for can move its agents.
  const drawn = {}
  // Work's own pages keep Work's tab marked.
  const onWorkPage = screen === 'world' || screen === 'yolo' || screen === 'project' || screen === 'proof'

  return (
    <motion.div
      data-screen-menu
      className="@container select-none-chrome pointer-events-none absolute inset-x-0 top-3.5 z-20 flex flex-col items-center"
      initial={false}
      animate={{ left: shift }}
      transition={transition}
    >
      <Surface>
        <nav aria-label="Screens" className={ROW}>
          {main.map((tab, at) => {
            const active = tab.id === screen || (onWorkPage && tab.id === 'work')
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
                        // A page opened from the menu starts a new trail.
                        openMenuScreen(tab.id)
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
          {second ? (
            <Born key={second} label={second === 'agents' ? 'Agents' : 'Open now'}>
              {secondPieces({ second, canvas, split, drawn })}
              {pillOn === 'second' && pill && isOpen(canvas) ? <CanvasPill canvas={canvas} dot={pill.dot} index={0} /> : null}
            </Born>
          ) : null}
        </AnimatePresence>
      </Surface>
      <Trail pill={pillOn === 'trail' && isOpen(canvas) ? canvas : null} dot={pill?.dot ?? false} />
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

/** Where the agents row lies on screen now, read from the page. Null until an item that is not open is drawn. */
function measuredRow(): RowGeometry | null {
  const row = document.querySelector('[data-menu-agent]')?.parentElement
  const item = row?.querySelector<HTMLElement>('[data-menu-agent]:not([aria-current])')?.offsetWidth
  if (!row || item === undefined) return null
  const open = row.querySelector<HTMLElement>('[data-menu-agent][aria-current]')?.offsetWidth ?? item
  return {
    left: row.getBoundingClientRect().left,
    width: window.innerWidth,
    item,
    open,
    gap: Number.parseFloat(getComputedStyle(row).columnGap) || 0,
  }
}

const sameRow = (left: RowGeometry, right: RowGeometry) =>
  left.left === right.left &&
  left.width === right.width &&
  left.item === right.item &&
  left.open === right.open &&
  left.gap === right.gap

/** Opens an agent from the menu: its canvas comes in from the open agent's side, with the keyboard in it. */
function openFromMenu(agentId: string, toward: 1 | -1) {
  useView.getState().previewAgent(agentId, toward)
  // A menu choice stays open when focus leaves the agents list, keeping the preview's travel direction.
  useView.getState().openAgentCanvas(agentId)
  requestCanvasFocus()
}

const labelOf = (agent: RunningAgent) => (agent.asks ? `${agent.title}, waiting for you` : agent.waits ? `${agent.title}, ${agent.doing}` : agent.title)

/** Puts back what the browser scrolled to show a menu agent that took the keyboard past the window's edge (`putBack`). */
function keepWindowStill(item: Element) {
  const around: AroundMenu[] = []
  for (let box = item.parentElement; box; box = box.parentElement) {
    const style = getComputedStyle(box)
    around.push({ box, overflowX: style.overflowX, overflowY: style.overflowY, viewport: box === document.scrollingElement })
  }
  putBack(around)
}

/**
 * The agents working now. The one on the canvas carries its name, and one that is waiting for the user says so. With
 * more agents than the window is wide, only the ones on screen are drawn whole, and every other is a bare button in
 * its place (`menu-agents.ts`). One the keyboard reaches is drawn whole and keeps the keyboard.
 */
function Agents({ drawn }: { drawn: object }) {
  const still = useStill()
  const agents = useRunningAgents()
  const openAgent = useView((view) => view.openAgent)
  const at = agents.findIndex((agent) => agent.id === openAgent)
  const openTitle = agents[at]?.title
  // The row is centered: an agent coming or going, another one opening, its name, or the menu drawing again can move
  // every item. Only then do the items measure where they are.
  const moved = useMemo(() => ({}), [drawn, agents.length, openAgent, openTitle])
  /** The agents the row has drawn. One of them coming on screen does not drop in again. */
  const known = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    known.current = new Set(agents.map((agent) => agent.id))
  })

  const [geometry, setGeometry] = useState<RowGeometry | null>(null)
  const measure = useCallback(() => {
    const next = measuredRow()
    if (next) setGeometry((current) => (current && sameRow(current, next) ? current : next))
  }, [])
  // Read again whenever the row may have moved, before the page shows it, and while the menu's room changes size.
  useLayoutEffect(measure, [moved, geometry])
  useEffect(() => {
    const menu = document.querySelector('[data-screen-menu]')
    if (!menu) return
    const observer = new ResizeObserver(measure)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [])

  /** The agent the keyboard reached while it was a bare button. Focusing it may scroll the page, so the row is read again. */
  const [keyboard, setKeyboard] = useState<string | null>(null)
  const reached = useCallback(
    (id: string) => {
      setKeyboard(id)
      measure()
    },
    [measure],
  )
  const blurred = useCallback((id: string) => setKeyboard((current) => (current === id ? null : current)), [])

  const row = geometry ?? estimatedRow(agents.length, window.innerWidth)
  const keyboardAt = agents.findIndex((agent) => agent.id === keyboard)
  const pieces = rowPieces(agents.length, at, row, keyboardAt < 0 ? null : keyboardAt)
  return pieces.map((piece) => {
    const agent = agents[piece.index]!
    if (piece.kind === 'bare') return <BareItem key={agent.id} agent={agent} index={piece.index} at={at} width={row.item} onFocused={reached} />
    return (
      <AgentItem
        key={agent.id}
        agent={agent}
        index={piece.index}
        at={at}
        moved={moved}
        known={known}
        still={still}
        keyboard={agent.id === keyboard}
        onBlurred={blurred}
      />
    )
  })
}

interface BareItemProps {
  agent: RunningAgent
  index: number
  at: number
  /** An item's width, so the bare button holds its place. */
  width: number
  onFocused: (id: string) => void
}

/** An agent of the row that is off screen: a button with its name in the item's place, and nothing drawn in it. */
const BareItem = memo(function BareItem({ agent, index, at, width, onFocused }: BareItemProps) {
  return (
    <button
      type="button"
      data-menu-bare
      aria-label={labelOf(agent)}
      title={agent.title}
      onMouseDown={(event) => event.preventDefault()}
      onFocus={(event) => {
        keepWindowStill(event.currentTarget)
        onFocused(agent.id)
      }}
      onClick={() => openFromMenu(agent.id, index > at ? 1 : -1)}
      className="h-8 shrink-0 rounded-full"
      style={{ width }}
    />
  )
})

interface AgentItemProps {
  agent: RunningAgent
  index: number
  /** The open agent's place, which says which way the canvas travels to this one. */
  at: number
  /** New whenever the row may have moved this item. */
  moved: object
  known: RefObject<ReadonlySet<string>>
  still: boolean
  /** The keyboard reached it as a bare button, so it takes the keyboard once drawn whole. */
  keyboard: boolean
  onBlurred: (id: string) => void
}

/** One agent of the row. It draws again only for its own agent, or when the row may have moved it. */
const AgentItem = memo(function AgentItem({ agent, index, at, moved, known, still, keyboard, onBlurred }: AgentItemProps) {
  const active = index === at
  // It measures its layout only when it may have moved: its place, whether it is open, or the row around it changed.
  const layoutDependency = useMemo(() => ({}), [index, active, moved])
  const element = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    if (keyboard) element.current?.focus({ preventScroll: true })
  }, [keyboard])
  return (
    <motion.button
      ref={element}
      layout={!still}
      layoutDependency={layoutDependency}
      transition={agentEntry(still)}
      type="button"
      data-menu-agent
      aria-current={active ? 'page' : undefined}
      aria-label={labelOf(agent)}
      title={agent.title}
      onMouseDown={(event) => event.preventDefault()}
      onFocus={(event) => keepWindowStill(event.currentTarget)}
      onBlur={() => onBlurred(agent.id)}
      onClick={() => openFromMenu(agent.id, index > at ? 1 : -1)}
      className={cn(ITEM, 'px-2', active ? 'pr-3 text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {active ? <Marker /> : null}
      <motion.span layout={still ? false : 'position'} layoutDependency={layoutDependency} transition={agentEntry(still)} className="relative">
        <motion.span
          className="block"
          initial={known.current.has(agent.id) ? false : holdStill({ opacity: 0, transform: 'translateY(-18px) scale(0.96)' }, still)}
          animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: agentEntry(still) }}
        >
          <AgentHood hue={agent.hue} size={20} mood={agent.mood} asking={Boolean(agent.asks)} working={!agent.waits} />
        </motion.span>
      </motion.span>
      {active ? (
        <motion.span
          layout={still ? false : 'position'}
          layoutDependency={layoutDependency}
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
})

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
