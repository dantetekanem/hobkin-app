import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { ReviewLanding, ReviewStatus, VerdictPreview } from '#shared/review/status.ts'
import type { Review } from '#shared/review/types.ts'
import { discussionMessage } from '#shared/review/notes.ts'
import { questionsToDiscuss, type Verdict } from '#shared/review/verdict.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { dayLabel, timeOf } from '@/features/reports/time.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import type { Note } from '../notes/notes.ts'
import '../preparing/preparing.css'
import { reviewMemory, useSession } from '../state/context.tsx'
import { unseenNeeds, unseenWords } from './evidence.ts'
import { CONFIRM_MS, createVerdictChoices, handOver, heldDown, suggestionNote, VERDICT_CHOICES, verdictComments, verdictKind, type VerdictCommands } from '../verdict.ts'
import { createReviewRemoval, footOf, KEEPS, REMOVE_REVIEW_LINES, removeChoices, type RemoveChoice } from './foot.ts'

/** The choices that send the reviewer's comments, and have nothing to send without one. */
const needsComment = (verdict: Verdict) => verdict === 'request-changes' || verdict === 'comment'

const noHost: VerdictCommands = async () => {
  throw new Error('Hobkin is not connected here.')
}
const nothingToSave = async () => {}
const inField = () => document.activeElement?.closest('input, textarea, [contenteditable="true"]') != null

/** The choice the foot offers first: merging is what a review that passes ends with. */
const PRIMARY: Verdict = 'approve-merge'
/** What the foot says when a review is removed, which the screen closes on. */
const REMOVED = 'Removed the review.'
/** The height of what the foot says, whatever it says, so nothing above it moves. What does not fit scrolls. */
const SLOT = 'h-[140px]'

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
 * The verdict, fixed at the foot of the review panel, or along the code view's bottom line (`layout: 'line'`), and
 * confirmed in place (`footOf`). Choices in places that never move: Approve, Approve and merge, Talk to agent and
 * Remove, and on a pull request Publish comments and Request changes too. Each but a pull request's Talk to agent is the
 * host's own verdict, for the commit of the review on screen. That one hands the questions to discuss to hobkin in one
 * message, at once, as a question to hobkin goes: nothing is posted. The first click asks the host what it will do: the same
 * button then reads "Click again to confirm", with what will happen under the choices, and a second click within ten
 * seconds does it. Approve and merge of a finished change whose branch moved since the review reads "Merge it as it is
 * now". After ten seconds, on Escape, or when the keyboard leaves the foot, it goes back. A key held down never gives
 * the second click. Once the host has done it, `landed` hears so.
 *
 * Remove is the review and the code. Its first click does nothing: the foot shows what will go and two ways, "Remove it
 * and delete the branch", which has the keyboard, and "Only remove the review", which keeps the branch and the pull
 * request. For another author's pull request there is no branch of the user's to delete: one confirm takes the review out.
 *
 * A change that lands is past choosing (spec 032). While an agent brings it up to date the choices wait, and the foot
 * says so. Once it merged, where it landed takes the choices' place.
 *
 * Nothing moves on the way (the user, 2026-11-12: "approve and merge is doing a weird jump"): the choices keep their
 * size and place whatever they say, and what the foot says keeps its height, scrolling what does not fit.
 */
