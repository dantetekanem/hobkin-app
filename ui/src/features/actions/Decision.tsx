import { ArrowLeft, ArrowUpRight, ExternalLink, MessagesSquare, Waypoints, X } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useStops } from '@/app/stops.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import type { Answer } from '@/features/questions/queue.ts'
import { timeOf, waited } from '@/features/reports/time.ts'
import { cn } from '@/lib/utils.ts'
import { canDismiss, dismissesKey } from './dismiss.ts'
import { discussesKey } from './discuss.ts'
import { answersOf, type WaitingRow } from './items.ts'
import { KIND } from './kinds.ts'
import { SCREEN_PANES } from '@/app/screen-layout.ts'

interface OpenItemProps {
  rows: readonly WaitingRow[]
  row: WaitingRow
  sample: boolean
  now: number
  /** Reports' slide (`slideVariants`), and which way the layer and the card last slid. */
  slides: Variants
  aside: number
  step: number
  onSwitch: (row: WaitingRow) => void
  onClose: () => void
  onAnswer: (row: WaitingRow, given: Answer) => void
  onReview: (row: WaitingRow) => void
  /** Read here though it is handled elsewhere, because work mode is off. Where it is handled is then a button of its own. */
  reads?: boolean
  /** Opens it where it is handled. */
  onOpenElsewhere?: (row: WaitingRow) => void
  /** Puts the item on the next message to hobkin, to talk it over. It answers nothing. */
  onDiscuss: (row: WaitingRow) => void
  /** Dismisses the item with hobkin's own dismissal. It answers nothing. */
  onDismiss: (row: WaitingRow) => void
}

/**
 * An open item, laid out as Reports is: its decision card on the left, everything waiting on the right. Another item
 * from that list slides its card in from the side it lies on. Up and Down walk the controls, Enter presses, Escape
 * goes back to the list.
 */
