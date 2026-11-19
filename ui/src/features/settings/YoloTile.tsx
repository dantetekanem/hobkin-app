import { useState } from 'react'
import { Switch } from '@/components/ui/switch.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { useHasHost, useWork } from '@/lib/host/index.ts'
import { Choice, Tile } from './SettingsScreen.tsx'
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, stillNeeded, yoloSays, yoloValue } from './yolo.ts'

const className = 'col-span-6 @max-[820px]:col-span-2'

/**
 * YOLO mode (049-yolo-mode): the user's switch for letting small, well-reviewed changes merge and deploy by
 * themselves, and the lowest general rate they accept. It is hobkin's own setting, changed only from here, and turning
 * it on merges nothing: hobkin first gets each project ready. The tile says how many projects are ready and what each
 * of the others still needs. With no host it shows sample data, and a click changes only that.
 */
export function YoloTile() {
  const hasHost = useHasHost()
  const hosted = useWork()?.yolo ?? null
  const [sample, setSample] = useState(SAMPLE_YOLO)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const yolo = hasHost ? hosted : sample

  if (!yolo) {
    return (
      <Tile name="YOLO mode" value="Not known yet" className={className}>
        <p className="text-[13px] text-muted-foreground">hobkin has not said how YOLO mode stands. It shows here once work mode's status arrives.</p>
      </Tile>
    )
  }

  const change = async (next: { on?: boolean; rate?: number }) => {
    if (saving) return
    setProblem(null)
    if (!hasHost) return setSample((before) => sampleAfter(before, next))
    setSaving(true)
    try {
      // The host answers by publishing work mode's status again, which is what this tile draws.
      await runCommand('work.yolo', next)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const waiting = stillNeeded(yolo)

  return (
    <Tile name="YOLO mode" value={hasHost ? yoloValue(yolo) : 'Sample values'} className={className}>
      <label className="flex items-start gap-3">
        <Switch checked={yolo.on} disabled={saving} onCheckedChange={(on) => void change({ on })} data-stop="" className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Let small changes merge and deploy by themselves</span>
          <span className="block max-w-[70ch] text-[12px] leading-snug text-muted-foreground">{yoloSays(yolo)}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px]">Lowest general rate</span>
        <Choice
          label="Lowest general rate"
          value={String(yolo.rate)}
          options={rateChoices(yolo).map((rate) => ({ value: String(rate), label: String(rate) }))}
          onChoose={(rate) => void change({ rate: Number(rate) })}
        />
      </div>
      {yolo.on && yolo.projects.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium">{readyCount(yolo)}</p>
          {waiting.length ? (
            <ul aria-label="Projects not ready yet" className="flex flex-col gap-1.5">
              {waiting.map((project) => (
                <li key={project.slug} className="rounded-2xl bg-surface px-4 py-2.5">
                  <span className="block text-[14px] font-medium">{project.name}</span>
                  <span className="block text-[12px] leading-snug break-words text-muted-foreground">{project.needs.join(' ')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-[13px] leading-snug text-bad-fg">
          Not saved. {problem}
        </p>
      ) : null}
    </Tile>
  )
}
