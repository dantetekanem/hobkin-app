import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import type { HistoryConversation } from '#shared/commands/registry.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { clockTime, dayLabel } from '@/features/reports/time.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { MessageText } from './markdown.ts'

export interface HistoryViewProps {
  title: string
  when: string
  /** Null while it is being read. */
  conversation: Pick<HistoryConversation, 'messages' | 'earlier' | 'cut'> | null
  /** Why it could not be read. */
  error: string | null
  /** Back to the list of conversations. */
  onBack: () => void
  /** Back to the conversation going on now. */
  onClose: () => void
}

const AUTHOR = { user: 'You', assistant: 'hobkin' } as const

/**
 * An earlier conversation, opened from History over the chat. It only reads: nothing here sends, resumes or changes
 * it. It opens at its end, as the chat does, and Escape or "Back to now" returns to the conversation going on now.
 */
export function HistoryView({ title, when, conversation, error, onBack, onClose }: HistoryViewProps) {
  const still = useStill()
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (conversation && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [conversation])
  const said = (words: string) => <li className="py-10 text-center text-[14px] text-muted-foreground">{words}</li>
  const now = Date.now()

  return (
    <motion.section
      aria-label={`${title}, earlier conversation`}
      data-history-view
      className="flex h-full min-h-0 flex-col"
      initial={holdStill({ opacity: 0, transform: 'translateY(12px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)' }, still)}
      transition={{ transform: spring.sheet, opacity: tween.enter }}
    >
      <header className="mx-auto flex w-full max-w-[664px] shrink-0 items-center gap-2 px-3 pt-2 pb-2">
        {/* The keyboard stays where it was, so the veil's keys and the input keep working. */}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onBack}
          aria-label="Earlier conversations"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-tight">{title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{when}</span>
        </span>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          className="h-8 shrink-0 rounded-full bg-surface-2 px-3 font-heading text-[13px] font-medium transition-colors duration-[160ms] ease-[ease] hover:bg-secondary"
        >
          Back to now
        </button>
      </header>
      <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-4">
        <ol className="mx-auto flex max-w-[640px] flex-col gap-4 pt-2">
          {error ? said(error) : conversation === null ? said('Opening it…') : conversation.messages.length === 0 ? said('Nothing was said in it.') : null}
          {conversation?.earlier ? <li className="eyebrow text-center">{conversation.earlier} earlier messages are not shown</li> : null}
          {conversation?.messages.map((message, index) => {
            const mine = message.role === 'user'
            return (
              <li key={index} className={cn('flex min-w-0 flex-col gap-1', mine && 'items-end')}>
                <div className="flex items-baseline gap-2">
                  <span className="eyebrow">{AUTHOR[message.role]}</span>
                  {message.at === null ? null : (
                    <time dateTime={new Date(message.at).toISOString()} className="text-[11px] text-muted-foreground tabular-nums">
                      {dayLabel(message.at, now)}, {clockTime(message.at)}
                    </time>
                  )}
                </div>
                {message.about ? <div className="text-[12px] text-code-fg">About {message.about}</div> : null}
                {message.text ? (
                  <div className={cn('max-w-[92%] min-w-0 text-[15px] leading-relaxed break-words', mine && 'rounded-2xl rounded-br-md bg-secondary px-3.5 py-2')}>
                    <MessageText text={message.text} role={message.role} />
                  </div>
                ) : null}
                {message.images ? <div className="text-[12px] text-muted-foreground">{message.images === 1 ? '1 image' : `${message.images} images`}</div> : null}
              </li>
            )
          })}
          {conversation?.cut ? <li className="eyebrow text-center">This conversation is longer than History reads, so only its start is shown</li> : null}
        </ol>
      </div>
    </motion.section>
  )
}
