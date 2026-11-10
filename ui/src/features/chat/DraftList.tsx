import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils.ts'
import { draftAge, type KeptDraft } from './draft.ts'
import { useNow } from './use-now.ts'

/** A draft's first line, as the list names it, without the marks of a heading. */
const firstLine = (text: string) => (text.trim().split('\n', 1)[0] ?? '').replace(/^#{1,6}\s+/, '').slice(0, 160)
const images = (count: number) => (count === 1 ? '1 image' : `${count} images`)

export interface DraftListProps {
  /** What is being written now. */
  current: { text: string; images: number }
  /** The drafts set aside, newest first. */
  kept: readonly KeptDraft[]
  /** Opens a kept draft in the editor. */
  onOpen: (id: string) => void
  /** Back to the text, with nothing opened. */
  onBack: () => void
}

/**
 * The drafts: the one being written on top, then the ones set aside, newest first, each with its first line and
 * when it was kept. Keys, once the list has the keyboard (Shift+Tab from the text): Up and Down move, Enter opens,
 * Escape goes back to the text.
 */
export function DraftList({ current, kept, onOpen, onBack }: DraftListProps) {
  const listId = useId()
  const [active, setActive] = useState(0)
  // The ages move on while the editor is open.
  const now = useNow(true, 30000)
  // A row that went away hands the highlight to the one now in its place.
  const index = Math.min(active, kept.length)
  const rowId = (at: number) => `${listId}-${at}`
  const choose = (at: number) => (at === 0 ? onBack() : onOpen(kept[at - 1]!.id))

  useEffect(() => {
    document.getElementById(rowId(index))?.scrollIntoView({ block: 'nearest' })
  }, [index, listId])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: kept.length }
    if (event.key in moves) setActive(Math.max(0, Math.min(kept.length, moves[event.key]!)))
    else if (event.key === 'Enter') choose(index)
    else if (event.key === 'Escape') onBack()
    else return
    // The editor around the list has its own Enter and Escape.
    event.preventDefault()
    event.stopPropagation()
  }

  const row = (at: number, title: string, meta: string) => (
    <div
      key={at === 0 ? 'current' : kept[at - 1]!.id}
      id={rowId(at)}
      role="option"
      aria-selected={at === index}
      onClick={() => {
        setActive(at)
        choose(at)
      }}
      className={cn(
        'cursor-default rounded-xl px-3 py-2 transition-colors duration-[140ms] ease-[ease] hover:bg-surface-2/60',
        at === index && 'bg-surface-2/60 group-focus-visible:bg-surface-2 group-focus-visible:shadow-[inset_0_0_0_1.5px_var(--color-ring)]',
      )}
    >
      <div className={cn('truncate text-[13px]', at === 0 ? 'font-heading font-medium' : 'text-foreground')}>{title}</div>
      <div className="truncate text-[12px] text-muted-foreground">{meta}</div>
    </div>
  )

  return (
    <nav aria-label="Drafts" className="flex min-h-0 flex-1 flex-col">
      <h3 className="eyebrow px-4 pt-4 pb-2">Drafts</h3>
      <div
        role="listbox"
        tabIndex={0}
        aria-label="Drafts"
        aria-activedescendant={rowId(index)}
        onKeyDown={onKeyDown}
        className="group scroll-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-3 outline-none"
      >
        {row(0, firstLine(current.text) || 'New message', ['writing now', current.images ? images(current.images) : ''].filter(Boolean).join(' · '))}
        {kept.map((draft, at) =>
          row(at + 1, firstLine(draft.text) || 'Images only', [draftAge(draft.at, now), draft.attachments.length ? images(draft.attachments.length) : ''].filter(Boolean).join(' · ')),
        )}
        {kept.length === 0 ? <p className="px-3 pt-2 text-[12px] leading-relaxed text-muted-foreground">Escape keeps a draft here, so an unfinished one never stands in the way.</p> : null}
      </div>
    </nav>
  )
}
