import { ArrowUp, CircleHelp } from 'lucide-react'
import { forwardRef, useLayoutEffect, useRef, useState, type ForwardedRef } from 'react'
import type { Review, StoryStep } from '#shared/review/types.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { discussionMessage, type Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'

/**
 * The quick way to talk to hobkin about the review. It is hobkin's main conversation: a message goes there with the
 * review, the step and the node the reviewer is on, so hobkin knows what "this" is and can walk the review itself.
 * It sits on a surface of its own, apart from the panel and from the yellow of the actions, and says what to type.
 */
export const HobkinBox = forwardRef(function HobkinBox(
  { review, live, step, node, notes }: { review: Review; live: boolean; step: StoryStep | undefined; node: string | undefined; notes: readonly Note[] },
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const busy = useHost((state) => state.snapshot.busy === true)
  const own = useRef<HTMLTextAreaElement | null>(null)
  const questions = notes.filter((note) => note.intent === 'question' && note.author === 'user' && note.sent == null)

  // The field grows with its words, up to a point.
  useLayoutEffect(() => {
    const element = own.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(160, element.scrollHeight)}px`
  }, [text])

  const send = async (words: string, then?: () => void) => {
    if (!live || sending || !words.trim()) return
    setSending(true)
    setProblem(null)
    try {
      await runCommand('conversation.send', { text: words, review: { id: review.id, ...(step ? { step: step.id } : {}), ...(node ? { node } : {}) } })
      then?.()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  const askQuestions = () => {
    const message = discussionMessage(review, questions)
    if (message) void send(message, () => reviewMemory.getState().markSent(review, questions.map((note) => note.id), Date.now()))
  }

  return (
    <section aria-label="Ask Hobkin" className="flex flex-col gap-2 rounded-2xl bg-[var(--rv-ask)] p-3 ring-1 ring-[var(--rv-ask-edge)]">
      <div className="flex items-center gap-2">
        <Hob mood={busy ? 'searching' : 'hello'} size={24} stage="var(--rv-ask)" still />
        <h3 className="min-w-0 flex-1 font-heading text-[14.5px] font-semibold">Ask Hobkin</h3>
        <Kbd>H</Kbd>
      </div>
      {questions.length > 0 ? (
        <button
          type="button"
          data-stop
          disabled={!live || sending}
          onClick={askQuestions}
          className="flex items-center gap-1.5 self-start rounded-full bg-sun/20 px-2.5 py-1 font-heading text-[13px] font-medium text-sun-fg disabled:opacity-50 [&_svg]:size-3.5"
        >
          <CircleHelp aria-hidden="true" />
          Ask your {questions.length === 1 ? 'open question' : `${questions.length} open questions`}
        </button>
      ) : null}
      <div className={cn('flex items-end gap-2 rounded-xl bg-[var(--hb-surface)] p-2 ring-1 ring-[var(--rv-ask-edge)] focus-within:ring-2 focus-within:ring-primary/70', !live && 'opacity-60')}>
        <textarea
          ref={(element) => {
            own.current = element
            if (typeof ref === 'function') ref(element)
            else if (ref) ref.current = element
          }}
          value={text}
          rows={1}
          disabled={!live}
          aria-label="Ask hobkin about this review"
          placeholder={live ? 'Ask about this step, or say what to change' : 'Sample review: Hobkin is not connected here'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // The words belong to the field: no key typed here walks the story.
            event.stopPropagation()
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void send(text, () => setText(''))
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
          disabled={!live || sending || !text.trim()}
          onClick={() => void send(text, () => setText(''))}
          className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-[140ms] active:scale-[0.94] disabled:opacity-30 [&_svg]:size-4"
        >
          <ArrowUp />
        </button>
      </div>
      <p className="text-[13px] leading-snug text-pretty text-muted-foreground">Ask what a line does or why it is safe, or say what to change. Hobkin sees this step and can move your view.</p>
      {problem || busy ? (
        <p role="status" className={cn('text-[13px] leading-snug', problem ? 'text-bad-fg' : 'text-muted-foreground')}>
          {problem ?? 'Hobkin is answering…'}
        </p>
      ) : null}
    </section>
  )
})
