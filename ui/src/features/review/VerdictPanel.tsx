import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Review } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import { Button } from '@/components/ui/button.tsx'
import { reviewMemory } from './state/context.tsx'
import { createVerdict, type VerdictCommands } from './verdict.ts'

const LABEL: Record<Verdict, string> = { comment: 'Comment', approve: 'Approve', 'request-changes': 'Request changes' }

/** The host's exact preview, followed by a separate, explicit send. Opening this panel sends nothing. */
export function VerdictPanel({ review, command, saveNotes, current }: { review: Review; command: VerdictCommands; saveNotes: () => Promise<void>; current: () => boolean }) {
  const [open, setOpen] = useState(false)
  const submit = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) submit.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])
  const flow = useMemo(() => createVerdict({ id: review.id, command, saveNotes, current }), [review, command, saveNotes, current])
  const state = useStore(flow)
  useEffect(() => {
    const disconnect = flow.connect()
    let known = reviewMemory.getState().of(review)
    const unsubscribe = reviewMemory.subscribe(() => {
      const next = reviewMemory.getState().of(review)
      if (next.notes !== known.notes || next.draft !== known.draft) flow.cancel()
      known = next
    })
    return () => { unsubscribe(); disconnect() }
  }, [flow, review])
  const close = () => { flow.cancel(); setOpen(false) }
  return (
    <div className="absolute right-4 top-28 z-30 max-w-lg" onKeyDown={(event) => {
      if (!open) return
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }}>
      {!open ? <Button ref={submit} onClick={() => setOpen(true)}>Submit review</Button> : (
        <section aria-label="Review verdict" className="rv-float flex max-h-[65vh] flex-col gap-3 overflow-y-auto rounded-xl border p-4">
          <h2 className="font-heading font-semibold">Review verdict</h2>
          <p className="text-sm text-muted-foreground">Your saved comments go with the verdict. Questions stay with hobkin. Finish any note you are still writing before previewing.</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LABEL) as Verdict[]).map((choice) => <Button key={choice} variant="outline" disabled={state.busy} onClick={() => void flow.preview(choice)}>Preview {LABEL[choice].toLowerCase()}</Button>)}
          </div>
          {state.preview ? <div className="flex flex-col gap-3" aria-label="Exact verdict preview">
            {state.preview.lines.map((line, index) => <p className="whitespace-pre-wrap text-sm" key={index}>{line}</p>)}
            {state.preview.post ? <>
              <p className="text-xs text-muted-foreground">{state.preview.post.event} · {state.preview.post.commit_id}</p>
              <pre className="whitespace-pre-wrap text-sm">{state.preview.post.body}</pre>
              {state.preview.post.comments.map((comment, index) => <div key={index} className="text-sm">
                <p>{comment.path} · {comment.side} · {comment.start_line ? `${comment.start_line}–` : ''}{comment.line}</p>
                <p className="whitespace-pre-wrap">{comment.body}</p>
              </div>)}
            </> : null}
            {state.preview.note ? <pre className="whitespace-pre-wrap text-sm">{state.preview.note}</pre> : null}
            <Button disabled={state.busy} onClick={() => void flow.confirm()}>Confirm {LABEL[state.preview.verdict].toLowerCase()}</Button>
          </div> : null}
          <div role="status" className="whitespace-pre-wrap text-sm">{state.busy ? 'Waiting for the host…' : state.error ?? state.message}</div>
          <Button variant="ghost" onClick={close}>Cancel</Button>
        </section>
      )}
    </div>
  )
}
