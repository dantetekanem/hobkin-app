import { AnimatePresence, motion } from 'motion/react'
import { holdStill, useStill } from '@/app/still.ts'
import { isMood } from '@/avatar/moods.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { helpersGlow } from '@/features/agent-activity/glow.ts'
import { FoldLine, RunsOnLine } from '@/features/teams/FoldLine.tsx'
import { runsOnWords } from '@/features/teams/runs-on.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { cn } from '@/lib/utils.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'
import { byStanding, childCounts, childHue, childLine, childrenSummary, describeChild, helpersCount, satellitesOf } from './child-summary.ts'
import { useRunChildren } from './children.ts'

/**
 * An agent's helpers, drawn small beside it: their faces, or a line that folds them and opens their list. hobkin keeps
 * none of their steps, so a helper opens nothing.
 */

/**
 * An agent's helpers folded into one line, as its teams agents are: their faces and how many, its border breathing
 * while one runs. A press opens every one under it, what is still out first, each with how it stands and the tier,
 * model and thinking level it runs on as far as hobkin sends them.
 */
export function HelpersLine({ helpers, hue, className }: { helpers: readonly RunChild[]; hue: number; className?: string }) {
  if (helpers.length === 0) return null

  // Each keeps the hue of its place among the helpers, as its face does in the agents list.
  const hueOf = (child: RunChild) => childHue(hue, helpers.indexOf(child))
  const outFirst = byStanding(helpers)
  const faces = outFirst.map((child) => ({
    key: keyOf(child),
    face: <ChildHood child={child} hue={hueOf(child)} size={14} />,
  }))
  const list = {
    title: 'Helpers',
    counts: childCounts(helpers),
    label: 'Its helpers, running ones first',
    rows: <HelperRows helpers={outFirst} hueOf={hueOf} />,
  }

  return (
    <FoldLine
      drop="helpers"
      faces={faces}
      count={helpersCount(helpers)}
      summary={childrenSummary(helpers)}
      live={helpersGlow(helpers)}
      hue={hue}
      list={list}
      className={className}
    />
  )
}

/** An owned helper by its id, a legacy teams row by its name. */
const keyOf = (child: RunChild) => child.id ?? child.name

/** The open list's rows: face, name and how it stands, then what it runs on. */
function HelperRows({ helpers, hueOf }: { helpers: readonly RunChild[]; hueOf: (child: RunChild) => number }) {
  const models = useModelChoices()
  return helpers.map((child) => (
    <li key={keyOf(child)} title={describeChild(child)} className="flex min-w-0 items-start gap-2.5 rounded-xl px-2 py-1.5 text-[13px] leading-snug">
      <span className="mt-px">
        <ChildHood child={child} hue={hueOf(child)} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2 text-[12px]">
          <span className="min-w-0 truncate text-[13px] font-medium">{child.name}</span>
          <span className={cn('min-w-0 flex-1 truncate', child.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>{childLine(child)}</span>
        </span>
        <RunsOnLine words={runsOnWords(child, models)} />
      </span>
    </li>
  ))
}

/** A mark at the face's foot for how a child ended. A report is the wire's pulse come home, not a tick. */
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
