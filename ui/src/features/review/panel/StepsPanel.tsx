import { ChevronsRight } from 'lucide-react'
import { animate, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { useHost } from '@/lib/host/index.ts'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { targetLabel } from '../notes/notes.ts'
import { reviewMemory, useReduced, useReviewMemory, useRig, useSession, useSessionStore } from '../state/context.tsx'
import type { Size } from '../story/camera.ts'
import type { VerdictCommands } from '../verdict.ts'
import { Actions } from './Actions.tsx'
import { MENU, PanelHeader } from './Header.tsx'
import { HobkinBox } from './HobkinBox.tsx'
import { LevelBadge } from '../graph/kinds.tsx'
import { Matters, type StepUnit } from './Matters.tsx'
import { NoteButton, NoteEditor, NoteRow } from './notes.tsx'
import { reviewThread, reviewTrack, type TrackEntry } from './thread.ts'

export { NoteMarks } from './notes.tsx'

/** How much of the panel stays in view while it is tucked away. */
export const STEPS_STRIP = 52

/** The panel's width, for a canvas of a given width. It never takes more than what leaves the graph room to breathe. */
export function stepsPanelWidth(canvas: number): number {
  return Math.round(Math.max(248, Math.min(372, canvas * 0.3, canvas - 300)))
}

/** What the review screen hands the panel: whether it is live, how the preparation stands, the way out, and the verdict. */
export interface PanelChrome {
  live: boolean
  preparation: ReviewStatus | null
  rebuild: () => void
  close: () => void
  /** The host's own verdict commands, for a live review. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host, so a verdict the host shows is done with them as they are. */
  saveNotes?: () => Promise<void>
}

const HEADING = 'font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'

/**
 * The review panel, on the left of the review, full height. It reads in the reviewer's order (the user's, 2026-11-12):
 * the header says which project changes, the change's title and size, and opens a pull request's description; then
 * this step; then what matters here; then Hobkin, to ask; then the rest: comments and questions, the notes and what was
 * asked, the verdict, the commit range and the keys. The steps are walked from the bar at the bottom of the screen.
 *
 * It is always part of the screen. While the reviewer walks the story or moves the graph it tucks away, leaving a
 * strip, and it comes back whole when they go to it: the pointer over it, the keyboard in it, or the S key. The part
 * of it on screen counts as covered, so nothing is ever framed under it.
 *
 * Purpose of the motion: spatial consistency. The panel slides on the same spring as the canvas itself grows on, so a
 * pointer that leaves and comes straight back turns it round from where it is.
 */
export function StepsPanel({ canvas, chrome, unit }: { canvas: Size; chrome: PanelChrome; unit?: StepUnit }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const panel = useRef<HTMLElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const trackList = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const review = useSession((session) => session.review)
  const steps = useSession((session) => session.view.story)
  const current = useSession((session) => session.story.step)
  const seen = useSession((session) => session.story.seen.length)
  const moved = useSession((session) => session.move.key > 0)
  const editor = useSession((session) => session.editor)
  const notes = useSession((session) => session.notes)
  const focus = useSession((session) => session.focus)
  const nodeOf = useSession((session) => session.nodeOf)
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
  const focused = useMemo(() => focus.map((id) => nodeOf.get(id)).filter((node): node is ReviewNode => node != null), [focus, nodeOf])
  // The frame's menu floats over the top middle of the canvas. Where it covers the panel's top, the header flows around
  // it. On a canvas so narrow that too little would be left beside it, the header starts under it.
  const overlap = Math.max(0, Math.round(width - (canvas.width - MENU.width) / 2 + MENU.gap))
  const under = overlap > width - 150

  // A new step starts with its word folded.
  useEffect(() => setMore(false), [current])
  // The track keeps its newest entry in view, as a conversation does.
  useLayoutEffect(() => {
    const element = trackList.current
    if (element) element.scrollTop = element.scrollHeight
  }, [track.length])
  // A step or a node the reviewer arrives at is read from the top of the panel, unless they are working in it. Only an
  // arrival does this: closing the note editor leaves the panel where it is.
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element || editor || panel.current?.contains(document.activeElement)) return
    element.scrollTop = 0
  }, [current, focus])
  // The H key goes to the box, as clicking it does.
  useEffect(() => {
    const element = panel.current
    if (!element) return
    const talk = () => {
      box.current?.focus({ preventScroll: true })
      box.current?.scrollIntoView({ block: 'nearest' })
    }
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
      <motion.div className="flex min-h-0 flex-1 flex-col" style={{ opacity: dim, filter: blur, paddingTop: under ? MENU.bottom - 14 : 0 }}>
        <PanelHeader
          review={review}
          overlap={under ? 0 : overlap}
          pinned={pinned}
          onPin={() => reviewMemory.getState().setPanelPinned(!pinned)}
          onClose={chrome.close}
          live={chrome.live}
          preparation={chrome.preparation}
          rebuild={chrome.rebuild}
        />

        <div ref={scroller} className="rv-scroll min-h-0 flex-1 overflow-y-auto border-t border-border">
          {step ? (
            <section aria-label="This step" className="flex flex-col gap-1.5 px-4 pt-3.5 pb-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={HEADING}>
                  Step {current + 1} of {steps.length}
                </span>
                <span className="text-[12.5px] text-muted-foreground tabular-nums">
                  {seen} of {steps.length} seen
                </span>
                {step.level ? <LevelBadge level={step.level} /> : null}
                {path ? (
                  <span className="max-w-full truncate rounded-full bg-secondary px-2 py-0.5 text-[12px] font-medium" title={pathTest ? `The path of the test "${pathTest}"` : undefined}>
                    path {path.id.slice(1)}
                    {pathTest ? ` · ${pathTest}` : ''}
                  </span>
                ) : null}
              </div>
              <h3 className="font-heading text-[16px] leading-[1.3] font-semibold text-pretty">{step.title}</h3>
              {step.text ? (
                <button type="button" data-stop onClick={() => setMore((before) => !before)} className={cn('text-left text-[14px] leading-[1.55] text-pretty', !more && 'line-clamp-6')} title={more ? 'Show less' : 'Show all of it'}>
                  {step.text}
                </button>
              ) : null}
            </section>
          ) : null}

          <Matters nodes={focused} unit={unit} />

          <div className="border-t border-border px-4 py-3.5">
            <HobkinBox ref={box} review={review} live={chrome.live} step={step} node={pointed ?? focus[0]} notes={notes} />
          </div>

          <section aria-label="Comments and questions" className="flex flex-col gap-2.5 border-t border-border px-4 py-3.5">
            <h3 className={HEADING}>Comments and questions</h3>
            {editor ? (
              <NoteEditor review={review} target={targetLabel(review, editor.target)} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <NoteButton intent="comment" keys="N" onClick={() => store.getState().startNote('comment')} />
                <NoteButton intent="question" keys="D" onClick={() => store.getState().startNote('question')} />
              </div>
            )}
            <div ref={trackList} className="rv-scroll max-h-[320px] overflow-y-auto" aria-label="Notes and discussion">
              {track.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted-foreground">Your comments and questions, Hobkin's notes, and what you ask Hobkin about this review show here.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {track.map((entry) => (entry.kind === 'note' ? <NoteRow key={entry.id} note={entry.note} review={review} /> : <MessageRow key={entry.id} entry={entry} />))}
                </ol>
              )}
            </div>
          </section>

          <div className="border-t border-border px-4 py-3.5">
            <Actions review={review} notes={notes} live={chrome.live} step={step} node={pointed ?? focus[0]} close={chrome.close} verdict={chrome.verdict} saveNotes={chrome.saveNotes} />
          </div>

          <footer className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
            {review.notices.length > 0 || removed.length > 0 ? (
              <details>
                <summary className="cursor-default text-[12.5px]">{review.notices.length + (removed.length > 0 ? 1 : 0)} notes on this review</summary>
                <div className="mt-1 flex flex-col gap-1 text-[12.5px] leading-snug">
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
              <span className="truncate font-mono" title="The commits this review was built from">
                {review.change.base.slice(0, 7)}..{review.change.head.slice(0, 7)}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>?</Kbd> keys
              </span>
            </p>
          </footer>
        </div>
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

function MessageRow({ entry }: { entry: Extract<TrackEntry, { kind: 'message' }> }) {
  const [whole, setWhole] = useState(false)
  const hobkin = entry.who === 'hobkin'
  return (
    <li className={cn('flex flex-col gap-0.5 rounded-lg px-2.5 py-2', hobkin ? 'bg-[var(--rv-ask)]' : 'bg-background')}>
      <span className="font-heading text-[12px] font-semibold text-muted-foreground">{hobkin ? 'Hobkin' : 'You asked'}</span>
      <button type="button" data-stop onClick={() => setWhole((before) => !before)} className={cn('text-left text-[14px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap', !whole && 'line-clamp-6')}>
        {entry.text}
      </button>
    </li>
  )
}
