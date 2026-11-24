import type { WorkMetrics } from '#shared/protocol/metrics.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { TILE_CHART, type NumbersChart } from '../numbers/board-model.ts'
import { NO_DATA, workTiles, type Tile, type TileKey, type TilesInput } from '../numbers/format.ts'
import type { MetricsReadState } from '../numbers/metrics-store.ts'
import { reviewCounts, rowsOf, type ReviewList } from './ai-reviews.ts'

/**
 * Work's six tiles (_specs/053-work-control-room, "Work"): what they read from the work state, the AI reviews' list
 * the page already follows, and the numbers by day, and what a click on one opens. Pure, so it is tested alone.
 */

/** The AI reviews as their list says now. */
export interface ReviewTally {
  running: number
  ready: number
  failed: number
}

/** The AI reviews running, ready and stopped, or null before the list first answers, so the tile does not say none run. */
export function reviewTallyOf(list: ReviewList | null): ReviewTally | null {
  if (!list) return null
  const { running, ready, failed } = reviewCounts(rowsOf(list))
  return { running, ready, failed }
}

/** Finished changes waiting for the user's yes or no now: every card in every group, as the header counts them. */
export const waitingNow = (work: WorkState): number => work.finished.reduce((sum, group) => sum + group.changes.length, 0)

/** Of those, the ones no group's yes takes: hobkin's "Needs you" and what runs left for the user. */
export const needsYouNow = (work: WorkState): number =>
  work.finished
    .filter(({ name }) => name === 'needs' || name === 'left')
    .reduce((sum, group) => sum + group.changes.length, 0)

/**
 * When the change that has waited longest was last written (`FinishedChange.at`), in milliseconds, or null unless every
 * waiting change says it: a host older than the time sends none. hobkin writes an item again for a review's scores, a
 * note or a refresh, so the time can be later than the finish, and the wait it gives can read shorter, never longer.
 */
export function oldestAtOf(work: Pick<WorkState, 'finished'>): number | null {
  const times = work.finished.flatMap(({ changes }) => changes.map(({ at }) => (at ? Date.parse(at) : Number.NaN)))
  if (!times.length || times.some((time) => !Number.isFinite(time))) return null
  return Math.min(...times)
}

/** The few things the tiles read from the work state, so a tile is drawn again only when one of them changes. */
export interface WorkNow {
  waiting: number
  /** How many of those wait on the user alone. */
  needsYou: number
  /** When the oldest of them was last written, or null when not every one says (`oldestAtOf`). */
  oldestAt: number | null
  tokensToday: number | null
  dailyTokens: number | null
}

export const workNowOf = (work: WorkState): WorkNow => ({
  waiting: waitingNow(work),
  needsYou: needsYouNow(work),
  oldestAt: oldestAtOf(work),
  tokensToday: work.tokensToday ?? null,
  dailyTokens: work.dailyTokens ?? null,
})

/**
 * What the tiles read, at `clock`. How long the oldest change has waited is known only when every one says when it was
 * last written. Today's tokens are the host's own count; a host that sends none leaves it to the numbers.
 */
export function tilesInputOf(now: WorkNow | null, reviews: ReviewTally | null, metrics: WorkMetrics | null, clock = Date.now()): TilesInput {
  const oldestMs = now?.oldestAt == null ? null : Math.max(0, clock - now.oldestAt)
  return {
    days: metrics?.all.days ?? null,
    waiting: now ? { count: now.waiting, oldestMs } : null,
    reviews,
    tokens: now ? { today: now.tokensToday, limit: now.dailyTokens } : null,
    merged: 'today',
  }
}

/** Why a tile with no figure has none, under it, when the numbers could not be had. */
const WHY_NONE: Partial<Record<MetricsReadState, string>> = {
  'older-host': 'this host sends none yet',
  failed: 'could not be read',
}

/**
 * The six tiles. A tile the numbers would have filled keeps its box and says why it is empty. When how long the oldest
 * change has waited is not known, the waiting tile says how many of them wait on the user alone instead.
 */
export function tilesOf(input: TilesInput, state: MetricsReadState, needsYou: number | null = null): Tile[] {
  const why = input.days ? undefined : WHY_NONE[state]
  const oldestUnknown = needsYou !== null && Boolean(input.waiting?.count) && input.waiting?.oldestMs === null
  return workTiles(input).map((tile) => {
    if (tile.key === 'waiting' && oldestUnknown) {
      return { ...tile, context: needsYou ? `${needsYou} need you first` : 'all ready for your yes' }
    }
    if (why && tile.figure === NO_DATA && !tile.context) return { ...tile, context: why }
    return tile
  })
}

/** A tile opens the Numbers tab at the chart it stands for. */
export const tileOpens = (key: TileKey): { tab: 'numbers'; at: NumbersChart } => ({ tab: 'numbers', at: TILE_CHART[key] })
