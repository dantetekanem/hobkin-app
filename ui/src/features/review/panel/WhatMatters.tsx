import { ChevronRight, CircleHelp } from 'lucide-react'
import { useState } from 'react'
import type { ChangeScores } from '#shared/protocol/work.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { useSession, useSessionStore } from '../state/context.tsx'
import { useModelRows } from '../story/use-model-checks.ts'
import { AskLink } from './AskLink.tsx'
import { InlineCode } from './InlineCode.tsx'
import { ModelChecks } from './ModelChecks.tsx'
import { Scores } from './Scores.tsx'
import { scoresWanted } from './scores.ts'
import type { UnitMatter, WhatMatters as Matters } from './sidebar.ts'

const HEADING = 'font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'
/** How many units show before "more", so the panel stays short. */
const SHOWN = 4

/**
 * Under the panel's header, the same on every step (the user, 2026-11-12: "Sidebar should be a constant explanation
 * of what this does. not long."): what the change does, in three sentences at most; one line for each unit that needs
 * a look, its level and its claim, which goes to the step that tells it, with a quick link that asks hobkin about it;
 * and how many questions are open, which goes to the step of the first. The step itself is told on the canvas. For a
 * hobkin change, each TLA+ model and what TLC said of it at the reviewed head sits under what it does, each opening its run.
 */
export function WhatMatters({ matters, ask, scores }: { matters: Matters; ask: ((text: string) => Promise<boolean>) | null; scores?: ChangeScores | null }) {
  const store = useSessionStore()
  const [whole, setWhole] = useState(false)
  const models = useModelRows()
  const scored = useSession((session) => scoresWanted(session.review.id))
  const { does, questions } = matters
  if (!does && matters.units.length === 0 && questions.count === 0 && models.length === 0 && !scored) return null
  const units = whole ? matters.units : matters.units.slice(0, SHOWN)
  const go = (unit: UnitMatter) => {
    if (unit.step != null) store.getState().goTo(unit.step)
    else if (unit.node) store.getState().focusOn(unit.node)
  }

  return (
    <section aria-label="What this change does" className="flex flex-col gap-3 border-t border-border px-4 pt-3.5 pb-4">
      {does ? (
        <div className="flex flex-col gap-1.5">
          <h3 className={HEADING}>What this change does</h3>
          <div className="text-[15px] leading-[1.55] text-pretty [overflow-wrap:anywhere]">
            <Markdown text={does} />
          </div>
        </div>
      ) : null}

      {scored ? <Scores scores={scores} heading={HEADING} /> : null}

      {models.length > 0 ? <ModelChecks rows={models} heading={HEADING} /> : null}

      {units.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <h3 className={HEADING}>Needs a look</h3>
          <ul className="-mx-2 flex flex-col">
            {units.map((unit) => {
              const where = unit.step != null ? `step ${unit.step + 1}` : unit.node ? 'its node' : null
              return (
                <li key={unit.key} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    data-stop
                    disabled={!where}
                    title={where ? `${unit.text} (go to ${where})` : unit.text}
                    onClick={() => go(unit)}
                    className="rv-matter flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left"
                  >
                    {/* Only a part that can break is marked. The rest are worth a look, and say why in their own words. */}
                    {unit.level === 'high' ? (
                      <span className="rv-level shrink-0" data-level="high" data-critical={unit.critical}>
                        Breaks
                        {unit.critical ? <span className="sr-only">, and needs a fix</span> : null}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      <InlineCode text={unit.text} />
                    </span>
                  </button>
                  <AskLink iconOnly words={unit.asks} ask={ask} />
                </li>
              )
            })}
          </ul>
          {matters.units.length > SHOWN ? (
            <button type="button" data-stop onClick={() => setWhole((before) => !before)} className="self-start font-heading text-[13px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {whole ? 'Show fewer' : `Show ${matters.units.length - SHOWN} more`}
            </button>
          ) : null}
        </div>
      ) : null}

      {questions.count > 0 ? (
        <button
          type="button"
          data-stop
          disabled={questions.step == null}
          onClick={() => questions.step != null && store.getState().goTo(questions.step)}
          className="rv-matter -mx-2 flex h-8 items-center gap-2 rounded-lg px-2 text-left"
        >
          <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-sun-fg" />
          <span className="min-w-0 flex-1 truncate text-[14px]">{questions.count === 1 ? '1 open question' : `${questions.count} open questions`}</span>
          {questions.step != null ? (
            <span className="flex shrink-0 items-center gap-0.5 font-heading text-[12.5px] font-semibold text-muted-foreground">
              Step {questions.step + 1}
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </span>
          ) : null}
        </button>
      ) : null}
    </section>
  )
}
