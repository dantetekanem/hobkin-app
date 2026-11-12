import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { VerdictPreview } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import type { Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'
import { CONFIRM_MS, createVerdictChoices, heldDown, type VerdictCommands } from '../verdict.ts'

/** What each verdict is called, for a finished hobkin change and for a pull request from GitHub, and what it says while the host does it. */
const CHOICES: Record<'change' | 'pull', { verdict: Verdict; label: string; doing: string; keys?: string }[]> = {
  change: [
    { verdict: 'approve', label: 'Approve', doing: 'Opening its pull request…', keys: 'A' },
    { verdict: 'approve-merge', label: 'Approve and merge', doing: 'Merging…', keys: 'M' },
    { verdict: 'request-changes', label: 'Send fixes', doing: 'Sending…', keys: 'X' },
  ],
  pull: [
    { verdict: 'approve', label: 'Approve', doing: 'Posting…', keys: 'A' },
    { verdict: 'comment', label: 'Comment', doing: 'Posting…' },
    { verdict: 'request-changes', label: 'Request changes', doing: 'Posting…', keys: 'X' },
  ],
}

/** The choices that send the reviewer's comments, and have nothing to send without one. */
const needsComment = (verdict: Verdict) => verdict === 'request-changes' || verdict === 'comment'
const unsentComments = (notes: readonly Note[]) => notes.filter((note) => note.intent === 'comment' && note.sent == null).map((note) => note.id)

const noHost: VerdictCommands = async () => {
  throw new Error('Hobkin is not connected here.')
}
const nothingToSave = async () => {}
const inField = () => document.activeElement?.closest('input, textarea, [contenteditable="true"]') != null

/**
 * The verdict, in the review panel, confirmed in place. Every choice is the host's own verdict, for the commit of the
 * review on screen. The first click asks the host what it will do: the button then reads "Click again to confirm",
 * with what will happen under it, and a second click within ten seconds does it. After ten seconds, on Escape, or when
 * the keyboard leaves the buttons, it goes back. A key held down never gives the second click. Once the host has done
 * it, `landed` hears so, and the review closes.
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
  const kind = targetOfReviewId(review.id)?.kind === 'pull' ? 'pull' : 'change'
  const comments = unsentComments(notes).length
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
  useEffect(() => {
    if (armed && !inField()) buttons.current.get(armed)?.focus({ preventScroll: true })
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

  const status = statusLine()

  /** What the line under the choices says: the sample notice, the host at work, its error or message, or what a click does. */
  function statusLine(): ReactNode {
    if (!live) return 'Sample review. Nothing is sent.'
    if (flow.busy) return doing.current ? 'The host is doing it…' : 'Asking the host what it will do…'
    if (flow.error) return flow.error
    if (flow.preview) return null
    if (flow.message) return <Markdown text={flow.message} />
    return kind === 'change'
      ? 'Each choice shows what it will do and asks for a second click. Nothing happens before it.'
      : 'Each choice shows the review GitHub will get and asks for a second click. Nothing is posted before it.'
  }

  return (
    <section
      aria-label="Verdict"
      className="flex flex-col gap-2"
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
      <div className="flex flex-wrap gap-1.5">
        {CHOICES[kind].map((choice) => {
          const waiting = armed === choice.verdict
          const working = flow.busy && (doing.current === choice.verdict || asking.current === choice.verdict)
          const primary = choice.verdict === 'approve' || waiting
          return (
            <Button
              key={choice.verdict}
              ref={(element) => {
                if (element) buttons.current.set(choice.verdict, element)
                else buttons.current.delete(choice.verdict)
              }}
              size="sm"
              data-stop
              data-verdict={choice.verdict}
              data-armed={waiting}
              aria-pressed={waiting}
              variant={primary ? 'default' : 'outline'}
              className="relative h-8 overflow-hidden px-3 text-[13px]"
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
                  Click again to confirm
                  <span className="rv-confirm-time" aria-hidden="true" style={{ animationDuration: `${CONFIRM_MS}ms` }} />
                </>
              ) : working ? (
                doing.current === choice.verdict ? choice.doing : 'Checking…'
              ) : (
                <>
                  {choice.label}
                  {needsComment(choice.verdict) ? <span className="tabular-nums">{comments}</span> : null}
                  {choice.keys ? <Kbd className={primary ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>{choice.keys}</Kbd> : null}
                </>
              )}
            </Button>
          )
        })}
      </div>

      {flow.preview ? (
        <div role="group" aria-label={`What ${labelOf(kind, flow.preview.verdict)} will do`} className="rv-scroll flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto rounded-xl bg-background p-3 ring-1 ring-border-strong/60">
          <p className="font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{labelOf(kind, flow.preview.verdict)} will</p>
          <ul className="flex flex-col gap-1.5 text-[14px] leading-[1.45] text-pretty">
            {flow.preview.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {flow.preview.note ? <pre className="rounded-lg bg-secondary/70 p-2.5 font-sans text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{flow.preview.note}</pre> : null}
          {flow.preview.post ? <GitHubPost post={flow.preview.post} /> : null}
          <p className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
            Click it again within ten seconds to confirm. <Kbd>esc</Kbd> takes it back.
          </p>
        </div>
      ) : null}

      <div role="status" className={cn('text-[13px] leading-snug [overflow-wrap:anywhere]', flow.error ? 'text-bad-fg' : flow.message ? 'text-foreground' : 'text-muted-foreground')}>
        {status}
      </div>
    </section>
  )
}

const labelOf = (kind: 'change' | 'pull', verdict: Verdict) => CHOICES[kind].find((choice) => choice.verdict === verdict)?.label ?? ''

const EVENT: Record<NonNullable<VerdictPreview['post']>['event'], string> = { APPROVE: 'an approval', COMMENT: 'a comment', REQUEST_CHANGES: 'a request for changes' }

/** The review GitHub will get, as the host will post it: its kind, its words, and each comment on its lines. */
function GitHubPost({ post }: { post: NonNullable<VerdictPreview['post']> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/70 p-2.5" aria-label="The review GitHub will get">
      <p className="font-heading text-[12.5px] font-semibold text-muted-foreground">
        GitHub gets {EVENT[post.event]}, on commit {post.commit_id.slice(0, 7)}
      </p>
      <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{post.body}</p>
      {post.comments.map((comment, index) => (
        <div key={index} className="flex flex-col gap-0.5 border-t border-border pt-2">
          <p className="font-mono text-[12px] [overflow-wrap:anywhere] text-muted-foreground">
            {comment.path}, {comment.start_line ? `lines ${comment.start_line} to ${comment.line}` : `line ${comment.line}`}
            {comment.side === 'LEFT' ? ', as it was' : ''}
          </p>
          <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}
    </div>
  )
}
