import { Check } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { play } from '@/features/sound/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { cloudWayOn, matching, ownOption, shownOf, togglePick } from './picks.ts'
import './story.css'

interface PickCloudProps {
  /** The question, for a screen reader: the bubble that asks it is drawn, not read. */
  label: string
  /** Everything there is to pick from. */
  options: readonly string[]
  /** `loading`: the options are on their way. `none`: there are none, and `note` says why. */
  state: 'loading' | 'ready' | 'none'
  note?: string
  /** What was picked before, when the user came back to the question. */
  initial: readonly string[]
  /** Typed words can become a bubble of their own. */
  allowOwn: boolean
  /** Said under the field while there is nothing else to say, such as where the answers are kept. */
  remark?: string
  /** Where the bubbles start, from the top of the window: under hobkin's feet. */
  top: number
  onAnswer: (picked: string[]) => void
  still: boolean
}

/** A small bubble to pick, open or picked. The follow-up questions' bubbles have the same look (`FollowUps.tsx`). */
export const PILL = 'h-9 rounded-full border px-3.5 font-heading text-[13.5px] font-medium whitespace-nowrap outline-offset-2 transition-[background-color,border-color,color,transform] duration-[160ms] ease-[ease] active:scale-[0.96]'
export const PILL_OPEN = 'border-white/45 bg-card/60 text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_8px_16px_-10px_rgb(0_0_0/0.45)] hover:bg-card/85 dark:border-white/15 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_8px_16px_-10px_rgb(0_0_0/0.7)]'
export const PILL_PICKED = 'border-transparent bg-primary text-primary-foreground shadow-[0_8px_18px_-8px_color-mix(in_oklab,var(--hb-sun)_70%,transparent)]'

/** The bubbles arrive one after another, up to this many apart, so a full cloud does not take long to fill. */
const ARRIVE = { step: 0.012, atMost: 28 }

/**
 * A cloud of small bubbles to pick from, as many as one likes, over the hill under hobkin. Typing narrows them to
 * what holds the typed words, and at most fifty show at once. Where the list takes new ones, Enter makes the typed
 * words a bubble of their own. Once something is picked, Continue shows where Skip was, and it, Enter with nothing
 * typed, or Done keeps what was picked. A bubble picked with the pointer gives the keyboard back to the field, so
 * Enter goes on.
 */
export function PickCloud({ label, options, state, note, initial, allowOwn, remark, top, onAnswer, still }: PickCloudProps) {
  const id = useId()
  const field = useRef<HTMLInputElement | null>(null)
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState<string[]>(() => [...initial])
  // Bubbles the user made by typing, shown with the rest.
  const [own, setOwn] = useState<string[]>(() => initial.filter((one) => !options.includes(one)))

  useEffect(() => {
    field.current?.focus({ preventScroll: true })
  }, [])

  const all = [...options, ...own.filter((one) => !options.includes(one))]
  const { shown, more } = shownOf(matching(all, typed))
  const toAdd = allowOwn ? ownOption(all, typed) : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Typed words that are no bubble yet become one, picked. Otherwise Enter is done.
    if (toAdd) {
      setOwn((ones) => [...ones, toAdd])
      setPicked((ones) => [...ones, toAdd])
      setTyped('')
      return
    }
    onAnswer(picked)
  }

  let says = ''
  if (state === 'loading') says = 'Looking.'
  else if (state === 'none') says = note ?? ''
  else if (more > 0) says = `${more} more. Type to find them.`
  else if (remark) says = remark

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
          {shown.map((option, index) => {
            const on = picked.includes(option)
            const wait = Math.min(index, ARRIVE.atMost) * ARRIVE.step
            return (
              <motion.span
                key={option}
                className="inline-block"
                initial={{ opacity: 0, transform: still ? 'scale(1)' : 'scale(0.8)' }}
                animate={{ opacity: 1, transform: 'scale(1)', transition: { transform: { ...spring.alive, delay: wait }, opacity: { ...tween.enter, delay: wait } } }}
                exit={{ opacity: 0, transition: tween.exit }}
              >
                {/* Each bobs at its own pace, so the cloud never moves as one. */}
                <span className="tale-bob inline-block" style={{ animationDelay: `${-(index % 7) * 0.7}s`, animationDuration: `${4.4 + (index % 5) * 0.5}s` }}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={(event) => {
                      play('tap')
                      setPicked((ones) => togglePick(ones, option))
                      // A click by the pointer, not by a key on the bubble itself.
                      if (event.detail > 0) field.current?.focus({ preventScroll: true })
                    }}
                    className={cn(PILL, on ? PILL_PICKED : PILL_OPEN)}
                  >
                    {option}
                  </button>
                </span>
              </motion.span>
            )
          })}
        </AnimatePresence>
      </div>

      <div className="flex w-[min(520px,100%)] flex-col gap-2">
        <div className="tale-glassy tale-glass flex h-14 w-full items-center gap-2 rounded-full pr-2 pl-6">
          <label htmlFor={id} className="sr-only">
            {allowOwn ? 'Filter the bubbles, or type your own' : 'Filter the bubbles'}
          </label>
          <input
            ref={field}
            id={id}
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={allowOwn ? 'Filter, or type your own' : 'Filter'}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <span className="shrink-0 px-1 font-heading text-[12.5px] text-muted-foreground" aria-live="polite">
            {picked.length ? `${picked.length} picked` : ''}
          </span>
          <Button type="submit" size="icon-lg" aria-label={toAdd ? `Add ${toAdd}` : 'Done'} className="size-10">
            <Check className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-7 items-start justify-between gap-3 px-2">
          <p role={state === 'none' ? 'status' : undefined} className="max-w-[46ch] text-[12px] leading-snug text-foreground/80">
            {says}
          </p>
          {/* Skip and Continue share one place, as wide and tall as Continue, so nothing moves when one takes the other's place. */}
          <div className="flex h-9 min-w-[124px] shrink-0 items-center justify-end">
            {cloudWayOn(picked) === 'continue' ? (
              <Button type="button" size="lg" className="gap-2 px-4" onClick={() => onAnswer(picked)}>
                Continue
                <Kbd className="bg-foreground/10 text-primary-foreground">↵</Kbd>
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => onAnswer([])}>
                Skip
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.form>
  )
}
