import { ArrowUp } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { QuestionReply } from '#shared/protocol/question.ts'
import { PILL, PILL_OPEN, PILL_PICKED } from './PickCloud.tsx'
import type { Ask } from './story.ts'
import './story.css'

type FollowUpAsk = Extract<Ask, { kind: 'follow-up' }>

interface FollowUpsProps {
  /** The question, for a screen reader: the bubble that asks it is drawn, not read. */
  label: string
  /** What main hobkin asks, once its bubble is said. Null while it is still thinking, or its words are arriving. */
  ask: FollowUpAsk | null
  /** Where the bubbles start, from the top of the window: under hobkin's feet. */
  top: number
  /** Gives hobkin the answer. It answers with what went wrong, in hobkin's words, or null once hobkin has it. */
  onAnswer: (id: string, reply: QuestionReply) => Promise<string | null>
  /** The user has told hobkin enough, and the story goes on. */
  onEnough: () => void
  still: boolean
}

/** The bubbles arrive one after another, this far apart in seconds. There are only a few. */
const ARRIVE_STEP = 0.06
/** A choice can be a whole sentence, so its bubble may wrap, where a project's name never does. */
const SENTENCE = 'h-auto min-h-9 max-w-full py-1.5 text-center whitespace-normal text-balance'

/**
 * Main hobkin's own questions, after the setup's fixed ones: bubbles to pick one from, over the hill under hobkin,
 * and a field to type an answer when the question takes one. A pick answers at once. "That's enough" stays the
 * whole time, also while hobkin is still thinking of what to ask.
 */
export function FollowUps({ label, ask, top, onAnswer, onEnough, still }: FollowUpsProps) {
  const id = useId()
  const field = useRef<HTMLInputElement | null>(null)
  const first = useRef<HTMLButtonElement | null>(null)
  const [typed, setTyped] = useState('')
  // The answer on its way to hobkin, so nothing is sent twice. Null while none is.
  const [sending, setSending] = useState<QuestionReply | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const question = ask?.question ?? null
  // The question an answer was for, so one that comes back late never lands on the next question.
  const asked = useRef(question)
  asked.current = question

  // Each question starts clean and takes the keyboard: its field when it takes words, its first bubble otherwise.
  useEffect(() => {
    setTyped('')
    setSending(null)
    setProblem(null)
    if (!ask) return
    const target = ask.typed ? field.current : first.current
    target?.focus({ preventScroll: true })
    // Once for each question, by its id.
  }, [question])

  const give = async (reply: QuestionReply) => {
    if (!question || sending) return
    setSending(reply)
    setProblem(null)
    const wrong = await onAnswer(question, reply)
    // Given, the next question or hobkin thinking takes its place. Otherwise it says why and waits.
    if (wrong === null || asked.current !== question) return
    setProblem(wrong)
    setSending(null)
  }

  const pick = (value: string) => {
    if (sending) return
    play('pick')
    void give({ value })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const words = typed.trim()
    if (ask?.typed && words) void give({ typed: words })
  }

  const picked = sending && 'value' in sending ? sending.value : null

  return (
    <motion.form
      onSubmit={submit}
      noValidate
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: tween.enter }}
      exit={{ opacity: 0, transition: tween.exit }}
      className="absolute inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-3 px-6 pb-[4vh]"
      style={{ top }}
    >
      <div role="group" aria-label={label} className="flex min-h-0 w-full max-w-[1100px] flex-1 flex-wrap content-center items-center justify-center gap-x-2 gap-y-2.5 overflow-hidden">
        <AnimatePresence initial>
          {(ask?.options ?? []).map((option, index) => {
            const wait = index * ARRIVE_STEP
            return (
              <motion.span
                key={`${question}:${option.value}`}
                className="inline-block max-w-full"
                initial={{ opacity: 0, transform: still ? 'scale(1)' : 'scale(0.8)' }}
                animate={{ opacity: 1, transform: 'scale(1)', transition: { transform: { ...spring.alive, delay: wait }, opacity: { ...tween.enter, delay: wait } } }}
                exit={{ opacity: 0, transition: tween.exit }}
              >
                {/* Each bobs at its own pace, as the bubbles of a cloud do. */}
                <span className="tale-bob inline-block max-w-full" style={{ animationDelay: `${-(index % 7) * 0.7}s`, animationDuration: `${4.4 + (index % 5) * 0.5}s` }}>
                  <button
                    ref={index === 0 ? first : undefined}
                    type="button"
                    aria-pressed={picked === option.value}
                    disabled={sending !== null}
                    onClick={() => pick(option.value)}
                    className={cn(PILL, SENTENCE, picked === option.value ? PILL_PICKED : PILL_OPEN)}
                  >
                    {option.label}
                  </button>
                </span>
              </motion.span>
            )
          })}
        </AnimatePresence>
      </div>

      <div className="flex w-[min(520px,100%)] flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {ask?.typed ? (
            <motion.div
              key="field"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: tween.enter }}
              exit={{ opacity: 0, transition: tween.exit }}
              className="tale-glassy tale-glass flex h-14 w-full items-center gap-2 rounded-full pr-2 pl-6"
            >
              <label htmlFor={id} className="sr-only">
                Type your own answer
              </label>
              <input
                ref={field}
                id={id}
                type="text"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                  setProblem(null)
                }}
                placeholder="Or type your own answer"
                autoComplete="off"
                spellCheck={false}
                disabled={sending !== null}
                aria-invalid={problem ? true : undefined}
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              <Button type="submit" size="icon-lg" aria-label="Answer" disabled={sending !== null || typed.trim() === ''} className="size-10">
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* What went wrong gets a card of its own, since red does not read on the land. */}
        {problem ? (
          <p role="alert" className="max-w-[46ch] rounded-xl bg-card px-2.5 py-1 text-[12px] leading-snug font-medium text-destructive shadow-panel">
            {problem}
          </p>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onEnough}>
          That's enough
        </Button>
      </div>
    </motion.form>
  )
}