export function OpenItem({ rows, row, sample, now, slides, aside, step, onSwitch, onClose, onAnswer, onReview, reads = false, onOpenElsewhere, onDiscuss, onDismiss }: OpenItemProps) {
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !(event.target instanceof HTMLElement)) return
    // The item that has the keyboard: the open one, or one in the list beside it. Typed in the answer field, a key is text.
    const listed = event.target.closest<HTMLElement>('[data-side-row]')?.dataset.sideRow
    const focused = rows.find((each) => each.id === listed) ?? row
    const typing = event.target instanceof HTMLInputElement

    if (event.key === 'Escape') onClose()
    // Pressed here rather than left to the browser, so a key that comes from hobkin's commands presses it the same way.
    else if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.target.click()
    // As r replies to a report: the item goes with the next message.
    else if (discussesKey({ key: event.key, shift: event.shiftKey }, typing)) onDiscuss(focused)
    // As Backspace deletes a report: the item is dismissed.
    else if (dismissesKey(event.key, typing)) onDismiss(focused)
    else return
    event.preventDefault()
  }

  return (
    <motion.div
      ref={root}
      custom={aside}
      variants={slides}
      initial="enter"
      animate="center"
      exit="exit"
      onKeyDown={keys}
      className={`absolute inset-0 ${SCREEN_PANES}`}
    >
      <div className="relative min-h-0 overflow-hidden rounded-[28px]">
        <AnimatePresence initial={false} custom={step}>
          <motion.div key={row.id} custom={step} variants={slides} initial="enter" animate="center" exit="exit" className="absolute inset-0">
            <Card row={row} sample={sample} now={now} onClose={onClose} onAnswer={onAnswer} onReview={onReview} reads={reads} onOpenElsewhere={onOpenElsewhere} onDiscuss={onDiscuss} onDismiss={onDismiss} />
          </motion.div>
        </AnimatePresence>
      </div>
      <ul aria-label="Action items" className="scroll-quiet flex min-h-0 flex-col overflow-y-auto overscroll-contain px-1 pt-2 pb-6 @max-[800px]:hidden">
        {rows.map((each) => {
          const open = each.id === row.id
          const Icon = KIND[each.kind].icon
          return (
            <li key={each.id}>
              <button
                type="button"
                data-stop=""
                data-side-row={each.id}
                aria-current={open ? 'true' : undefined}
                onClick={() => onSwitch(each)}
                className="group relative isolate flex w-full cursor-default items-start gap-3 rounded-2xl px-3 py-2.5 text-left outline-offset-[-2px]"
              >
                {/* The open item's row wears the card's own color, as the open report's row does in Reports. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 -z-10 rounded-2xl transition-opacity duration-[160ms] ease-[ease]',
                    open ? 'bg-background opacity-100' : 'bg-surface-2 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100',
                  )}
                />
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-heading text-[14px] leading-snug font-medium tracking-[-0.01em]">{each.summary}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{each.from}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </motion.div>
  )
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * One item as a whole decision: who asks and since when, the whole question, what changed and why it is the user's,
 * then its answers in words, hobkin's pick marked with its reason, and the user's own words where hobkin takes them.
 * A number answers at once. Discuss, first among its buttons, talks it over with hobkin, and Dismiss after it takes the item
 * away unanswered. Neither answers anything.
 */
function Card({ row, sample, now, onClose, onAnswer, onReview, reads, onOpenElsewhere, onDiscuss, onDismiss }: Pick<OpenItemProps, 'row' | 'sample' | 'now' | 'onClose' | 'onAnswer' | 'onReview' | 'reads' | 'onOpenElsewhere' | 'onDiscuss' | 'onDismiss'>) {
  const back = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const [words, setWords] = useState('')
  const { choices, words: takesWords } = answersOf(row, sample)
  const { label, icon: Icon } = KIND[row.kind]
  const at = timeOf(row.at)
  const whole = (row.item?.question ?? row.question.question).trim()
  // An item's own summary is made of its question, what changed and why, which the card shows apart.
  const summary = row.item ? '' : (row.question.tldr?.trim() ?? '')
  const why = row.question.why ?? row.item?.why ?? null
  const pick = row.question.recommended
  const dismisses = canDismiss(row)

  // Opening hands the keyboard to the card, so its keys work at once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => back.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])

  const byNumber = (event: KeyboardEvent<HTMLDivElement>) => {
    const digit = /^[1-9]$/.test(event.key) && !(event.target instanceof HTMLInputElement) ? Number(event.key) : 0
    if (!digit || digit > choices.length) return
    event.preventDefault()
    onAnswer(row, { value: choices[digit - 1]!.value })
  }

  return (
    <div role="region" aria-labelledby={titleId} onKeyDown={byNumber} className="absolute inset-0 overflow-hidden rounded-[28px] bg-background">
      <div className="scroll-quiet h-full overflow-y-auto overscroll-contain px-8 pt-4 pb-10">
        <article className="mx-auto flex max-w-[660px] flex-col gap-4">
          <div>
            <Button ref={back} variant="ghost" size="sm" data-stop="" onClick={onClose} className="-ml-1.5">
              <ArrowLeft aria-hidden="true" />
              Action items
            </Button>
          </div>
          <header>
            <p className="eyebrow flex items-center gap-1.5">
              <Icon className="size-3 shrink-0" aria-hidden="true" />
              {row.from.toLowerCase().startsWith(label.toLowerCase()) ? row.from : `${label} · ${row.from}`}
            </p>
            <h2 id={titleId} className="mt-2 font-heading text-[24px] leading-[1.2] font-semibold tracking-[-0.022em] text-balance">{row.summary}</h2>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{row.putOff ? 'Put off from the question sheet' : at === null ? '' : `Waiting ${waited(at, now)}`}</p>
          </header>
          {flat(whole) !== flat(row.summary) ? <p className="text-[15px] leading-relaxed whitespace-pre-line">{whole}</p> : null}
          {summary && flat(summary) !== flat(whole) ? <p className="text-[14px] leading-relaxed whitespace-pre-line text-muted-foreground">{summary}</p> : null}
          {row.changed ? (
            <p className="flex items-baseline gap-2 text-[14px]">
              <span className="eyebrow shrink-0">Changed</span>
              <span>{row.changed}</span>
            </p>
          ) : null}
          {why && !pick ? (
            <p className="flex items-baseline gap-2 text-[14px]">
              <span className="eyebrow shrink-0">Why you</span>
              <span className="text-muted-foreground">{why}</span>
            </p>
          ) : null}

          {choices.length ? (
            <div role="group" aria-label="Answers" className="flex flex-col gap-1.5">
              {choices.map((choice, index) => (
                <button
                  key={choice.value}
                  type="button"
                  data-stop=""
                  onClick={() => onAnswer(row, { value: choice.value })}
                  className="group flex cursor-default items-start gap-3 rounded-2xl bg-tone-1 px-3.5 py-3 text-left outline-none transition-colors duration-[120ms] ease-[ease] hover:bg-surface-2 focus-visible:bg-surface-2"
                >
                  <Kbd className="mt-0.5 shrink-0 group-focus-visible:bg-primary group-focus-visible:text-primary-foreground">{index + 1}</Kbd>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug font-medium">{choice.label}</span>
                    {choice.value === pick && why ? <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{why}</span> : null}
                  </span>
                  {choice.value === pick ? <span className="eyebrow mt-1 shrink-0 text-sun-fg">hobkin's pick</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {takesWords ? (
            <input
              data-stop=""
              value={words}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !words.trim()) return
                event.preventDefault()
                onAnswer(row, { typed: words.trim() })
              }}
              placeholder="Or type your own answer"
              aria-label="Type your own answer"
              className="h-11 rounded-full border-[1.5px] border-input bg-card px-4 text-[15px] outline-none transition-colors duration-[160ms] ease-[ease] placeholder:text-muted-foreground focus:border-ring"
            />
          ) : null}
          {/* Every item can be talked over with hobkin, whether or not it has anything to answer here. */}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="outline" size="sm" data-stop="" onClick={() => onDiscuss(row)}>
              <MessagesSquare aria-hidden="true" />
              Discuss
              <Kbd>r</Kbd>
            </Button>
            {dismisses ? (
              <Button variant="ghost" size="sm" data-stop="" onClick={() => onDismiss(row)}>
                <X aria-hidden="true" />
                Dismiss
                <Kbd>⌫</Kbd>
              </Button>
            ) : null}
            {row.branch ? (
              <Button variant="outline" size="sm" data-stop="" onClick={() => onReview(row)}>
                <Waypoints aria-hidden="true" />
                Review
              </Button>
            ) : null}
            {reads && row.opens ? (
              // Work mode is off, so Work would do nothing with it, but it can still be opened there.
              <Button variant="ghost" size="sm" data-stop="" onClick={() => onOpenElsewhere?.(row)}>
                Opens in Work
                <ArrowUpRight aria-hidden="true" />
              </Button>
            ) : null}
            {row.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" data-stop="" className="inline-flex items-center gap-1 rounded-sm text-[13px] underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground">
                {link.label}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ))}
          </p>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {[...(choices.length ? [[`1–${choices.length}`, 'answer']] : []), ['r', 'discuss'], ...(dismisses ? [['⌫', 'dismiss']] : []), ['↑ ↓', 'move'], ['enter', 'press'], ['esc', 'back']].map(([keys, does]) => (
              <span key={keys} className="flex items-center gap-1">
                <Kbd>{keys}</Kbd> {does}
              </span>
            ))}
            {sample && !row.answers ? <span>Sample: an answer stays in this window.</span> : null}
          </p>
        </article>
      </div>
    </div>
  )
}
