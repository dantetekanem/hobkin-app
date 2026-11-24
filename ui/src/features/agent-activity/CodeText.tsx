import { useMemo } from 'react'
import '@/features/review/code/code.css'
import { segmentsOf } from '@/features/review/code/segments.ts'
import { FONT, tokenStyle, type Highlighted } from '@/features/review/code/tokens.ts'
import { useHighlighted } from '@/features/review/code/use-highlighted.ts'
import { cn } from '@/lib/utils.ts'
import { coloredUpTo } from './colors.ts'
import { PREVIEW_LINES, previewOf } from './preview.ts'
import { useUnfold } from './unfold.ts'
import { BOX } from './boxes.ts'

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

const MORE = 'rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70 transition-opacity duration-[160ms] ease-[ease] hover:opacity-100'
const number = (count: number) => count.toLocaleString('en-US')
const lines = (count: number) => `${number(count)} ${count === 1 ? 'line' : 'lines'}`

/**
 * Opens a long box in place and closes it back to its first lines. A big one (`onMore`, with `next` lines for the next
 * press and `left` not drawn) opens a part at a time, each press drawing more, with how many are left.
 */
export function MoreButton({ open, count, onToggle, onMore, left = 0, next = 0 }: { open: boolean; count: number; onToggle: () => void; onMore?: () => void; left?: number; next?: number }) {
  const paged = onMore !== undefined && next > 0 && next < left
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={onToggle} className={MORE}>
        {paged ? `Show ${number(next)} more of ${lines(count)}` : `Show all ${lines(count)}`}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      {onMore && left > 0 ? (
        <button type="button" onClick={onMore} className={MORE}>
          {next < left ? `Show ${number(next)} more · ${lines(left)} left` : `Show the last ${lines(left)}`}
        </button>
      ) : null}
      <button type="button" aria-expanded onClick={onToggle} className={MORE}>
        Show less
      </button>
    </span>
  )
}

/**
 * Text a tool was given or gave back, colored by the review's own highlighter (Shiki, in its worker) in the language
 * given, or plain. It is as tall as its lines, wrapped, and never scrolls by itself: a long text shows its first
 * `most` lines and opens in place to more, a big one two hundred lines a press. Only the lines shown are highlighted,
 * so a closed preview costs its few lines.
 */
export function CodeText({ text, language, from, label, note, most = PREVIEW_LINES }: { text: string; language: string | null; from?: number; label: string; note?: string; most?: number }) {
  const { open, presses, toggle, more, box } = useUnfold<HTMLDivElement>()
  const textLines = useMemo(() => linesOf(text), [text])
  const { shown: [count = 0], foldable, left, next } = previewOf([textLines.length], presses, most)
  const head = useHighlighted(foldable ? textLines.slice(0, most).join('\n') : text, language)
  // Opened, the lines drawn are highlighted. Until they are, the first lines keep the colors they had.
  const all = useHighlighted(open && foldable ? coloredUpTo(text, count) : null, language)
  return (
    <div ref={box} className="min-w-0 overflow-hidden rounded-xl bg-code-bg text-code-text shadow-[inset_0_0_0_1px_var(--hb-border)]">
      <div role="region" aria-label={label} {...{ [BOX]: '' }} className="aa-box scroll-quiet py-1.5 font-mono text-[12px] leading-[1.6]">
        {textLines.slice(0, count).map((line, index) => {
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
          {foldable ? <MoreButton open={open} count={textLines.length} onToggle={toggle} onMore={more} left={left} next={next} /> : null}
          {note ? <span className="truncate opacity-50">{note}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