export function Actions({ review, notes, live, verdict, saveNotes, landed, ask, status, layout = 'panel' }: {
  /** In the panel's foot, a grid with what it says under it; along the code view's bottom line, a row with what it says over it. */
  layout?: 'panel' | 'line'
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
  // Someone else's pull request is approved or commented on, and only its review is removed: its author merges or closes it.
  const foot = footOf(review.id, status?.owner)
  const choosable = removeChoices(foot.remove)
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
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  // Read when a verdict lands, so a new one given later is the one that runs.
  const onLanded = useRef(landed)
  onLanded.current = landed
  const onAsk = useRef(ask)
  onAsk.current = ask
  // Remove was pressed and the foot is showing what goes.
  const [removing, setRemoving] = useState(false)
  // A pull request's Talk to agent: its questions to discuss go to hobkin as one message, and are marked asked once it has them.
  const questions = kind === 'pull' ? questionsToDiscuss(notes) : []
  const [talking, setTalking] = useState(false)
  const talk = async () => {
    const message = discussionMessage(review, questions)
    if (!ask || !message || talking) return
    setTalking(true)
    try {
      if (await ask(message)) {
        reviewMemory.getState().markSent(review, questions.map((note) => note.id), Date.now())
      }
    } finally {
      setTalking(false)
    }
  }
  // A grammar suggestion taken in changes the user's own comment to it. Like any change of the notes, that takes back
  // the choice shown, to be shown again with the words as they are now.
  const suggestion: Suggestion = {
    takes: (original) => suggestionNote(notes, original) != null,
    take: (original, words) => {
      const note = suggestionNote(reviewMemory.getState().notesOf(review), original)
      if (note) reviewMemory.getState().editNote(review, note.id, { text: words, intent: note.intent })
    },
  }

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
  const removal = useMemo(
    () => createReviewRemoval({ id: review.id, command: verdict ?? noHost, removed: () => onLanded.current?.('discard', REMOVED) }),
    [review.id, verdict],
  )
  const removalFlow = useStore(removal)
  // A yes is never blocked: with nodes that need the reviewer not seen, its first press says how many (spec 053).
  const unseen = useSession((session) => unseenNeeds(session.review.nodes, session.seen))
  // What the foot shows for Remove: what goes, with its choices, once it was pressed.
  const removeShown = foot.remove === 'both' ? removing && (armed === 'discard-branch' || flow.busy || flow.error != null) : removalFlow.asked || removalFlow.busy || (removing && removalFlow.error != null)

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

  // Remove goes back to its button once nothing waits and nothing is wrong.
  useEffect(() => {
    if (removing && !armed && !flow.busy && flow.error == null && !removalFlow.asked && !removalFlow.busy && removalFlow.error == null) setRemoving(false)
  }, [armed, flow.busy, flow.error, removalFlow.asked, removalFlow.busy, removalFlow.error, removing])
  // Another choice taken takes Remove back.
  useEffect(() => {
    if (armed && armed !== 'discard-branch') {
      removal.cancel()
      setRemoving(false)
    }
  }, [armed, removal])

  // The button that waits for its second click holds the keyboard, so Enter gives it and leaving takes it back. A key
  // still down from the first only repeats there, and the button stops repeats (`heldDown`): it takes a key pressed anew.
  // Remove's default, "Remove it and delete the branch", or its one choice, holds it the same way.
  useEffect(() => {
    const target = armed === 'discard-branch' ? 'remove-delete' : removalFlow.asked ? 'remove-review' : armed
    const button = target ? buttons.current.get(target) : undefined
    if (button && !inField()) button.focus({ preventScroll: true })
  }, [armed, removalFlow.asked])

  // A change that starts to land, here or elsewhere, takes back a choice that waits. A choice that held the keyboard
  // can no longer hold it, so the keyboard goes to the box under the choices, and stays in the review.
  const landingState = landing?.state ?? null
  useLayoutEffect(() => {
    if (!landingState) return
    if (!doing.current) choices.cancel()
    removal.cancel()
    if (section.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true })
  }, [landingState, choices, removal])

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
  // Remove's first press shows what goes: the host's own words for the no that deletes the branch, or, for another
  // author's pull request, what taking only the review out does.
  const pressRemove = () => {
    if (flow.busy || removalFlow.busy) return
    setRemoving(true)
    if (foot.remove === 'both') void press('discard-branch')
    else {
      choices.cancel()
      removal.ask()
    }
  }
  const choose = (choice: RemoveChoice) => {
    if (choice.id === 'delete') void press('discard-branch')
    else {
      choices.cancel()
      void removal.run()
    }
  }
  const stepBack = () => {
    choices.cancel()
    removal.cancel()
    setRemoving(false)
  }
  const waiting = armed != null || removalFlow.asked
  const off = !verdict || landing != null
  // Under the choices, the foot has a box only while it has something to say.
  const says = Boolean(landing) || flow.busy || flow.error != null || flow.preview != null || flow.message != null || !live

  const line = layout === 'line'
  const choiceClass = line
    ? 'rv-verdict relative h-8 shrink-0 justify-between gap-2 overflow-hidden rounded-full px-3 text-[13px] font-semibold'
    : 'rv-verdict relative h-9 w-full justify-between overflow-hidden rounded-full px-3 text-[14px] font-semibold'
  // Along the line, what the foot says shows over the choices only while it has something to say: never the sample's standing note.
  const speaks = removeShown || Boolean(landing) || flow.busy || flow.error != null || flow.preview != null || flow.message != null
  const saidBox = (
    <div
      ref={box}
      role="status"
      tabIndex={-1}
      className={cn('rv-scroll min-h-0 flex-1 overflow-y-auto rounded-xl px-3 py-2.5 text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] outline-none', says && 'bg-background')}
    >
      <Said kind={kind} live={live} flow={flow} doing={doing.current != null} landing={landing} unseen={unseen} why={foot.why} suggestion={suggestion} />
    </div>
  )
  const said = removeShown ? (
    <RemoveSaid ways={foot.remove} choices={choosable} flow={flow} removal={removalFlow} lines={flow.preview?.verdict === 'discard-branch' ? flow.preview.lines : null} buttons={buttons} onChoose={choose} />
  ) : (
    saidBox
  )

  const choicesRow = (
    <>
      {foot.slots.map((choice) => {
        const waitingHere = armed === choice.verdict
        const working = flow.busy && (doing.current === choice.verdict || asking.current === choice.verdict)
        const primary = choice.verdict === PRIMARY
        const secondClick = choice.verdict === 'approve-merge' && moved ? 'Merge it as it is now' : 'Click again to confirm'
        const label = VERDICT_CHOICES[kind].find((entry) => entry.verdict === choice.verdict)
        // X presses Talk to agent: on a finished change, the host's verdict that takes the notes to its agent.
        const talks = kind === 'change' && choice.verdict === 'request-changes'
        return (
          <Button
            key={choice.verdict}
            ref={(element) => {
              if (element) buttons.current.set(choice.verdict, element)
              else buttons.current.delete(choice.verdict)
            }}
            data-stop
            data-verdict={choice.verdict}
            data-talk={talks ? '' : undefined}
            data-armed={waitingHere}
            aria-pressed={waitingHere}
            title={choice.offered ? undefined : (foot.why ?? undefined)}
            variant={primary ? 'default' : 'outline'}
            className={choiceClass}
            // Not disabled while the host works: a focused button that is disabled drops the keyboard out of the review.
            // A click then does nothing. A change that lands is past choosing, and some choices are not this review's to give.
            disabled={off || !choice.offered || (needsComment(choice.verdict) && comments === 0)}
            // A stopped key presses nothing: Enter held from the first click, or Space held while it was clicked, does not confirm.
            onKeyDown={(event) => {
              if (heldDown(event)) event.preventDefault()
            }}
            onClick={() => void press(choice.verdict)}
          >
            {waitingHere ? (
              <>
                <span className="truncate">{secondClick}</span>
                <span className="rv-confirm-time" aria-hidden="true" style={{ animationDuration: `${CONFIRM_MS}ms` }} />
              </>
            ) : working ? (
              <span className="truncate">{doing.current === choice.verdict ? label?.doing : 'Checking…'}</span>
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
      {kind === 'pull' ? (
        <Button
          data-stop
          data-talk
          variant="outline"
          className={choiceClass}
          title={ask ? 'Your questions to discuss go to hobkin in one message. Your comments stay for the pull request.' : 'Hobkin is not connected here.'}
          // Not disabled while it sends, so the keyboard stays: a second press while it sends does nothing.
          disabled={off || !ask || questions.length === 0}
          onClick={() => void talk()}
        >
          <span className="truncate">
            {talking ? 'Sending…' : 'Talk to agent'}
            {talking ? null : <span className="ml-1.5 tabular-nums">{questions.length}</span>}
          </span>
          <Kbd>X</Kbd>
        </Button>
      ) : null}
      {/* Remove, last: the review and the code. It reads apart from the yeses, in the color of what cannot be taken back. */}
      <Button
        data-stop
        data-remove
        data-armed={removeShown}
        aria-pressed={removeShown}
        variant="outline"
        className={cn(choiceClass, 'text-destructive hover:text-destructive')}
        disabled={off}
        onClick={pressRemove}
      >
        <span className="truncate">Remove</span>
        {removeShown ? <span className="rv-confirm-time" aria-hidden="true" style={{ animationDuration: `${CONFIRM_MS}ms` }} /> : null}
      </Button>
    </>
  )

  return (
    <section
      ref={section}
      aria-label="Verdict"
      className={line ? 'relative flex min-w-0 items-center gap-1.5' : 'flex flex-col gap-2'}
      // Escape steps back from the second click before it reaches the review, which would close.
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || doing.current || !(waiting || flow.busy)) return
        event.preventDefault()
        stepBack()
      }}
      onBlur={(event) => {
        if (doing.current || event.currentTarget.contains(event.relatedTarget)) return
        if (choices.getState().preview) choices.cancel()
        removal.cancel()
      }}
    >
      {line ? (
        <>
          {merged ? (
            <p className="flex items-center gap-2 font-heading text-[13px] font-semibold whitespace-nowrap">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-ok-fg" />
              <span>{mergedWords(landing)}</span>
            </p>
          ) : (
            // A line too narrow for every choice scrolls them, rather than cut the last ones off.
            <div className="scroll-quiet flex min-w-0 items-center gap-1.5 overflow-x-auto px-0.5 py-1">{choicesRow}</div>
          )}
          {/* What it says, over the line: the one thing that may lie over the code, and only while it speaks. */}
          {speaks ? <div className="absolute right-0 bottom-full z-30 mb-2 flex max-h-[260px] w-[min(420px,calc(100vw-2rem))] flex-col rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-float">{said}</div> : null}
        </>
      ) : (
        <>
          {/* The choices' place, a grid that never changes for a kind of review. Once the change merged, where it landed is told in it, at its size. */}
          <div className="grid">
            <div className={cn('col-start-1 row-start-1 grid grid-cols-[5fr_7fr] gap-1.5', merged && 'invisible')} inert={merged}>
              {choicesRow}
            </div>
            {merged ? (
              <p className="col-start-1 row-start-1 flex items-center gap-2 self-center px-1 font-heading text-[15px] leading-snug font-semibold text-pretty">
                <CircleCheck aria-hidden="true" className="size-[18px] shrink-0 text-ok-fg" />
                <span>{mergedWords(landing)}</span>
              </p>
            ) : null}
          </div>

          {/* What the foot says, in a place of its own size. Focusable, so a click into it to scroll keeps the keyboard with the verdict and takes nothing back. */}
          <div className={cn(SLOT, 'flex min-h-0 flex-col gap-1.5')}>{said}</div>
        </>
      )}
    </section>
  )
}

/**
 * What Remove says once pressed: what will go, and its choices under it, "Remove it and delete the branch" first, as the
 * default. A choice that cannot be given yet, because the host has not said what it deletes, waits.
 */
export function RemoveSaid({ ways, choices, flow, removal, lines, buttons, onChoose }: {
  ways: 'both' | 'review'
  choices: RemoveChoice[]
  flow: { busy: boolean; preview: VerdictPreview | null; error: string | null }
  removal: { busy: boolean; error: string | null }
  lines: readonly string[] | null
  buttons: { current: Map<string, HTMLButtonElement> }
  onChoose: (choice: RemoveChoice) => void
}): ReactNode {
  const error = flow.error ?? removal.error
  const working = flow.busy || removal.busy
  const said = ways === 'review' ? REMOVE_REVIEW_LINES : lines
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" aria-label="What Remove will do">
      <div role="status" tabIndex={-1} className="rv-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-xl bg-background px-3 py-2 text-[13.5px] leading-[1.4] text-pretty [overflow-wrap:anywhere] outline-none">
        {error ? (
          <p className="flex items-start gap-2 text-bad-fg">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : working && !said ? (
          <p className="text-muted-foreground">Asking the host what it will do…</p>
        ) : (
          <>
            {said?.map((line, index) => <p key={index}>{line}</p>)}
            {ways === 'both' ? <p className="text-muted-foreground">{KEEPS}</p> : null}
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1.5">
        {choices.map((choice) => (
          <Button
            key={choice.id}
            ref={(element) => {
              if (element) buttons.current.set(`remove-${choice.id}`, element)
              else buttons.current.delete(`remove-${choice.id}`)
            }}
            data-stop
            data-remove-choice={choice.id}
            variant={choice.id === 'delete' || ways === 'review' ? 'destructive' : 'outline'}
            className="h-8 w-full justify-center rounded-full px-3 text-[13.5px] font-semibold"
            disabled={working || (choice.id === 'delete' && flow.preview?.verdict !== 'discard-branch')}
            // A stopped key presses nothing: the Enter that gave the first press does not give the second.
            onKeyDown={(event) => {
              if (heldDown(event)) event.preventDefault()
            }}
            onClick={() => onChoose(choice)}
          >
            <span className="truncate">{choice.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

const labelOf = (kind: 'change' | 'pull', verdict: Verdict) => VERDICT_CHOICES[kind].find((choice) => choice.verdict === verdict)?.label ?? ''

/**
 * What the foot says: how the change lands, the host at work, what a choice will do while it waits for
 * its second click, the host's reason when it will not do it, its words when it did, or the sample notice. Nothing
 * when there is nothing to say.
 */
function Said({ kind, live, flow, doing, landing, unseen, why, suggestion }: {
  suggestion: Suggestion
  kind: 'change' | 'pull'
  live: boolean
  flow: { busy: boolean; preview: VerdictPreview | null; error: string | null; message: string | null }
  doing: boolean
  landing: ReviewLanding | null
  /** How many nodes that need the reviewer are not seen. */
  unseen: number
  /** Why a choice is off, for someone else's pull request. */
  why: string | null
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
  if (flow.preview) return <Preview kind={kind} preview={flow.preview} unseen={isYes(flow.preview.verdict) ? unseenWords(unseen) : null} suggestion={suggestion} />
  if (flow.message) return <Markdown text={flow.message} />
  if (!live) return <p className="text-muted-foreground">Sample review: nothing is sent from here.</p>
  return (
    <div className="flex flex-col gap-1.5 text-muted-foreground">
      {why ? <p className="text-pretty">{why}</p> : null}
      <p className="text-pretty">
        Each choice shows what it does, then asks once more.
      </p>
      <p className="flex items-center gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>/</Kbd> lists every key.
      </p>
    </div>
  )
}

/** The yeses, whose first press says what the reviewer has not seen. */
const isYes = (verdict: Verdict) => verdict === 'approve' || verdict === 'approve-merge'

/**
 * What a choice will do, as the host says it, while the choice waits for its second click. A yes given with nodes that
 * need the reviewer not seen says how many first, and that U goes to the next: the second press still does it.
 */
/** Whether a grammar suggestion can be taken in, by the user's own comment it corrects, and taking it in. */
interface Suggestion {
  takes(original: string): boolean
  take(original: string, words: string): void
}

function Preview({ kind, preview, unseen, suggestion }: { kind: 'change' | 'pull'; preview: VerdictPreview; unseen: string | null; suggestion: Suggestion }) {
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
      {preview.suggested?.length ? (
        <div className="flex flex-col gap-1.5" aria-label="Grammar not changed">
          <p className="text-pretty">Not changed, since it could change what you meant. Use a suggestion to change your words to it:</p>
          {preview.suggested.map(({ original, suggestion: words }, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-lg bg-secondary/70 p-2.5">
              <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">{original}</p>
              <p className="text-[13.5px] leading-[1.45] [overflow-wrap:anywhere] whitespace-pre-wrap">{words}</p>
              {suggestion.takes(original) ? (
                <Button data-stop size="sm" variant="outline" className="h-7 self-start rounded-full px-2.5 text-[13px]" onClick={() => suggestion.take(original, words)}>
                  Use it
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
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
