import { memo, useMemo } from 'react'
import { TILE_DAYS, type TileKey } from '@/features/numbers/format.ts'
import { TileRow } from '@/features/numbers/StatTile.tsx'
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
export const WorkTiles = memo(function WorkTiles({ waiting, tokensToday, dailyTokens, reviews }: { waiting: number | null; tokensToday: number | null; dailyTokens: number | null; reviews: ReviewTally | null }) {
  const { metrics, state } = useWorkMetrics(TILE_DAYS)
  const tally = reviews ? `${reviews.running}/${reviews.ready}/${reviews.failed}` : ''
  const tiles = useMemo(() => {
    const now: WorkNow | null = waiting === null ? null : { waiting, tokensToday, dailyTokens }
    const [running = 0, ready = 0, failed = 0] = tally ? tally.split('/').map(Number) : []
    return tilesOf(tilesInputOf(now, tally ? { running, ready, failed } : null, metrics), state)
  }, [waiting, tokensToday, dailyTokens, tally, metrics, state])
  return <TileRow tiles={tiles} loading={state === 'loading' && !metrics} onOpen={openTile} />
})
