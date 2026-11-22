import { memo, useMemo } from 'react'
import { TILE_DAYS, type TileKey } from '@/features/numbers/format.ts'
import { TileRow } from '@/features/numbers/StatTile.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { useWorkMetrics } from '@/features/numbers/use-work-metrics.ts'
import { useWorkTab } from './tab.ts'
import { tileOpens, tilesInputOf, tilesOf, type ReviewTally, type WorkNow } from './work-tiles.ts'

/** A tile opens the Numbers tab at the chart it stands for. One function for the page's life, so the tiles stay drawn. */
const openTile = (key: TileKey) => useWorkTab.getState().openNumbers(tileOpens(key).at)

/**
 * Work's six tiles under its header (053, "Work"): what waits, merged today, first pass, by itself, AI reviews and
 * today's tokens, each with a 30-day sparkline, each a button into Numbers. They are drawn again only when one of
 * the few things they read changes, not on every message the host sends.
 */
export const WorkTiles = memo(function WorkTiles({
  waiting,
  needsYou,
  oldestAt,
  tokensToday,
  dailyTokens,
  reviews,
}: {
  waiting: number | null
  needsYou: number | null
  oldestAt: number | null
  tokensToday: number | null
  dailyTokens: number | null
  reviews: ReviewTally | null
}) {
  // How long the oldest has waited follows the clock, a minute at a time, and only while it is known.
  const read = useNow(oldestAt !== null, 60_000)
  const clock = oldestAt === null ? 0 : read
  const { metrics, state } = useWorkMetrics(TILE_DAYS)
  // The reviews' counts, not their object, so a list read again that counts the same makes no new tiles.
  const hasReviews = reviews !== null
  const running = reviews?.running ?? 0
  const ready = reviews?.ready ?? 0
  const failed = reviews?.failed ?? 0
  const tiles = useMemo(() => {
    const now: WorkNow | null = waiting === null ? null : { waiting, needsYou: needsYou ?? 0, oldestAt, tokensToday, dailyTokens }
    const tally = hasReviews ? { running, ready, failed } : null
    return tilesOf(tilesInputOf(now, tally, metrics, clock), state, needsYou)
  }, [waiting, needsYou, oldestAt, tokensToday, dailyTokens, hasReviews, running, ready, failed, metrics, state, clock])
  return <TileRow tiles={tiles} loading={state === 'loading' && !metrics} onOpen={openTile} />
})
