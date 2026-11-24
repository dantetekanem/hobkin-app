import { Plus, X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { MEMORY_NOW_MAX } from '#shared/protocol/memory.ts'
import { Button } from '@/components/ui/button.tsx'
import { cn } from '@/lib/utils.ts'
import type { NowLine } from './groups.ts'
import { memoryActions, memoryStore, useMemory } from './use-memories.ts'

/** Every line of the list keeps one height, whether it reads, is being written or was just removed. */
const LINE = 'flex min-h-12 items-center gap-2 px-4 py-2'

/**
 * The Right now list (`memory.md`): the main chat's short list of what matters at the moment, with its own add, edit
 * and remove. A removed line stays where it was as one line with Undo until the page is left. A search shows only the
 * lines with every word, and adding or editing waits for the search to clear.
 */
export function NowList({ lines, total, searching }: { lines: readonly NowLine[]; total: number; searching: boolean }) {
  const edit = useMemory((state) => state.nowEdit)
  const busy = useMemory((state) => state.nowBusy)
  const refused = useMemory((state) => state.nowRefused)
  const removed = useMemory((state) => state.nowRemoved)
  const full = total >= MEMORY_NOW_MAX

  // What was removed sits where it was, among the lines still there.
  const rows: ({ kind: 'line'; line: NowLine } | { kind: 'removed'; text: string })[] = lines.map((line) => ({ kind: 'line', line }))
  if (!searching) for (const gone of [...removed].sort((a, b) => a.index - b.index)) rows.splice(Math.min(gone.index, rows.length), 0, { kind: 'removed', text: gone.text })
  const adding = edit !== null && edit.item === null

  return (
    <section aria-label="Right now" className="flex flex-col gap-3">
      <header className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 className="eyebrow">Right now</h3>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            The main chat's short list of what matters at the moment, {total} of {MEMORY_NOW_MAX} lines. Routines and Work runs read it too.
          </p>
        </div>
        <Button variant="outline" size="sm" data-key-stop="" disabled={full || busy || searching || edit !== null} onClick={() => memoryStore.nowStart(null)}>
          <Plus aria-hidden="true" />
          Add a line
        </Button>
      </header>
      {rows.length === 0 && !adding ? (
        <p className="rounded-[22px] border border-dashed border-border-strong/40 px-4 py-4 text-[13px] text-muted-foreground">{searching ? 'No line holds those words.' : 'Nothing right now.'}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-[22px] bg-background">
          {rows.map((row) =>
            row.kind === 'removed' ? (
              <li key={`removed:${row.text}`} className={LINE}>
                <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  Removed <span className="text-foreground">“{row.text}”</span>
                </p>
                <Button variant="outline" size="sm" data-key-stop="" disabled={busy} onClick={() => void memoryActions.nowUndoRemove(row.text)}>
                  Undo
                </Button>
              </li>
            ) : edit !== null && edit.item === row.line.text ? (
              <NowEditor key={`line:${row.line.index}`} text={edit.text} busy={busy} />
            ) : (
              <li key={`line:${row.line.index}`} className={LINE}>
                <p className="min-w-0 flex-1 text-[13.5px] leading-snug break-words">{row.line.text}</p>
                <Button variant="ghost" size="sm" data-key-stop="" disabled={busy || edit !== null} onClick={() => memoryStore.nowStart(row.line.text)}>
                  Edit
                </Button>
                <Button variant="ghost" size="icon-sm" data-key-stop="" disabled={busy || edit !== null} aria-label={`Remove “${row.line.text}”`} onClick={() => void memoryActions.nowRemove(row.line.text, row.line.index)}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            ),
          )}
          {adding ? <NowEditor key="new" text={edit.text} busy={busy} /> : null}
        </ol>
      )}
      {refused ? (
        <p role="alert" className="text-[12.5px] text-bad-fg">
          {refused}
        </p>
      ) : null}
    </section>
  )
}

/** A line being written, in its place: Enter saves, Escape puts it back as it was. */
function NowEditor({ text, busy }: { text: string; busy: boolean }) {
  const field = useRef<HTMLInputElement | null>(null)
  useEffect(() => field.current?.focus({ preventScroll: true }), [])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void memoryActions.nowSave()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      memoryStore.nowCancel()
    }
  }

  return (
    <li className={LINE}>
      <input
        ref={field}
        data-key-stop=""
        value={text}
        maxLength={200}
        aria-label="Right now line"
        placeholder="What matters now, such as “Reply to the landlord by Friday”"
        onChange={(event) => memoryStore.nowType(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        className={cn('h-8 min-w-0 flex-1 rounded-lg border border-input bg-surface px-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50')}
      />
      <Button variant="ghost" size="sm" data-key-stop="" disabled={busy} onClick={() => memoryStore.nowCancel()}>
        Cancel
      </Button>
      <Button size="sm" data-key-stop="" disabled={busy} onClick={() => void memoryActions.nowSave()}>
        Save
      </Button>
    </li>
  )
}
