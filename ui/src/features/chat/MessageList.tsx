import { ArrowDown, Reply } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shellFields } from '#shared/protocol/snapshot.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { spring, stagger, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { DayGroup, Entry, MessageEntry, NoticeEntry } from './conversation.ts'
import { heldBy, type Holder } from './doing.ts'
import { MessageText, risen, StreamingMarkdown, sunk } from './markdown.ts'
import { nextReveal } from './stream-buffer.ts'
import type { PinnedScroll } from './use-pinned-scroll.ts'
import { StoredImages } from './StoredImages.tsx'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

/** What an entry says, whatever its key. A reply keeps it when its stored copy takes the place of the one written live. */
const wordsOf = (entry: Entry) => entry.kind === 'shell' ? `shell\n${entry.command}\n${entry.text}` : (entry.kind === 'message' ? `${entry.role}\n${entry.text}` : `${entry.tone}\n${entry.text}`)

/** A reply still held live: being written, or finished and waiting for hobkin to store it. Its blocks do the moving. */
const isLive = (entry: Entry) => entry.key.startsWith('live:')

/** Words that arrived within this long are still fading in. */
const FRESH_MS = 400

/** The least time between two pieces of a reply appearing. A line slower than this shows as soon as it is finished. */
const CADENCE_MS = 140

// What is above a new message glides up to make room. No bounce: it is the new message that lands.
const makeRoom = { layout: spring.sheet }

interface Drawn {
  epoch: number
  keys: Set<string>
  words: Set<string>
}

export interface MessageListProps {
  days: DayGroup[]
  /** Changes when the whole conversation was replaced, so a history that just loaded does not arrive piece by piece. */
  epoch: number
  scroll: PinnedScroll
  /** What to say when there is nothing to show. */
  empty: string
  /** A label over the conversation, such as "Sample data". */
  label?: string
}

/**
 * The conversation: days, messages, notices and the reply being written, following the newest unless the user
 * scrolled up. What arrives while the user is looking rises into place the way the pieces of a canvas screen
 * do, and what is above it makes room. What was already there when the conversation loaded does not move.
 */
