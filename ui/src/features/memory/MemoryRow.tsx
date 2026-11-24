import { Ellipsis, Lock } from 'lucide-react'
import { Fragment, memo, useEffect, useRef, type ReactNode } from 'react'
import type { MemoryEntry } from '#shared/protocol/memory.ts'
import { Button } from '@/components/ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx'
import { cn } from '@/lib/utils.ts'
import { fromWords, linksIn, nameWords, textParts, untilWords, type WordsAt } from './groups.ts'
import { LinkPress } from './LinkPress.tsx'
import { MemoryEditor } from './MemoryEditor.tsx'
import { draftOf, type Forgotten, type MemoryDraft } from './store.ts'
import { memoryActions, memoryStore, useMemory } from './use-memories.ts'

const sameDraft = (a: MemoryDraft, b: MemoryDraft) => a.description === b.description && a.kind === b.kind && a.until === b.until && a.private === b.private && a.text === b.text

const goToMemory = (name: string) => memoryStore.seekMemory(name)

/** The text with each `[[name]]` as a press that goes to that memory. */
function TextWithLinks({ text }: { text: string }) {
  return (
    <>
      {textParts(text).map((part, index) =>
        'link' in part ? (
          <LinkPress key={index} onPress={() => goToMemory(part.link)} label={`Go to the memory ${nameWords(part.link)}`}>
            {nameWords(part.link)}
          </LinkPress>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

type RowMode = 'shown' | 'editing' | 'forgotten'

/** Where the keyboard lands in a row as it turns into each of its modes. */
const FOCUS_IN: Record<RowMode, string> = {
  shown: '[data-row-edit]',
  editing: '[data-first-field]',
  forgotten: '[data-row-undo]',
}

export interface MemoryRowProps {
  memory: MemoryEntry
  /** Forgotten on this page: the row is one line with Undo. */
  forgotten?: Forgotten
  /** Its day has passed. */
  past: boolean
  at: WordsAt
}

/**
 * One memory: its description, the text under it, where it came from and when, its links, Edit, and a small menu with
 * Forget, Make private or Share with every agent, and Copy name. Editing happens in the row, which keeps its place in
 * the list until Save. Forgotten, it is one line with Undo, in the same place. It draws again only when its own memory,
 * draft, refusal or command changes, so a key typed in one row draws no other.
 */
export const MemoryRow = memo(function MemoryRow({ memory, forgotten, past, at }: MemoryRowProps) {
  const { name } = memory
  const draft = useMemory((state) => state.drafts[name])
  const busy = useMemory((state) => state.busy[name] === true)
  const refused = useMemory((state) => state.refused[name] ?? null)
  const saved = useMemory((state) => state.saved[name] !== undefined)
  const root = useRef<HTMLElement | null>(null)
  const mode: RowMode = forgotten ? 'forgotten' : draft ? 'editing' : 'shown'
  const shownMode = useRef(mode)

  // The keyboard follows the row as it changes: into the editor, back to Edit, onto Undo.
  useEffect(() => {
    if (shownMode.current === mode) return
    shownMode.current = mode

    const active = document.activeElement
    const keyboardWasHere = root.current?.contains(active) || active === document.body
    // Opening the editor always takes the keyboard. The other changes keep it only when it was in the row.
    if (mode !== 'editing' && !keyboardWasHere) return
    root.current?.querySelector<HTMLElement>(FOCUS_IN[mode])?.focus({ preventScroll: true })
  }, [mode])

  const description = memory.description || name

  if (forgotten) {
    return (
      <article ref={root} data-memory={name} tabIndex={-1} aria-label={`Forgot ${description}`} className="flex min-h-12 items-center gap-3 rounded-[22px] border border-dashed border-border-strong/40 px-4 py-2 outline-offset-2 focus:outline-2 focus:outline-ring">
        <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          Forgot <span className="text-foreground">“{description}”</span>
        </p>
        {forgotten.refused ? <p className="max-w-[45%] shrink truncate text-[12.5px] text-bad-fg" title={forgotten.refused}>{forgotten.refused}</p> : null}
        <Button variant="outline" size="sm" data-key-stop="" data-row-undo="" disabled={busy} onClick={() => void memoryActions.undoForget(name)}>
          Undo
        </Button>
      </article>
    )
  }

  if (draft) {
    return (
      <article ref={root} data-memory={name} aria-label={`Editing ${description}`} className="rounded-[22px] bg-background p-4 ring-1 ring-border-strong/50">
        <MemoryEditor
          label={description}
          draft={draft}
          dirty={!sameDraft(draft, draftOf(memory))}
          busy={busy}
          refused={refused}
          onChange={(patch) => memoryStore.change(name, patch)}
          onSave={() => void memoryActions.save(name)}
          onCancel={() => memoryStore.cancel(name)}
        />
      </article>
    )
  }

  const from = fromWords(memory, at)
  const until = memory.until ? untilWords(memory.until, at.now) : null
  // The links its text already shows in place are not listed again under it.
  const linkedInText = new Set(memory.text ? linksIn(memory.text) : [])
  const moreLinks = (memory.links ?? []).filter((link) => !linkedInText.has(link))
  const said = memory.source?.said

  return (
    <article ref={root} data-memory={name} tabIndex={-1} aria-label={description} className="flex flex-col gap-2 rounded-[22px] bg-background p-4 outline-offset-2 focus:outline-2 focus:outline-ring">
      <header className="flex items-start gap-3">
        <h4 className={cn('min-w-0 flex-1 pt-1 text-[15px] leading-snug font-semibold tracking-[-0.01em] text-pretty break-words', past && 'text-muted-foreground')}>{description}</h4>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" data-key-stop="" data-row-edit="" disabled={busy} onClick={() => memoryStore.edit(name)} aria-label={`Edit ${description}`}>
            Edit
          </Button>
          <RowMenu name={name} description={description} isPrivate={memory.private === true} busy={busy} />
        </div>
      </header>
      {memory.text ? (
        <p className="text-[13.5px] leading-relaxed whitespace-pre-line break-words text-muted-foreground">
          <TextWithLinks text={memory.text} />
        </p>
      ) : null}
      {said ? (
        <p className="text-[12.5px] leading-snug break-words text-muted-foreground">
          You said: <q className="text-foreground/80">{said}</q>
        </p>
      ) : null}
      {moreLinks.length > 0 ? (
        <p className="flex flex-wrap gap-x-2 text-[12.5px] text-muted-foreground">
          Linked:
          {moreLinks.map((link) => (
            <LinkPress key={link} onPress={() => goToMemory(link)} label={`Go to the memory ${nameWords(link)}`}>
              {nameWords(link)}
            </LinkPress>
          ))}
        </p>
      ) : null}
      <MetaLine
        parts={[
          from,
          until ? (past ? `${until}, now past` : until) : null,
          memory.private ? (
            <span className="inline-flex items-baseline gap-1">
              <Lock aria-hidden="true" className="size-3 translate-y-[1px] self-center" />
              Private
            </span>
          ) : null,
          saved ? (
            <LinkPress onPress={() => void memoryActions.undoSave(name)} label={`Undo your change to ${description}`}>
              Undo your change
            </LinkPress>
          ) : null,
        ]}
      />
      {refused ? (
        <p role="alert" className="text-[12.5px] leading-snug break-words text-bad-fg">
          {refused}
        </p>
      ) : null}
    </article>
  )
})

/** Where a memory came from, the day it holds until, private, and Undo after a save, one after another with a dot between. */
function MetaLine({ parts }: { parts: readonly ReactNode[] }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== '')
  if (shown.length === 0) return null
  return (
    <p className="text-[12px] leading-relaxed text-muted-foreground">
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

/** Forget, Make private or Share with every agent, and Copy name: a popover, the one thing that may cover the list. */
function RowMenu({ name, description, isPrivate, busy }: { name: string; description: string; isPrivate: boolean; busy: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" data-key-stop="" disabled={busy} aria-label={`More for ${description}`} />}>
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-52">
        <DropdownMenuItem onClick={() => void memoryActions.setPrivate(name, !isPrivate)}>{isPrivate ? 'Share with every agent' : 'Make private'}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(name)}>Copy name</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void memoryActions.forget(name)}>
          Forget
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
