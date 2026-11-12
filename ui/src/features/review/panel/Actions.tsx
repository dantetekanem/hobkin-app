import { TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { VerdictPreview } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import type { Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'
import { CONFIRM_MS, createVerdictChoices, heldDown, VERDICT_CHOICES, verdictKind, type VerdictCommands } from '../verdict.ts'

/** The choices that send the reviewer's comments, and have nothing to send without one. */
const needsComment = (verdict: Verdict) => verdict === 'request-changes' || verdict === 'comment'
const unsentComments = (notes: readonly Note[]) => notes.filter((note) => note.intent === 'comment' && note.sent == null).map((note) => note.id)

const noHost: VerdictCommands = async () => {
  throw new Error('Hobkin is not connected here.')
}
const nothingToSave = async () => {}
const inField = () => document.activeElement?.closest('input, textarea, [contenteditable="true"]') != null
/** Whether all of an element is in sight inside the box that scrolls it. */
const inSight = (element: Element, box: Element) => {
  const shown = box.getBoundingClientRect()
  const at = element.getBoundingClientRect()
  return at.top >= shown.top && at.bottom <= shown.bottom
}

/** The choice the panel offers first: merging is what a review that passes ends with. */
const PRIMARY: Verdict = 'approve-merge'

/**
 * The verdict, at the foot of the review panel, confirmed in place. Every choice is the host's own verdict, for the
 * commit of the review on screen. The first click asks the host what it will do: the same button then reads "Click
 * again to confirm", with what will happen in the box under the choices, and a second click within ten seconds does
 * it. After ten seconds, on Escape, or when the keyboard leaves the choices, it goes back. A key held down never gives
 * the second click. Once the host has done it, `landed` hears so, and the review closes.
 *
 * Nothing moves on the way (the user, 2026-11-12: "approve and merge is doing a weird jump"): the choices keep their
 * size whatever they say, and the box keeps its height whatever it holds, scrolling what does not fit.
 */
export function Actions({ review, notes, live, verdict, saveNotes, landed }: {
  review: Review
  notes: readonly Note[]
  live: boolean
  /** The host's verdict commands, for a live review. Without them nothing can be chosen. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host first, so what the host shows is what goes. */
  saveNotes?: () => Promise<void>
  /** Hears of a verdict the host did, with its words. */
  landed?: (verdict: Verdict, message: string) => void
}) {
  const kind = verdictKind(review.id)
  const comments = unsentComments(notes).length
  const section = useRef<HTMLElement>(null)
  // Once the second click is given, the host is doing it: nothing may take it back.
  const doing = useRef<Verdict | null>(null)
  // The choice whose first click the host is answering.
  const asking = useRef<Verdict | null>(null)
  const buttons = useRef(new Map<Verdict, HTMLButtonElement>())
  // Read when a verdict lands, so a new one given later is the one that runs.
  const onLanded = useRef(landed)
  onLanded.current = landed

  const choices = useMemo(
    () =>
      createVerdictChoices({
        id: review.id,
        head: review.change.head,
        command: verdict ?? noHost,
        saveNotes: saveNotes ?? nothingToSave,
        current: () => true,
        comments: () => unsentComments(reviewMemory.getState().notesOf(review)),
        markSent: (ids) => reviewMemory.getState().markSent(review, ids, Date.now()),
        landed: (done, message) => onLanded.current?.(done, message),
      }),
    [review, verdict, saveNotes],
  )
  useEffect(() => choices.connect(), [choices])
  const flow = useStore(choices)
  const armed = flow.preview?.verdict ?? null

  // What a shown verdict sends is the notes as they stood. When they change, it is taken back, to be shown again.
  useEffect(() => {
    let known = reviewMemory.getState().of(review).notes
    return reviewMemory.subscribe((state) => {
      const now = state.of(review).notes
      if (now === known) return
      known = now
      const { preview, busy } = choices.getState()
      if (doing.current || !(preview || busy)) return
      choices.cancel()
      choices.setState({ message: 'Your notes changed, so that was taken back. Choose it again to see what goes now.' })
    })
  }, [choices, review])

  // The button that waits for its second click holds the keyboard, so Enter gives it and leaving takes it back. A key
  // still down from the first only repeats there, and the button stops repeats (`heldDown`): it takes a key pressed anew.
  // A choice armed by its key from the graph can be out of sight: the verdict then comes into view, as little as it
  // takes. One that was clicked is in sight, so nothing scrolls.
  useEffect(() => {
    const button = armed ? buttons.current.get(armed) : undefined
    if (!button) return
    if (!inField()) button.focus({ preventScroll: true })
    const box = button.closest('.rv-scroll')
    if (box && !inSight(button, box)) section.current?.scrollIntoView({ block: 'nearest' })
  }, [armed])

  const press = async (choice: Verdict) => {
    if (choices.getState().busy) return
    if (choices.armed() === choice) doing.current = choice
    else asking.current = choice
    try {
      await choices.press(choice)
    } finally {
      doing.current = null
      asking.current = null
    }
  }

  return (
    <section
      ref={section}
      aria-label="Verdict"
      className="flex flex-col gap-1.5"
      // Escape steps back from the second click before it reaches the review, which would close.
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || doing.current || !(flow.preview || flow.busy)) return
        event.preventDefault()
        choices.cancel()
      }}
      onBlur={(event) => {
        if (!doing.current && choices.getState().preview && !event.currentTarget.contains(event.relatedTarget)) choices.cancel()
      }}
    >
      {VERDICT_CHOICES[kind].map((choice) => {
        const waiting = armed === choice.verdict
        const working = flow.busy && (doing.current === choice.verdict || asking.current === choice.verdict)
        const primary = choice.verdict === PRIMARY
        return (
          <Button
            key={choice.verdict}
            ref={(element) => {
              if (element) buttons.current.set(choice.verdict, element)
              else buttons.current.delete(choice.verdict)
            }}
            data-stop
            data-verdict={choice.verdict}
            data-armed={waiting}
            aria-pressed={waiting}
            variant={primary ? 'default' : 'outline'}
            className="rv-verdict relative h-9 w-full justify-between overflow-hidden rounded-full px-3.5 text-[14px] font-semibold"
            // Not disabled while the host works: a focused button that is disabled drops the keyboard out of the review.
            // A click then does nothing.
            disabled={!live || !verdict || (needsComment(choice.verdict) && comments === 0)}
            // A stopped key presses nothing: Enter held from the first click, or Space held while it was clicked, does not confirm.
            onKeyDown={(event) => {
              if (heldDown(event)) event.preventDefault()
            }}
            onClick={() => void press(choice.verdict)}
          >
            {waiting ? (
              <>
                <span className="truncate">Click again to confirm</span>
                <span className="rv-confirm-time" aria-hidden="true" style={{ animationDuration: `${CONFIRM_MS}ms` }} />
              </>
            ) : working ? (
              <span className="truncate">{doing.current === choice.verdict ? choice.doing : 'Checking…'}</span>
            ) : (
              <>
                <span className="truncate">
                  {choice.label}
                  {needsComment(choice.verdict) ? <span className="ml-1.5 tabular-nums">{comments}</span> : null}
                </span>
                {choice.keys ? <Kbd className={primary ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>{choice.keys}</Kbd> : null}
              </>
            )}
          </Button>
        )
      })}

      {/* Focusable, so a click into it to scroll keeps the keyboard with the verdict and takes nothing back. */}
      <div role="status" tabIndex={-1} className="rv-scroll mt-1 h-[132px] overflow-y-auto rounded-xl bg-background px-3 py-2.5 text-[14px] leading-[1.45] [overflow-wrap:anywhere] outline-none">
        <Said kind={kind} live={live} flow={flow} doing={doing.current != null} />
      </div>
    </section>
  )
}

