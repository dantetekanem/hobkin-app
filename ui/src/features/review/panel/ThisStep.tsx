import { CodeXml } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Markdown } from '@/features/chat/markdown.ts'
import { LevelBadge } from '../graph/kinds.tsx'
import { useSessionStore } from '../state/context.tsx'
import { InlineCode } from './InlineCode.tsx'
import type { StepBrief } from './sidebar.ts'

/**
 * The step the reviewer is on, first in the panel under its header (the user, 2026-11-12: "the order is: this step >
 * description that matters for me > agent I can ping and ask > other info"): its number, its level, the claim of the
 * unit it tells, and what changed in a sentence or two. `code` says whether the step has code: Enter, or the button,
 * opens it beside the change review's explanation of it.
 */
export function ThisStep({ brief, code }: { brief: StepBrief; code: boolean }) {
  const store = useSessionStore()
  return (
    <section aria-label="This step" className="flex flex-col gap-2 border-t border-border px-4 pt-3.5 pb-4">
      <div className="flex min-h-[26px] flex-wrap items-center gap-2">
        <span className="font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase tabular-nums">
          Step {brief.index + 1} of {brief.total}
        </span>
        {brief.level ? <LevelBadge level={brief.level} critical={brief.critical} size="large" /> : null}
      </div>
      <h3 className="font-heading text-[16.5px] leading-[1.3] font-semibold text-pretty [overflow-wrap:anywhere]">
        <InlineCode text={brief.title} />
      </h3>
      {brief.what ? (
        <div className="text-[15px] leading-[1.55] text-pretty [overflow-wrap:anywhere]">
          <Markdown text={brief.what} />
        </div>
      ) : null}
      {code ? (
        <button
          type="button"
          data-stop
          onClick={() => store.getState().openCode()}
          className="mt-1 flex h-8 items-center gap-1.5 self-start rounded-full bg-background pr-1.5 pl-3 font-heading text-[13px] font-semibold transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] [&_svg]:size-4"
        >
          <CodeXml aria-hidden="true" />
          The code, explained
          <Kbd>↵</Kbd>
        </button>
      ) : null}
    </section>
  )
}
