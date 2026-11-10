import { Check, ChevronsRight, CircleHelp, MessageSquare, Pencil, Pin, Trash2 } from 'lucide-react'
import { animate, motion, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Review, StoryStep } from '#shared/review/types.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { sampleHandoff } from '../notes/handoff.ts'
import { discussionMessage, targetLabel, type Note, type NoteIntent } from '../notes/notes.ts'
import { foldSteps } from '../notes/steps.ts'
import { reviewMemory, useReduced, useReviewMemory, useRig, useSession, useSessionStore } from '../state/context.tsx'
import type { Size } from '../story/camera.ts'

/** How much of the panel stays in view while it is tucked away. */
export const STEPS_STRIP = 52

/** The panel's width, for a canvas of a given width. It never takes more than what leaves the graph room to breathe. */
export function stepsPanelWidth(canvas: number): number {
  return Math.round(Math.max(232, Math.min(344, canvas * 0.28, canvas - 300)))
}

/** The keys of the review, in the order a reviewer meets them. */
const KEYS: [keys: string, does: string][] = [
  ['→  space', 'Next step'],
  ['←', 'Previous step'],
  ['1 … 9  0', 'Step 1 to 9, and 10. Two digits make one number'],
  ['home  end', 'First and last step'],
  ['/', 'Find a node by name, path or kind'],
  ['↑  ↓', 'The node above or below'],
  ['⇧←  ⇧→', 'Along a wire to the left or right'],
  [',  .', 'Back and forward through where you jumped'],
  ['B', 'Back to the step'],
  ['G', 'The whole graph'],
  ['↵', 'Open the code of the focus'],
  ['N  C', 'A comment on what you are on'],
  ['D', 'A question for hobkin'],
  ['H', 'Hand the questions to hobkin'],
  ['S', 'To this panel, and back'],
  ['W', 'Walk the wires of the focus'],
  ['Y  R', 'Confirm or remove the open wire'],
  ['esc', 'One level back: the code, a detour, the step, then the review'],
]

/**
 * The steps panel: how the change is built, on the left of the review, full height.
 * The story's summary comes first, then every step by number and title. The current step is highlighted,
 * with its text and its notes under it. Below are the review's facts and its keys.
 *
 * It is always part of the screen. While the reviewer walks the story or moves the graph it tucks away,
 * leaving a strip, and it comes back whole when they go to it: the pointer over it, the keyboard in it,
 * or the 1 key. The part of it on screen counts as covered, so nothing is ever framed under it.
 *
 * Purpose of the motion: spatial consistency. The panel slides on the same spring as the canvas itself
 * grows on, so a pointer that leaves and comes straight back turns it round from where it is.
 */
