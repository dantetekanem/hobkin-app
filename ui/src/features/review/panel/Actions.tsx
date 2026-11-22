import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { ReviewLanding, ReviewStatus, VerdictPreview } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { dayLabel, timeOf } from '@/features/reports/time.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import type { Note } from '../notes/notes.ts'
import '../preparing/preparing.css'
import { reviewMemory, useSession } from '../state/context.tsx'
import { unseenNeeds, unseenWords } from './evidence.ts'
import { CONFIRM_MS, createVerdictChoices, handOver, heldDown, VERDICT_CHOICES, verdictChoices, verdictComments, verdictKind, type VerdictCommands } from '../verdict.ts'

/** The choices that send the reviewer's comments, and have nothing to send without one. */
const needsComment = (verdict: Verdict) => verdict === 'request-changes' || verdict === 'comment'

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

/** Where a change landed, in a line: "Merged into main at e44106a · 4:13 PM", with the day when it was not today. */
function mergedWords({ into, sha, at }: ReviewLanding): string {
  const where = `Merged${into ? ` into ${into}` : ''}${sha ? ` at ${sha.slice(0, 7)}` : ''}`
  const when = timeOf(at)
  if (when == null) return where
  const time = new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = dayLabel(when, Date.now())
  return `${where} · ${day === 'Today' ? time : `${day}, ${time}`}`
}

/**
 * The verdict, at the foot of the review panel, confirmed in place. Every choice is the host's own verdict, for the
 * commit of the review on screen. The first click asks the host what it will do: the same button then reads "Click
 * again to confirm", with what will happen in the box under the choices, and a second click within ten seconds does
 * it. Approve and merge of a finished change whose branch moved since the review reads "Click again to merge it as it
 * is now", as the host merges it where it is now. After ten seconds, on Escape, or when the keyboard leaves the
 * choices, it goes back. A key held down never gives the second click. Once the host has done it, `landed` hears so.
 *
 * A change that lands is past choosing (spec 032). While an agent brings it up to date the choices wait, and the box
 * says so. Once it merged, where it landed takes the choices' place.
 *
 * Nothing moves on the way (the user, 2026-11-12: "approve and merge is doing a weird jump"): the choices keep their
 * size whatever they say, the line that takes their place keeps their room, and the box keeps its height whatever it
 * holds, scrolling what does not fit.
 */
