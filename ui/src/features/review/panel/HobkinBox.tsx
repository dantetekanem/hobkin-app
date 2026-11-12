import { ArrowUp, CircleHelp, RotateCcw, TriangleAlert } from 'lucide-react'
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
import type { AskCommand } from './ask.ts'
import { atNewest, answersReview, conversationOf, joinThread, reviewThread, waitingAsks, type ConversationLine } from './thread.ts'
import { useAskHobkin } from './use-ask.ts'

/** The band keeps this height whatever the conversation holds: it scrolls inside, and nothing around it moves. */
const BAND_HEIGHT = 'clamp(320px, 46vh, 460px)'

/**
 * Where the reviewer talks to hobkin about the review: a band across the panel in its own color, a fixed height, with
 * the conversation about this review scrolling inside it and the field at its foot. A message goes into hobkin's
 * main conversation with the review, the step and the node the reviewer is on, so hobkin knows what "this" is and can
 * walk the review itself. The conversation reads as a chat, oldest first, and keeps to its newest reply unless the
 * reviewer scrolled up to read. A message shows the moment it is sent, a reply as it is written. The review keeps a
 * copy of both, so the conversation is there again when the review opens again. The field shows a concrete example
 * of what to ask (`example`).
 */
export const HobkinBox = forwardRef(function HobkinBox(
  { review, ask, notes, example = 'What does this step change, and how is it tested?' }: { review: Review; ask: AskCommand | null; notes: readonly Note[]; example?: string },
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const store = useSessionStore()
  const asks = useSession((session) => session.asks)
  const [text, setText] = useState('')
  const own = useRef<HTMLTextAreaElement | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Whether the conversation keeps to its newest message. It lets go when the reviewer scrolls up, and takes hold again at the foot.
  const pinned = useRef(true)
  const busy = useHost((state) => state.snapshot.busy === true)
  const messages = useHost((state) => state.messages)
  const live = useHost((state) => state.live)
  const kept = useReviewMemory((memory) => memory.threadOf(review))
  const send = useAskHobkin(ask)
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

  // A message just sent, from the field or a quick link anywhere in the review, brings the conversation to its foot.
  const sent = useRef(asks.length)
  useLayoutEffect(() => {
    if (asks.length > sent.current) pinned.current = true
    sent.current = asks.length
  }, [asks.length])
  // Kept to the newest message as messages come, a reply grows and the field takes more room, while it is pinned. It
  // opens at its foot.
  useLayoutEffect(() => {
    const element = scroller.current
    const inner = content.current
    if (!element || !inner) return
    const follow = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(inner)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (pinned.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [exchanges])

  // The field grows with its words, up to a point. The conversation gives it the room, so the band keeps its height.
  useLayoutEffect(() => {
    const element = own.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(132, Math.max(44, element.scrollHeight))}px`
  }, [text])

  const submit = (words: string) => {
    if (!send || !words.trim()) return
    // It shows in the conversation at once, so the field is free for the next one.
    setText('')
    pinned.current = true
    void send(words)
  }
  const askQuestions = async () => {
    const message = discussionMessage(review, questions)
    if (!send || !message) return
    if (await send(message)) reviewMemory.getState().markSent(review, questions.map((note) => note.id), Date.now())
  }
  const again = (line: ConversationLine) => {
    store.getState().dropAsks([line.key])
    if (send) void send(line.text)
  }

  return (
    <section aria-label="Ask hobkin" className="rv-ask flex shrink-0 flex-col" style={{ height: BAND_HEIGHT }}>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
        <Hob mood={busy && answering ? 'searching' : 'hello'} size={26} stage="var(--rv-ask)" still />
        <h3 className="min-w-0 flex-1 font-heading text-[15px] font-semibold">Ask hobkin</h3>
        {questions.length > 0 ? (
          <button
            type="button"
            data-stop
            disabled={!send}
            onClick={() => void askQuestions()}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[var(--rv-ask-you)] px-2.5 font-heading text-[13px] font-semibold transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] disabled:active:scale-100 [&_svg]:size-3.5"
          >
            <CircleHelp aria-hidden="true" />
            Ask your {questions.length === 1 ? 'question' : `${questions.length} questions`}
          </button>
        ) : null}
        <Kbd>H</Kbd>
      </div>

      <div
        ref={scroller}
        className="rv-scroll min-h-0 flex-1 overflow-y-auto px-4"
        aria-label="Your conversation with hobkin about this review"
        onScroll={(event) => {
          pinned.current = atNewest(event.currentTarget)
        }}
      >
        <div ref={content} className="flex min-h-full flex-col justify-end gap-4 pt-1 pb-3">
          {exchanges.length === 0 ? (
            <div className="flex flex-col gap-1.5 text-[14px] leading-[1.5] text-pretty text-muted-foreground">
              {ask ? (
                <p>Hobkin sees this step and the node you are on. Ask what a line does, why it is safe, or what to change, and it answers here.</p>
              ) : (
                <p>This is a sample review, so hobkin is not connected and nothing can be sent. In a review of your own, hobkin answers here.</p>
              )}
            </div>
          ) : (
            exchanges.map((exchange) => (
              <div key={exchange.key} className="flex flex-col gap-2">
                {exchange.lines.map((line) => (line.who === 'you' ? <Asked key={line.key} line={line} again={() => again(line)} /> : <Reply key={line.key} line={line} />))}
                {exchange.waiting ? (
                  <p role="status" className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
                    <span className="rv-ask-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    Hobkin is answering
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rv-ask-input flex shrink-0 items-end gap-2 py-2.5 pr-3 pl-4">
        <textarea
          ref={(element) => {
            own.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          value={text}
          rows={2}
          disabled={!send}
          aria-label="Ask hobkin about this review"
          placeholder={send ? `e.g. ${example}` : 'Hobkin is not connected to this sample review'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // The words belong to the field: no key typed here walks the graph.
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit(text)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
            }
          }}
          className="rv-scroll min-h-[44px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-[1.45] outline-none placeholder:text-muted-foreground disabled:cursor-default"
        />
        <button
          type="button"
          data-stop
          aria-label="Send to hobkin"
          title="Send to hobkin (Enter)"
          disabled={!send || !text.trim()}
          onClick={() => submit(text)}
          className="mb-1 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-[140ms] active:scale-[0.94] disabled:opacity-40 [&_svg]:size-4"
        >
          <ArrowUp />
        </button>
      </div>
    </section>
  )
})

const SENT: Record<NonNullable<ConversationLine['state']>, string> = { sending: 'Sending…', queued: 'Hobkin reads it after what it is doing now.', failed: 'Not sent.', writing: '' }

/** What the reviewer asked, as they wrote it, and where it stands while it is on its way. */
function Asked({ line, again }: { line: ConversationLine; again: () => void }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="rv-ask-you max-w-[90%] rounded-2xl rounded-br-md px-3 py-2 text-[14.5px] leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap">{line.text}</p>
      {line.state && line.state !== 'writing' ? (
        <p className={cn('flex flex-wrap items-center justify-end gap-x-1.5 text-right text-[13px] leading-snug', line.state === 'failed' ? 'rv-ask-bad' : 'text-muted-foreground')}>
          {line.state === 'failed' ? <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" /> : null}
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

/** A reply of hobkin's, whole, as it reads in the chat. */
function Reply({ line }: { line: ConversationLine }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-heading text-[12.5px] font-semibold text-muted-foreground">{line.state === 'writing' ? 'Hobkin, writing' : 'Hobkin'}</span>
      <div className="text-[14.5px] leading-[1.55] [overflow-wrap:anywhere]">
        <Markdown text={line.text} />
      </div>
    </div>
  )
}
