import { ChevronRight, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AgentHood } from '@/components/Mark.tsx'
import { useActionCount } from '@/features/actions/store.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useActionItemCount, useHasHost } from '@/lib/host/index.ts'
import { ease, spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
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

/** What the second row holds: the agents, the review, Settings with Integrations under it, or a GitHub the menu leaves out. */
type Second = 'agents' | 'review' | 'settings' | 'github'

function secondFor(screen: ScreenId, githubInMenu: boolean): Second | null {
  if (screen === 'agent') return 'agents'
  if (screen === 'review') return 'review'
  if (screen === 'settings' || screen === 'integrations') return 'settings'
  if (screen === 'github' && !githubInMenu) return 'github'
  return null
}

function iconOf(id: ScreenId): LucideIcon {
  return SCREENS.find((entry) => entry.id === id)!.icon
}

/** The pill that marks where the canvas is. One element shared by both rows, so it travels from one to the other. */
function Marker() {
  return <motion.span layoutId="screen-menu-marker" className="absolute inset-0 rounded-full bg-surface-2" transition={spring.pill} />
}

/**
 * The screen menu. It floats over the top of the canvas, as the menu on hobkin.dev floats over the page.
 *
 * It is one surface. The first row never changes: the five screens stay where they are. Whatever is open
 * for now (an agent, a review, Settings and Integrations) is a second row inside the same surface, which
 * grows downward to hold it. Nothing is ever added at the end of the first row, so it never jumps sideways.
 */
export function ScreenMenu() {
  const screen = useView((view) => view.screen)
  const openScreen = useView((view) => view.openScreen)
  const githubInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const main = SCREENS.filter((tab) => inMenu(tab.id, githubInMenu))
  // With a host, hobkin's own count: open decisions plus waiting rows, as the terminal counts them.
  const sampleCount = useActionCount()
  const hostCount = useActionItemCount()
  const badges: Partial<Record<ScreenId, number>> = { actions: useHasHost() ? hostCount : sampleCount }
  const second = secondFor(screen, githubInMenu)

  return (
    <div className="select-none-chrome pointer-events-none absolute inset-x-0 top-3.5 z-20 flex justify-center">
      <Surface>
        <nav aria-label="Screens" className={ROW}>
          {main.map((tab) => {
            const active = tab.id === screen
            const badge = badges[tab.id]
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={tab.label}
                // A click here leaves the keyboard where it was.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openScreen(tab.id)}
                className={cn(ITEM, active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {active ? <Marker /> : null}
                <tab.icon className="relative size-3.5" aria-hidden="true" />
                <span className={cn('relative', !active && '@max-[680px]:hidden')}>{tab.label}</span>
                {badge ? (
                  <span className="relative grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {badge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
        <AnimatePresence mode="popLayout" initial={false}>
          {second ? (
            <Born key={second} label={second === 'agents' ? 'Agents' : 'Open now'}>
              {second === 'agents' ? <Agents /> : second === 'review' ? <ReviewItem /> : second === 'github' ? <GitHubItem /> : <SettingsTrail inIntegrations={screen === 'integrations'} />}
            </Born>
          ) : null}
        </AnimatePresence>
      </Surface>
    </div>
  )
}

/**
 * The one surface both rows sit on. The rows size it, and it follows their size on a spring, so it grows
 * downward when the second row is born and closes again when that row goes. The surface is a layer of its
 * own behind the rows: it is the only thing that changes size, and its edge and shadow stay true while it does.
 */
function Surface({ children }: { children: ReactNode }) {
  const still = useStill()
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
          transition={still ? { duration: 0 } : spring.pill}
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
            layout
            transition={spring.pill}
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={agent.asks ? `${agent.title}, waiting for you` : agent.title}
            title={agent.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => previewAgent(agent.id, index > at ? 1 : -1)}
            className={cn(ITEM, 'px-2', active ? 'pr-3 text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {active ? <Marker /> : null}
            <motion.span layout="position" className="relative">
              <motion.span className="block" {...popIn(index, still)}>
                <AgentHood hue={agent.hue} size={20} mood={agent.mood} asking={Boolean(agent.asks)} />
              </motion.span>
            </motion.span>
            {active ? (
              <motion.span
                layout="position"
                className="relative max-w-[24ch] truncate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.08 } }}
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
      onClick={active ? undefined : onClick}
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

function CloseButton({ label, index, onClick }: { label: string; index: number; onClick: () => void }) {
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
      <X className="size-3.5" aria-hidden="true" />
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

/** Settings, and Integrations under it: Settings › Integrations. Settings is the way back up. */
function SettingsTrail({ inIntegrations }: { inIntegrations: boolean }) {
  const still = useStill()
  const toggleSettings = useView((view) => view.toggleSettings)
  const closeSettings = useView((view) => view.closeSettings)

  return (
    <>
      <Crumb id="settings" label="Settings" index={0} active={!inIntegrations} onClick={toggleSettings} />
      {inIntegrations ? (
        <>
          <motion.span layout="position" transition={spring.pill} {...popIn(1, still)} aria-hidden="true" className="grid place-items-center text-muted-foreground">
            <ChevronRight className="size-3.5" />
          </motion.span>
          <Crumb id="integrations" label="Integrations" index={2} active />
        </>
      ) : null}
      <CloseButton label={inIntegrations ? 'Close integrations and settings' : 'Close settings'} index={3} onClick={closeSettings} />
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
