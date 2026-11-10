import { AnimatePresence, motion, type Transition, type Variants } from 'motion/react'
import { spring, stagger } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { SlashList } from './slash.ts'

/** How far the conversation blurs behind the list, and how much of the card's color lies over it. */
const BLUR = 'blur(12px)'
const TINT = 0.8

// One transition drives the blur, the tint and the list, so the backing thickens as the list rises.
// A parent's opacity would not do it: a blurred backdrop does not fade with its parent, it pops.
const arrive: Transition = spring.sheet
const leave: Transition = { ...spring.sheet, duration: 0.3 }

const backing: Variants = {
  away: { backdropFilter: 'blur(0px)', transition: leave },
  here: { backdropFilter: BLUR, transition: arrive },
}
const tint: Variants = {
  away: { opacity: 0, transition: leave },
  here: { opacity: TINT, transition: arrive },
}
const rows: Variants = {
  away: { opacity: 0, transform: 'translateY(14px)', transition: leave },
  here: { opacity: 1, transform: 'translateY(0px)', transition: { ...arrive, staggerChildren: stagger } },
}
const row: Variants = {
  away: { opacity: 0, transform: 'translateY(8px)' },
  here: { opacity: 1, transform: 'translateY(0px)', transition: arrive },
}

export const slashRowId = (listId: string, index: number) => `${listId}-row-${index}`

export interface SlashPanelProps {
  /** The list to show, or null when it is closed. */
  list: SlashList | null
  /** The id the input names as the list it controls. */
  id: string
  onChoose: (index: number) => void
  onReach: (index: number) => void
}

/**
 * The commands for a message that starts with a slash, floating over the conversation right above the input.
 * The keyboard stays in the input: the input is a combobox and this is its list, so the selected row is
 * state, shown filled, and the keys are handled by the input.
 */
export function SlashPanel({ list, id, onChoose, onReach }: SlashPanelProps) {
  return (
    <AnimatePresence>
      {list ? (
        <motion.div key="slash" initial="away" animate="here" exit="away" className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-border shadow-panel">
          <motion.div aria-hidden="true" className="absolute inset-0" variants={backing} />
          <motion.div aria-hidden="true" className="absolute inset-0 bg-card" variants={tint} />
          {list.rows.length ? (
            <motion.ul id={id} role="listbox" aria-label="Commands" variants={rows} className="relative flex flex-col gap-0.5 p-1.5">
              {list.rows.map((command, index) => (
                <motion.li
                  key={command.name}
                  id={slashRowId(id, index)}
                  role="option"
                  aria-selected={index === list.selected}
                  variants={row}
                  // The input keeps the keyboard, so a press must not take the focus away from it.
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => onReach(index)}
                  onClick={() => onChoose(index)}
                  className={cn(
                    'flex cursor-default items-baseline gap-3 rounded-xl px-3 py-1.5 transition-colors duration-[160ms] ease-[ease]',
                    index === list.selected && 'bg-surface-2',
                  )}
                >
                  <span className="shrink-0 font-heading text-[14px] font-medium">{command.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{command.description}</span>
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <motion.p id={id} role="status" variants={rows} className="relative px-4 py-2.5 text-[13px] text-muted-foreground">
              No command matches <span className="font-heading font-medium text-foreground">/{list.query}</span>. Enter sends it as a message.
            </motion.p>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
