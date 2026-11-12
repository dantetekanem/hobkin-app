import { CircleHelp, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { Review } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import { targetLabel, type Note, type NoteIntent } from '../notes/notes.ts'
import { reviewMemory, useReviewMemory, useSessionStore } from '../state/context.tsx'

/** How many comments and questions a step has, beside its title. */
export function NoteMarks({ comments, questions }: { comments: number; questions: number }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-1.5 font-heading text-[12px] font-semibold text-muted-foreground tabular-nums">
      {comments > 0 ? (
        <span className="flex items-center gap-0.5" aria-label={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}>
          <MessageSquare className="size-3" aria-hidden="true" />
          {comments}
        </span>
      ) : null}
      {questions > 0 ? (
        <span className="flex items-center gap-0.5 text-sun-fg" aria-label={`${questions} ${questions === 1 ? 'question' : 'questions'}`}>
          <CircleHelp className="size-3" aria-hidden="true" />
          {questions}
        </span>
      ) : null}
    </span>
  )
}

export function NoteButton({ intent, keys, onClick }: { intent: NoteIntent; keys: string; onClick: () => void }) {
  const Icon = intent === 'question' ? CircleHelp : MessageSquare
  return (
    <button
      type="button"
      data-stop
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-full bg-background px-3 font-heading text-[13px] font-medium transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-3.5"
    >
      <Icon aria-hidden="true" />
      {intent === 'question' ? 'Question' : 'Comment'}
      <Kbd>{keys}</Kbd>
    </button>
  )
}

/** One note in the track: who wrote it, what it is about, and its words. Choosing it goes to what it is about. */
export function NoteRow({ note, review }: { note: Note; review: Review }) {
  const store = useSessionStore()
  const Icon = note.intent === 'question' ? CircleHelp : MessageSquare
  const stepIndex = review.story.findIndex((step) => step.id === note.step)
  const about = note.target.kind === 'step' ? null : targetLabel(review, note.target)
  const by = note.author === 'hobkin' ? 'Hobkin' : 'You'

  return (
    <li className="group flex items-start gap-2 rounded-lg bg-background px-2.5 py-2" data-author={note.author}>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', note.intent === 'question' ? 'text-sun-fg' : note.author === 'hobkin' ? 'text-primary' : 'text-muted-foreground')} aria-label={note.intent === 'question' ? 'Question' : 'Comment'} />
      <button type="button" data-stop title={about ? `Go to ${about}` : undefined} onClick={() => store.getState().showNote(note.id)} className="min-w-0 flex-1 rounded-md text-left">
        <span className="block font-heading text-[12px] font-semibold [overflow-wrap:anywhere] text-muted-foreground group-hover:underline underline-offset-2">
          {by} · step {stepIndex + 1}
          {about ? ` · on ${about}` : ''}
        </span>
        <span className="block text-[14px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{note.text}</span>
        {note.sent ? <span className="mt-0.5 block text-[12px] text-muted-foreground">{note.intent === 'question' ? 'Asked' : 'Sent'}</span> : null}
      </button>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[140ms] group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          data-stop
          aria-label="Change this note"
          title="Change this note"
          onClick={() => store.getState().editNote(note.id)}
          // With the keyboard on a note, Backspace removes it, as it removes anything.
          onKeyDown={(event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return
            reviewMemory.getState().removeNote(review, note.id)
            event.preventDefault()
          }}
          className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary [&_svg]:size-3"
        >
          <Pencil />
        </button>
        <button type="button" aria-label="Remove this note" title="Remove this note" onClick={() => reviewMemory.getState().removeNote(review, note.id)} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary [&_svg]:size-3">
          <Trash2 />
        </button>
      </div>
    </li>
  )
}

/**
 * Where a note is written. Enter keeps it, Shift with Enter starts a new line, and Escape leaves
 * without losing what was written: the words wait as a draft.
 */
export function NoteEditor({ review, target }: { review: Review; target: string }) {
  const store = useSessionStore()
  const draft = useReviewMemory((memory) => memory.of(review).draft)
  const field = useRef<HTMLTextAreaElement>(null)
  const intent = draft?.intent ?? 'comment'
  const set = (change: { text?: string; intent?: NoteIntent }) => {
    reviewMemory.getState().setDraft(review, {
      intent,
      text: draft?.text ?? '',
      ...(draft?.editing ? { editing: draft.editing } : {}),
      ...change,
    })
  }

  // The keyboard goes to the words at once, with the caret after what is already there.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
    element.scrollIntoView({ block: 'nearest' })
  }, [])
  // The field grows with its words, up to a point.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(220, element.scrollHeight)}px`
  }, [draft?.text])

  const leave = (save: boolean) => {
    if (save) store.getState().saveNote()
    else store.getState().closeEditor()
    // The keyboard goes back to the graph, where it was.
    field.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-background p-2.5 ring-1 ring-border-strong/50">
      <div className="flex items-center gap-1.5">
        {(['comment', 'question'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={intent === kind}
            onClick={() => {
              set({ intent: kind })
              field.current?.focus()
            }}
            className={cn('rounded-full px-2.5 py-0.5 font-heading text-[12.5px] font-semibold', intent === kind ? 'bg-secondary' : 'text-muted-foreground')}
          >
            {kind === 'question' ? 'Question' : 'Comment'}
          </button>
        ))}
        <span className="min-w-0 flex-1 truncate text-right text-[12.5px] text-muted-foreground">on {target}</span>
      </div>
      <textarea
        ref={field}
        value={draft?.text ?? ''}
        rows={2}
        aria-label={intent === 'question' ? `A question on ${target}` : `A comment on ${target}`}
        placeholder={intent === 'question' ? 'What do you want to ask?' : 'What should change, or be remembered?'}
        onChange={(event) => set({ text: event.target.value })}
        onKeyDown={(event) => {
          // The words belong to the field: no key typed here walks the story.
          event.stopPropagation()
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            leave(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            leave(false)
          }
        }}
        className="rv-scroll w-full resize-none bg-transparent text-[14px] leading-[1.5] outline-none placeholder:text-muted-foreground"
      />
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> keep
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⇧↵</Kbd> new line
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> leave, the words stay
        </span>
      </p>
    </div>
  )
}
