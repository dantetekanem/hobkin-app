import type { WorkMetrics } from '#shared/protocol/metrics.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { TILE_CHART, type NumbersChart } from '../numbers/board-model.ts'
import { NO_DATA, workTiles, type Tile, type TileKey, type TilesInput } from '../numbers/format.ts'
import type { MetricsReadState } from '../numbers/metrics-store.ts'
import { groupReviews, reviewCounts, type ReviewList } from './ai-reviews.ts'

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
  const { running, ready, failed } = reviewCounts(groupReviews(list))
  return { running, ready, failed }
}

/** Finished changes waiting for the user's yes or no now: every card in every group, as the header counts them. */
export const waitingNow = (work: WorkState): number => work.finished.reduce((sum, group) => sum + group.changes.length, 0)

/** Of those, the ones no group's yes takes: hobkin's "Needs you" and what runs left for the user. */
export const needsYouNow = (work: WorkState): number => work.finished.filter(({ name }) => name === 'needs' || name === 'left').reduce((sum, group) => sum + group.changes.length, 0)

/** The few things the tiles read from the work state, so a tile is drawn again only when one of them changes. */
export interface WorkNow {
  waiting: number
  /** How many of those wait on the user alone. */
  needsYou: number
  tokensToday: number | null
  dailyTokens: number | null
}

export const workNowOf = (work: WorkState): WorkNow => ({ waiting: waitingNow(work), needsYou: needsYouNow(work), tokensToday: work.tokensToday ?? null, dailyTokens: work.dailyTokens ?? null })

/**
 * What the tiles read. The work state has no time a change finished at, so how long the oldest has waited is not
 * known yet. Today's tokens are the host's own count; a host that sends none leaves it to the numbers.
 */
export function tilesInputOf(now: WorkNow | null, reviews: ReviewTally | null, metrics: WorkMetrics | null): TilesInput {
  return {
    days: metrics?.all.days ?? null,
    waiting: now ? { count: now.waiting, oldestMs: null } : null,
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
 * The six tiles. A tile the numbers would have filled keeps its box and says why it is empty. The work state has no
 * time a change finished at, so the waiting tile says how many of them wait on the user alone instead of how old the
 * oldest is.
 */
export function tilesOf(input: TilesInput, state: MetricsReadState, needsYou: number | null = null): Tile[] {
  const why = input.days ? undefined : WHY_NONE[state]
  return workTiles(input).map((tile) => {
    if (tile.key === 'waiting' && needsYou !== null && input.waiting?.count && input.waiting.oldestMs === null) return { ...tile, context: needsYou ? `${needsYou} need you first` : 'all ready for your yes' }
    return why && tile.figure === NO_DATA && !tile.context ? { ...tile, context: why } : tile
  })
}

/** A tile opens the Numbers tab at the chart it stands for. */
export const tileOpens = (key: TileKey): { tab: 'numbers'; at: NumbersChart } => ({ tab: 'numbers', at: TILE_CHART[key] })
