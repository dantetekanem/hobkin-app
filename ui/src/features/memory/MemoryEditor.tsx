import { useId, useState, type KeyboardEvent } from 'react'
import { MEMORY_KINDS, type MemoryKind } from '#shared/protocol/memory.ts'
import { Button } from '@/components/ui/button.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { cn } from '@/lib/utils.ts'
import { KIND_WORDS } from './groups.ts'
import type { MemoryDraft } from './store.ts'

const KIND_CHOICES = MEMORY_KINDS.map((kind) => ({ value: kind, label: KIND_WORDS[kind].one }))

const FIELD = 'w-full rounded-xl border border-input bg-surface px-3 text-[14px] outline-none transition-[border-color,box-shadow] duration-[160ms] ease-[ease] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

export interface MemoryEditorProps {
  /** The row's own label, for the fields' names: the memory's description, or "New memory". */
  label: string
  draft: MemoryDraft
  /** The draft says something other than the memory does. */
  dirty: boolean
  busy: boolean
  /** Why the host refused the last save, kept until the next. */
  refused: string | null
  onChange: (patch: Partial<MemoryDraft>) => void
  onSave: () => void
  onCancel: () => void
}

/**
 * A memory being written, inside its row: the description, the kind, the day it holds until, private, and the text.
 * Save and Cancel keep their place whatever the row says, and a refusal shows to their left in the host's words. The
 * Command+S and Command+Enter keys save. Escape cancels an untouched draft, and asks once before dropping words.
 */
export function MemoryEditor({ label, draft, dirty, busy, refused, onChange, onSave, onCancel }: MemoryEditorProps) {
  const id = useId()
  const [warned, setWarned] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const save = (event.key === 's' || event.key === 'Enter') && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey
    if (save) {
      event.preventDefault()
      onSave()
      return
    }
    if (event.key !== 'Escape' || event.defaultPrevented) return
    // The kind's list closes on its own Escape first.
    if (event.target instanceof HTMLElement && event.target.closest('[role="listbox"]')) return
    event.preventDefault()
    if (!dirty || warned) onCancel()
    else setWarned(true)
  }

  const change = (patch: Partial<MemoryDraft>) => {
    setWarned(false)
    onChange(patch)
  }

  const status = refused ?? (busy ? 'Saving…' : warned ? 'Unsaved changes. Press Escape again to drop them.' : '')

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <label className="flex flex-col gap-1.5" htmlFor={`${id}-description`}>
        <span className="eyebrow">Description</span>
        <input
          id={`${id}-description`}
          data-key-stop=""
          data-first-field=""
          value={draft.description}
          maxLength={150}
          placeholder="One line every agent reads, such as “Lives in Lisbon since 2025”"
          aria-label={`${label}: description`}
          onChange={(event) => change({ description: event.currentTarget.value.replace(/\n/g, ' ') })}
          className={cn(FIELD, 'h-9 font-medium')}
        />
      </label>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow" id={`${id}-kind`}>
            Kind
          </span>
          <Select items={KIND_CHOICES} value={draft.kind} onValueChange={(next) => next && change({ kind: next as MemoryKind })}>
            <SelectTrigger aria-labelledby={`${id}-kind`} data-key-stop="" className="h-9 min-w-44 rounded-xl border-input bg-surface px-3 text-[14px] data-[size=default]:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value} label={choice.label}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex h-9 items-center gap-2.5" htmlFor={`${id}-private`}>
          <Switch id={`${id}-private`} data-key-stop="" checked={draft.private} onCheckedChange={(on) => change({ private: on })} aria-describedby={`${id}-private-line`} />
          <span className="text-[13.5px] font-medium">Private</span>
          <span id={`${id}-private-line`} className="text-[12px] text-muted-foreground">
            Only the main chat and durable hobkins get it
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label className="eyebrow" htmlFor={`${id}-until`}>
            Until <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <div className="flex items-center gap-1">
            <input
              id={`${id}-until`}
              data-key-stop=""
              type="date"
              value={draft.until}
              onChange={(event) => change({ until: event.currentTarget.value })}
              className={cn(FIELD, 'h-9 w-40 tabular-nums')}
            />
            {/* Last on its line, so it comes and goes without moving anything. */}
            {draft.until ? (
              <Button variant="ghost" size="sm" data-key-stop="" onClick={() => change({ until: '' })}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1.5" htmlFor={`${id}-text`}>
        <span className="eyebrow">
          Text <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <textarea
          id={`${id}-text`}
          data-key-stop=""
          value={draft.text}
          maxLength={2000}
          rows={3}
          placeholder="The fact in plain sentences. [[a-memory-name]] links to another memory."
          aria-label={`${label}: text`}
          onChange={(event) => change({ text: event.currentTarget.value })}
          className={cn(FIELD, 'field-sizing-content min-h-20 py-2 leading-relaxed')}
        />
      </label>

      <div className="flex items-center gap-2">
        <p role="status" className={cn('min-w-0 flex-1 text-[12.5px] leading-snug break-words', refused ? 'text-bad-fg' : 'text-muted-foreground')}>
          {status}
        </p>
        <Button variant="ghost" data-key-stop="" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button data-key-stop="" disabled={busy} aria-busy={busy || undefined} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  )
}
