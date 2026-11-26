import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { focusHome } from '@/app/focus-home.ts'
import { stillVariants, useStill } from '@/app/still.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useSetup } from '@/features/onboarding/store.ts'
import { useTour } from '@/features/tour/store.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { CardFactsLine, ChoiceText, PickMark } from './CardParts.tsx'
import { WAIT_MS, onSheet, timeLeft, type Question } from './queue.ts'
import { useQuestions } from './store.ts'
// hobkin's own questions rise on this sheet, and the answers go back to it (022 S4).
import './host-bridge.ts'

const TICK_MS = 250
/** After this long without a key or a pointer move in the sheet, the user counts as idle again. */
const ENGAGED_MS = 4000

/**
 * A question from hobkin, on a surface of its own: a sheet that rises from the bottom of the window while
 * everything behind it blurs, so the question reads the same over any screen. Spec: 022-questions.
 */
export function QuestionSheet() {
  const queue = useQuestions((state) => state.queue)
  const freshWait = useQuestions((state) => state.freshWait)
  // The first-run setup and its tour cover the window, and the frame under them is out of reach. The sheet steps
  // aside until both are gone, so a question nobody can see never runs out its wait into Action Items.
  const setupOpen = useSetup((state) => state.open)
  const touring = useTour((state) => state.open)
  const covered = setupOpen || touring
  const question = onSheet(queue, covered)

  // Stepping aside and coming back, the question gets its whole wait.
  useEffect(() => {
    freshWait()
  }, [covered, freshWait])

  return (
    <AnimatePresence>
      {question ? (
        <Sheet key={question.id} question={question} at={1} of={queue.waiting.length} left={timeLeft(queue)} />
      ) : null}
    </AnimatePresence>
  )
}

