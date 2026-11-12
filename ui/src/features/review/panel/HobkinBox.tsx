import { ArrowUp, CircleHelp, RotateCcw } from 'lucide-react'
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ForwardedRef } from 'react'
import type { Review } from '#shared/review/types.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Markdown } from '@/features/chat/markdown.ts'
import { useHost } from '@/lib/host/index.ts'
import { replyText } from '@/lib/host/live.ts'
import { cn } from '@/lib/utils.ts'
import { discussionMessage, type Note } from '../notes/notes.ts'
import { reviewMemory, useReviewMemory, useSession, useSessionStore } from '../state/context.tsx'
import { askHobkin, type AskCommand } from './ask.ts'
import { answersReview, conversationOf, joinThread, reviewThread, waitingAsks, type ConversationLine } from './thread.ts'

/**
 * Where the reviewer talks to hobkin about the review, on a darker band of the panel. A message goes into hobkin's
 * main conversation with the review, the step and the node the reviewer is on, so hobkin knows what "this" is and can
 * walk the review itself. Under the box is the conversation about this review: what was asked, newest first, each with
 * hobkin's replies under it, a reply as it is written, and a message the moment it is sent. The review keeps a copy, so
 * the conversation is there again when the review opens again.
 */
export const HobkinBox = forwardRef(function HobkinBox(
  { review, ask, notes }: { review: Review; ask: AskCommand | null; notes: readonly Note[] },
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const store = useSessionStore()
  const asks = useSession((session) => session.asks)
  const [text, setText] = useState('')
  const own = useRef<HTMLTextAreaElement | null>(null)
  const busy = useHost((state) => state.snapshot.busy === true)
  const messages = useHost((state) => state.messages)
  const live = useHost((state) => state.live)
  const kept = useReviewMemory((memory) => memory.threadOf(review))
  const title = review.change.title
  const questions = notes.filter((note) => note.intent === 'question' && note.author === 'user' && note.sent == null)

  const shown = useMemo(() => reviewThread(messages, title), [messages, title])
  const thread = useMemo(() => joinThread(kept, shown), [kept, shown])
  const answering = useMemo(() => answersReview(messages, title), [messages, title])
  // The reply being written belongs here when it answers the newest message, and that message is about this review.
  const writing = answering && live ? live.replies.map(replyText).filter((words) => words.trim()).join('\n\n') : null
  const exchanges = useMemo(() => conversationOf({ thread, asks, writing, busy: busy && answering }), [answering, asks, busy, thread, writing])

  // The review keeps what the conversation shows, so it outlives the chat moving on.
  useEffect(() => {
    if (shown.length > 0) reviewMemory.getState().keepThread(review, shown)
  }, [review, shown])
  // A message the conversation now shows needs no place of its own.
  useEffect(() => {
    const { settled } = waitingAsks(asks, thread)
    if (settled.length > 0) store.getState().dropAsks(settled)
  }, [asks, store, thread])

  // The field grows with its words, up to a point.
  useLayoutEffect(() => {
    const element = own.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(160, element.scrollHeight)}px`
  }, [text])

  const send = (words: string) => {
    if (!ask || !words.trim()) return
    // It shows in the conversation at once, so the box is free for the next one.
    setText('')
    void askHobkin(store, ask, words)
  }
  const askQuestions = async () => {
    const message = discussionMessage(review, questions)
    if (!ask || !message) return
    if (await askHobkin(store, ask, message)) reviewMemory.getState().markSent(review, questions.map((note) => note.id), Date.now())
  }
  const again = (line: ConversationLine) => {
    store.getState().dropAsks([line.key])
    if (ask) void askHobkin(store, ask, line.text)
  }

  return (
    <section aria-label="Ask Hobkin" className="rv-ask flex flex-col gap-3 px-4 pt-4 pb-5">
      <div className="flex items-center gap-2">
        <Hob mood={busy && answering ? 'searching' : 'hello'} size={24} stage="var(--rv-ask)" still />
        <h3 className="min-w-0 flex-1 font-heading text-[14.5px] font-semibold">Ask Hobkin</h3>
        <Kbd>H</Kbd>
      </div>
      {questions.length > 0 ? (
        <button
          type="button"
          data-stop
          disabled={!ask}
          onClick={() => void askQuestions()}
          className="flex items-center gap-1.5 self-start rounded-full bg-sun/20 px-2.5 py-1 font-heading text-[13px] font-medium text-sun-fg disabled:opacity-50 [&_svg]:size-3.5"
        >
          <CircleHelp aria-hidden="true" />
          Ask your {questions.length === 1 ? 'open question' : `${questions.length} open questions`}
        </button>
      ) : null}
      <div className={cn('rv-ask-field flex items-end gap-2 rounded-xl p-2', !ask && 'opacity-60')}>
        <textarea
          ref={(element) => {
            own.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          value={text}
          rows={1}
          disabled={!ask}
          aria-label="Ask hobkin about this review"
          placeholder={ask ? 'Ask about this step, or say what to change' : 'Sample review: Hobkin is not connected here'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // The words belong to the field: no key typed here walks the graph.
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send(text)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
            }
          }}
          className="rv-scroll min-h-[22px] flex-1 resize-none bg-transparent px-1 text-[14px] leading-[1.5] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          data-stop
          aria-label="Send to hobkin"
          disabled={!ask || !text.trim()}
          onClick={() => send(text)}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-[140ms] active:scale-[0.94] disabled:opacity-30 [&_svg]:size-4"
        >
          <ArrowUp />
        </button>
      </div>
      {exchanges.length === 0 ? (
        <p className="text-[13px] leading-snug text-pretty text-muted-foreground">Ask what a line does or why it is safe, or say what to change. Hobkin sees the step and the node you are on, can move your view, and answers here.</p>
      ) : (
        <ol aria-label="Your conversation with Hobkin about this review" className="flex flex-col gap-4">
          {exchanges.map((exchange, index) => (
            <li key={exchange.key} className="flex flex-col gap-2">
              {exchange.lines.map((line) =>
                line.who === 'you'
                  ? <Asked key={line.key} line={line} again={() => again(line)} />
                  : <Reply key={line.key} line={line} whole={index === 0} />,
              )}
              {exchange.waiting ? (
                <p role="status" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <span className="rv-ask-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Hobkin is answering
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
})

const SENT: Record<NonNullable<ConversationLine['state']>, string> = { sending: 'Sending…', queued: 'Hobkin reads it after what it is doing now.', failed: 'Not sent.', writing: '' }

/** What the reviewer asked, as they wrote it, and where it stands while it is on its way. */
function Asked({ line, again }: { line: ConversationLine; again: () => void }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="rv-ask-you max-w-[92%] rounded-2xl rounded-br-md px-3 py-2 text-[14px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{line.text}</p>
      {line.state && line.state !== 'writing' ? (
        <p className={cn('flex items-center gap-1.5 text-[12.5px]', line.state === 'failed' ? 'text-bad-fg' : 'text-muted-foreground')}>
          {line.state === 'failed' ? `${SENT.failed} ${line.error ?? ''}` : SENT[line.state]}
          {line.state === 'failed' ? (
            <button type="button" data-stop onClick={again} className="flex items-center gap-1 font-heading font-semibold text-foreground underline-offset-2 hover:underline [&_svg]:size-3">
              <RotateCcw aria-hidden="true" />
              Send again
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

/** A reply longer than this folds, unless it is the newest. */
const LONG_REPLY = { characters: 420, lines: 8 } as const

/** A reply of hobkin's. The newest is shown whole; older ones fold, and open on a click. */
function Reply({ line, whole }: { line: ConversationLine; whole: boolean }) {
  const [open, setOpen] = useState(false)
  const long = line.text.length > LONG_REPLY.characters || line.text.split('\n').length > LONG_REPLY.lines
  const folded = long && !whole && !open
  return (
    <div className="flex flex-col gap-1">
      <span className="font-heading text-[12px] font-semibold text-muted-foreground">{line.state === 'writing' ? 'Hobkin, writing' : 'Hobkin'}</span>
      <div className={cn('text-[14px] leading-[1.5] [overflow-wrap:anywhere]', folded && 'rv-ask-folded')}>
        <Markdown text={line.text} />
      </div>
      {long && !whole ? (
        <button type="button" data-stop onClick={() => setOpen((before) => !before)} className="self-start font-heading text-[12.5px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {open ? 'Show less' : 'Show all of it'}
        </button>
      ) : null}
    </div>
  )
}
