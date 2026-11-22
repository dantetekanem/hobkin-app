import { useMemo } from 'react'
import type { AssessmentStatus, ChangeAssessment } from '#shared/review/assessment.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { OpenArrow } from '@/components/ui/open-arrow.tsx'
import { cn } from '@/lib/utils.ts'
import '../../proofs/proofs.css'
import type { Tone } from '../../proofs/run/run-view.ts'
import { firstToLook } from '../proof/beside.ts'
import { useSession, useSessionStore } from '../state/context.tsx'
import { useModelRows } from '../story/use-model-checks.ts'
import { evidenceLines, type EvidenceFacts, type EvidenceLine, type EvidenceOpens } from './evidence.ts'

const DOT: Readonly<Record<Tone, string>> = { ok: 'bg-ok-fg', bad: 'bg-bad-fg', warn: 'bg-warn-fg', live: 'pf-pulse bg-sun', quiet: 'bg-muted-foreground' }
const WORDS: Readonly<Record<Tone, string>> = { ok: 'text-foreground', bad: 'text-bad-fg', warn: 'text-warn-fg', live: 'text-foreground', quiet: 'text-muted-foreground' }
/** The key that does what a line's click does, where there is one. */
const KEY: Partial<Record<EvidenceLine['key'], string>> = { models: 'T', seen: 'U' }

interface EvidenceProps {
  assessment: Pick<ChangeAssessment, 'summary'> | null
  status: AssessmentStatus | null | undefined
  parts: EvidenceFacts['parts']
  /** The class of its heading, the panel's own. */
  heading: string
}

/**
 * The evidence for the verdict, right above it (053-work-control-room): the tests, the AI review's answer, the models and
 * proofs, and how many of the nodes that need the reviewer are seen, one line each. A line with something to open is a
 * row that opens it: the test to read first, the first part that needs the reviewer, the proof beside the review, the
 * next node not seen. A line with nothing to open is plain text. Each line keeps its height and its place as the
 * evidence comes in. It reads the seen marks on its own, so a move through the review draws only this again.
 */
export function Evidence({ assessment, status, parts, heading }: EvidenceProps) {
  const store = useSessionStore()
  const nodes = useSession((session) => session.review.nodes)
  const seen = useSession((session) => session.seen)
  const models = useModelRows()
  const lines = useMemo(() => evidenceLines({ nodes, assessment, status, parts, models, seen }), [assessment, models, nodes, parts, seen, status])

  const open = (opens: EvidenceOpens) => {
    const session = store.getState()
    if (opens.to === 'node') return session.reach(opens.id)
    if (opens.to === 'step') return session.goTo(opens.index)
    if (opens.to === 'unseen') return void session.nextUnseen(1)
    const run = firstToLook(models)
    if (run) session.openProof(run, 'evidence')
  }

  return (
    <section aria-label="Evidence" className="flex flex-col gap-0.5">
      <h3 className={heading}>Evidence</h3>
      <ul className="-mx-2 flex flex-col">
        {lines.map((line) => {
          const content = (
            <>
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[line.tone])} />
              <span className="shrink-0 text-[13.5px] text-muted-foreground">{line.label}</span>
              <span className={cn('min-w-0 flex-1 truncate text-[14px]', WORDS[line.tone])}>{line.text}</span>
            </>
          )
          const opens = line.opens
          const key = KEY[line.key]
          return (
            <li key={line.key}>
              {opens ? (
                <button
                  type="button"
                  data-stop
                  {...(line.key === 'models' ? { 'data-proof-from': 'evidence' } : {})}
                  title={`${line.label}: ${line.text}`}
                  onClick={() => open(opens)}
                  className="pressable flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left"
                >
                  {content}
                  {key ? <Kbd>{key}</Kbd> : null}
                  <OpenArrow />
                </button>
              ) : (
                <div className="flex h-8 min-w-0 items-center gap-2 px-2" title={`${line.label}: ${line.text}`}>
                  {content}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