const labelOf = (kind: 'change' | 'pull', verdict: Verdict) => VERDICT_CHOICES[kind].find((choice) => choice.verdict === verdict)?.label ?? ''

/**
 * What the box under the choices says: the sample notice, the host at work, what a choice will do while it waits for
 * its second click, the host's reason when it will not do it, or its words when it did.
 */
function Said({ kind, live, flow, doing }: { kind: 'change' | 'pull'; live: boolean; flow: { busy: boolean; preview: VerdictPreview | null; error: string | null; message: string | null }; doing: boolean }): ReactNode {
  if (!live) return <p className="text-muted-foreground">Sample review: nothing is sent from here.</p>
  if (flow.busy) return <p className="text-muted-foreground">{doing ? 'The host is doing it…' : 'Asking the host what it will do…'}</p>
  if (flow.error) {
    return (
      <p className="flex items-start gap-2 text-bad-fg">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{flow.error}</span>
      </p>
    )
  }
  if (flow.preview) return <Preview kind={kind} preview={flow.preview} />
  if (flow.message) return <Markdown text={flow.message} />
  return (
    <p className="text-pretty text-muted-foreground">
      {kind === 'change'
        ? 'Each choice first says what it will do, and waits for a second click. Nothing happens before it.'
        : 'Each choice first shows what GitHub will get, and waits for a second click. Nothing is posted before it.'}
    </p>
  )
}

/** What a choice will do, as the host says it, while the choice waits for its second click. */
function Preview({ kind, preview }: { kind: 'change' | 'pull'; preview: VerdictPreview }) {
  return (
    <div className="flex flex-col gap-2" aria-label={`What ${labelOf(kind, preview.verdict)} will do`}>
      <p className="font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{labelOf(kind, preview.verdict)} will</p>
      <ul className="flex flex-col gap-1 text-pretty">
        {preview.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      {preview.note ? <pre className="rounded-lg bg-secondary/70 p-2.5 font-sans text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{preview.note}</pre> : null}
      {preview.post ? <GitHubPost post={preview.post} /> : null}
      <p className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        Click it again within ten seconds to confirm. <Kbd>esc</Kbd> takes it back.
      </p>
    </div>
  )
}

const EVENT: Record<NonNullable<VerdictPreview['post']>['event'], string> = { APPROVE: 'an approval', COMMENT: 'a comment', REQUEST_CHANGES: 'a request for changes' }

/** The review GitHub will get, as the host will post it: its kind, its words, and each comment on its lines. */
function GitHubPost({ post }: { post: NonNullable<VerdictPreview['post']> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/70 p-2.5" aria-label="The review GitHub will get">
      <p className="font-heading text-[13px] font-semibold text-muted-foreground">
        GitHub gets {EVENT[post.event]}, on commit {post.commit_id.slice(0, 7)}
      </p>
      <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{post.body}</p>
      {post.comments.map((comment, index) => (
        <div key={index} className="flex flex-col gap-0.5 border-t border-border pt-2">
          <p className="font-mono text-[12.5px] [overflow-wrap:anywhere] text-muted-foreground">
            {comment.path}, {comment.start_line ? `lines ${comment.start_line} to ${comment.line}` : `line ${comment.line}`}
            {comment.side === 'LEFT' ? ', as it was' : ''}
          </p>
          <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}
    </div>
  )
}
