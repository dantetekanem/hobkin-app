import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import { useLayoutEffect, useMemo, useRef, type Ref, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils.ts'
import { liveMarkdown, type LiveStyle } from './live-markdown.ts'

/**
 * The look of each piece. Only what keeps a character's width in a monospace face: weight, slant, color and
 * shading, never size or padding, or the text would drift from the textarea above it. A mark is dimmed last.
 */
const LOOK: Record<LiveStyle, string> = {
  heading: 'font-bold text-foreground',
  strong: 'font-bold',
  em: 'italic',
  strike: 'line-through decoration-muted-foreground',
  code: 'rounded-[3px] bg-code-bg text-code-text',
  fence: 'text-muted-foreground',
  block: 'text-code-text',
  link: 'text-primary underline decoration-primary/40 underline-offset-2',
  url: 'text-muted-foreground',
  quote: 'text-muted-foreground',
  bullet: 'font-bold text-primary',
  rule: 'text-muted-foreground',
  task: 'text-primary',
  mark: 'text-muted-foreground/70',
}

/** One box for both layers: the same face, size, spacing and wrapping, so they lay the text out the same way. */
const BOX = 'px-6 py-4 font-mono text-[14px] leading-[1.7] whitespace-pre-wrap break-words [font-variant-ligatures:none] [tab-size:4] [scrollbar-gutter:stable]'

export interface LiveMarkdownFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'className' | 'children'> {
  value: string
  ref?: Ref<HTMLTextAreaElement>
  className?: string
}

/**
 * A text field that shows its Markdown as it is typed. The words go into a real textarea, so typing, undo,
 * selection, spelling and input methods are the browser's own. Its text is transparent, and under it lies the
 * same text with its look, in the same box, so every character sits exactly where the textarea has it.
 */
export function LiveMarkdownField({ value, ref, className, onScroll, ...props }: LiveMarkdownFieldProps) {
  const layer = useRef<HTMLDivElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const pieces = useMemo(() => liveMarkdown(value), [value])

  // The layer follows the textarea's scroll, and again after each change, since typing can scroll it too.
  const follow = () => {
    if (layer.current && field.current) layer.current.scrollTop = field.current.scrollTop
  }
  useLayoutEffect(follow)

  return (
    <div className={cn('relative min-h-0', className)}>
      <div ref={layer} aria-hidden="true" className={cn(BOX, 'pointer-events-none absolute inset-0 overflow-hidden text-foreground')}>
        {pieces.map((piece, index) =>
          piece.styles.length ? (
            <span key={index} className={cn(...piece.styles.map((style) => LOOK[style]))}>
              {piece.text}
            </span>
          ) : (
            piece.text
          ),
        )}
        {/* A last empty line takes its room, as it does in the textarea. */}
        {value === '' || value.endsWith('\n') ? '​' : null}
      </div>
      <textarea
        {...props}
        ref={(node) => {
          field.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        value={value}
        onScroll={(event) => {
          follow()
          onScroll?.(event)
        }}
        className={cn(
          BOX,
          'scroll-quiet relative block h-full w-full resize-none overflow-y-auto bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25 placeholder:font-sans placeholder:text-muted-foreground',
        )}
      />
    </div>
  )
}
