import { ArrowUp, CircleHelp } from 'lucide-react'
import { forwardRef, useLayoutEffect, useRef, useState, type ForwardedRef } from 'react'
import type { Review, StoryStep } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { discussionMessage, type Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'

/**
 * The quick way to talk to hobkin about the review. It is hobkin's main conversation: a message goes there with the
 * review, the step and the node the reviewer is on, so hobkin knows what "this" is and can walk the review itself.
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
    <div className="flex flex-col gap-1.5">
      {questions.length > 0 ? (
        <button
          type="button"
          data-stop
          disabled={!live || sending}
          onClick={askQuestions}
          className="flex items-center gap-1.5 self-start rounded-full bg-sun/15 px-2.5 py-1 font-heading text-[12px] font-medium text-sun-fg disabled:opacity-50 [&_svg]:size-3.5"
        >
          <CircleHelp aria-hidden="true" />
          Ask your {questions.length === 1 ? 'open question' : `${questions.length} open questions`}
        </button>
      ) : null}
      <div className={cn('flex items-end gap-2 rounded-2xl bg-background p-2 ring-1 ring-border-strong/50 focus-within:ring-primary/60', !live && 'opacity-60')}>
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
          placeholder={live ? 'Ask Hobkin about this step' : 'Sample review: Hobkin is not connected here'}
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
          className="rv-scroll min-h-[22px] flex-1 resize-none bg-transparent px-1 text-[13.5px] leading-[1.5] outline-none placeholder:text-muted-foreground"
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
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
        {problem ?? (busy ? 'Hobkin is answering…' : (
          <>
            <Kbd>H</Kbd> to write here · Hobkin sees this step and can move your view
          </>
        ))}
      </p>
    </div>
  )
})
