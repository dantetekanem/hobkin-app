import { AnimatePresence, motion } from 'motion/react'
import { holdStill, useStill } from '@/app/still.ts'
import { isMood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { cn } from '@/lib/utils.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { childHue, childrenSummary, describeChild, satellitesOf } from './child-summary.ts'
import { useRunChildren } from './children.ts'

/**
 * A run's own agents, the ones it spawned through pi-extended-teams, drawn small beside it. They cannot be opened,
 * stopped or messaged: hobkin has no way to reach them, so nothing here takes the keyboard.
 */

/** A mark at the hood's foot for how a child ended. A report is the wire's pulse come home, not a tick. */
const ENDED: Partial<Record<RunChild['state'], string>> = {
  reported: 'bg-[var(--hb-wire-pulse)] shadow-[0_0_0_1px_var(--hb-wire-active),0_0_0_2.5px_var(--background)]',
  failed: 'bg-bad shadow-[0_0_0_1.5px_var(--background)]',
  stopped: 'border border-muted-foreground bg-background',
}

/**
 * One child's small face. Only a running child moves, with its last phase as its mood when the run asked for it.
 * A queued one waits faint, one the run outlived is grey, and an ended one wears its mark.
 */
export function ChildHood({ child, hue, size = 12 }: { child: RunChild; hue: number; size?: number }) {
  const running = child.state === 'running'
  const mark = ENDED[child.state]
  return (
    <span
      className={cn(
        'relative block shrink-0 transition-[opacity,filter] duration-200 ease-[ease]',
        child.state === 'queued' && 'opacity-45',
        child.state === 'stopped' && 'opacity-60 grayscale',
      )}
    >
      <AgentHood hue={hue} size={size} mood={running && isMood(child.phase) ? child.phase : running ? 'working' : 'idle'} working={running} />
      {mark ? <span aria-hidden="true" className={cn('absolute -right-[3px] -bottom-[2px] size-[5px] rounded-full', mark)} /> : null}
    </span>
  )
}

/** As many faces as the dock shows for one agent. More are counted. */
const DOCK_FACES = 4

/**
 * An agent's children in the agents list: a few small faces and what they add up to. It is no taller than the
 * row's two lines, so every row stays the same size. The words are the row's description (`summaryId`).
 */
export function ChildCluster({ runId, hue, summaryId }: { runId: string; hue: number; summaryId: string }) {
  return <ChildFaces spawned={useRunChildren(runId)} hue={hue} summaryId={summaryId} />
}

/** The faces of any agents' children, run's or hobkin's own, with their sum in words under `summaryId`. */
export function ChildFaces({ spawned: children, hue, summaryId }: { spawned: readonly RunChild[]; hue: number; summaryId?: string }) {
  const still = useStill()
  if (children.length === 0) return null
  const summary = childrenSummary(children)
  const { shown, more } = satellitesOf(children, DOCK_FACES)
  return (
    <span className="flex shrink-0 items-center gap-1" title={summary}>
      <span id={summaryId} hidden>
        {summary}
      </span>
      <span aria-hidden="true" className="flex items-center gap-[5px]">
        <AnimatePresence initial={false}>
          {shown.map((child) => (
            // A child arrives the way an agent does in the list: it bubbles up and overshoots a little.
            <motion.span
              key={child.name}
              title={describeChild(child)}
              initial={holdStill({ opacity: 0, transform: 'translateY(8px) scale(0.5)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { type: 'spring', duration: 0.62, bounce: 0.48 } } as const, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(0px) scale(0.7)', transition: { duration: 0.18 } }, still)}
            >
              <ChildHood child={child} hue={childHue(hue, children.indexOf(child))} />
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
      {more ? (
        <span aria-hidden="true" className="text-[10px] text-muted-foreground tabular-nums">
          +{more}
        </span>
      ) : null}
    </span>
  )
}
