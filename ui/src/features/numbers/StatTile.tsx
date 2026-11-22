import { memo, useId, useMemo } from 'react'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import { pressProps } from './ChartFrame.tsx'
import { NO_DATA, type Tile, type TileKey } from './format.ts'
import { Sparkline } from './Sparkline.tsx'

export interface StatTileProps {
  label: string
  /** The figure, or "no data yet". */
  figure: string
  /** Smaller words after the figure: "of 100M", "running". */
  after?: string
  /** One line of context under the figure. */
  context: string
  /** What the tile counts, in a sentence: its title, and its description for a reader. */
  counts: string
  /** One value for each of the last 30 days, oldest first. */
  series: readonly (number | null)[]
  /** What a full sparkline bar stands for: 1 for a share. */
  most?: number
  /** The numbers are being read: the tile keeps its box and says so. */
  loading?: boolean
  /** Makes the tile a button that opens what it counts. */
  onOpen?: () => void
}

const TILE = 'flex h-[124px] min-w-0 flex-col gap-0.5 rounded-2xl bg-background px-3.5 py-3 text-left select-none'

/**
 * One tile of the Work sketch: a label, the figure, one line of context and a 30-day sparkline, in a box of one size
 * whatever it holds. Given `onOpen` it is a button with the open arrow.
 */
export const StatTile = memo(function StatTile({ label, figure, after, context, counts, series, most, loading = false, onOpen }: StatTileProps) {
  const described = useId()
  const known = !loading && figure !== NO_DATA
  const name = loading ? `${label}: reading the numbers` : `${label}: ${figure}${after ? ` ${after}` : ''}${context ? `, ${context}` : ''}`
  const body = (
    <>
      <span className="flex h-5 min-w-0 items-center justify-between gap-2">
        <span className="truncate font-label text-[12.5px] font-medium text-muted-foreground">{label}</span>
        {onOpen ? <OpenArrow className="size-3.5" /> : null}
      </span>
      <span className="flex h-8 min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
        {known ? (
          <>
            <span className="font-heading text-[24px] leading-8 font-semibold tracking-[-0.02em] [font-variant-numeric:normal]">{figure}</span>
            {after ? <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{after}</span> : null}
          </>
        ) : (
          <span className="text-[13px] leading-8 text-muted-foreground">{loading ? 'Reading…' : NO_DATA}</span>
        )}
      </span>
      <span className="h-5 truncate text-[12.5px] leading-5 text-muted-foreground">{loading ? '' : context}</span>
      <Sparkline values={series} most={most} className="mt-auto" />
      <span id={described} className="sr-only">
        {counts}
      </span>
    </>
  )
  return (
    <div {...pressProps(onOpen)} title={counts} aria-label={name} aria-describedby={described} className={cn(TILE, onOpen && 'pressable')}>
      {body}
    </div>
  )
})

/**
 * The six tiles in one row, as on Work and a project's page: six across from 896 pixels of room, three below that,
 * two when narrow. `onOpen` gets the tile's key; `TILE_CHART` (`board-model.ts`) names the Numbers chart it opens at.
 */
export const TileRow = memo(function TileRow({ tiles, loading = false, onOpen }: { tiles: readonly Tile[]; loading?: boolean; onOpen?: (key: TileKey) => void }) {
  // One handler for each key, kept while `onOpen` is, so a tile whose numbers did not change is not drawn again.
  const keys = tiles.map((tile) => tile.key).join(' ')
  const opens = useMemo(() => (onOpen ? new Map(keys.split(' ').map((key) => [key, () => onOpen(key as TileKey)])) : null), [keys, onOpen])
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-6">
        {tiles.map(({ key, ...tile }) => (
          <StatTile key={key} {...tile} loading={loading} onOpen={opens?.get(key)} />
        ))}
      </div>
    </div>
  )
})