export function StepsPanel({ canvas }: { canvas: Size }) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const panel = useRef<HTMLElement>(null)
  const review = useSession((session) => session.review)
  const steps = useSession((session) => session.view.story)
  const current = useSession((session) => session.story.step)
  const seen = useSession((session) => session.story.seen)
  const moved = useSession((session) => session.move.key > 0)
  const editor = useSession((session) => session.editor)
  const notes = useSession((session) => session.notes)
  const counts = useSession((session) => session.counts)
  const removed = useSession((session) => session.view.removed)
  const pinned = useReviewMemory((memory) => memory.panelPinned)
  const [hover, setHover] = useState(false)
  const [within, setWithin] = useState(false)
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set())
  const [handing, setHanding] = useState<{ message: string; ids: string[] } | null>(null)
  const [handed, setHanded] = useState<number | null>(null)

  const width = stepsPanelWidth(canvas.width)
  // Whole when the reviewer is at it or asked to keep it, and before their first move, when it introduces the review.
  const open = pinned || hover || within || editor != null || handing != null || !moved
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

  const items = useMemo(() => foldSteps(steps.length, current, opened), [current, opened, steps.length])
  const questions = notes.filter((note) => note.intent === 'question' && note.sent == null)
  // The frame's menu floats over the top middle of the canvas. On a narrow canvas the panel starts under it.
  const underMenu = (canvas.width - 560) / 2 < width

  // The arrows walk the panel's controls, as they walk a terminal's. Tab is the frame's.
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || (event.target as HTMLElement).closest('textarea')) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-stop]')].filter((stop) => !stop.hasAttribute('disabled'))
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next = stops[event.key === 'ArrowDown' ? Math.min(stops.length - 1, at + 1) : Math.max(0, at - 1)]
    next?.focus()
    next?.scrollIntoView({ block: 'nearest' })
    event.preventDefault()
    event.stopPropagation()
  }

  // The keyboard follows the story: with the keyboard on a step, Left and Right keep it on the current one.
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.dataset.step != null && panel.current?.contains(active)) {
      panel.current.querySelector<HTMLElement>(`[data-step="${current}"]`)?.focus()
    }
  }, [current])

  const handOver = useRef<HTMLButtonElement>(null)
  const discuss = () => {
    const message = discussionMessage(review, notes)
    if (message) setHanding({ message, ids: questions.map((note) => note.id) })
  }
  // What would be sent comes into view with the keyboard on its button, so Enter hands it over and Escape does not.
  useEffect(() => {
    if (!handing) return
    handOver.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    handOver.current?.focus({ preventScroll: true })
  }, [handing, reduced])
  useEffect(() => {
    const element = panel.current
    if (!element) return
    // The H key asks for the same thing as the button.
    const onDiscuss = () => discuss()
    element.addEventListener('rv-discuss', onDiscuss)
    return () => element.removeEventListener('rv-discuss', onDiscuss)
  })

  return (
    <motion.aside
      ref={panel}
      aria-label="Steps"
      data-rv-steps
      data-open={open}
      className="rv-steps absolute top-0 bottom-0 left-0 z-[15] flex flex-col"
      style={{ width, transform: place }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setWithin(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setWithin(false)}
      onKeyDown={onKeyDown}
    >
      <motion.div className="rv-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-5" style={{ opacity: dim, filter: blur, paddingTop: underMenu ? 108 : 18 }}>
        <header className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 font-heading text-[16px] leading-[1.25] font-semibold tracking-[-0.02em] text-balance">{review.change.title}</h2>
            <button
              type="button"
              data-stop
              aria-pressed={pinned}
              aria-label={pinned ? 'Let this panel tuck away' : 'Keep this panel open'}
              title={pinned ? 'Let this panel tuck away (S)' : 'Keep this panel open (S)'}
              onClick={() => reviewMemory.getState().setPanelPinned(!pinned)}
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.94] [&_svg]:size-3.5',
                pinned ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary',
              )}
            >
              <Pin />
            </button>
          </div>
          {review.summary ? <p className="text-[13.5px] leading-[1.5] text-pretty text-muted-foreground">{review.summary}</p> : null}
        </header>

        <ol className="flex flex-col gap-0.5">
          {items.map((item) =>
            item.type === 'fold' ? (
              <li key={`fold${item.from}`}>
                <button
                  type="button"
                  data-stop
                  onClick={() => setOpened((before) => new Set(before).add(item.from))}
                  className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left font-heading text-[12px] text-muted-foreground hover:bg-secondary"
                >
                  <span className="grid size-5 shrink-0 place-items-center">⋯</span>
                  {item.from + 1} to {item.to + 1} · {item.count} more
                </button>
              </li>
            ) : (
              <StepRow
                key={steps[item.index]!.id}
                step={steps[item.index]!}
                index={item.index}
                current={item.index === current}
                seen={seen.includes(steps[item.index]!.id)}
                marks={counts.steps[steps[item.index]!.id]}
                review={review}
                notes={item.index === current ? notes.filter((note) => note.step === steps[item.index]!.id) : []}
              />
            ),
          )}
        </ol>

        <section className="flex flex-col gap-2 border-t border-border pt-3.5">
          {handing ? (
            <div className="flex flex-col gap-2">
              <p className="eyebrow">What hobkin will get</p>
              <pre className="rv-scroll max-h-56 overflow-y-auto rounded-xl bg-secondary p-3 font-sans text-[12.5px] leading-[1.5] whitespace-pre-wrap">{handing.message}</pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={handOver}
                  size="sm"
                  data-stop
                  onClick={() => {
                    void sampleHandoff.discuss(review.id, handing.message).then(() => {
                      reviewMemory.getState().markSent(review, handing.ids, Date.now())
                      setHanded(handing.ids.length)
                      setHanding(null)
                    })
                  }}
                >
                  Hand them over
                </Button>
                <Button size="sm" variant="outline" data-stop onClick={() => setHanding(null)}>
                  Not yet
                </Button>
                <span className="self-center text-[11.5px] text-muted-foreground">Comments stay here for the verdict.</span>
              </div>
            </div>
          ) : (
            <>
              <Button size="sm" variant={questions.length > 0 ? 'default' : 'outline'} disabled={questions.length === 0} data-stop onClick={discuss} className="self-start">
                <CircleHelp />
                Discuss with hobkin
                {questions.length > 0 ? <span className="tabular-nums">{questions.length}</span> : null}
                <Kbd className={questions.length > 0 ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>H</Kbd>
              </Button>
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                {handed != null
                  ? `${handed === 1 ? 'One question was' : `${handed} questions were`} handed over. This is sample data, so nothing was sent: the host will put the message in the conversation.`
                  : questions.length === 0
                    ? 'Questions you write with D wait here until you hand them over.'
                    : 'Your questions go to hobkin as one message, each with its step written out.'}
                {counts.comments > 0 ? ` ${counts.comments === 1 ? 'One comment is' : `${counts.comments} comments are`} kept for the verdict.` : ''}
              </p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-3.5 text-[12.5px]">
          <p className="font-mono text-[11.5px] leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">
            {review.change.project} · {review.change.branch}
            <br />
            {review.change.base.slice(0, 7)}..{review.change.head.slice(0, 7)} · {review.change.files} files <span className="text-ok-fg">+{review.change.additions}</span>{' '}
            <span className="text-bad-fg">−{review.change.deletions}</span>
          </p>
          {review.notices.map((notice) => (
            <p key={notice} className="leading-snug text-muted-foreground">
              {notice}
            </p>
          ))}
          {removed.length > 0 ? (
            <p className="leading-snug">
              {removed.length === 1 ? 'One proposed wire is removed.' : `${removed.length} proposed wires are removed.`}{' '}
              <button type="button" data-stop className="font-medium underline underline-offset-2" onClick={() => removed.forEach((edge) => store.getState().decideWire(edge.id, null))}>
                Bring {removed.length === 1 ? 'it' : 'them'} back
              </button>
            </p>
          ) : null}
        </section>

        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 border-t border-border pt-3.5 text-[12.5px]">
          {KEYS.map(([keys, does]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-[11px] whitespace-nowrap text-muted-foreground">{keys}</dt>
              <dd>{does}</dd>
            </div>
          ))}
        </dl>
      </motion.div>
      {/* Tucked away, the strip says the panel is there and how to bring it back. */}
      <motion.div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-center gap-2 pt-[120px] text-muted-foreground" style={{ width: STEPS_STRIP, opacity: hint }}>
        <ChevronsRight className="size-4" />
        <span className="font-heading text-[11px] font-semibold tracking-[0.08em] uppercase [writing-mode:vertical-rl]">Steps</span>
        <Kbd>S</Kbd>
      </motion.div>
    </motion.aside>
  )
}

function StepRow({ step, index, current, seen, marks, review, notes }: { step: StoryStep; index: number; current: boolean; seen: boolean; marks: { comments: number; questions: number } | undefined; review: Review; notes: readonly Note[] }) {
  const store = useSessionStore()
  const editor = useSession((session) => (current ? session.editor : null))
  const text = step.text || (step.kind === 'closing' ? 'What this change leaves alone, and what is still open.' : '')

  return (
    <li className={cn('rounded-xl', current && 'bg-secondary')}>
      <button
        type="button"
        data-stop
        data-step={index}
        aria-current={current ? 'step' : undefined}
        onClick={() => store.getState().goTo(index)}
        className={cn('flex w-full items-start gap-2.5 rounded-xl px-1.5 py-1.5 text-left', !current && 'hover:bg-secondary/60')}
      >
        <span
          className={cn(
            'mt-px grid size-5 shrink-0 place-items-center rounded-full font-heading text-[10.5px] font-semibold tabular-nums',
            current ? 'bg-primary text-primary-foreground' : seen ? 'bg-foreground/80 text-background' : 'text-muted-foreground ring-1 ring-border-strong/60 ring-inset',
          )}
        >
          {seen && !current ? <Check className="size-3" aria-label="Seen" /> : index + 1}
        </span>
        <span className={cn('min-w-0 flex-1 font-heading text-[13px] leading-[1.3] tracking-[-0.01em]', current ? 'font-semibold' : seen ? 'text-foreground' : 'text-muted-foreground')}>{step.title}</span>
        {marks ? <NoteMarks {...marks} /> : null}
      </button>
      {current ? (
        <div className="flex flex-col gap-2.5 px-2 pt-0.5 pb-2.5 pl-[38px]">
          {text ? <p className="text-[13.5px] leading-[1.5] text-pretty">{text}</p> : null}
          {notes.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} review={review} />
              ))}
            </ul>
          ) : null}
          {editor ? (
            <NoteEditor review={review} target={targetLabel(review, editor.target)} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <NoteButton intent="comment" keys="N" onClick={() => store.getState().startNote('comment')} />
              <NoteButton intent="question" keys="D" onClick={() => store.getState().startNote('question')} />
            </div>
          )}
        </div>
      ) : null}
    </li>
  )
}

