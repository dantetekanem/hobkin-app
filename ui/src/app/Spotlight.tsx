import { CornerDownLeft, Search } from 'lucide-react'
import { AnimatePresence, motion, useIsPresent, type Transition } from 'motion/react'
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AgentHood } from '@/components/Mark.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { focusInput } from './keys.ts'
import { useSpotlightTargets, type SpotlightTarget } from './spotlight-entries.ts'
import { searchSpotlight, type SpotlightKind } from './spotlight-search.ts'
import { stillVariants, useStill } from './still.ts'
import { useView } from './view-store.ts'

/** How far the window behind blurs. */
const BLUR = 'blur(18px)'

// One transition drives the blur, the shade and the panel, so the window behind thickens exactly as the panel lands.
// Opacity on a parent would not do: a blurred backdrop does not fade with its parent, it pops.
const arrive: Transition = { ...spring.sheet, duration: 0.5 }
const leave: Transition = { ...spring.sheet, duration: 0.3 }

const HEADING: Record<SpotlightKind, string> = {
  screen: 'Screens',
  setting: 'Settings',
  agent: 'Agents working now',
  project: 'Projects',
  report: 'Reports',
  routine: 'Routines',
  action: 'Action items',
  pull: 'Pull requests',
  issue: 'Issues',
}

/**
 * The spotlight: Command+K from anywhere opens a search over the whole window, which blurs behind it. Typing finds
 * screens, the sections of Settings, the agents working now, reports, routines, what waits on the user and their
 * GitHub. Up and Down choose, Enter goes there, Escape closes. It is a dialog, so it owns every key while it is open,
 * Command+R aside (019-keyboard). See _specs/026-spotlight.
 */
export function Spotlight() {
  const open = useView((view) => view.spotlight)
  return createPortal(<AnimatePresence>{open ? <Panel key="spotlight" /> : null}</AnimatePresence>, document.body)
}

/** The keyboard goes back where it was before the spotlight opened, or home when that is gone. */
function giveBack(to: Element | null): void {
  if (to instanceof HTMLElement && to.isConnected && to !== document.body) to.focus({ preventScroll: true })
  else focusInput()
}

