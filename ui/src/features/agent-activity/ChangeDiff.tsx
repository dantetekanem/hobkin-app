import { useMemo, useState } from 'react'
import { describeFile, expandGap, showWholeFile, startView, unifiedRows, type Diff, type DiffView, type FileSides } from '@/features/review/code/diff-rows.ts'
import { DiffGapRow, DiffLineRow } from '@/features/review/code/DiffView.tsx'
import { languageOf } from '@/features/review/code/languages.ts'
import { useColors } from './use-colors.ts'

/**
 * One place a file changed, drawn whole at its own height with the review's own rows, as `DiffView` draws it with
 * `natural`: its first `rows` rows, with "Show more" in a band of held-back lines. Its colors are the ones kept for it
 * when it was shown before, on the first paint (colors.ts). Seen for the first time, its lines are drawn at once,
 * plain, and take their colors in place once it is in or near view: the same lines, at the same size.
 */
export function ChangeDiff({ file, diff, rows, near }: { file: FileSides; diff: Diff; rows: number; near: boolean }) {
  const language = languageOf(file.path)
  const head = useColors(file.head, language, near)
  const base = useColors(file.base === file.head ? null : file.base, language, near)
  const start = useMemo(() => startView(diff), [diff])
  // Lines the user showed with "Show more" belong to the diff they were shown in: the change growing starts again from its changes.
  const [shown, setShown] = useState<{ diff: Diff; view: DiffView } | null>(null)
  const view = shown?.diff === diff ? shown.view : start
  const items = useMemo(() => unifiedRows(diff, view), [diff, view])
  const show = (next: DiffView) => setShown({ diff, view: next })
  const { title, note } = describeFile(file)

  if (note) {
    return (
      <div className="dv">
        <p className="dv-note">{note}</p>
      </div>
    )
  }
  return (
    <div className="dv" style={{ height: 'auto', overflow: 'visible' }} aria-label={`Changes in ${title}`} data-rv-code>
      {items.slice(0, rows).map((item) => (
        <div key={item.key}>
          {item.type === 'gap' ? (
            <DiffGapRow item={item} whole={!diff.partial} onMore={(direction) => show(expandGap(view, item.id, direction))} onWhole={() => show(showWholeFile(view))} />
          ) : (
            <DiffLineRow line={item.line} numbers="both" base={base} head={head} dim={false} selection={null} marks={undefined} onPick={undefined} />
          )}
        </div>
      ))}
    </div>
  )
}
