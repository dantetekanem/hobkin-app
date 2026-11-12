import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Review, StoryStep } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import type { Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'
import { createVerdictChoices, shownFirst, type VerdictCommands } from '../verdict.ts'
import { verdictRequest } from './request.ts'

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

const noHost: VerdictCommands = async () => {
  throw new Error('Hobkin is not connected here.')
}
const nothingToSave = async () => {}
const inField = () => document.activeElement?.closest('input, textarea, [contenteditable="true"]') != null

/**
 * The verdict, in the review panel. A finished change's Approve and Approve and merge are the host's own: the first
 * yes shows exactly what will happen, the second (Enter, or Yes) does it, and the host's answer, or why it cannot,
 * shows here. Send fixes, and a pull request's choices, ask hobkin in its main conversation, and the review closes.
 * The A, M and X keys bring the keyboard to their choice.
 */
export function Actions({ review, notes, live, step, node, close, verdict, saveNotes }: {
  review: Review
  notes: readonly Note[]
  live: boolean
  step: StoryStep | undefined
  node: string | undefined
  close: () => void
  /** The host's verdict commands, for a live review. Without them the host's choices wait. */
  verdict?: VerdictCommands | null
  /** Keeps the reviewer's notes in the host first, so what the host shows is what goes. */
  saveNotes?: () => Promise<void>
}) {
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const kind = review.id.startsWith('pr:') ? 'pull' : 'change'
  const comments = notes.filter((note) => note.intent === 'comment' && note.sent == null).length
  const yes = useRef<HTMLButtonElement>(null)
  // Once the second yes is given, the host is doing it: nothing may hide what it answers.
  const doing = useRef(false)
  const buttons = useRef(new Map<Verdict, HTMLButtonElement>())
  const [chosen, setChosen] = useState<Verdict | null>(null)

  // A request to hobkin in its main conversation, with the comments that go with it. The conversation is where it happens.
  const ask = async (choice: Verdict) => {
    const request = verdictRequest(review, notes, choice)
    if (!live || sending || !request) return
    setSending(true)
    setProblem(null)
    try {
      await runCommand('conversation.send', { text: request.text, review: { id: review.id, ...(step ? { step: step.id } : {}), ...(node ? { node } : {}) } })
      if (request.sends.length > 0) reviewMemory.getState().markSent(review, request.sends, Date.now())
      close()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      setSending(false)
    }
  }
  const latestAsk = useRef(ask)
  latestAsk.current = ask

  const choices = useMemo(
    () => createVerdictChoices({ id: review.id, command: verdict ?? noHost, saveNotes: saveNotes ?? nothingToSave, current: () => true, ask: (choice) => latestAsk.current(choice) }),
    [review.id, verdict, saveNotes],
  )
  useEffect(() => choices.connect(), [choices])
  const flow = useStore(choices)

  // Once the host has said what will happen, the keyboard waits on the yes, so Enter does it.
  useEffect(() => {
    if (flow.preview && !inField()) yes.current?.focus({ preventScroll: true })
  }, [flow.preview])
  const back = () => {
    if (chosen && !inField()) buttons.current.get(chosen)?.focus({ preventScroll: true })
  }
  const choose = (choice: Verdict) => {
    setChosen(choice)
    setProblem(null)
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
          const host = shownFirst(review.id, choice.verdict)
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
              // The host's own choices show what they will do as soon as their key is pressed: the yes is a second key.
              data-shows={host ? '' : undefined}
              aria-pressed={host ? flow.preview?.verdict === choice.verdict : undefined}
              variant={primary ? 'default' : 'outline'}
              className="h-8 px-3 text-[13px]"
              // Not disabled while the host works: a focused button that is disabled drops the keyboard out of the review.
              // A second press then does nothing.
              disabled={!live || sending || (host ? !verdict : verdictRequest(review, notes, choice.verdict) == null)}
              onClick={() => choose(choice.verdict)}
            >
              {choice.label}
              {choice.verdict === 'request-changes' || choice.verdict === 'comment' ? <span className="tabular-nums">{comments}</span> : null}
              {choice.keys ? <Kbd className={primary ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>{choice.keys}</Kbd> : null}
            </Button>
          )
        })}
      </div>

      {flow.preview ? (
        <div role="group" aria-label={`What ${label} will do`} className="flex flex-col gap-2.5 rounded-xl bg-background p-3 ring-1 ring-border-strong/60">
          <p className="font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{label} will</p>
          <ul className="flex flex-col gap-1.5 text-[14px] leading-[1.45] text-pretty">
            {flow.preview.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {flow.preview.note ? <pre className="rv-scroll max-h-48 overflow-y-auto font-sans text-[13px] leading-[1.45] whitespace-pre-wrap">{flow.preview.note}</pre> : null}
          <div className="flex flex-wrap gap-1.5">
            <Button
              ref={yes}
              size="sm"
              data-stop
              className="h-8 px-3 text-[13px]"
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

      <div role="status" className={cn('text-[13px] leading-snug [overflow-wrap:anywhere]', flow.error || problem ? 'text-bad-fg' : flow.message ? 'text-foreground' : 'text-muted-foreground')}>
        {!live ? (
          'Sample review. Nothing is sent.'
        ) : flow.busy ? (
          'Waiting for the host…'
        ) : flow.error ? (
          flow.error
        ) : problem ? (
          problem
        ) : sending ? (
          'Asking Hobkin…'
        ) : flow.message && !flow.preview ? (
          <Markdown text={flow.message} />
        ) : flow.preview ? (
          'Nothing is done until you say yes.'
        ) : kind === 'change' ? (
          'Approve and Approve and merge show what they will do first. Send fixes asks Hobkin in the conversation, and the review closes.'
        ) : (
          'Hobkin carries it out in the conversation, and the review closes.'
        )}
      </div>
    </section>
  )
}
