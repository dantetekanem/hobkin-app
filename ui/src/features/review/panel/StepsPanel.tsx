import { ChevronsRight, Pin, RefreshCw, X } from 'lucide-react'
import { animate, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { targetLabel } from '../notes/notes.ts'
import { reviewMemory, useReduced, useReviewMemory, useRig, useSession, useSessionStore } from '../state/context.tsx'
import type { Size } from '../story/camera.ts'
import { Actions } from './Actions.tsx'
import { HobkinBox } from './HobkinBox.tsx'
import { NoteButton, NoteEditor, NoteRow } from './notes.tsx'
import { reviewThread, reviewTrack, type TrackEntry } from './thread.ts'

export { NoteMarks } from './notes.tsx'

/** How much of the panel stays in view while it is tucked away. */
export const STEPS_STRIP = 52

/** The panel's width, for a canvas of a given width. It never takes more than what leaves the graph room to breathe. */
export function stepsPanelWidth(canvas: number): number {
  return Math.round(Math.max(248, Math.min(372, canvas * 0.3, canvas - 300)))
}

/** What the review screen hands the panel: whether it is live, how the preparation stands, and the way out. */
export interface PanelChrome {
  live: boolean
  preparation: ReviewStatus | null
  rebuild: () => void
  close: () => void
}

/**
 * The review panel: a quick window to talk with hobkin while walking the change, on the left of the review, full
 * height. From the top: the change and whether its review is outdated, the track of every note and of what the
 * reviewer asked hobkin, the step the reviewer is on with a short word on it, the box to ask hobkin, and the verdict.
 * The steps themselves are walked from the bar at the bottom of the screen, and the keys are on ⌘?.
 *
 * It is always part of the screen. While the reviewer walks the story or moves the graph it tucks away, leaving a
 * strip, and it comes back whole when they go to it: the pointer over it, the keyboard in it, or the S key. The part
 * of it on screen counts as covered, so nothing is ever framed under it.
 *
 * Purpose of the motion: spatial consistency. The panel slides on the same spring as the canvas itself grows on, so a
 * pointer that leaves and comes straight back turns it round from where it is.
 */
export function StepsPanel({ canvas, chrome }: { canvas: Size; chrome: PanelChrome }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const panel = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const review = useSession((session) => session.review)
  const steps = useSession((session) => session.view.story)
  const current = useSession((session) => session.story.step)
  const moved = useSession((session) => session.move.key > 0)
  const editor = useSession((session) => session.editor)
  const notes = useSession((session) => session.notes)
  const focus = useSession((session) => session.focus)
  const pointed = useSession((session) => session.pointed)
  const removed = useSession((session) => session.view.removed)
  const pinned = useReviewMemory((memory) => memory.panelPinned)
  const messages = useHost((state) => state.messages)
  const [hover, setHover] = useState(false)
  const [within, setWithin] = useState(false)
  const [more, setMore] = useState(false)

  const width = stepsPanelWidth(canvas.width)
  // Whole when the reviewer is at it or asked to keep it, and before their first move, when it introduces the review.
  const open = pinned || hover || within || editor != null || !moved
  useEffect(() => store.getState().setPanelOpen(open), [open, store])

  // How much of the panel is on screen. The camera reads this as covered, and the panel reads its own place from it.
  useEffect(() => {
    const visible = open ? width : STEPS_STRIP
    if (reduced) {
      rig.side.jump(visible)
      return
    }
    const playing = animate(rig.side, visible, spring.screen)
    return () => playing.stop()
  }, [open, reduced, rig, width])
  const place = useTransform(() => `translateX(${Math.min(0, rig.side.get() - width)}px)`)
  const openness = useTransform(() => Math.max(0, Math.min(1, (rig.side.get() - STEPS_STRIP) / Math.max(1, width - STEPS_STRIP))))
  // Tucked, it steps back the way the chat does under a canvas that has grown: dimmed and a little blurred.
  const dim = useTransform(() => 0.36 + 0.64 * openness.get())
  const blur = useTransform(() => (reduced ? 'none' : `blur(${((1 - openness.get()) * 2.4).toFixed(2)}px)`))
  const hint = useTransform(() => 1 - openness.get())

  const step = steps[current]
  const track = useMemo(() => reviewTrack(notes, reviewThread(messages, review.change.title)), [messages, notes, review.change.title])
  const path = step?.path ? review.paths?.find((entry) => entry.id === step.path) : undefined
  const pathTest = path ? review.nodes.find((node) => node.id === path.test)?.title : undefined
  // The frame's menu floats over the top middle of the canvas. On a narrow canvas the panel starts under it.
  const underMenu = (canvas.width - 560) / 2 < width

  // A new step starts with its word folded.
  useEffect(() => setMore(false), [current])
  // The track keeps its newest entry in view, as a conversation does.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [track.length])
  // The H key goes to the box, as clicking it does.
  useEffect(() => {
    const element = panel.current
    if (!element) return
    const talk = () => box.current?.focus({ preventScroll: true })
    element.addEventListener('rv-talk', talk)
    return () => element.removeEventListener('rv-talk', talk)
  }, [])

  return (
    <motion.aside
      ref={panel}
      aria-label="Review"
      data-rv-steps
      data-open={open}
      className="rv-steps absolute top-0 bottom-0 left-0 z-[15] flex flex-col"
      style={{ width, transform: place }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setWithin(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setWithin(false)}
    >
      <motion.div className="flex min-h-0 flex-1 flex-col" style={{ opacity: dim, filter: blur, paddingTop: underMenu ? 108 : 14 }}>
        <header className="flex flex-col gap-2 px-4 pb-3">
          <div className="flex items-start gap-1.5">
            <h2 className="min-w-0 flex-1 font-heading text-[15px] leading-[1.25] font-semibold tracking-[-0.02em] text-balance">{review.change.title}</h2>
            <RoundToggle label={pinned ? 'Let this panel tuck away (S)' : 'Keep this panel open (S)'} pressed={pinned} onClick={() => reviewMemory.getState().setPanelPinned(!pinned)}>
              <Pin />
            </RoundToggle>
            <RoundToggle label="Close the review (Esc)" onClick={chrome.close}>
              <X />
            </RoundToggle>
          </div>
          <Outdated review={review} preparation={chrome.preparation} live={chrome.live} rebuild={chrome.rebuild} />
        </header>

        <div ref={scroller} className="rv-scroll min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-3" aria-label="Notes and discussion">
          {track.length === 0 ? (
            <p className="text-[12.5px] leading-snug text-muted-foreground">Your comments and questions, Hobkin's notes, and what you ask Hobkin about this review show here.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {track.map((entry) => (entry.kind === 'note' ? <NoteRow key={entry.id} note={entry.note} review={review} /> : <MessageRow key={entry.id} entry={entry} />))}
            </ol>
          )}
        </div>

        <section aria-label="This step" className="flex flex-col gap-2.5 border-t border-border px-4 pt-3 pb-3">
          {step ? (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 font-heading text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                Step {current + 1} of {steps.length}
                {path ? (
                  <span className="truncate rounded-full bg-secondary px-1.5 py-px font-medium tracking-normal normal-case" title={pathTest ? `The path of the test "${pathTest}"` : undefined}>
                    path {path.id.slice(1)}
                    {pathTest ? ` · ${pathTest}` : ''}
                  </span>
                ) : null}
              </p>
              <p className="font-heading text-[13.5px] leading-[1.3] font-semibold">{step.title}</p>
              {step.text ? (
                <button type="button" data-stop onClick={() => setMore((before) => !before)} className={cn('text-left text-[13px] leading-[1.5] text-pretty', !more && 'line-clamp-4')} title={more ? 'Show less' : 'Show all of it'}>
                  {step.text}
                </button>
              ) : null}
            </div>
          ) : null}
          {editor ? (
            <NoteEditor review={review} target={targetLabel(review, editor.target)} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <NoteButton intent="comment" keys="N" onClick={() => store.getState().startNote('comment')} />
              <NoteButton intent="question" keys="D" onClick={() => store.getState().startNote('question')} />
            </div>
          )}
          <HobkinBox ref={box} review={review} live={chrome.live} step={step} node={pointed ?? focus[0]} notes={notes} />
        </section>

        <section className="border-t border-border px-4 pt-3 pb-2.5">
          <Actions review={review} notes={notes} live={chrome.live} step={step} node={pointed ?? focus[0]} close={chrome.close} />
        </section>

        <footer className="flex flex-col gap-1 px-4 pb-3 text-[11px] text-muted-foreground">
          {review.notices.length > 0 || removed.length > 0 ? (
            <details>
              <summary className="cursor-default">{review.notices.length + (removed.length > 0 ? 1 : 0)} notes on this review</summary>
              <div className="mt-1 flex flex-col gap-1">
                {review.notices.map((notice) => (
                  <p key={notice}>{notice}</p>
                ))}
                {removed.length > 0 ? (
                  <p>
                    {removed.length === 1 ? 'One proposed wire is removed.' : `${removed.length} proposed wires are removed.`}{' '}
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => removed.forEach((edge) => store.getState().decideWire(edge.id, null))}>
                      Bring {removed.length === 1 ? 'it' : 'them'} back
                    </button>
                  </p>
                ) : null}
              </div>
            </details>
          ) : null}
          <p className="flex items-center justify-between gap-2">
            <span className="truncate font-mono">
              {review.change.base.slice(0, 7)}..{review.change.head.slice(0, 7)} · {review.change.files} files <span className="text-ok-fg">+{review.change.additions}</span> <span className="text-bad-fg">−{review.change.deletions}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>?</Kbd> keys
            </span>
          </p>
        </footer>
      </motion.div>
      {/* Tucked away, the strip says the panel is there and how to bring it back. */}
      <motion.div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-center gap-2 pt-[120px] text-muted-foreground" style={{ width: STEPS_STRIP, opacity: hint }}>
        <ChevronsRight className="size-4" />
        <span className="font-heading text-[11px] font-semibold tracking-[0.08em] uppercase [writing-mode:vertical-rl]">Hobkin</span>
        <Kbd>S</Kbd>
      </motion.div>
    </motion.aside>
  )
}

function RoundToggle({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-stop
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.94] [&_svg]:size-3.5',
        pressed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

/** Says when the review was built for an older commit than the change is at now, and offers to build it again. */
function Outdated({ review, preparation, live, rebuild }: { review: Review; preparation: ReviewStatus | null; live: boolean; rebuild: () => void }) {
  if (!live || !preparation) return null
  const rebuilding = preparation.phase != null
  const moved = preparation.head != null && preparation.head !== review.change.head
  if (!moved && !rebuilding) return null
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl bg-sun/15 px-2.5 py-2 text-[12px] leading-snug text-sun-fg">
      <p className="min-w-0 flex-1">
        {rebuilding
          ? `Building the review again${preparation.head ? ` for ${preparation.head.slice(0, 7)}` : ''}. This one stays open until it is ready.`
          : `Outdated. Built for ${review.change.head.slice(0, 7)}, and the change is now at ${preparation.head!.slice(0, 7)}.`}
      </p>
      {rebuilding ? null : (
        <Button size="sm" variant="outline" data-stop className="h-6 shrink-0 px-2 text-[11.5px]" onClick={rebuild}>
          <RefreshCw />
          Rebuild
        </Button>
      )}
    </div>
  )
}

function MessageRow({ entry }: { entry: Extract<TrackEntry, { kind: 'message' }> }) {
  const [whole, setWhole] = useState(false)
  const hobkin = entry.who === 'hobkin'
  return (
    <li className={cn('flex flex-col gap-0.5 rounded-lg px-2.5 py-2', hobkin ? 'bg-secondary' : 'bg-background')}>
      <span className="font-heading text-[11px] font-semibold text-muted-foreground">{hobkin ? 'Hobkin' : 'You asked'}</span>
      <button type="button" data-stop onClick={() => setWhole((before) => !before)} className={cn('text-left text-[13px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap', !whole && 'line-clamp-6')}>
        {entry.text}
      </button>
    </li>
  )
}