function Panel() {
  const still = useStill()
  const present = useIsPresent()
  const closeSpotlight = useView((view) => view.closeSpotlight)
  const targets = useSpotlightTargets()
  const [text, setText] = useState('')
  // The chosen row, by its entry. Live data can add rows above it, and the choice stays on the same thing.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const cameFrom = useRef<Element | null>(null)
  const id = useId()

  const groups = useMemo(() => searchSpotlight(targets, text), [targets, text])
  const rows = useMemo(() => groups.flatMap((group) => group.entries), [groups])
  const found = rows.findIndex((row) => row.id === chosenId)
  const chosen = found >= 0 ? found : 0

  // The spotlight takes the keyboard as it opens, and remembers where it was.
  useLayoutEffect(() => {
    cameFrom.current = document.activeElement
    field.current?.focus()
  }, [])

  const close = () => {
    closeSpotlight()
    giveBack(cameFrom.current)
  }

  const choose = (target: SpotlightTarget | undefined) => {
    if (!target) return
    closeSpotlight()
    // Back where it was first, so a page opened outside the app leaves the keyboard there. Going to a place in the app takes it on from there.
    giveBack(cameFrom.current)
    target.go()
  }

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return
    setChosenId(rows[(chosen + delta + rows.length) % rows.length]!.id)
    requestAnimationFrame(() => list.current?.querySelector('[data-chosen="true"]')?.scrollIntoView({ block: 'nearest' }))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    const command = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Enter') choose(rows[chosen])
    // Command+K again closes it, as the key that opened it.
    else if (event.key === 'Escape' || (command && event.key === 'k')) close()
    // The field is the only control. Tab would carry the keyboard out to the window behind.
    else if (event.key === 'Tab') {
      /* held */
    } else return
    event.preventDefault()
  }

  let index = 0

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      data-spotlight
      // While it leaves, it takes no clicks and no keyboard.
      inert={!present}
      className="select-none-chrome fixed inset-0 z-50"
      initial="away"
      animate="here"
      exit="away"
      variants={{ away: { transition: leave }, here: { transition: arrive } }}
      onKeyDown={onKeyDown}
    >
      {/* The window behind blurs from nothing, in step with the panel. */}
      <motion.div className="absolute inset-0" variants={{ away: { backdropFilter: 'blur(0px)', transition: leave }, here: { backdropFilter: BLUR, transition: arrive } }} />
      {/* A shade settles over it. A click there closes the spotlight. */}
      <motion.div className="absolute inset-0 bg-scrim" variants={{ away: { opacity: 0, transition: leave }, here: { opacity: 1, transition: arrive } }} onClick={close} />

      <div className="pointer-events-none absolute inset-x-0 top-[13vh] flex justify-center px-4">
        <motion.div
          className="pointer-events-auto flex w-full max-w-[640px] flex-col overflow-hidden rounded-[26px] border border-border bg-background shadow-float"
          variants={stillVariants(
            {
              away: { opacity: 0, transform: 'translateY(-28px) scale(0.94)', transition: leave },
              here: { opacity: 1, transform: 'translateY(0px) scale(1)', transition: arrive },
            },
            still,
          )}
        >
          <label className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
            <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={field}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={rows.length ? `${id}-${chosen}` : undefined}
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                // A new search starts on its best match.
                setChosenId(null)
                list.current?.scrollTo({ top: 0 })
              }}
              placeholder="Search screens, reports, routines, agents and GitHub"
              className="min-w-0 flex-1 bg-transparent font-heading text-[17px] tracking-[-0.01em] outline-none select-text placeholder:text-muted-foreground"
            />
            <Kbd>esc</Kbd>
          </label>

          <motion.div ref={list} layoutScroll id={`${id}-list`} role="listbox" aria-label="Found" className="scroll-quiet h-[min(420px,52vh)] overflow-y-auto px-2 py-1.5">
            {groups.map((group) => (
              <div key={group.kind} role="group" aria-label={HEADING[group.kind]} className="pb-1">
                <div className="eyebrow flex items-baseline gap-2 px-3 pt-2.5 pb-1">
                  {HEADING[group.kind]}
                  {group.hidden ? <span className="font-sans tracking-normal normal-case">and {group.hidden} more</span> : null}
                </div>
                {group.entries.map((target) => {
                  const at = index++
                  return <Row key={target.id} id={`${id}-${at}`} target={target} chosen={at === chosen} still={still} onPoint={() => setChosenId(target.id)} onChoose={() => choose(target)} />
                })}
              </div>
            ))}
            {rows.length === 0 ? <p className="grid h-full place-items-center px-6 text-center text-[14px] text-muted-foreground">Nothing matches “{text.trim()}”.</p> : null}
          </motion.div>

          <footer className="flex h-10 shrink-0 items-center gap-4 border-t border-border px-5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              choose
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              go there
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd>
              close
            </span>
          </footer>
        </motion.div>
      </div>
    </motion.div>
  )
}

function Mark({ target }: { target: SpotlightTarget }) {
  if ('hood' in target.mark) {
    const { hue, mood, asking } = target.mark.hood
    return <AgentHood hue={hue} size={22} mood={mood} asking={asking} />
  }
  const Icon = target.mark.icon
  return <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
}

interface RowProps {
  id: string
  target: SpotlightTarget
  chosen: boolean
  still: boolean
  onPoint: () => void
  onChoose: () => void
}

/** One thing found. The chosen row carries the marker, which glides from row to row as the choice moves. */
function Row({ id, target, chosen, still, onPoint, onChoose }: RowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={chosen}
      data-chosen={chosen}
      // The pointer and the arrows share one choice. A click keeps the keyboard in the field.
      onPointerMove={() => {
        if (!chosen) onPoint()
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      className="relative flex min-h-11 cursor-default items-center gap-3 rounded-2xl px-3 py-2"
    >
      {chosen ? (
        <motion.span layoutId={still ? undefined : 'spotlight-chosen'} className="absolute inset-0 rounded-2xl bg-surface-2" transition={spring.follow} />
      ) : null}
      <span className="relative grid w-6 shrink-0 place-items-center">
        <Mark target={target} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-tight">{target.title}</span>
        {target.detail ? <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{target.detail}</span> : null}
      </span>
      {target.keys ? <Kbd className="relative">{target.keys}</Kbd> : null}
      <CornerDownLeft className={cn('relative size-3.5 shrink-0 text-muted-foreground transition-opacity duration-[120ms] ease-[ease]', !chosen && 'opacity-0')} aria-hidden="true" />
    </div>
  )
}
