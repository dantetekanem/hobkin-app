import { Check, Lock } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { cardRows, changeFields, checkChange, FULL_LINE, type Card, type CardChanges, type ChangePart } from './cards.ts'
import './story.css'

/** A card's three buttons, by their place in its footer. Left and Right keep the same place on the next card. */
export const CARD_BUTTONS = ['keep', 'change', 'drop'] as const
export type CardButton = (typeof CARD_BUTTONS)[number]

interface RoutineCardProps {
  card: Card
  /** Its place among the goal's cards, for the keys that move between them. */
  index: number
  mark: 'kept' | 'dropped' | null
  changes: CardChanges
  /** On a work computer a private card says it reads the person's own accounts. */
  work: boolean
  /** A Keep was refused because five are kept, so the card says why. */
  full: boolean
  /** Change is open: the rows are fields. */
  changing: boolean
  onKeep: () => void
  onChange: () => void
  onDrop: () => void
  onSave: (edits: Record<ChangePart, string>) => void
  onCancel: () => void
  width: number
  height: number
  still: boolean
}

const FIELD = 'w-full rounded-xl border border-white/45 bg-card/70 px-3 text-[13.5px] text-foreground outline-none transition-[border-color] duration-[160ms] placeholder:text-muted-foreground/70 focus-visible:border-ring dark:border-white/15'

/**
 * One routine as a pane of glass: its title, then what it watches, where it looks, how often, when it tells, what it
 * leaves out and what the person gets, then Keep, Change and Drop. The card keeps its size and its buttons keep their
 * places whatever it shows: Change turns the rows into fields in place, with Save and Cancel where Keep and Change
 * were. A kept card has a mark and a lit edge, and a dropped one dims, with Undo where Drop was.
 */