/** How many comments and questions a step has, beside its title. */
export function NoteMarks({ comments, questions }: { comments: number; questions: number }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-1.5 font-heading text-[11px] font-semibold text-muted-foreground tabular-nums">
      {comments > 0 ? (
        <span className="flex items-center gap-0.5" aria-label={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}>
          <MessageSquare className="size-3" aria-hidden="true" />
          {comments}
        </span>
      ) : null}
      {questions > 0 ? (
        <span className="flex items-center gap-0.5 text-sun-fg" aria-label={`${questions} ${questions === 1 ? 'question' : 'questions'}`}>
          <CircleHelp className="size-3" aria-hidden="true" />
          {questions}
        </span>
      ) : null}
    </span>
  )
}

function NoteButton({ intent, keys, onClick }: { intent: NoteIntent; keys: string; onClick: () => void }) {
  const Icon = intent === 'question' ? CircleHelp : MessageSquare
  return (
    <button
      type="button"
      data-stop
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-full bg-background px-2.5 font-heading text-[12px] font-medium transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-3.5"
    >
      <Icon aria-hidden="true" />
      {intent === 'question' ? 'Question' : 'Comment'}
      <Kbd>{keys}</Kbd>
    </button>
  )
}

function NoteRow({ note, review }: { note: Note; review: Review }) {
  const store = useSessionStore()
  const Icon = note.intent === 'question' ? CircleHelp : MessageSquare
  const about = note.target.kind === 'step' ? null : targetLabel(review, note.target)

  return (
    <li className="group flex items-start gap-2 rounded-lg bg-background px-2.5 py-2">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', note.intent === 'question' ? 'text-sun-fg' : 'text-muted-foreground')} aria-label={note.intent === 'question' ? 'Question' : 'Comment'} />
      {/* The note itself goes to what it is about: the node, the wire, or the lines in the code. */}
      <button
        type="button"
        data-stop
        title={about ? `Go to ${about}` : undefined}
        onClick={() => store.getState().showNote(note.id)}
        className="min-w-0 flex-1 rounded-md text-left"
      >
        {about ? <span className="block font-heading text-[11px] font-semibold [overflow-wrap:anywhere] text-muted-foreground underline-offset-2 group-hover:underline">On {about}</span> : null}
        <span className="block text-[13px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{note.text}</span>
        {note.sent ? <span className="mt-0.5 block text-[11px] text-muted-foreground">Handed to hobkin</span> : null}
      </button>
      <div className="flex shrink-0 gap-0.5">
        <button
          type="button"
          data-stop
          aria-label="Change this note"
          title="Change this note"
          onClick={() => store.getState().editNote(note.id)}
          // With the keyboard on a note, Backspace removes it, as it removes anything.
          onKeyDown={(event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return
            reviewMemory.getState().removeNote(review, note.id)
            event.preventDefault()
          }}
          className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary [&_svg]:size-3"
        >
          <Pencil />
        </button>
        <button type="button" aria-label="Remove this note" title="Remove this note" onClick={() => reviewMemory.getState().removeNote(review, note.id)} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary [&_svg]:size-3">
          <Trash2 />
        </button>
      </div>
    </li>
  )
}

