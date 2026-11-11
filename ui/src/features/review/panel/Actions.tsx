import { useState } from 'react'
import type { Review, StoryStep } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand } from '@/lib/host/index.ts'
import type { Note } from '../notes/notes.ts'
import { reviewMemory } from '../state/context.tsx'
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

/**
 * The verdict, at the foot of the review panel. Choosing one asks hobkin, in its main conversation, to carry it out,
 * with the review and the comments that go with it, and closes the review: the conversation is where it happens.
 * The A, M and X keys bring the keyboard to their choice, and Enter makes it.
 */
export function Actions({ review, notes, live, step, node, close }: { review: Review; notes: readonly Note[]; live: boolean; step: StoryStep | undefined; node: string | undefined; close: () => void }) {
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const kind = review.id.startsWith('pr:') ? 'pull' : 'change'
  const comments = notes.filter((note) => note.intent === 'comment' && note.sent == null).length

  const ask = async (verdict: Verdict) => {
    const request = verdictRequest(review, notes, verdict)
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

  return (
    <section aria-label="Verdict" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {CHOICES[kind].map((choice) => {
          const primary = choice.verdict === 'approve'
          return (
            <Button
              key={choice.verdict}
              size="sm"
              data-stop
              data-verdict={choice.verdict}
              variant={primary ? 'default' : 'outline'}
              disabled={!live || sending || verdictRequest(review, notes, choice.verdict) == null}
              onClick={() => void ask(choice.verdict)}
            >
              {choice.label}
              {choice.verdict === 'request-changes' || choice.verdict === 'comment' ? <span className="tabular-nums">{comments}</span> : null}
              {choice.keys ? <Kbd className={primary ? 'bg-primary-foreground/15 text-primary-foreground' : undefined}>{choice.keys}</Kbd> : null}
            </Button>
          )
        })}
      </div>
      <p role="status" className="text-[11.5px] leading-snug text-muted-foreground">
        {!live ? 'Sample review. Nothing is sent.' : problem ?? (sending ? 'Asking Hobkin…' : 'Hobkin carries it out in the conversation, and the review closes.')}
      </p>
    </section>
  )
}
