import { Dialog } from '@base-ui/react/dialog'
import { useMemo, useRef, useState } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import type { WorkState } from '#shared/protocol/work.ts'
import { cn } from '@/lib/utils.ts'
import { QueueRowCard } from './Queue.tsx'
import { sheetRows } from './queue-sheet.ts'
import { useWorkUi } from './store.ts'
import { useWholeQueue } from './use-whole-queue.ts'

/**
 * The queue as a sheet, built as the workload sheet is: the same dialog, a head that stays and a body that scrolls. It
 * lists every row in hobkin's order with what the page's row has and the same four actions. The rows of paused projects
 * come last under one line. The project the page shows is the sheet's, with a way to see them all from inside it.
 * Escape and Close close it and the keyboard goes back to what had it.
 */
interface QueueSheetProps {
  open: boolean
  work: Pick<WorkState, 'queue' | 'queued' | 'projects'>
  /** The project the page shows alone, as its slug and its name, or null for All. */
  only: { slug: string; name: string } | null
  live: boolean
  onClose: () => void
}

export function QueueSheet({ open, work, only, live, onClose }: QueueSheetProps) {
  const still = useStill()
  const popup = useRef<HTMLDivElement | null>(null)
  const fade = still
    ? 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
    : 'transition-[translate,scale,opacity] duration-[360ms] ease-[var(--ease-drawer)] data-[starting-style]:translate-y-[-46%] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms]'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm transition-opacity duration-[240ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          ref={popup}
          initialFocus={() => popup.current?.querySelector<HTMLElement>('[data-sheet-row]') ?? true}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex h-[min(760px,calc(100vh-48px))] w-[min(780px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none',
            fade,
          )}
        >
          {open ? <QueueBody work={work} only={only} live={live} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function QueueBody({ work, only, live }: Pick<QueueSheetProps, 'work' | 'only' | 'live'>) {
  // Seen from inside the sheet, a project's choice can be lifted for the length of the visit.
  const [everything, setEverything] = useState(false)
  const chosen = everything ? null : (only?.slug ?? null)
  const queue = useWholeQueue(true, work, live)
  const pausedSlugs = useMemo(() => new Set(work.projects.filter(({ paused }) => paused).map(({ slug }) => slug)), [work.projects])
  const { rows, paused } = useMemo(() => sheetRows(queue, pausedSlugs, chosen), [queue, pausedSlugs, chosen])
  const waiting = rows.filter(({ skipped }) => !skipped).length + paused.filter(({ skipped }) => !skipped).length
  const urgent = rows.filter(({ grade, skipped }) => grade === 'P0' && !skipped).length
  const pausedProjects = new Set(paused.map(({ slug }) => slug)).size
  const told = useWorkUi((state) => state.said['queue'])
  const forget = useWorkUi((state) => state.forget)

  return (
    <>
      <header className="flex shrink-0 items-start gap-4 px-7 pt-6 pb-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em]">Queue</Dialog.Title>
          <Dialog.Description className="mt-1 flex min-h-7 flex-wrap items-center gap-x-2 text-[13.5px] leading-relaxed text-muted-foreground">
            {`${urgent ? `${urgent} P0 · ` : ''}${waiting} queued`}
            {only && !everything ? ` · ${only.name} only` : ''}
            {only && !everything ? (
              <Button variant="ghost" size="xs" onClick={() => setEverything(true)} className="text-muted-foreground">
                Show all projects
              </Button>
            ) : null}
          </Dialog.Description>
        </div>
        <Dialog.Close render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
          Close <Kbd>esc</Kbd>
        </Dialog.Close>
      </header>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 pb-2">
        {rows.length || paused.length ? (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <SheetRow key={row.key} row={row} live={live} />
            ))}
            {paused.length ? (
              <li className="px-3 pt-5 pb-1 text-[12.5px] text-muted-foreground">{pausedProjects === 1 ? 'These wait on a paused project.' : 'These wait on paused projects.'}</li>
            ) : null}
            {paused.map((row) => (
              <SheetRow key={row.key} row={row} live={live} />
            ))}
          </ul>
        ) : (
          <p className="px-3 text-[13.5px] text-muted-foreground">{only && !everything ? `Nothing is queued for ${only.name}.` : 'Nothing is queued.'}</p>
        )}
      </div>

      {/* What hobkin said of the last Start now, where it stays whether the row left or not. The line keeps its height. */}
      <footer className="mx-4 flex min-h-12 shrink-0 items-center gap-3 border-t border-border px-3">
        <p role={told?.tone === 'refused' ? 'alert' : 'status'} className={cn('min-w-0 flex-1 truncate text-[12.5px] leading-snug', told ? (told.tone === 'refused' ? 'text-bad-fg' : '') : 'text-muted-foreground')} title={told?.text}>
          {told ? told.text : 'Enter on a row runs it next.'}
        </p>
        {told ? (
          <Button variant="ghost" size="xs" onClick={() => forget('queue')} className="shrink-0 text-muted-foreground">
            Done
          </Button>
        ) : null}
      </footer>
    </>
  )
}

/** A row of sixty and more costs nothing while it is off screen: the browser skips drawing it. */
function SheetRow({ row, live }: { row: WorkState['queue'][number]; live: boolean }) {
  return (
    <li className="[contain-intrinsic-size:auto_56px] [content-visibility:auto]">
      <QueueRowCard row={row} live={live} sheet />
    </li>
  )
}
