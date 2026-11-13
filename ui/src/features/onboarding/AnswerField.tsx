import { ArrowUp } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { pickedSuggestions, toggleSuggestion } from './questions.ts'
import type { Ask } from './story.ts'

interface AnswerFieldProps {
  ask: Extract<Ask, { kind: 'input' }>
  /** The question, for a screen reader: the bubble itself is drawn, not read. */
  label: string
  /** What was answered before, when the user came back to the question. */
  initial: string
  /** Keeps the answer. It answers with what is wrong, in hobkin's words, or null once the answer is kept. */
  onAnswer: (value: string) => Promise<string | null>
  still: boolean
}

const LANDED = 'translateX(-50%) translateY(0px) scale(1)'

/**
 * Where the user types an answer: one field at the bottom of the window, in the middle. Enter sends it. An
 * answer that may be left out has Skip, and a question with common answers shows them to pick from.
 */
export function AnswerField({ ask, label, initial, onAnswer, still }: AnswerFieldProps) {
  const id = useId()
  const field = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  const [keeping, setKeeping] = useState(false)

  // The field takes the keyboard as it lands, so the answer can be typed at once.
  useEffect(() => {
    field.current?.focus({ preventScroll: true })
  }, [])

  const answer = async (text: string) => {
    if (keeping) return
    setKeeping(true)
    setProblem(null)
    const wrong = await onAnswer(text)
    // Kept: the story goes on and this field goes with it. Otherwise it says why and waits.
    if (wrong !== null) {
      setProblem(wrong)
      setKeeping(false)
      field.current?.focus({ preventScroll: true })
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void answer(value)
  }

  const picked = ask.suggestions ? pickedSuggestions(value, ask.suggestions) : []
  const empty = value.trim() === ''

  return (
    <motion.form
      onSubmit={submit}
      noValidate
      initial={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(28px) scale(0.96)' }}
      animate={{ opacity: 1, transform: LANDED, transition: { transform: spring.rise, opacity: tween.enter } }}
      exit={{ opacity: 0, transform: still ? LANDED : 'translateX(-50%) translateY(14px) scale(0.98)', transition: tween.exit }}
      className="absolute bottom-[7vh] left-1/2 z-[80] flex w-[min(480px,calc(100vw-48px))] flex-col items-center gap-2.5"
    >
      {ask.suggestions ? (
        <div className="flex flex-wrap justify-center gap-1.5">
          {ask.suggestions.map((suggestion) => {
            const on = picked.includes(suggestion)
            return (
              <button
                key={suggestion}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setValue((written) => toggleSuggestion(written, suggestion))
                  field.current?.focus({ preventScroll: true })
                }}
                className={cn(
                  'h-7 rounded-full border px-3 font-heading text-[12.5px] font-medium whitespace-nowrap outline-offset-2 transition-[background-color,border-color,color,transform] duration-[160ms] ease-[ease] active:scale-[0.97]',
                  on ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card/70 text-foreground/80 backdrop-blur-md hover:border-border-strong hover:text-foreground',
                )}
              >
                {suggestion}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="tale-glassy tale-glass flex h-14 w-full items-center gap-2 rounded-full pr-2 pl-6">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          ref={field}
          id={id}
          type={ask.type}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setProblem(null)
          }}
          placeholder={ask.placeholder}
          autoComplete="off"
          autoCapitalize={ask.type === 'email' ? 'none' : undefined}
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || ask.note ? `${id}-says` : undefined}
          disabled={keeping}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <Button type="submit" size="icon-lg" aria-label="Answer" disabled={keeping || (empty && !ask.optional)} className="size-10">
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-7 w-full items-start justify-between gap-3 px-2">
        <p
          id={`${id}-says`}
          role={problem ? 'alert' : undefined}
          // The note sits on the hill, so it takes the text color, which reads on the land in every theme. What is
          // wrong gets a card of its own, since red does not read on the land.
          className={cn('max-w-[46ch] text-[12px] leading-snug', problem ? 'rounded-xl bg-card px-2.5 py-1 font-medium text-destructive shadow-panel' : 'text-foreground/80')}
        >
          {problem ?? ask.note ?? ''}
        </p>
        {ask.optional ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={keeping} onClick={() => void answer('')}>
            Skip
          </Button>
        ) : null}
      </div>
    </motion.form>
  )
}
