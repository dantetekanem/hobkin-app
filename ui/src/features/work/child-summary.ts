import type { RunChild } from '#shared/protocol/snapshot.ts'

/**
 * How a run's own agents (the ones it spawned through pi-extended-teams) are put into words. Pure, so the counting
 * is tested without a window. It says only what the run's stream showed: a child's live steps never reach hobkin,
 * a report says nothing of whether the work is right, and a child the run outlived ended in a way nobody saw.
 */

type ChildState = RunChild['state']

/** What is still out first, then failures, then how the rest ended. */
const ORDER: readonly ChildState[] = ['running', 'queued', 'failed', 'reported', 'stopped']

const WORD: Record<ChildState, string> = { running: 'running', queued: 'queued', reported: 'reported', failed: 'failed', stopped: 'never reported' }

/** "3 helpers · 1 running, 1 queued, 1 reported", or nothing for a run that spawned none. */
export function childrenSummary(children: readonly RunChild[]): string {
  if (children.length === 0) return ''
  const counts = ORDER.flatMap((state) => {
    const count = children.filter((child) => child.state === state).length
    return count ? [`${count} ${WORD[state]}`] : []
  })
  return `${children.length === 1 ? '1 helper' : `${children.length} helpers`} · ${counts.join(', ')}`
}

/** One child's state in a few words. A running one adds its tool or phase when the run last asked teams for them. */
export function childLine(child: RunChild): string {
  const last = child.activeTool ?? child.phase
  if (child.state === 'running' && last) return `running · ${last}`
  if (child.state === 'queued' && child.queuePosition) return `queued · #${child.queuePosition}`
  return WORD[child.state]
}

const MEANING: Record<ChildState, string> = {
  running: 'running',
  queued: 'queued for a free place',
  reported: 'sent its report, which does not say whether the work is right',
  failed: 'failed: it could not start, or reported a failure',
  stopped: 'never reported: the run ended first, so how it ended is unknown',
}

/** One child in full, for a tooltip or a screen reader. */
export function describeChild(child: RunChild): string {
  const who = [child.name, child.role, child.modelSlot].filter(Boolean).join(', ')
  const position = child.state === 'queued' && child.queuePosition ? `, number ${child.queuePosition} in line` : ''
  const last = [child.phase, child.activeTool].filter(Boolean).join(', ')
  const status = child.state === 'running' && last ? `; at the run's last status check: ${last}` : ''
  return `${who}: ${MEANING[child.state]}${position}${status}`
}

/**
 * The children an agent's node has room for. All of them when they fit. Past that, one place goes to the count of
 * the rest, and the others go to the ones still out, then failures, then reports, each kept in the order it came.
 */
export function satellitesOf(children: readonly RunChild[], room: number): { shown: readonly RunChild[]; more: number } {
  if (children.length <= room) return { shown: children, more: 0 }
  const picked = new Set([...children].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state)).slice(0, room - 1))
  return { shown: children.filter((child) => picked.has(child)), more: children.length - picked.size }
}

/** The hue hobkin's own helpers' faces take after: near its yellow eyes. */
export const HOBKIN_HUE = 70

const NONE: readonly RunChild[] = []
const isOut = (child: RunChild) => child.state === 'running' || child.state === 'queued'

/**
 * hobkin's own helpers worth showing now: none once all have ended, else the ones still out and those that ended
 * since the first of them started, so a long chat's earlier helpers do not pile up.
 */
export function helpersNow(children: readonly RunChild[]): readonly RunChild[] {
  const out = children.filter(isOut)
  if (out.length === 0) return NONE
  const since = Math.min(...out.map((child) => child.startedAt ?? 0))
  return children.filter((child) => isOut(child) || (child.endedAt ?? 0) >= since)
}

/** A child wears its parent's hue, turned a little each, so siblings tell apart and never move in step. */
export const childHue = (parentHue: number, index: number) => (parentHue + 18 * (index + 1)) % 360