function Sheet({ question, at, of, left }: { question: Question; at: number; of: number; left: number }) {
  const still = useStill()
  const answer = useQuestions((state) => state.answer)
  const defer = useQuestions((state) => state.defer)
  const tick = useQuestions((state) => state.tick)
  const [selected, setSelected] = useState(() => Math.max(0, question.choices.findIndex((choice) => choice.value === question.recommended)))
  const [typed, setTyped] = useState('')
  const options = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  const touchedAt = useRef(0)
  const inField = selected === question.choices.length

  // The sheet takes the keyboard when it rises, and hands it back home when it leaves.
  useEffect(() => {
    options.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) focusHome()
      })
    }
  }, [])

  // hobkin's 30 seconds. They run only while the user leaves the sheet alone.
  useEffect(() => {
    const timer = setInterval(() => tick(TICK_MS, Date.now() - touchedAt.current < ENGAGED_MS || typed.length > 0), TICK_MS)
    return () => clearInterval(timer)
  }, [tick, typed])

  const touch = () => {
    touchedAt.current = Date.now()
  }

  const choose = (index: number) => answer(question.id, { value: question.choices[index]!.value })
  const later = () => defer(question.id)

  const move = (next: number) => {
    const clamped = Math.min(question.choices.length, Math.max(0, next))
    setSelected(clamped)
    if (clamped === question.choices.length) field.current?.focus()
    else options.current?.focus()
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={question.question}
      className="fixed inset-0 z-50"
      initial="away"
      animate="here"
      exit="away"
      variants={{ away: {}, here: {} }}
      onPointerMove={touch}
      onKeyDown={(event) => {
        touch()
        if (event.key === 'Escape') {
          later()
          event.preventDefault()
          return
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return
        if (event.target === field.current) {
          if (event.key === 'ArrowUp') {
            move(question.choices.length - 1)
            event.preventDefault()
          } else if (event.key === 'Enter') {
            answer(question.id, { typed })
            event.preventDefault()
          }
          return
        }
        const digit = /^[1-9]$/.test(event.key) ? Number(event.key) : 0
        if (digit && digit <= question.choices.length) choose(digit - 1)
        else if (event.key === 'ArrowDown') move(selected + 1)
        else if (event.key === 'ArrowUp') move(selected - 1)
        else if (event.key === 'Enter') choose(selected)
        else if (event.key.length === 1 && event.key !== ' ') {
          // A letter means the user is writing an answer of their own. It lands in the field.
          setSelected(question.choices.length)
          field.current?.focus()
          return
        } else return
        event.preventDefault()
      }}
    >
      {/* The window behind blurs and darkens in the same movement as the sheet rises. A click there puts the question off. */}
      <motion.div
        className="absolute inset-0"
        variants={{ away: { backdropFilter: 'blur(0px)' }, here: { backdropFilter: 'blur(10px)' } }}
        transition={spring.screen}
      />
      <motion.div
        className="absolute inset-0 bg-scrim"
        variants={{ away: { opacity: 0 }, here: { opacity: 1 } }}
        transition={spring.screen}
        onClick={later}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4">
        <motion.section
          className="pointer-events-auto relative w-full max-w-[760px] overflow-hidden rounded-t-[30px] bg-background shadow-float"
          variants={stillVariants(
            {
              away: { opacity: 0, transform: 'translateY(100%)', transition: { transform: spring.screenExit, opacity: { duration: 0.2 } } },
              here: { opacity: 1, transform: 'translateY(0%)', transition: { transform: spring.screen, opacity: tween.enter } },
            },
            still,
          )}
        >
          {/* The time left before the question moves to Action Items. It holds while the user chooses or types. */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-tone-1">
            <div
              className="h-full origin-left bg-primary transition-transform duration-[250ms] ease-linear"
              style={{ transform: `scaleX(${left / WAIT_MS})` }}
            />
          </div>

          <div className="px-8 pt-8 pb-6">
            <div className="flex items-center gap-3">
              <Hob mood="listening" size={44} />
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{question.from === 'hobkin' ? 'hobkin asks' : 'hobkin asks, for'}</p>
                {question.from === 'hobkin' ? null : <p className="truncate text-[13px] text-muted-foreground">{question.from}</p>}
              </div>
              {of > 1 ? (
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {at} of {of}
                </span>
              ) : null}
            </div>

            <h2 className="mt-4 text-[24px] leading-[1.2] font-semibold text-balance">{question.question}</h2>
            {question.tldr ? <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{question.tldr}</p> : null}
            <CardFactsLine question={question} now={Date.now()} className="mt-3" />

            <div
              ref={options}
              role="listbox"
              aria-label="Choices"
              aria-activedescendant={inField ? undefined : `choice-${question.id}-${selected}`}
              tabIndex={-1}
              className="mt-5 flex flex-col gap-1.5 outline-none"
            >
              {question.choices.map((choice, index) => {
                const active = index === selected
                const recommended = choice.value === question.recommended
                return (
                  <motion.div
                    key={choice.value}
                    id={`choice-${question.id}-${index}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(index)}
                    onPointerMove={() => {
                      if (!active) setSelected(index)
                    }}
                    variants={stillVariants(
                      {
                        away: { opacity: 0, transform: 'translateY(18px)' },
                        here: {
                          opacity: 1,
                          transform: 'translateY(0px)',
                          transition: { transform: spring.rise, opacity: tween.enter, delay: 0.12 + index * 0.05 },
                        },
                      },
                      still,
                    )}
                    className={cn(
                      'flex cursor-default items-start gap-3 rounded-2xl px-3.5 py-3 transition-colors duration-[120ms] ease-[ease]',
                      active ? 'bg-surface-2' : 'bg-tone-1',
                    )}
                  >
                    <Kbd className={cn('mt-0.5 shrink-0', active && 'bg-primary text-primary-foreground')}>{index + 1}</Kbd>
                    <span className="min-w-0 flex-1">
                      <ChoiceText choice={choice} question={question} className="text-[15px] leading-snug font-medium" />
                      {recommended && question.why ? <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{question.why}</span> : null}
                    </span>
                    {recommended ? <PickMark sure={question.sure} className="mt-1" /> : null}
                  </motion.div>
                )
              })}
            </div>

            <label
              className={cn(
                'mt-3 flex h-11 items-center rounded-full border-[1.5px] bg-card px-4 transition-colors duration-[160ms] ease-[ease]',
                inField ? 'border-ring' : 'border-input',
              )}
            >
              <input
                ref={field}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onFocus={() => setSelected(question.choices.length)}
                placeholder="Or type your own answer"
                aria-label="Type your own answer"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            </label>

            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Kbd>1</Kbd>
                <Kbd>{question.choices.length}</Kbd>
                pick
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↑↓</Kbd>
                move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>enter</Kbd>
                answer
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                later, in Action Items
              </span>
            </p>
          </div>
        </motion.section>
      </div>
    </motion.div>
  )
}
