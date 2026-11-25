import { useEffect } from 'react'
import { Switch } from '@/components/ui/switch.tsx'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { SHORT_REPORTS_SAYS, shortReportsValue, useShortReports } from './short-reports.ts'
import { Tile } from './SettingsScreen.tsx'

/**
 * Short reports (051-short-reports): while it is on, hobkin writes a short version of each new report on its fast tier,
 * and the reader shows it first with the full report under it. The switch is hobkin's, read when the tile mounts.
 * The line under it always holds one line, so a problem that shows there moves nothing.
 */
export function ShortReportsTile() {
  const hasHost = useHasHost()
  const on = useShortReports((state) => state.on)
  const problem = useShortReports((state) => state.problem)

  useEffect(() => {
    if (hasHost) void useShortReports.getState().load()
  }, [hasHost])

  const line = !hasHost ? 'hobkin keeps this switch, and the host is not connected.' : problem ?? 'Each short version is one call to the fast tier. Reports from before you turn it on stay as they are.'

  return (
    <Tile name="Short reports" value={shortReportsValue(on)} className="col-span-3 @max-[820px]:col-span-2">
      <label className="flex flex-1 items-start gap-3">
        <Switch
          checked={on === true}
          disabled={!hasHost || on === null}
          onCheckedChange={(next) => void useShortReports.getState().turn(next)}
          data-stop=""
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">A short version first</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">{SHORT_REPORTS_SAYS}</span>
        </span>
      </label>
      <p role="status" className={cn('min-h-lh text-[12px] leading-snug', hasHost && problem ? 'text-destructive' : 'text-muted-foreground')}>
        {line}
      </p>
    </Tile>
  )
}
