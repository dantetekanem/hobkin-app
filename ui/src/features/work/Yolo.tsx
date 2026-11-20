import { useState } from 'react'
import { Rise } from '@/app/Reveal.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { rateChoices, readyCount, SAMPLE_YOLO, sampleAfter, stillNeeded, yoloSays } from '@/features/settings/yolo.ts'
import { runCommand } from '@/lib/host/client.ts'
import type { WorkState } from '@/lib/host/index.ts'
import { Segmented } from './parts.tsx'

/**
 * YOLO mode on the Work screen, under work mode's own switch (049-yolo-mode): the switch that lets small,
 * well-reviewed changes merge and deploy by themselves, the lowest general rate it accepts, and what each project
 * still needs before it is ready. Turning it on merges nothing: hobkin first gets each project ready. Without a host
 * it shows sample data, and a click changes only that.
 */
export function YoloMode({ work, live }: { work: WorkState | null; live: boolean }) {
  const [sample, setSample] = useState(SAMPLE_YOLO)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const yolo = live ? (work?.yolo ?? null) : sample
  if (!yolo) return null

  const change = async (next: { on?: boolean; rate?: number }) => {
    if (saving) return
    setProblem(null)
    if (!live) return setSample((before) => sampleAfter(before, next))
    setSaving(true)
    try {
      // The host answers by publishing work mode's status again, which is what this draws.
      await runCommand('work.yolo', next)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const waiting = stillNeeded(yolo)

  return (
    <Rise>
      <section aria-label="YOLO mode" className="flex flex-col gap-3 rounded-3xl bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-3">
            <Switch checked={yolo.on} disabled={saving} onCheckedChange={(on) => void change({ on })} data-stop="" />
            <span className="font-heading text-[14px] font-medium">YOLO mode {yolo.on ? 'on' : 'off'}</span>
          </label>
          {yolo.on && yolo.projects.length ? <span className="text-[13px] text-muted-foreground tabular-nums">{readyCount(yolo)}</span> : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="eyebrow">Lowest rate</span>
            <Segmented
              label="Lowest general rate that merges and deploys by itself"
              name="yolo-rate"
              value={String(yolo.rate)}
              options={rateChoices(yolo).map((rate) => ({ value: String(rate), label: String(rate) }))}
              disabled={saving}
              onChoose={(rate) => void change({ rate: Number(rate) })}
            />
          </div>
        </div>
        <p className="max-w-[72ch] text-[13px] leading-snug text-muted-foreground">{yoloSays(yolo)}</p>
        {yolo.on && waiting.length ? (
          <ul aria-label="Projects not ready yet" className="flex flex-col gap-1.5">
            {waiting.map((project) => (
              <li key={project.slug} className="rounded-2xl bg-background px-4 py-2.5">
                <span className="block text-[14px] font-medium">{project.name}</span>
                <span className="block text-[12px] leading-snug break-words text-muted-foreground">{project.needs.join(' ')}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {problem ? (
          <p role="alert" className="text-[13px] leading-snug text-bad-fg">
            Not saved. {problem}
          </p>
        ) : null}
      </section>
    </Rise>
  )
}