/**
 * Where a note is written. Enter keeps it, Shift with Enter starts a new line, and Escape leaves
 * without losing what was written: the words wait as a draft.
 */
function NoteEditor({ review, target }: { review: Review; target: string }) {
  const store = useSessionStore()
  const draft = useReviewMemory((memory) => memory.of(review).draft)
  const field = useRef<HTMLTextAreaElement>(null)
  const intent = draft?.intent ?? 'comment'
  const set = (change: { text?: string; intent?: NoteIntent }) => reviewMemory.getState().setDraft(review, { intent, text: draft?.text ?? '', ...(draft?.editing ? { editing: draft.editing } : {}), ...change })

  // The keyboard goes to the words at once, with the caret after what is already there.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(element.value.length, element.value.length)
    element.scrollIntoView({ block: 'nearest' })
  }, [])
  // The field grows with its words, up to a point.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(220, element.scrollHeight)}px`
  }, [draft?.text])

  const leave = (save: boolean) => {
    if (save) store.getState().saveNote()
    else store.getState().closeEditor()
    // The keyboard goes back to the graph, where it was.
    field.current?.closest<HTMLElement>('[data-rv-root]')?.focus({ preventScroll: true })
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-background p-2.5 ring-1 ring-border-strong/50">
      <div className="flex items-center gap-1.5">
        {(['comment', 'question'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={intent === kind}
            onClick={() => {
              set({ intent: kind })
              field.current?.focus()
            }}
            className={cn('rounded-full px-2 py-0.5 font-heading text-[11.5px] font-semibold', intent === kind ? 'bg-secondary' : 'text-muted-foreground')}
          >
            {kind === 'question' ? 'Question' : 'Comment'}
          </button>
        ))}
        <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-muted-foreground">on {target}</span>
      </div>
      <textarea
        ref={field}
        value={draft?.text ?? ''}
        rows={2}
        aria-label={intent === 'question' ? `A question for hobkin on ${target}` : `A comment on ${target}`}
        placeholder={intent === 'question' ? 'What do you want to ask hobkin?' : 'What should change, or be remembered?'}
        onChange={(event) => set({ text: event.target.value })}
        onKeyDown={(event) => {
          // The words belong to the field: no key typed here walks the story.
          event.stopPropagation()
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            leave(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            leave(false)
          }
        }}
        className="rv-scroll w-full resize-none bg-transparent text-[13.5px] leading-[1.5] outline-none placeholder:text-muted-foreground"
      />
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> keep
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⇧↵</Kbd> new line
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> leave, the words stay
        </span>
      </p>
    </div>
  )
}
