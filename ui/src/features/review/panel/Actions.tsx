import { useEffect, useMemo, useRef, useState } from 'react'
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
import { createVerdictChoices, heldDown, type VerdictCommands } from '../verdict.ts'

/** What each verdict is called, for a finished hobkin change and for a pull request from GitHub. */
const CHOICES: Record<'change' | 'pull', { verdict: Verdict; label: string; keys?: string }[]> = {
  change: [
    { verdict: 'approve', label: 'Approve', keys: 'A' },
    { verdict: 'approve-merge', label: 'Approve and merge', keys: 'M' },
    { verdict: 'request-changes', label: 'Send fixes', keys: 'X' },
  ],
  pull: [
    { verdict: 'approve', label: 'Approve', keys: 'A' },
    { verdict: 'comment', label: 'Comment' },
    { verdict: 'request-changes', label: 'Request changes', keys: 'X' },
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
 * The verdict, in the review panel. Every choice is the host's own verdict, for the commit of the review on screen: the
 * first yes shows exactly what will happen (for a pull request, the review GitHub will get), the second (Enter, or Yes)
 * does it, and the host's answer, or why it cannot, shows here. A key held down never gives the second yes. The
 * comments that went with it are marked sent, as the host marks them in the home. The A, M and X keys are the first yes
 * of their choice.
 */
export function Actions({ review, notes, live, verdict, saveNotes }: {
  review: Review
  notes: readonly Note[]
  live: boolean
  /** The host's verdict commands, for a live review. Without them nothing can be chosen. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host first, so what the host shows is what goes. */
  saveNotes?: () => Promise<void>
}) {
  const kind = targetOfReviewId(review.id)?.kind === 'pull' ? 'pull' : 'change'
  const comments = unsentComments(notes).length
  const yes = useRef<HTMLButtonElement>(null)
  // Once the second yes is given, the host is doing it: nothing may hide what it answers.
  const doing = useRef(false)
  const buttons = useRef(new Map<Verdict, HTMLButtonElement>())
  const [chosen, setChosen] = useState<Verdict | null>(null)

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
      }),
    [review, verdict, saveNotes],
  )
  useEffect(() => choices.connect(), [choices])
  const flow = useStore(choices)

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

  // Once the host has said what will happen, the keyboard waits on the yes, so Enter does it. A key still down from the
  // choice only repeats there, and the yes stops repeats (`heldDown`): it takes a key pressed anew.
  useEffect(() => {
    if (flow.preview && !inField()) yes.current?.focus({ preventScroll: true })
  }, [flow.preview])
  const back = () => {
    if (chosen && !inField()) buttons.current.get(chosen)?.focus({ preventScroll: true })
  }
  const choose = (choice: Verdict) => {
    setChosen(choice)
    void choices.choose(choice)
  }
  const confirm = async () => {
    // The keyboard goes back to the choice first: the box with the yes goes away while the host does it.
    back()
    doing.current = true
    await choices.confirm()
    doing.current = false
  }
  const label = CHOICES[kind].find((choice) => choice.verdict === flow.preview?.verdict)?.label ?? ''

  return (
    <section
      aria-label="Verdict"
      className="flex flex-col gap-2"
      // Escape steps back from the yes before it reaches the review, which would close.
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || doing.current || !(flow.preview || flow.busy)) return
        event.preventDefault()
        choices.cancel()
        back()
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {CHOICES[kind].map((choice) => {
          const primary = choice.verdict === 'approve'
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
              aria-pressed={flow.preview?.verdict === choice.verdict}
              variant={primary ? 'default' : 'outline'}
              className="h-8 px-3 text-[13px]"
              // Not disabled while the host works: a focused button that is disabled drops the keyboard out of the review.
              // A second press then does nothing.
              disabled={!live || !verdict || (needsComment(choice.verdict) && comments === 0)}
              onClick={() => choose(choice.verdict)}
            >
              {choice.label}
              {needsComment(choice.verdict) ? <span className="tabular-nums">{comments}</span> : null}
              {choice.keys ? <Kbd className={primary ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>{choice.keys}</Kbd> : null}
            </Button>
          )
        })}
      </div>

      {flow.preview ? (
        <div role="group" aria-label={`What ${label} will do`} className="rv-scroll flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto rounded-xl bg-background p-3 ring-1 ring-border-strong/60">
          <p className="font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label} will</p>
          <ul className="flex flex-col gap-1.5 text-[14px] leading-[1.45] text-pretty">
            {flow.preview.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {flow.preview.note ? <pre className="rounded-lg bg-secondary/70 p-2.5 font-sans text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{flow.preview.note}</pre> : null}
          {flow.preview.post ? <GitHubPost post={flow.preview.post} /> : null}
          <div className="flex flex-wrap gap-1.5">
            <Button
              ref={yes}
              size="sm"
              data-stop
              className="h-8 px-3 text-[13px]"
              // A stopped key presses nothing: Enter held from the choice, or Space held while it was clicked, does not say yes.
              onKeyDown={(event) => {
                if (heldDown(event)) event.preventDefault()
              }}
              onClick={() => void confirm()}
            >
              Yes, {label.toLowerCase()}
              <Kbd className="bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-stop
              className="h-8 px-3 text-[13px]"
              onClick={() => {
                choices.cancel()
                back()
              }}
            >
              Not now
              <Kbd>esc</Kbd>
            </Button>
          </div>
        </div>
      ) : null}

      <div role="status" className={cn('text-[13px] leading-snug [overflow-wrap:anywhere]', flow.error ? 'text-bad-fg' : flow.message ? 'text-foreground' : 'text-muted-foreground')}>
        {!live ? (
          'Sample review. Nothing is sent.'
        ) : flow.busy ? (
          'Waiting for the host…'
        ) : flow.error ? (
          flow.error
        ) : flow.message && !flow.preview ? (
          <Markdown text={flow.message} />
        ) : flow.preview ? (
          'Nothing is done until you say yes.'
        ) : kind === 'change' ? (
          'Each choice shows what it will do first. Nothing happens until you say yes.'
        ) : (
          'Each choice shows the review GitHub will get. Nothing is posted until you say yes.'
        )}
      </div>
    </section>
  )
}

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
