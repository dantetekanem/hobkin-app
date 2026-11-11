import { useMemo } from 'react'
import '@/features/review/code/code.css'
import { segmentsOf } from '@/features/review/code/segments.ts'
import { FONT, tokenStyle, type Highlighted } from '@/features/review/code/tokens.ts'
import { useHighlighted } from '@/features/review/code/use-highlighted.ts'
import { cn } from '@/lib/utils.ts'
import { PREVIEW_LINES, previewOf } from './preview.ts'
import { useUnfold } from './unfold.ts'

const linesOf = (text: string) => text.replace(/\n+$/, '').split('\n')

/** One line in its colors, drawn the way the review's diff draws one. */
function Tokens({ line, tokens, styles }: { line: string; tokens: Highlighted['lines'][number] | undefined; styles: Highlighted['styles'] }) {
  if (line === '') return '​'
  return segmentsOf(line, tokens, []).map((segment, index) => {
    const style = tokens ? styles[segment.style] : undefined
    return (
      <span
        key={index}
        style={style ? tokenStyle(style) : undefined}
        data-li={style && style.lightFont & FONT.italic ? '' : undefined}
        data-di={style && style.darkFont & FONT.italic ? '' : undefined}
        data-lb={style && style.lightFont & FONT.bold ? '' : undefined}
        data-db={style && style.darkFont & FONT.bold ? '' : undefined}
      >
        {segment.text}
      </span>
    )
  })
}

/** Opens a long box to all of its lines in place, and closes it back to its first ones. */
export function MoreButton({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70 transition-opacity duration-[160ms] ease-[ease] hover:opacity-100">
      {open ? 'Show less' : `Show all ${count.toLocaleString('en-US')} lines`}
    </button>
  )
}

/**
 * Text a tool was given or gave back, colored by the review's own highlighter (Shiki, in its worker) in the language
 * given, or plain. It is as tall as its lines, wrapped, and never scrolls by itself: a long text shows its first
 * `most` lines and opens in place to the rest. Only the lines shown are highlighted, so a closed preview costs its few lines.
 */
export function CodeText({ text, language, from, label, note, most = PREVIEW_LINES }: { text: string; language: string | null; from?: number; label: string; note?: string; most?: number }) {
  const { open, toggle, box } = useUnfold<HTMLDivElement>()
  const lines = useMemo(() => linesOf(text), [text])
  const { shown: [count = 0], foldable } = previewOf([lines.length], open, most)
  const head = useHighlighted(foldable ? lines.slice(0, most).join('\n') : text, language)
  // Opened, the whole text is highlighted. Until it is, the first lines keep the colors they had.
  const all = useHighlighted(open && foldable ? text : null, language)
  return (
    <div ref={box} className="min-w-0 overflow-hidden rounded-xl bg-code-bg text-code-text shadow-[inset_0_0_0_1px_var(--hb-border)]">
      <div role="region" aria-label={label} className="py-1.5 font-mono text-[12px] leading-[1.6]">
        {lines.slice(0, count).map((line, index) => {
          const source = all.lines[index] ? all : head
          return (
            <div key={index} className={cn('grid', from === undefined ? 'grid-cols-[minmax(0,1fr)] pl-3.5' : 'grid-cols-[3.4em_minmax(0,1fr)]')}>
              {from === undefined ? null : <span className="pr-3 text-right tabular-nums opacity-40 select-none">{from + index}</span>}
              <code className="dv-code">
                <Tokens line={line} tokens={source.lines[index]} styles={source.styles} />
              </code>
            </div>
          )
        })}
      </div>
      {foldable || note ? (
        <div className="flex items-center gap-2 px-2 pb-1.5 text-[11px]">
          {foldable ? <MoreButton open={open} count={lines.length} onToggle={toggle} /> : null}
          {note ? <span className="truncate opacity-50">{note}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
