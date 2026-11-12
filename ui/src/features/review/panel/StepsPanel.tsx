import { ChevronsRight } from 'lucide-react'
import { animate, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { ReviewStatus } from '#shared/review/status.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring } from '@/lib/motion.ts'
import { targetLabel } from '../notes/notes.ts'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import type { Size } from '../story/camera.ts'
import type { VerdictCommands } from '../verdict.ts'
import { Actions } from './Actions.tsx'
import type { AskCommand } from './ask.ts'
import { MENU, PanelHeader } from './Header.tsx'
import { HobkinBox } from './HobkinBox.tsx'
import { NoteButton, NoteEditor, NoteRow } from './notes.tsx'
import { askExample, stepBrief, whatMatters } from './sidebar.ts'
import { ThisStep } from './ThisStep.tsx'
import { useAskHobkin } from './use-ask.ts'
import { WhatMatters } from './WhatMatters.tsx'

export { NoteMarks } from './notes.tsx'

/** How much of the panel stays in view while it is hidden. */
export const STEPS_STRIP = 52

/** The panel's width, for a canvas of a given width. It never takes more than what leaves the graph room to breathe. */
export function stepsPanelWidth(canvas: number): number {
  return Math.round(Math.max(248, Math.min(372, canvas * 0.3, canvas - 300)))
}

/** What the review screen hands the panel: whether it is live, how the preparation stands, the way out, and the verdict. */
export interface PanelChrome {
  live: boolean
  preparation: ReviewStatus | null
  /** The change review, once it is ready. */
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

const HEADING = 'font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'

/**
 * The review panel, on the left of the review, full height, in the order the user reads a review (2026-11-12: "the
 * order is: this step > description that matters for me > agent I can ping and ask > other info"). At its top, the
 * same for the whole review: which project changes, the title with its overall risk, its size and its commits. Under
 * it, held in place, the step the reviewer is on. Then, scrolling: what matters in the change, hobkin to ask on a band
 * of its own, the comments and questions, the verdict, and the keys.
 *
 * It stays open. The reviewer can hide it, with its chevron or S, to give the graph its width: a strip is left that
 * brings it back. Hidden, it comes back while they are in it: the keyboard in it, a message to hobkin, a note being
 * written. The part of it on screen counts as covered, so nothing is ever framed under it.
 *
 * Purpose of the motion: spatial consistency. It slides on the same spring as the canvas grows on, so hiding it and
 * bringing it straight back turns it round from where it is. Nothing in it is dimmed or blurred on the way.
 */
export function StepsPanel({ canvas, chrome }: { canvas: Size; chrome: PanelChrome }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const panel = useRef<HTMLElement>(null)
  const noteList = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const review = useSession((session) => session.review)
  const steps = useSession((session) => session.view.story)
  const nodes = useSession((session) => session.view.nodes)
  const current = useSession((session) => session.story.step)
  const hasCode = useSession((session) => session.focus.length > 0)
  // The node the reviewer is on, for the example of what to ask.
  const on = useSession((session) => {
    const id = session.pointed ?? session.focus[0]
    return id ? session.nodeOf.get(id) : undefined
  })
  const editor = useSession((session) => session.editor)
  const notes = useSession((session) => session.notes)
  const removed = useSession((session) => session.view.removed)
  const talking = useSession((session) => session.talking)
  const [hidden, setHidden] = useState(false)
  const [within, setWithin] = useState(false)

  const width = stepsPanelWidth(canvas.width)
  const open = !hidden || within || talking || editor != null
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
  // The strip covers what the panel holds as it goes, and leaves as it comes back.
  const strip = useTransform(() => 1 - Math.max(0, Math.min(1, (rig.side.get() - STEPS_STRIP) / Math.max(1, width - STEPS_STRIP))))

  const units = chrome.assessment?.units?.units
  const brief = useMemo(() => stepBrief(steps, current, units, nodes), [current, nodes, steps, units])
  const matters = useMemo(() => whatMatters(review, chrome.assessment, steps, nodes), [chrome.assessment, nodes, review, steps])
  const ask = useAskHobkin(chrome.ask)
  // A quick link's words go to hobkin at once, and the conversation comes into view to show them.
  const askFromList = useMemo(
    () =>
      ask
        ? (words: string) => {
            band.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
            return ask(words)
          }
        : null,
    [ask, reduced],
  )

  // The notes in the order they were written, the newest last.
  const listed = useMemo(() => [...notes].sort((a, b) => a.at - b.at), [notes])
  // The frame's menu floats over the top middle of the canvas. Where it covers the panel's top, the header flows around
  // it. On a canvas so narrow that too little would be left beside it, the header starts under it.
  const overlap = Math.max(0, Math.round(width - (canvas.width - MENU.width) / 2 + MENU.gap))
  const under = overlap > width - 150

  const hide = () => {
    setHidden(true)
    // Whatever held it open lets go: the conversation, a note being written (its words wait as a draft), and the
    // keyboard, which goes back to the graph.
    store.getState().setTalking(false)
    if (store.getState().editor) store.getState().closeEditor()
    panel.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  }
  const toggle = useRef(hide)
  toggle.current = hidden ? () => setHidden(false) : hide

  // The list keeps its newest note in view.
  useLayoutEffect(() => {
    const element = noteList.current
    if (element) element.scrollTop = element.scrollHeight
  }, [listed.length])
  // H goes to hobkin's field, as clicking it does. S (`rv-toggle`) hides the panel, or brings it back.
  useEffect(() => {
    const element = panel.current
    if (!element) return
    const talk = () => {
      box.current?.focus({ preventScroll: true })
      box.current?.scrollIntoView({ block: 'nearest' })
    }
    const flip = () => toggle.current()
    element.addEventListener('rv-talk', talk)
    element.addEventListener('rv-toggle', flip)
    return () => {
      element.removeEventListener('rv-talk', talk)
      element.removeEventListener('rv-toggle', flip)
    }
  }, [])

  return (
    <motion.aside
      ref={panel}
      aria-label="Review"
      data-rv-steps
      data-open={open}
      className="rv-steps absolute top-0 bottom-0 left-0 z-[15] flex flex-col"
      style={{ width, transform: place }}
      onFocus={() => setWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setWithin(false)
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: under ? MENU.bottom - 14 : 0 }}>
        <PanelHeader
          review={review}
          overlap={under ? 0 : overlap}
          onHide={hide}
          onClose={chrome.close}
          live={chrome.live}
          preparation={chrome.preparation}
          assessment={chrome.assessment}
          rebuild={chrome.rebuild}
        />
        {brief ? <ThisStep brief={brief} code={hasCode} /> : null}

        <div className="rv-scroll min-h-0 flex-1 overflow-y-auto">
          <WhatMatters matters={matters} ask={askFromList} />

          <div ref={band} className="scroll-my-2">
            <HobkinBox ref={box} review={review} ask={chrome.ask} notes={notes} example={askExample(brief, on)} />
          </div>

          <section aria-label="Comments and questions" className="flex flex-col gap-2.5 px-4 pt-4 pb-3.5">
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
                <p className="text-[14px] leading-snug text-pretty text-muted-foreground">Your comments and questions, and hobkin's notes, show here. Comments go with the verdict. Choose one to read it beside its node.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {listed.map((note) => (
                    <NoteRow key={note.id} note={note} review={review} />
                  ))}
                </ol>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-2.5 border-t border-border px-4 pt-3.5 pb-4">
            <h3 className={HEADING}>Verdict</h3>
            <Actions review={review} notes={notes} live={chrome.live} verdict={chrome.verdict} saveNotes={chrome.saveNotes} {...(chrome.landed ? { landed: chrome.landed } : {})} />
          </div>

          <footer className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
            {review.notices.length > 0 || removed.length > 0 ? (
              <details>
                <summary className="cursor-default text-[13px]">{review.notices.length + (removed.length > 0 ? 1 : 0)} notes on this review</summary>
                <div className="mt-1 flex flex-col gap-1 text-[13px] leading-snug">
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
      </div>

      {/* Hidden, the strip says the panel is there and brings it back. */}
      <motion.div
        aria-hidden={open}
        inert={open}
        className="rv-strip absolute inset-y-0 right-0 flex flex-col items-center gap-3 pt-3"
        style={{ width: STEPS_STRIP, opacity: strip, pointerEvents: open ? 'none' : 'auto' }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-stop
                aria-label="Show the panel"
                onClick={() => setHidden(false)}
                className="grid size-9 place-items-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-[0.94] [&_svg]:size-4"
              />
            }
          >
            <ChevronsRight />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            Show the panel <Kbd>S</Kbd>
          </TooltipContent>
        </Tooltip>
        <span className="font-heading text-[12.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase [writing-mode:vertical-rl]">Review</span>
      </motion.div>
    </motion.aside>
  )
}
