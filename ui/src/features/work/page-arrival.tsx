import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { useStill } from '@/app/still.ts'
import { spring, stagger, tween } from '@/lib/motion.ts'

/**
 * Work's pieces (Hero and Rise) wait for an arrival from above them, which the screen gives once as it travels in. A
 * page that mounts after that, or pieces that wait for hobkin's work, would stay hidden. So each page, and the box
 * holding what waits for the work, brings its pieces in itself: `enter` as it mounts, `center` at once.
 */

const together: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger } },
}

/** Slides in the way the page came along the menu's second row, or only fades under Still. `custom` is that way, -1 or 1, or 0 for none. */
const page = (still: boolean): Variants => ({
  enter: (way: number) => ({ opacity: 0, transform: still ? 'translateX(0px)' : `translateX(${way * 48}px)` }),
  center: { opacity: 1, transform: 'translateX(0px)', transition: { staggerChildren: stagger, transform: still ? { duration: 0 } : spring.push, opacity: tween.enter } },
})

/** One of Work's pages. Give each page its own key, so it mounts as the user comes to it. `way` is -1 or 1, or 0 for the first page, which the screen's own arrival carries. */
export function WorkPage({ way, resumed, className, children, ...aria }: { way: number; resumed: boolean; className?: string; children: ReactNode; role?: string; id?: string; 'aria-labelledby'?: string }) {
  return (
    <motion.div variants={page(useStill())} custom={way} initial={resumed ? false : 'enter'} animate="center" className={className} {...aria}>
      {children}
    </motion.div>
  )
}

/** What waits for hobkin's work: it lands when the work comes, with the same spacing as the page around it. */
export function WhenWorkComes({ children, resumed }: { children: ReactNode; resumed: boolean }) {
  return (
    <motion.div variants={together} initial={resumed ? false : 'enter'} animate="center" className="flex flex-col gap-10">
      {children}
    </motion.div>
  )
}
