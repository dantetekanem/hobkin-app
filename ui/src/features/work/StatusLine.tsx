import { SlidersHorizontal } from 'lucide-react'
import { useEffect, type Ref } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useNow } from '@/features/chat/use-now.ts'
import { cn } from '@/lib/utils.ts'
import { runWork, useWorkUi } from './store.ts'
import { statusLine, type StatusAct, type StatusInput } from './work-status.ts'
import { workloadAction, type WorkloadSetting } from './workload.ts'

const DOT = { go: 'bg-ok', held: 'bg-warn', off: 'bg-border-strong' } as const

/** Where the line's answers from hobkin are kept. */
const PLACE = 'status'

/**
 * The line under Work's tiles (053): what work mode does next, or the one thing that holds it and until when, with the
 * control that changes it, and the Workload button at its end. It is one line of one height: longer words are cut and
 * read whole on hover, the control keeps its place before the button, and the button never moves. A refusal from
 * hobkin stands in for the words until they change.
 */
export function StatusLine({ work, live, onTurnOn, onSheet, sheetButton }: { work: StatusInput; live: boolean; onTurnOn: () => void; onSheet?: (at: WorkloadSetting | null) => void; sheetButton?: Ref<HTMLButtonElement> }) {
  // The words say "now" or a time, so they follow the clock.
  const now = useNow(true, 30_000)
  const shown = statusLine(work, now)
  // A control that opens the sheet shows only where there is a sheet to open.
  const line = shown.control?.act.do === 'sheet' && !onSheet ? { ...shown, control: null } : shown
  const busy = useWorkUi((state) => Boolean(state.busy[PLACE]))
  const said = useWorkUi((state) => state.said[PLACE])
  const refused = said?.tone === 'refused' ? said.text : null
  useEffect(() => useWorkUi.getState().forget(PLACE), [line.text])

  const act = (what: StatusAct) => {
    if (what.do === 'mode-on') onTurnOn()
    else if (what.do === 'sheet') onSheet?.(what.at)
    else void runWork(what.do === 'allowance' ? { do: 'allowance', at: what.at } : workloadAction(what.change), { live, place: PLACE })
  }
  const text = refused ?? line.text

  return (
    <div className="flex h-9 min-w-0 items-center gap-3">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[line.tone])} />
      <p role={refused ? 'alert' : 'status'} title={text} className={cn('min-w-0 flex-1 truncate text-[13.5px] leading-9', refused ? 'text-bad-fg' : line.tone === 'go' ? 'text-muted-foreground' : 'text-foreground')}>
        {text}
      </p>
      {line.control ? (
        <Button variant="outline" size="sm" data-stop="" disabled={busy} focusableWhenDisabled className="shrink-0" onClick={() => act(line.control!.act)}>
          {busy ? 'Saving…' : line.control.label}
        </Button>
      ) : null}
      {onSheet ? (
        <Button ref={sheetButton} variant="ghost" size="sm" data-stop="" aria-keyshortcuts="w" className="shrink-0 text-muted-foreground" onClick={() => onSheet(null)}>
          <SlidersHorizontal aria-hidden="true" />
          Workload
          <Kbd>W</Kbd>
        </Button>
      ) : null}
    </div>
  )
}