export function Actions({ review, notes, live, verdict, saveNotes, landed, ask, status }: {
  review: Review
  notes: readonly Note[]
  live: boolean
  /** The host's verdict commands, for a live review or a sample that has a made-up host. Without them nothing can be chosen. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host first, so what the host shows is what goes. */
  saveNotes?: () => Promise<void>
  /** Hears of a verdict the host did, with its words. */
  landed?: (verdict: Verdict, message: string) => void | Promise<void>
  /** Sends hobkin a message about this review, or null where hobkin is not connected. A verdict the host could not do goes to it. */
  ask?: ((text: string) => Promise<boolean>) | null
  /** How the host says the review stands: how its change lands, and the commit the change is at now. */
  status?: ReviewStatus | null
}) {
  const kind = verdictKind(review.id)
  // Someone else's pull request is approved or commented on: its author merges or closes it.
  const offered = verdictChoices(review.id, status?.owner)
  const comments = verdictComments(review.id, notes).length
  const landing = status?.landing ?? null
  const merged = landing?.state === 'merged'
  // The host merges a finished change where its branch is now, which the preview says.
  const moved = kind === 'change' && status?.head != null && status.head !== review.change.head
  const section = useRef<HTMLElement>(null)
  const box = useRef<HTMLDivElement>(null)
  // Once the second click is given, the host is doing it: nothing may take it back.
  const doing = useRef<Verdict | null>(null)
  // The choice whose first click the host is answering.
  const asking = useRef<Verdict | null>(null)
  const buttons = useRef(new Map<Verdict, HTMLButtonElement>())
  // Read when a verdict lands, so a new one given later is the one that runs.
  const onLanded = useRef(landed)
  onLanded.current = landed
  const onAsk = useRef(ask)
  onAsk.current = ask

  const choices = useMemo(
    () =>
      createVerdictChoices({
        id: review.id,
        head: review.change.head,
        command: verdict ?? noHost,
        saveNotes: saveNotes ?? nothingToSave,
        current: () => true,
        comments: () => verdictComments(review.id, reviewMemory.getState().notesOf(review)),
        markSent: (ids) => reviewMemory.getState().markSent(review, ids, Date.now()),
        landed: (done, message) => onLanded.current?.(done, message),
        failed: async (failedVerdict, reason) => (onAsk.current ? onAsk.current(handOver(verdictKind(review.id), failedVerdict, reason)) : false),
      }),
    [review, verdict, saveNotes],
  )
  useEffect(() => choices.connect(), [choices])
  const flow = useStore(choices)
  const armed = flow.preview?.verdict ?? null
  // A yes is never blocked: with nodes that need the reviewer not seen, its first press says how many (spec 053).
  const unseen = useSession((session) => unseenNeeds(session.review.nodes, session.seen))
  // The box under the choices is there only while it has something to say.
  const says = Boolean(landing) || flow.busy || flow.error != null || flow.preview != null || flow.message != null || !live

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

  // A change that starts to land, here or elsewhere, takes back a choice that waits. A choice that held the keyboard
  // can no longer hold it, so the keyboard goes to the box under the choices, and stays in the review.
  const landingState = landing?.state ?? null
  useLayoutEffect(() => {
    if (!landingState) return
    if (!doing.current) choices.cancel()
    if (section.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true })
  }, [landingState, choices])

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
      {/* The choices' place. Once the change merged, where it landed is told in it, at the choices' size. */}
      <div className="grid">
        <div className={cn('col-start-1 row-start-1 flex flex-col gap-1.5', merged && 'invisible')} inert={merged}>
          {offered.choices.map((choice) => {
            const waiting = armed === choice.verdict
            const working = flow.busy && (doing.current === choice.verdict || asking.current === choice.verdict)
            const primary = choice.verdict === PRIMARY
            // The no, and the no that deletes the branch too, read apart from the yeses, in the color of what cannot be taken back.
            const discards = choice.verdict === 'discard' || choice.verdict === 'discard-branch'
            const secondClick = choice.verdict === 'approve-merge' && moved ? 'Click again to merge it as it is now' : 'Click again to confirm'
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
                className={cn('rv-verdict relative h-9 w-full justify-between overflow-hidden rounded-full px-3.5 text-[14px] font-semibold', discards && 'text-destructive hover:text-destructive')}
                // Not disabled while the host works: a focused button that is disabled drops the keyboard out of the review.
                // A click then does nothing. A change that lands is past choosing.
                disabled={!verdict || landing != null || (needsComment(choice.verdict) && comments === 0)}
                // A stopped key presses nothing: Enter held from the first click, or Space held while it was clicked, does not confirm.
                onKeyDown={(event) => {
                  if (heldDown(event)) event.preventDefault()
                }}
                onClick={() => void press(choice.verdict)}
              >
                {waiting ? (
                  <>
                    <span className="truncate">{secondClick}</span>
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
          {offered.why ? <p className="px-1 text-[13px] leading-snug text-pretty text-muted-foreground">{offered.why}</p> : null}
        </div>
        {merged ? (
          <p className="col-start-1 row-start-1 flex items-center gap-2 self-center px-1 font-heading text-[15px] leading-snug font-semibold text-pretty">
            <CircleCheck aria-hidden="true" className="size-[18px] shrink-0 text-ok-fg" />
            <span>{mergedWords(landing)}</span>
          </p>
        ) : null}
      </div>

      {/* Only when there is something to say. Focusable, so a click into it to scroll keeps the keyboard with the verdict and takes nothing back. */}
      {says ? (
        <div ref={box} role="status" tabIndex={-1} className="rv-scroll mt-1 max-h-[132px] overflow-y-auto rounded-xl bg-background px-3 py-2.5 text-[14px] leading-[1.45] [overflow-wrap:anywhere] outline-none">
          <Said kind={kind} live={live} flow={flow} doing={doing.current != null} landing={landing} unseen={unseen} />
        </div>
      ) : null}
    </section>
  )
}

const labelOf = (kind: 'change' | 'pull', verdict: Verdict) => VERDICT_CHOICES[kind].find((choice) => choice.verdict === verdict)?.label ?? ''

/**
 * What the box under the choices says: how the change lands, the host at work, what a choice will do while it waits for
 * its second click, the host's reason when it will not do it, its words when it did, or the sample notice. Nothing
 * when there is nothing to say.
 */
function Said({ kind, live, flow, doing, landing, unseen }: {
  kind: 'change' | 'pull'
  live: boolean
  flow: { busy: boolean; preview: VerdictPreview | null; error: string | null; message: string | null }
  doing: boolean
  landing: ReviewLanding | null
  /** How many nodes that need the reviewer are not seen. */
  unseen: number
}): ReactNode {
  if (landing?.state === 'merged') return <p className="text-pretty text-muted-foreground">Nothing is left to decide here.</p>
  if (landing?.state === 'refreshing') {
    return (
      <p className="flex items-start gap-2.5 text-pretty">
        {/* It breathes while the agent works, and holds still under reduced motion (preparing.css). */}
        <span aria-hidden="true" className="pv-breath relative mt-[7px] size-2 shrink-0 rounded-full bg-primary" />
        <span>An agent is bringing the branch up to date. hobkin merges it when that run ends.</span>
      </p>
    )
  }
  if (flow.busy) return <p className="text-muted-foreground">{doing ? 'The host is doing it…' : 'Asking the host what it will do…'}</p>
  if (flow.error) {
    return (
      <p className="flex items-start gap-2 text-bad-fg">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{flow.error}</span>
      </p>
    )
  }
  if (flow.preview) return <Preview kind={kind} preview={flow.preview} unseen={isYes(flow.preview.verdict) ? unseenWords(unseen) : null} />
  if (flow.message) return <Markdown text={flow.message} />
  if (!live) return <p className="text-muted-foreground">Sample review: nothing is sent from here.</p>
  return null
}

/** The yeses, whose first press says what the reviewer has not seen. */
const isYes = (verdict: Verdict) => verdict === 'approve' || verdict === 'approve-merge'

/**
 * What a choice will do, as the host says it, while the choice waits for its second click. A yes given with nodes that
 * need the reviewer not seen says how many first, and that U goes to the next: the second press still does it.
 */
function Preview({ kind, preview, unseen }: { kind: 'change' | 'pull'; preview: VerdictPreview; unseen: string | null }) {
  return (
    <div className="flex flex-col gap-2" aria-label={`What ${labelOf(kind, preview.verdict)} will do`}>
      {unseen ? (
        <p className="flex items-start gap-2 text-pretty text-warn-fg">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{unseen}</span>
        </p>
      ) : null}
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

/** The review GitHub will get, as the host will post it: its kind, the user's words when they wrote any, and each comment on its lines. */
function GitHubPost({ post }: { post: NonNullable<VerdictPreview['post']> }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-secondary/70 p-2.5" aria-label="The review GitHub will get">
      <p className="font-heading text-[13px] font-semibold text-muted-foreground">
        GitHub gets {EVENT[post.event]}, on commit {post.commit_id.slice(0, 7)}
      </p>
      {post.body ? <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{post.body}</p> : null}
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