export function MessageList({ days, epoch, scroll, empty, label }: MessageListProps) {
  const still = useStill()
  // What the last paint showed. Only what is new since then arrives with movement.
  const drawn = useRef<Drawn | null>(null)
  const before = drawn.current
  const moves = before !== null && before.epoch === epoch
  let arriving = 0
  const orderOf = (entry: Entry): number | null => {
    if (!moves || isLive(entry) || before.keys.has(entry.key) || before.words.has(wordsOf(entry))) return null
    return arriving++
  }

  // Before the browser paints, and before the rows are measured for their move: when a message arrives or the
  // conversation was replaced, the view goes to the newest message, so the rows above it are seen to travel there.
  // A reply growing inside its row is followed by the scroll itself. `arriving` is counted while the rows are drawn.
  const { stick } = scroll
  useLayoutEffect(() => {
    if (!moves || arriving > 0) stick()
  }, [days, stick])

  useEffect(() => {
    const entries = days.flatMap((day) => day.entries)
    drawn.current = { epoch, keys: new Set(entries.map(({ key }) => key)), words: new Set(entries.map(wordsOf)) }
  })

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scroll.scroller}
        onScroll={scroll.onScroll}
        role="log"
        aria-label="Messages"
        className="scroll-quiet h-full overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-3"
      >
        <ol ref={scroll.content} className="mx-auto flex max-w-[640px] flex-col gap-5 pb-4">
          {label ? (
            <li className="flex justify-center">
              <span className="eyebrow rounded-full bg-surface-2 px-2.5 py-1">{label}</span>
            </li>
          ) : null}
          {days.length === 0 ? <li className="py-10 text-center text-[14px] text-muted-foreground">{empty}</li> : null}
          {days.map((day) => (
            <li key={day.key}>
              <motion.h2
                layout="position"
                transition={makeRoom}
                className="eyebrow mb-3 flex items-center gap-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
              >
                {day.label}
              </motion.h2>
              <ol className="flex flex-col gap-4">
                {day.entries.map((entry) => (
                  <Row key={entry.key} entry={entry} order={orderOf(entry)} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <AnimatePresence>
          {scroll.pinned ? null : (
            <motion.button
              type="button"
              onClick={scroll.jumpToLatest}
              initial={holdStill({ opacity: 0, transform: 'translateY(10px) scale(0.96)' }, still)}
              animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }, still)}
              exit={holdStill({ opacity: 0, transform: 'translateY(10px) scale(0.96)', transition: tween.exit }, still)}
              className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-border bg-card pr-1.5 pl-3 text-[12px] font-medium shadow-panel outline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
              Newest
              <Kbd>⌘↓</Kbd>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** One entry. `order` is its place among the entries arriving now, or null when it was already there. */
function Row({ entry, order }: { entry: Entry; order: number | null }) {
  const still = useStill()
  const writing = entry.kind === 'message' && entry.state === 'writing'
  const text = useRevealed(entry.text, writing)
  // As before the first word, nothing is drawn before the first finished line.
  if (writing && !text) return null
  const mine = entry.kind === 'message' && entry.role === 'user'
  // Several arriving together land one after another.
  const delay = Math.min(order ?? 0, 6) * stagger
  return (
    // The row itself only ever changes place, to make room. The rise is on what it holds.
    <motion.li layout="position" transition={makeRoom} className="min-w-0">
      <motion.div
        initial={order === null ? false : holdStill(sunk, still)}
        animate={holdStill(risen, still)}
        transition={{ transform: { ...spring.rise, delay }, opacity: { ...tween.enter, delay } }}
        // A message grows from the side it was said on.
        style={{ transformOrigin: mine ? '100% 100%' : '0% 100%' }}
        className={cn('flex min-w-0', entry.kind !== 'notice' ? 'flex-col gap-1' : 'items-baseline gap-2', mine && 'items-end')}
      >
        {entry.kind === 'shell' ? <ShellTranscript message={{ role: 'bashExecution', ...entry }} at={entry.at} /> : entry.kind === 'message' ? <Message entry={{ ...entry, text }} mine={mine} /> : <Notice entry={entry} />}
      </motion.div>
    </motion.li>
  )
}

/** Current chat and saved History share the same literal native shell presentation. */
export function ShellTranscript({ message, at }: { message: unknown; at?: number | null }) {
  const shell = shellFields(message)
  if (!shell) return null
  const outcome = shell.cancelled ? 'Cancelled' : shell.exitCode === null ? 'Outcome unknown' : shell.exitCode === 0 ? 'Succeeded (exit 0)' : `Failed (exit ${shell.exitCode})`
  return (
    <section aria-label="Shell command" className="min-w-0 rounded-lg border border-border bg-surface-2 p-3">
      <div className="eyebrow mb-2 flex items-baseline gap-2">
        <span>Shell · {outcome}</span>
        {at == null ? null : <time dateTime={new Date(at).toISOString()}>{clock.format(at)}</time>}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px]">{shell.command}</pre>
      {shell.commandPreviewCut ? <p className="text-[12px] text-muted-foreground">Command preview cut</p> : null}
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[13px]">{shell.output || '(no output)'}</pre>
      {shell.truncated ? <p className="text-[12px] text-muted-foreground">Pi truncated the captured output</p> : null}
      {shell.outputPreviewCut ? <p className="text-[12px] text-muted-foreground">Output preview cut</p> : null}
    </section>
  )
}

const AUTHOR: Record<MessageEntry['role'], string> = { user: 'You', assistant: 'hobkin', note: 'Note' }

const HELD: Record<Holder, string> = {
  compacting: 'hobkin is compacting the conversation. Your message goes as soon as that ends.',
  turn: 'hobkin is finishing its turn. Your message goes as soon as that ends.',
}

function Message({ entry, mine }: { entry: MessageEntry; mine: boolean }) {
  const queued = entry.state === 'queued'
  // A message hobkin has not taken yet says what it waits behind, if anything. A message already taken never looks.
  const sentAt = queued ? entry.at : null
  const held = useHost((state) => (sentAt === null ? null : heldBy(state.snapshot, sentAt)))
  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">{AUTHOR[entry.role]}</span>
        {queued ? <span className="eyebrow rounded-full bg-surface-2 px-1.5 py-px text-foreground">{held ? 'Waiting' : 'Sending'}</span> : null}
        {entry.at === null ? null : (
          <time dateTime={new Date(entry.at).toISOString()} className="text-[11px] text-muted-foreground tabular-nums">
            {clock.format(entry.at)}
          </time>
        )}
      </div>
      {entry.about ? (
        <div className="mt-0.5 mb-1 flex max-w-[92%] items-center gap-1.5 text-[12px] text-code-fg">
          <Reply aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">About {entry.about}</span>
        </div>
      ) : null}
      {entry.text ? (
        <div
          aria-busy={entry.state === 'writing' || undefined}
          className={cn(
            'max-w-[92%] min-w-0 text-[15px] leading-relaxed break-words',
            mine && 'rounded-2xl rounded-br-md bg-secondary px-3.5 py-2',
            // A queued message waits in a lighter tone until hobkin takes it. Opacity only, so it costs no layout.
            'transition-opacity duration-[220ms] ease-[ease]',
            queued && 'opacity-60',
          )}
        >
          {isLive(entry) ? <WritingText text={entry.text} /> : <MessageText text={entry.text} role={entry.role} />}
        </div>
      ) : null}
      {held ? <p role="status" className="max-w-[92%] text-[12px] text-muted-foreground">{HELD[held]}</p> : null}
      {entry.images ? entry.key.startsWith('outbox:') ? <div className="text-[12px] text-muted-foreground">{entry.images === 1 ? '1 image' : `${entry.images} images`}</div> : <StoredImages messageId={entry.key} count={entry.images} /> : null}
    </>
  )
}

/**
 * What shows of a reply being written: whole lines and Markdown blocks, at most one piece every CADENCE_MS, so it
 * grows in steps that read rather than letter by letter (`stream-buffer.ts`). A finished reply shows whole at once.
 */
function useRevealed(text: string, writing: boolean): string {
  const [shown, setShown] = useState(() => nextReveal(text, '', !writing))
  const last = useRef(0)
  const next = writing ? nextReveal(text, shown, false) : text
  useEffect(() => {
    if (!writing || next === shown) return
    const timer = setTimeout(() => {
      last.current = performance.now()
      setShown(next)
    }, Math.max(0, last.current + CADENCE_MS - performance.now()))
    return () => clearTimeout(timer)
  }, [writing, next, shown])
  return writing ? shown : text
}

/** A reply as it arrives. It remembers where the latest words began, so they can fade in while the rest stays still. */
function WritingText({ text }: { text: string }) {
  const still = useStill()
  const seen = useRef<{ text: string; pieces: { from: number; at: number }[] }>({ text: '', pieces: [] })
  if (text !== seen.current.text) {
    const now = performance.now()
    const grew = text.startsWith(seen.current.text)
    const recent = grew ? seen.current.pieces.filter((piece) => now - piece.at < FRESH_MS) : []
    seen.current = { text, pieces: [...recent, { from: grew ? seen.current.text.length : 0, at: now }] }
  }
  return <StreamingMarkdown text={text} marks={seen.current.pieces.map(({ from }) => from)} still={still} />
}

const TONE_DOT: Record<NoticeEntry['tone'], string> = {
  critical: 'bg-bad',
  blocked: 'bg-warn',
  useful: 'bg-ok',
  quiet: 'bg-border-strong',
  system: 'bg-foreground',
}

const TONE_NAME: Record<NoticeEntry['tone'], string> = {
  critical: 'Critical',
  blocked: 'Blocked',
  useful: 'Useful',
  quiet: 'Notice',
  system: 'You',
}

function Notice({ entry }: { entry: NoticeEntry }) {
  const quiet = entry.tone === 'quiet'
  const { review } = entry
  return (
    <>
      {/* The tone is said in words for a screen reader, and shown as a color for the eye. */}
      <span className={cn('size-1.5 shrink-0 translate-y-[-2px] rounded-full', TONE_DOT[entry.tone])} aria-hidden="true" />
      <span className="sr-only">{TONE_NAME[entry.tone]}:</span>
      <span className={cn('min-w-0 flex-1 text-[13px] leading-snug break-words', quiet ? 'text-muted-foreground' : 'text-foreground')}>
        {entry.text}
        {entry.count > 1 ? <span className="ml-1.5 text-muted-foreground tabular-nums">×{entry.count}</span> : null}
        {review ? (
          <button
            type="button"
            className="ml-2 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2"
            onClick={() => useView.getState().openReviewFor(review)}
          >
            Open review
          </button>
        ) : null}
      </span>
      {entry.at === null ? null : (
        <time dateTime={new Date(entry.at).toISOString()} className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {clock.format(entry.at)}
        </time>
      )}
    </>
  )
}
