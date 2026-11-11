import { motion } from 'motion/react'
import { MessageSquareText } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { sameEntry } from '#shared/protocol/activity.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { risen, sunk } from '@/features/chat/markdown.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import type { Call, CallRow } from './calls.ts'
import { CodeText } from './CodeText.tsx'
import { CodemodeCall } from './CodemodeCall.tsx'
import { CODE_PREVIEW_LINES } from './preview.ts'
import { StateMark } from './StepView.tsx'
import type { EntryTime } from './use-agent-activity.ts'

const arriving = { transform: spring.rise, opacity: tween.enter }

/**
 * One row of the run in code mode: a tool call as its task, its parameters and its output, or a slim line of what the
 * agent said between calls. A row rises into place when it arrives, as a step of the transcript does. One whose entry
 * did not change is not drawn again, so a reconnect that resends every entry redraws nothing.
 */
export const CallItem = memo(
  function CallItem({ row, timeOf }: { row: CallRow; timeOf: (id: string) => EntryTime | undefined; ended: boolean }) {
    const still = useStill()
    return (
      <motion.li
        data-step={row.kind}
        tabIndex={-1}
        initial={holdStill(sunk, still)}
        animate={holdStill({ ...risen, transition: arriving }, still)}
        style={{ transformOrigin: '0% 100%' }}
        className={cn(
          'w-full min-w-0 rounded-[18px] text-left outline-none [content-visibility:auto] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]',
          row.kind === 'says' ? '[contain-intrinsic-size:auto_40px]' : '[contain-intrinsic-size:auto_220px]',
        )}
      >
        {row.kind === 'says' ? <Says text={row.text} /> : <CallCard call={row} time={timeOf(row.key)} />}
      </motion.li>
    )
  },
  (before, after) => before.timeOf === after.timeOf && before.ended === after.ended && sameEntry(before.row.entry, after.row.entry),
)

/** The agent's words between calls, kept to two lines so the calls stay the thing read. */
function Says({ text }: { text: string }) {
  return (
    <p className="flex min-w-0 items-start gap-2 px-2.5 text-[13px] leading-relaxed text-muted-foreground" title={text}>
      <MessageSquareText className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
      <span className="line-clamp-2 min-w-0">{text.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()}</span>
    </p>
  )
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  )
}

/**
 * A call as task, parameters and output, all open and as tall as they are, with how it stands. Only a very long text
 * shows its first lines with a way to show the rest in place. One that failed carries a red edge and says why.
 */
function CallCard({ call, time }: { call: Call; time?: EntryTime }) {
  if (call.name === 'codemode') return <CodemodeCall entry={call.entry} ended={call.state === 'stopped'} />
  const failed = call.state === 'failed'
  const { lead, subject, code } = call.task
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-2xl bg-card px-4 py-3',
        failed ? 'shadow-[inset_3px_0_0_var(--hb-bad),inset_0_0_0_1px_var(--hb-border)]' : 'shadow-[inset_0_0_0_1px_var(--hb-border)]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <code className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] font-medium">{call.name}</code>
        <span className={cn('min-w-0 flex-1 truncate', failed && 'text-bad-fg')}>
          {lead}
          {subject ? <> {code ? <code className="font-mono text-[12px]">{subject}</code> : subject}</> : null}
        </span>
        <StateMark state={call.state} time={time} exitCode={call.exitCode} />
      </div>
      {call.parameters ? (
        <Part label="Parameters">
          <CodeText text={call.parameters} language={call.parametersLanguage} label={`Parameters of ${call.name}`} most={CODE_PREVIEW_LINES} />
          {call.long.map((long) => (
            <div key={long.field} className="flex min-w-0 flex-col gap-1">
              <code className="pl-1 font-mono text-[11px] text-muted-foreground">↓ {long.field}</code>
              <CodeText text={long.text} language={long.language} label={`${long.field} of ${call.name}`} most={CODE_PREVIEW_LINES} />
            </div>
          ))}
        </Part>
      ) : null}
      <Part label="Output">
        {call.output.trim() ? <CodeText text={call.output} language={call.outputLanguage} from={call.from} label={`Output of ${call.name}`} note={call.notice} most={CODE_PREVIEW_LINES} /> : null}
        {call.error ? (
          <p className="font-mono text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-bad-fg">{call.error}</p>
        ) : !call.output.trim() ? (
          <p className="text-[12px] text-muted-foreground">{call.state === 'running' ? 'Nothing yet.' : call.state === 'stopped' ? 'It stopped before it gave anything back.' : 'Nothing came back.'}</p>
        ) : null}
      </Part>
    </div>
  )
}
