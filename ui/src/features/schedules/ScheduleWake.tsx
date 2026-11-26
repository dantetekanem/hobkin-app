import { CalendarClock } from 'lucide-react'
import { memo } from 'react'
import { useArrival } from '@/features/agent-activity/arrive.ts'
import { useBlock } from '@/features/agent-activity/blocks.ts'
import { CodeText } from '@/features/agent-activity/CodeText.tsx'
import { Stamped } from '@/features/agent-activity/Stamp.tsx'
import { FoldRow } from '@/features/agent-activity/StepView.tsx'
import { cn } from '@/lib/utils.ts'
import type { ScheduleWake } from './wake.ts'

/**
 * The message a schedule woke its agent with, on the agent's page (`wake.ts`): one quiet row named by its schedules,
 * timed when the message came, which opens under itself to the whole message as a tool call's row opens to its output,
 * by a click, by Enter, or with every other tool block by Control+O.
 */
export const ScheduleWakeItem = memo(
  function ScheduleWakeItem({ wake, at }: { wake: ScheduleWake; at: number | null }) {
    const arrival = useArrival()
    const { open, toggle } = useBlock('other')
    return (
      <li
        data-step="wake"
        tabIndex={-1}
        className={cn('w-full min-w-0 rounded-[18px] px-2.5 text-left outline-none [contain:content] focus-visible:[box-shadow:0_0_0_2px_var(--hb-focus)]', arrival)}
      >
        <Stamped at={at} line="row">
          <div className="flex flex-col gap-1">
            <FoldRow icon={CalendarClock} open={open} onToggle={toggle}>
              <span className="truncate font-medium">{wake.title}</span>
            </FoldRow>
            {open ? <CodeText text={wake.text} language={wake.language} label={`What ${wake.title} woke it with`} /> : null}
          </div>
        </Stamped>
      </li>
    )
  },
  (before, after) => before.at === after.at && before.wake.title === after.wake.title && before.wake.text === after.wake.text,
)
