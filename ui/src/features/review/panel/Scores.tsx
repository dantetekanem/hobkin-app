import type { ChangeScores } from '#shared/protocol/work.ts'
import { scoresView } from './scores.ts'

/**
 * What hobkin's own scored review gave a finished change (049-yolo-mode, "The scores"; spec 032): its kind and general
 * rate, then each of the five scores with its number and its line of evidence, a line for each floor that holds it
 * whatever the rate, and a line when the scores are for an older commit. A change that was not scored says so and what
 * starts a scored review. A score says how well a question is answered. It is never the review's level.
 */
export function Scores({ scores, heading }: { scores: ChangeScores | null | undefined; heading: string }) {
  const view = scoresView(scores)

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className={heading}>Scores</h3>
      {view.none ? <p className="text-[14px] leading-5 text-muted-foreground">{view.none}</p> : null}
      {view.heading ? <p className="text-[14px] leading-5 font-medium">{view.heading}</p> : null}
      {view.rows.length > 0 ? (
        <ul className="flex flex-col">
          {view.rows.map((row) => (
            <li key={row.name} className="flex min-w-0 items-baseline gap-2 py-0.5">
              <span className="w-[8.5rem] shrink-0 text-[14px] leading-5 text-muted-foreground @max-[300px]:w-24">{row.name}</span>
              <span className="w-5 shrink-0 text-right font-mono text-[13px] leading-5 tabular-nums">{row.number}</span>
              <span className="min-w-0 flex-1 text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]" title={row.evidence}>
                {row.evidence}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.floors.map((line) => (
        <p key={line} className="text-[14px] leading-5 text-warn-fg">
          {line}
        </p>
      ))}
      {view.older ? <p className="text-[14px] leading-5 text-muted-foreground">{view.older}</p> : null}
    </div>
  )
}
