import { ArrowUp, CircleHelp, MessageSquare, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { inputKey } from '../keys.ts'
import { targetLabel, type Note, type NoteIntent } from '../notes/notes.ts'
import { reviewMemory, useReviewMemory, useSession, useSessionStore } from '../state/context.tsx'
import type { SessionStore } from '../state/session.ts'
import { submitNote, type AskCommand, type PendingAsk } from './ask.ts'
import { askExample, noteShown } from './sidebar.ts'
import { useAskHobkin } from './use-ask.ts'

/** How many comments and questions a step has, beside its title. */
export function NoteMarks({ comments, questions }: { comments: number; questions: number }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-1.5 font-heading text-[12.5px] font-semibold text-muted-foreground tabular-nums">
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

/**
 * Opens a note where it was written, for a quick read on the canvas (the user, 2026-11-12: "comments should open a
 * panel near the node for quick read"): the notes beside the node it is about, or the node of its lines, else those
 * taken on its step (`session.showNotes`). A node out of focus comes into focus first, so its notes open in sight.
 */
function openNearItsNode(store: SessionStore, note: Note): void {
  const state = store.getState()
  const place = noteShown(state.view.nodes, note, state.view.story)
  if (!place) {
    state.showNote(note.id)
    return
  }
  if ('node' in place && !state.focus.includes(place.node)) state.focusOn(place.node)
  store.getState().showNotes(place)
}

/** One note in the track: who wrote it, its step, what it is about, and its words. Choosing it opens it on the canvas. */
export function NoteRow({ note, review }: { note: Note; review: Review }) {
  const store = useSessionStore()
  const Icon = note.intent === 'question' ? CircleHelp : MessageSquare
  // Numbered by the story on screen, which can fold steps together.
  const stepIndex = useSession((session) => session.view.story.findIndex((step) => step.id === note.step))
  const about = note.target.kind === 'step' ? null : targetLabel(review, note.target)
  const by = note.author === 'hobkin' ? 'Hobkin' : 'You'

  return (
    <li className="group flex items-start gap-2 rounded-lg bg-background px-2.5 py-2" data-author={note.author}>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', note.intent === 'question' ? 'text-sun-fg' : note.author === 'hobkin' ? 'text-primary' : 'text-muted-foreground')} aria-label={note.intent === 'question' ? 'Question' : 'Comment'} />
      <button type="button" data-stop title={about ? `Read it beside ${about}` : 'Read it on its step'} onClick={() => openNearItsNode(store, note)} className="min-w-0 flex-1 rounded-md text-left">
        <span className="block font-heading text-[12.5px] font-semibold [overflow-wrap:anywhere] text-muted-foreground group-hover:underline underline-offset-2">
          {by}
          {stepIndex >= 0 ? ` · step ${stepIndex + 1}` : ''}
          {about ? ` · on ${about}` : ''}
        </span>
        <span className="block text-[14px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{note.text}</span>
        {note.sent ? <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{note.intent === 'question' ? 'Asked' : 'Sent'}</span> : null}
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

const SAYS: Partial<Record<PendingAsk['state'], string>> = { sending: 'Sending to hobkin…', queued: 'Hobkin reads it after what it is doing now.' }

/** What a note in the input is: a comment (C), a question to discuss with the agent (D), or a question for hobkin now (H). */
type NoteMode = 'comment' | 'discuss' | 'ask'
const MODES: { mode: NoteMode; label: string }[] = [
  { mode: 'comment', label: 'Comment' },
  { mode: 'discuss', label: 'Discuss' },
  { mode: 'ask', label: 'Ask hobkin' },
]
const intentOf = (mode: NoteMode): NoteIntent => (mode === 'comment' ? 'comment' : 'question')
/** How the field names itself to a screen reader, before what the note is on. */
const FIELD_WORDS: Record<NoteMode, string> = { comment: 'A comment on', discuss: 'A question to discuss with the agent about', ask: 'Ask hobkin about' }
/** The tallest the review's input grows with its words, as the chat's does, in pixels. */
const INPUT_HEIGHT = 200

/**
 * The review's input, at the bottom of the canvas under the step pager, there for as long as the review is open: where
 * a comment is written on what the reviewer is on, a question to discuss with the agent, or a question for hobkin. N or
 * C starts a comment, D a question to discuss, H a question for hobkin, a note's pencil in the panel opens it here to
 * change, and a click starts what was chosen last.
 *
 * Enter keeps a comment or a question to discuss, for "Talk to agent", and the keyboard goes back to the review. Enter
 * sends a question for hobkin to hobkin: hobkin's own chat comes into view beside the review to answer it, the keyboard
 * stays here for the next one, and it never goes to the chat's input. Shift with Enter starts a new line. Escape gives the keyboard back to the review with
 * the words kept as a draft, and goes no further, so it never reaches the chat, where it would stop hobkin. A click
 * here leaves the chat where it is, so an answer being read stays in view.
 */
export function NoteInput({ ask, units }: { ask: AskCommand | null; units?: readonly Unit[] | undefined }) {
  const store = useSessionStore()
  const review = useSession((session) => session.review)
  const editor = useSession((session) => session.editor)
  const step = useSession((session) => session.view.story[session.story.step])
  const nodes = useSession((session) => session.view.nodes)
  // The node the reviewer is on, for the example of what to ask.
  const on = useSession((session) => {
    const id = session.pointed ?? session.focus[0]
    return id ? session.nodeOf.get(id) : undefined
  })
  const newest = useSession((session) => session.asks.at(-1))
  const busy = useHost((state) => state.snapshot.busy === true)
  const draft = useReviewMemory((memory) => memory.of(review).draft)
  const send = useAskHobkin(ask)
  const field = useRef<HTMLTextAreaElement>(null)
  // The choice holds from one note to the next.
  const [chosen, setChosen] = useState<NoteMode>(draft?.intent === 'question' ? 'discuss' : 'comment')
  const drafted = draft != null
  const mode: NoteMode = draft ? (draft.intent === 'comment' ? 'comment' : editor?.ask ? 'ask' : 'discuss') : chosen
  const intent = intentOf(mode)
  useEffect(() => {
    if (drafted) setChosen(mode)
  }, [drafted, mode])

  const target = editor ? targetLabel(review, editor.target) : null
  const text = draft?.text ?? ''
  const asking = mode === 'ask'
  const said = newest?.state === 'failed' ? `Not sent. ${newest.error ?? ''}` : newest && (newest.state !== 'queued' || busy) ? SAYS[newest.state] : undefined

  const set = (change: { text?: string; intent?: NoteIntent }, asks = asking) => {
    // Words typed with no note open, as after a question went, are about what the reviewer is on now.
    if (!store.getState().editor) store.getState().startNote(change.intent ?? intent, { ask: asks })
    const now = reviewMemory.getState().of(review).draft
    reviewMemory.getState().setDraft(review, { intent: now?.intent ?? intent, text: now?.text ?? '', ...(now?.editing ? { editing: now.editing } : {}), ...change })
  }
  const choose = (kind: NoteMode) => {
    setChosen(kind)
    set({ intent: intentOf(kind) }, kind === 'ask')
    store.getState().setAsk(kind === 'ask')
    field.current?.focus({ preventScroll: true })
  }
  const backToReview = () => field.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  const submit = async () => {
    if ((await submitNote(store, reviewMemory, send)) === 'review') backToReview()
  }
  // A note started anywhere, by its key or from the panel, puts the keyboard here, the caret after what is there.
  useLayoutEffect(() => {
    const element = field.current
    if (!editor || !element || document.activeElement === element) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
  }, [editor])
  // The field is as tall as its words, up to a limit, as the chat's is, and one line when empty: a placeholder never
  // makes it taller. It is measured again when its width changes: the dock starts narrow, before the canvas is
  // measured, and the chat sliding in beside the review narrows it.
  const fit = () => {
    const element = field.current
    if (!element) return
    element.style.height = ''
    if (element.value) element.style.height = `${Math.min(element.scrollHeight, INPUT_HEIGHT)}px`
  }
  useLayoutEffect(fit, [text])
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    let width = element.offsetWidth
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return
      width = element.offsetWidth
      fit()
    })
    observer.observe(element)
    return () => observer.disconnect()
    // The observer is made once; `fit` reads the field each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="pointer-events-auto flex w-full max-w-[640px] flex-col gap-1"
      // A click here is not a click on the graph, which would slide the canvas back over the chat.
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        // Left with nothing written, the note closes, and the next one is about wherever the reviewer is then.
        if (event.currentTarget.contains(event.relatedTarget)) return
        if (store.getState().editor && !store.getState().editor?.editing && !reviewMemory.getState().of(review).draft?.text.trim()) store.getState().closeEditor()
      }}
    >
      {/* The chat's own field (Composer.tsx): one pill, one row, the choice at its left and the send at its right. */}
      <div className="rounded-[24px] border-[1.5px] border-input bg-card py-1.5 pr-1.5 pl-1.5 transition-colors duration-[160ms] ease-[ease] focus-within:border-ring">
        <div className="flex items-end gap-1">
          <div className="flex h-8 shrink-0 items-center">
            <div className="flex h-7 items-center rounded-full bg-surface-2 p-0.5" role="group" aria-label="What this note is">
              {MODES.map((choice) => (
                <button
                  key={choice.mode}
                  type="button"
                  aria-pressed={mode === choice.mode}
                  // The keyboard stays in the words.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(choice.mode)}
                  className={cn(
                    'h-6 rounded-full px-2.5 text-[13px] leading-none font-medium whitespace-nowrap transition-[background-color,color] duration-[140ms] ease-out',
                    mode === choice.mode ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={field}
            value={text}
            rows={1}
            aria-label={`${FIELD_WORDS[mode]} ${target ?? 'what you are on'}`}
            placeholder={
              mode === 'comment'
                ? 'What should change, or be remembered?'
                : mode === 'discuss'
                  ? 'What do you want to talk over with the agent?'
                  : send
                    ? `e.g. ${askExample(step, units, nodes, on)}`
                    : 'Hobkin is not connected to this sample review: the question is kept as a note'
            }
            onFocus={() => {
              if (!store.getState().editor) store.getState().startNote(intent, { ask: asking })
            }}
            onChange={(event) => set({ text: event.target.value })}
            onKeyDown={(event) => {
              // The words belong to the field: no key typed here walks the story, and none goes on to the chat.
              event.stopPropagation()
              const does = inputKey({ key: event.key, shift: event.shiftKey, composing: event.nativeEvent.isComposing })
              if (does === 'type') return
              event.preventDefault()
              if (does === 'send') void submit()
              else {
                store.getState().closeEditor()
                backToReview()
              }
            }}
            className="scroll-quiet min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent py-1 pl-1 text-left text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
            style={{ maxHeight: INPUT_HEIGHT }}
          />
          <button
            type="button"
            aria-label={asking && send ? 'Send to hobkin' : 'Keep this note'}
            title={asking && send ? 'Send to hobkin (Enter)' : 'Keep this note (Enter)'}
            disabled={!text.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void submit()}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-offset-2 transition-[transform,opacity] duration-[140ms] ease-out active:scale-[0.97] disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="flex h-5 items-center gap-x-2.5 overflow-hidden px-3 text-[12px] whitespace-nowrap text-muted-foreground">
        {target ? (
          <>
            <span className="min-w-0 truncate">on {target}</span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>↵</Kbd> {asking && send ? 'ask' : 'keep'}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>⇧↵</Kbd> new line
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>esc</Kbd> back to the review
            </span>
          </>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>C</Kbd> a comment
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>D</Kbd> discuss with the agent
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>H</Kbd> ask hobkin
            </span>
          </>
        )}
        <span className="flex-1" />
        {said ? (
          <span role={newest?.state === 'failed' ? 'alert' : 'status'} className={cn('flex min-w-0 items-center gap-1', newest?.state === 'failed' && 'text-bad-fg')}>
            {newest?.state === 'failed' ? <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            <span className="min-w-0 truncate">{said}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}
