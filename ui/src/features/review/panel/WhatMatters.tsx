import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { Markdown } from '@/features/chat/markdown.ts'
import { cn } from '@/lib/utils.ts'
import { LevelBadge } from '../graph/kinds.tsx'
import { useSessionStore } from '../state/context.tsx'
import { AskLink } from './AskLink.tsx'
import { InlineCode } from './InlineCode.tsx'
import type { UnitMatter, WhatMatters as Matters } from './sidebar.ts'

const HEADING = 'font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'
/** How many units and questions show before "Show more": the list stays short, so hobkin's band stays near. */
const SHOWN = 3
/** A claim longer than this shows its first lines, and opens on a click. */
const LONG = 280

/**
 * What matters in the change, second in the panel: what it says it does, the units that need a look, each of which
 * goes to the step that tells it, and the questions they leave for the reviewer. Each has a quick link that asks
 * hobkin about it at once, into the conversation under "Ask hobkin" (the user, 2026-11-12: "it should contain quick
 * links so i can ask that in hobkin right away").
 */
export function WhatMatters({ matters, ask }: { matters: Matters; ask: ((text: string) => Promise<boolean>) | null }) {
  const store = useSessionStore()
  const [whole, setWhole] = useState({ claim: false, units: false, questions: false })
  if (!matters.claim && matters.units.length === 0 && matters.questions.length === 0) return null
  const units = whole.units ? matters.units : matters.units.slice(0, SHOWN)
  const questions = whole.questions ? matters.questions : matters.questions.slice(0, SHOWN)
  const go = (unit: UnitMatter) => {
    if (unit.step != null) store.getState().goTo(unit.step)
    else if (unit.node) store.getState().focusOn(unit.node)
  }

  return (
    <section aria-label="What matters" className="flex flex-col gap-3 border-t border-border px-4 pt-3.5 pb-4">
      <h3 className={HEADING}>What matters</h3>
      {matters.claim ? (
        <div className="flex flex-col gap-1.5">
          <div className={cn('text-[15px] leading-[1.55] text-pretty [overflow-wrap:anywhere]', matters.claim.text.length > LONG && !whole.claim && 'line-clamp-4')}>
            <Markdown text={matters.claim.text} />
          </div>
          <div className="flex items-center justify-between gap-2">
            {matters.claim.text.length > LONG ? (
              <button type="button" data-stop onClick={() => setWhole((before) => ({ ...before, claim: !before.claim }))} className="font-heading text-[13px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {whole.claim ? 'Show less' : 'Show all of it'}
              </button>
            ) : (
              <span />
            )}
            <AskLink compact words={matters.claim.asks} ask={ask} />
          </div>
        </div>
      ) : null}

      {units.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h4 className={HEADING}>Needs a look</h4>
          <ul className="-mx-2 flex flex-col">
            {units.map((unit) => {
              const where = unit.step != null ? `Step ${unit.step + 1}` : unit.node ? 'Its node' : null
              return (
                <li key={unit.key} className="flex items-start gap-1.5">
                  <button
                    type="button"
                    data-stop
                    disabled={!where}
                    title={where ? `Go to ${where.toLowerCase()}` : undefined}
                    onClick={() => go(unit)}
                    className="rv-matter flex min-w-0 flex-1 flex-col items-start gap-1 rounded-lg px-2 py-1.5 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <LevelBadge level={unit.level} critical={unit.critical} />
                      {where ? <span className="font-heading text-[12.5px] font-semibold text-muted-foreground">{where}</span> : null}
                    </span>
                    <span className="text-[14px] leading-[1.45] text-pretty [overflow-wrap:anywhere]">
                      <InlineCode text={unit.text} />
                    </span>
                  </button>
                  <AskLink compact words={unit.asks} ask={ask} className="mt-1.5 mr-2" />
                </li>
              )
            })}
          </ul>
          <More shown={units.length} total={matters.units.length} whole={whole.units} toggle={() => setWhole((before) => ({ ...before, units: !before.units }))} />
        </div>
      ) : null}

      {questions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className={HEADING}>Questions for you</h4>
          <ul className="flex flex-col gap-2.5">
            {questions.map((question) => (
              <li key={question.key} className="flow-root">
                <AskLink compact words={question.asks} ask={ask} className="float-right mt-0.5 ml-2" />
                <p className="text-[14px] leading-[1.45] text-pretty [overflow-wrap:anywhere]">
                  <CircleHelp aria-label="Question" className="mr-1.5 inline size-3.5 align-[-2px] text-sun-fg" />
                  <InlineCode text={question.text} />
                </p>
              </li>
            ))}
          </ul>
          <More shown={questions.length} total={matters.questions.length} whole={whole.questions} toggle={() => setWhole((before) => ({ ...before, questions: !before.questions }))} />
        </div>
      ) : null}
    </section>
  )
}

function More({ shown, total, whole, toggle }: { shown: number; total: number; whole: boolean; toggle: () => void }) {
  if (total <= SHOWN) return null
  return (
    <button type="button" data-stop onClick={toggle} className="self-start font-heading text-[13px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
      {whole ? 'Show fewer' : `Show ${total - shown} more`}
    </button>
  )
}
