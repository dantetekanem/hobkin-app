import { AnimatePresence, motion, type Transition } from 'motion/react'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useProjects, useSessions } from '@/lib/host/index.ts'
import { VEIL_SECTIONS } from './screens.ts'
import { stillVariants, useStill } from './still.ts'
import { useView } from './view-store.ts'

/** How far the blur goes, and how much of the chat's own color lies over it. */
const BLUR = 'blur(14px)'
const TINT = 0.72

// One transition drives the blur, the tint and the list, so the veil thickens exactly as the list slides in.
// Opacity on a parent would not do: a blurred backdrop does not fade with its parent, it pops.
const arrive: Transition = spring.sheet
const leave: Transition = { ...spring.sheet, duration: 0.3 }

/**
 * Projects and earlier conversations, as a veil over the chat. It is not a pane: it lies inside the chat's
 * own bounds, the conversation stays visible beneath it, and it leaves as soon as something is chosen.
 * Switching between the two lists slides only the list.
 *
 * Its keys are the frame's (`key-map.ts`): Up and Down walk the list, Left and Right change list, Enter
 * chooses and Escape closes, wherever the keyboard was when the veil opened. The reached row is state,
 * not focus, so a click on the header's button works the same as its key.
 */
export function ChatVeil() {
  const projects = useProjects()
  const sessions = useSessions()
  const still = useStill()
  const veil = useView((view) => view.veil)
  const closeVeil = useView((view) => view.closeVeil)
  const index = veil ? VEIL_SECTIONS.indexOf(veil) : 0

  const close = () => {
    closeVeil()
    document.querySelector<HTMLTextAreaElement>('[data-chat-side] textarea')?.focus()
  }

  return (
    <AnimatePresence>
      {veil !== null ? (
        <motion.div
          key="veil"
          role="dialog"
          aria-label={veil === 'history' ? 'Earlier conversations' : 'Projects'}
          data-chat-veil
          className="select-none-chrome absolute inset-0 z-10"
          initial="away"
          animate="here"
          exit="away"
          variants={{ away: { transition: leave }, here: { transition: arrive } }}
        >
          {/* The blur grows from nothing. */}
          <motion.div
            className="absolute inset-0"
            variants={{
              away: { backdropFilter: 'blur(0px)', transition: leave },
              here: { backdropFilter: BLUR, transition: arrive },
            }}
          />
          {/* The chat's own color settles over it. A click on the veil closes the list. */}
          <motion.div
            className="absolute inset-0 bg-background"
            variants={{ away: { opacity: 0, transition: leave }, here: { opacity: TINT, transition: arrive } }}
            onClick={close}
          />
          <motion.div
            className="relative overflow-hidden"
            variants={stillVariants(
              {
                away: { opacity: 0, transform: 'translateY(-32px)', transition: leave },
                here: { opacity: 1, transform: 'translateY(0px)', transition: arrive },
              },
              still,
            )}
          >
            <motion.div
              className="flex"
              style={{ width: `${VEIL_SECTIONS.length * 100}%` }}
              initial={false}
              animate={{ transform: `translateX(${(-index * 100) / VEIL_SECTIONS.length}%)` }}
              transition={still ? { duration: 0 } : spring.screen}
            >
              <List label="Projects" shown={veil === 'projects'}>
                {projects.map((project, row) => (
                  <Row key={project.slug} row={row} shown={veil === 'projects'} onChoose={close}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-[11px] font-semibold">{project.priority}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-tight">{project.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {project.queued} queued · {project.waiting} waiting on you
                      </span>
                    </span>
                  </Row>
                ))}
              </List>
              <List label="Earlier conversations" shown={veil === 'history'}>
                {sessions.map((session, row) => (
                  <Row key={session.id} row={row} shown={veil === 'history'} onChoose={close}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-tight">{session.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {session.when} · {session.messages} messages
                      </span>
                    </span>
                  </Row>
                ))}
              </List>
            </motion.div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function List({ label, shown, children }: { label: string; shown: boolean; children: React.ReactNode }) {
  return (
    <div
      role="listbox"
      aria-label={label}
      data-veil-list
      // The list that is off to the side is not read out and takes no clicks.
      inert={!shown}
      className="scroll-quiet max-h-full overflow-y-auto px-3 pt-2 pb-4"
      style={{ width: `${100 / VEIL_SECTIONS.length}%` }}
    >
      <div className="mx-auto flex max-w-[640px] flex-col gap-0.5">{children}</div>
    </div>
  )
}

function Row({ row, shown, onChoose, children }: { row: number; shown: boolean; onChoose: () => void; children: React.ReactNode }) {
  const active = useView((view) => view.veilActive === row) && shown
  const setVeilActive = useView((view) => view.setVeilActive)

  return (
    <div
      role="option"
      aria-selected={active}
      data-veil-row
      data-active={active}
      onClick={onChoose}
      // The pointer and the arrows share one selection.
      onPointerMove={() => {
        if (!active) setVeilActive(row)
      }}
      className={cn(
        'flex w-full cursor-default items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-[120ms] ease-[ease]',
        active && 'bg-surface-2',
      )}
    >
      {children}
    </div>
  )
}
