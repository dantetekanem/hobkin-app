import { Check, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils.ts'

type AskState = 'idle' | 'sending' | 'asked' | 'failed'
const ICON = { idle: MessageCircleQuestion, sending: MessageCircleQuestion, asked: Check, failed: TriangleAlert } as const
const SAID: Record<Exclude<AskState, 'idle'>, string> = { sending: 'Asking…', asked: 'Asked', failed: 'Not sent' }

/**
 * A quick way to ask hobkin about one thing: it sends its words at once, they show in the conversation under
 * "Ask hobkin", and it says so. Its name carries the words it sends. `compact` is the short form, for a list.
 */
export function AskLink({ words, ask, compact = false, className }: {
  words: string
  /** Sends words to hobkin. Null where hobkin is not connected, as in a sample review. */
  ask: ((text: string) => Promise<boolean>) | null
  compact?: boolean
  className?: string
}) {
  const [state, setState] = useState<AskState>('idle')
  const Icon = ICON[state]
  const name = !ask ? 'Hobkin is not connected to this sample review' : state === 'failed' ? 'It did not go. The conversation under Ask hobkin says why. Click to try again.' : `Ask hobkin: ${words}`
  return (
    <button
      type="button"
      data-stop
      disabled={!ask || state === 'sending' || state === 'asked'}
      aria-label={name}
      title={name}
      onClick={async () => {
        if (!ask) return
        setState('sending')
        setState((await ask(words)) ? 'asked' : 'failed')
      }}
      className={cn(
        'rv-ask-link flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-heading text-[13px] font-semibold transition-[background-color,transform] duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] disabled:active:scale-100 [&_svg]:size-3.5',
        state === 'failed' && 'rv-ask-link-failed',
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {state === 'idle' ? (compact ? 'Ask' : 'Ask hobkin') : SAID[state]}
    </button>
  )
}
