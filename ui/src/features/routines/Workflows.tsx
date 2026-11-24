import { Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Rise } from '@/app/Reveal.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { serviceMark } from '@/features/integrations/marks.ts'
import { ServiceMark } from '@/features/integrations/ServiceMark.tsx'
import { waited } from '@/features/reports/time.ts'
import { windowPart } from '@/integration/registry.ts'
import { runWorkflow, setWorkflowEnabled, useWorkflows } from '@/integration/use-workflows.ts'
import { pressable, startWords, type WorkflowRow } from '@/integration/workflows.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The workflows integrations bring, under the routines and quieter than them: a group for each integration, with its
 * name and mark. A workflow's file is its integration's, so it can be run now (when a press starts it) and turned off
 * and on here, and nothing else. What starts it is its line; its last run is what the host says of it, and the whole
 * of its runs is in Reports.
 */
export function Workflows({ walkable = true, now, rows }: { walkable?: boolean; now: number; rows?: readonly WorkflowRow[] }) {
  const hosted = useWorkflows()
  const all = rows ?? hosted
  const groups = useMemo(() => {
    const byIntegration = new Map<string, WorkflowRow[]>()
    for (const row of all) byIntegration.set(row.integration, [...(byIntegration.get(row.integration) ?? []), row])
    return [...byIntegration]
  }, [all])
  if (groups.length === 0) return null

  return (
    <Rise>
    <div className="flex flex-col gap-4 pt-3" data-workflows="">
      {groups.map(([integration, workflows]) => {
        const part = windowPart(integration)
        const name = part?.manifest.name ?? integration
        return (
          <section key={integration} aria-label={`${name} workflows`} className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 px-1 font-heading text-[12px] font-medium text-muted-foreground">
              <ServiceMark look={part?.mark ?? serviceMark(integration)} size={18} />
              {name}
              <span className="tabular-nums">{workflows.length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {workflows.map((workflow) => (
                <WorkflowItem key={workflow.id} workflow={workflow} name={name} now={now} walkable={walkable} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
    </Rise>
  )
}

function WorkflowItem({ workflow, name, now, walkable }: { workflow: WorkflowRow; name: string; now: number; walkable: boolean }) {
  const live = useHasHost()
  const [busy, setBusy] = useState<'run' | 'enable' | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const act = async (kind: 'run' | 'enable', call: () => Promise<unknown>) => {
    if (busy) return
    setBusy(kind)
    setRefusal(null)
    try {
      await call()
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }
  const last = workflow.lastRun ? Date.parse(workflow.lastRun.at) : Number.NaN

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-tone-1 px-3.5 py-2.5', !workflow.enabled && 'opacity-60')}>
      <div className="min-w-[200px] flex-1">
        <p className="text-[14px] leading-snug font-medium">{workflow.title}</p>
        <p className="text-[12px] text-muted-foreground">
          {startWords(workflow, name)}
          {workflow.state === 'running' ? ' · running now' : ''}
          {Number.isFinite(last) ? ` · last run ${waited(last, now)} ago, ${workflow.lastRun!.outcome}` : ''}
        </p>
        {refusal ? (
          <p role="alert" className="text-[12px] text-bad-fg">
            {refusal}
          </p>
        ) : null}
      </div>
      {pressable(workflow) ? (
        <Button variant="outline" size="sm" data-stop={walkable ? '' : undefined} tabIndex={walkable ? 0 : -1} disabled={!live || busy !== null} focusableWhenDisabled onClick={() => void act('run', () => runWorkflow(workflow.id))}>
          <Play aria-hidden="true" />
          {busy === 'run' ? 'Starting…' : 'Run now'}
        </Button>
      ) : null}
      <Switch
        aria-label={`${workflow.title} on or off`}
        checked={workflow.enabled}
        disabled={!live || busy !== null}
        data-stop={walkable ? '' : undefined}
        tabIndex={walkable ? 0 : -1}
        onCheckedChange={(on) => void act('enable', () => setWorkflowEnabled(workflow.id, on))}
      />
    </li>
  )
}
