import { ChevronsRight } from 'lucide-react'
import { animate, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring } from '@/lib/motion.ts'
import { targetLabel } from '../notes/notes.ts'
import { reviewMemory, useReduced, useReviewMemory, useRig, useSession, useSessionStore } from '../state/context.tsx'
import type { Size } from '../story/camera.ts'
import type { VerdictCommands } from '../verdict.ts'
import { Actions } from './Actions.tsx'
import type { AskCommand } from './ask.ts'
import { MENU, PanelHeader } from './Header.tsx'
import { HobkinBox } from './HobkinBox.tsx'
import { NoteButton, NoteEditor, NoteRow } from './notes.tsx'

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
  /** The change review of a finished change, once it is ready. */
  assessment: ChangeAssessment | null
  rebuild: () => void
  close: () => void
  /** The host's own verdict commands, for a live review. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host, so a verdict the host shows is done with them as they are. */
  saveNotes?: () => Promise<void>
  /** Sends to hobkin, for a live review. */
  ask: AskCommand | null
  /** Hears of a verdict the host did. */
  landed?: (verdict: Verdict, message: string) => void
}

const HEADING = 'font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'

/**
 * The review panel, on the left of the review, full height. Its top is the same for the whole review: which project
 * changes, the title, what the change does, its overall risk, its size and commits. Under it, only the step the
 * reviewer is on, by its number and name; the step's explanation is in its node on the graph, and the code panel
 * explains each unit beside its code. Then Hobkin, to ask, on a darker band with the conversation about this review;
 * then the comments and questions, the verdict, and the keys.
 *
 * It is always part of the screen. While the reviewer walks the graph it tucks away, leaving a strip, and it comes back
 * whole when they go to it: the pointer over it, the keyboard in it, the S key, or a message to hobkin, until they go
 * back to the graph. The part of it on screen counts as covered, so nothing is ever framed under it.
 *
 * Purpose of the motion: spatial consistency. The panel slides on the same spring as the canvas itself grows on, so a
 * pointer that leaves and comes straight back turns it round from where it is.
 */
export function StepsPanel({ canvas, chrome }: { canvas: Size; chrome: PanelChrome }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const panel = useRef<HTMLElement>(null)
  const noteList = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const review = useSession((session) => session.review)
  const steps = useSession((session) => session.view.story)
  const current = useSession((session) => session.story.step)
  const moved = useSession((session) => session.move.key > 0)
  const editor = useSession((session) => session.editor)
  const notes = useSession((session) => session.notes)
  const removed = useSession((session) => session.view.removed)
  const talking = useSession((session) => session.talking)
  const pinned = useReviewMemory((memory) => memory.panelPinned)
  const [hover, setHover] = useState(false)
  const [within, setWithin] = useState(false)

  const width = stepsPanelWidth(canvas.width)
  // Whole when the reviewer is at it or asked to keep it, while they talk to hobkin, and before their first move, when
  // it introduces the review.
  const open = pinned || hover || within || talking || editor != null || !moved
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
  // The notes in the order they were written, the newest last.
  const listed = useMemo(() => [...notes].sort((a, b) => a.at - b.at), [notes])
  // The frame's menu floats over the top middle of the canvas. Where it covers the panel's top, the header flows around
  // it. On a canvas so narrow that too little would be left beside it, the header starts under it.
  const overlap = Math.max(0, Math.round(width - (canvas.width - MENU.width) / 2 + MENU.gap))
  const under = overlap > width - 150

  // The list keeps its newest note in view.
  useLayoutEffect(() => {
    const element = noteList.current
    if (element) element.scrollTop = element.scrollHeight
  }, [listed.length])
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
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setWithin(false)
      }}
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
          assessment={chrome.assessment}
          rebuild={chrome.rebuild}
        />
        {step ? (
          <p className="flex min-w-0 items-baseline gap-1.5 border-t border-border px-4 py-2.5 text-[13.5px]" title={step.title}>
            <span className="shrink-0 font-heading font-semibold text-muted-foreground tabular-nums">
              Step {current + 1} of {steps.length}:
            </span>
            <span className="min-w-0 truncate font-medium">{step.title}</span>
          </p>
        ) : null}

        <div className="rv-scroll min-h-0 flex-1 overflow-y-auto">
          <HobkinBox ref={box} review={review} ask={chrome.ask} notes={notes} />

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
            <div ref={noteList} className="rv-scroll max-h-[320px] overflow-y-auto" aria-label="Notes">
              {listed.length === 0 ? (
                <p className="text-[13px] leading-snug text-muted-foreground">Your comments and questions, and Hobkin's notes, show here. Comments go with the verdict.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {listed.map((note) => (
                    <NoteRow key={note.id} note={note} review={review} />
                  ))}
                </ol>
              )}
            </div>
          </section>

          <div className="border-t border-border px-4 py-3.5">
            <Actions review={review} notes={notes} live={chrome.live} verdict={chrome.verdict} saveNotes={chrome.saveNotes} {...(chrome.landed ? { landed: chrome.landed } : {})} />
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
            <p className="flex items-center justify-end gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>?</Kbd> keys
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