export function RoutineCard({ card, index, mark, changes, work, full, changing, onKeep, onChange, onDrop, onSave, onCancel, width, height, still }: RoutineCardProps) {
  const titleId = useId()
  const fields = changeFields(card, changes)
  const [edits, setEdits] = useState<Record<ChangePart, string>>(() => editsFrom(fields))
  const [problem, setProblem] = useState<string | null>(null)
  const changeButton = useRef<HTMLButtonElement | null>(null)
  const opened = useRef(false)
  // The fields come in once the rows have faded, so the first one takes the keyboard as it is drawn. Stable, so typing never moves it.
  const focusOnArrival = useCallback((field: HTMLInputElement | null) => field?.focus({ preventScroll: true }), [])

  // Change opens on what was saved last. Closed, the keyboard goes back to Change.
  useEffect(() => {
    if (changing) {
      setEdits(editsFrom(changeFields(card, changes)))
      setProblem(null)
    } else if (opened.current) changeButton.current?.focus({ preventScroll: true })
    opened.current = changing
    // When Change opens or closes.
  }, [changing])

  const save = (event?: FormEvent) => {
    event?.preventDefault()
    const wrong = Object.values(edits).map(checkChange).find((said) => said !== null)
    if (wrong) return setProblem(wrong)
    onSave(edits)
  }

  // As in the setup's other fields, Enter keeps what is written, and Shift+Enter starts a new line. Escape is the screen's.
  const onFieldKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    save()
  }

  const kept = mark === 'kept'
  const dropped = mark === 'dropped'
  const note = changing ? problem : full ? FULL_LINE : null
  // The rows and the fields swap in place: a fade, with a small lift only when things may move.
  const swap = {
    initial: { opacity: 0, transform: still ? 'translateY(0px)' : 'translateY(4px)' },
    animate: { opacity: 1, transform: 'translateY(0px)', transition: tween.enter },
    exit: { opacity: 0, transition: tween.exit },
  }

  return (
    <article
      aria-labelledby={titleId}
      data-card={index}
      data-mark={mark ?? undefined}
      className="tale-glassy tale-glass tale-card flex flex-col rounded-[26px] p-4 pb-3"
      style={{ width, height }}
    >
      <header className="tale-card-dims flex min-h-11 items-start gap-2">
        <h3 id={titleId} className="line-clamp-2 min-w-0 flex-1 font-heading text-[17px] leading-tight font-semibold tracking-[-0.012em] text-foreground">
          {card.title}
        </h3>
        {card.source === 'yours' ? <span className="mt-0.5 shrink-0 rounded-full bg-card/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Yours</span> : null}
        {/* The mark's place is kept, so the title never moves when the card is kept. */}
        <span aria-hidden="true" className={cn('flex size-6 shrink-0 items-center justify-center rounded-full transition-opacity duration-200', kept ? 'bg-primary text-primary-foreground opacity-100' : 'opacity-0')}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </header>

      <div className="tale-card-dims scroll-quiet relative mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <AnimatePresence mode="wait" initial={false}>
          {changing ? (
            <motion.form key="fields" {...swap} onSubmit={save} noValidate className="flex flex-col gap-2.5" aria-label={`Change ${card.title}`}>
              {fields.map((field, at) => {
                const id = `${titleId}-${field.part}`
                const value = edits[field.part]
                const set = (text: string) => {
                  setEdits((now) => ({ ...now, [field.part]: text }))
                  setProblem(null)
                }
                return (
                  <label key={field.part} htmlFor={id} className="flex flex-col gap-1">
                    <span className="text-[12px] leading-snug font-medium text-muted-foreground">{field.label}</span>
                    {field.part === 'often' ? (
                      <input
                        ref={at === 0 ? focusOnArrival : undefined}
                        id={id}
                        type="text"
                        value={value}
                        onChange={(event) => set(event.target.value)}
                        onKeyDown={onFieldKeys}
                        autoComplete="off"
                        spellCheck={false}
                        className={cn(FIELD, 'h-9')}
                      />
                    ) : (
                      <textarea
                        id={id}
                        value={value}
                        rows={2}
                        onChange={(event) => set(event.target.value)}
                        onKeyDown={onFieldKeys}
                        placeholder={field.part === 'skips' ? 'Nothing' : 'Your answer'}
                        spellCheck={false}
                        className={cn(FIELD, 'resize-none py-2 leading-snug')}
                      />
                    )}
                  </label>
                )
              })}
            </motion.form>
          ) : (
            <motion.dl key="rows" {...swap} className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2 text-[13px] leading-snug">
              {cardRows(card, changes, { work }).map((row) =>
                row.part === 'private' ? (
                  <div key={row.part} className="col-span-2 flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                    <dt className="sr-only">On this computer</dt>
                    <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                    <dd>{row.text}</dd>
                  </div>
                ) : (
                  <div key={row.part} className="contents">
                    <dt className="pt-px text-[12px] font-medium text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 text-foreground">{row.text}</dd>
                  </div>
                ),
              )}
            </motion.dl>
          )}
        </AnimatePresence>
      </div>

      {/* Said under the rows, which give way to it. The buttons below stay where they are. */}
      {note ? (
        <p role={changing ? 'alert' : 'status'} className="mt-2 text-[12px] leading-snug font-medium text-foreground">
          {note}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {changing ? (
          <>
            <Button data-card-button="keep" size="lg" onClick={() => save()}>
              Save
            </Button>
            <Button ref={changeButton} data-card-button="change" size="lg" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <span aria-hidden="true" />
          </>
        ) : (
          <>
            <Button data-card-button="keep" size="lg" variant={kept ? 'default' : 'outline'} aria-pressed={kept} onClick={onKeep}>
              {kept ? <Check aria-hidden="true" strokeWidth={3} /> : null}
              {kept ? 'Kept' : 'Keep'}
            </Button>
            <Button ref={changeButton} data-card-button="change" size="lg" variant="outline" onClick={onChange}>
              Change
            </Button>
            <Button data-card-button="drop" size="lg" variant={dropped ? 'secondary' : 'ghost'} aria-pressed={dropped} onClick={onDrop}>
              {dropped ? 'Undo' : 'Drop'}
            </Button>
          </>
        )}
      </div>
    </article>
  )
}

function editsFrom(fields: ReturnType<typeof changeFields>): Record<ChangePart, string> {
  const start = (part: ChangePart) => fields.find((field) => field.part === part)?.start ?? ''
  return { often: start('often'), skips: start('skips'), answer: start('answer') }
}
