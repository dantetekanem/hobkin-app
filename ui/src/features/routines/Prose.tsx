import { memo, type ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils.ts'

/**
 * Markdown a routine wrote: its report and its working memory. What a run writes is never markup of ours:
 * raw HTML shows as the text it is, a link opens outside the app, and a picture is never fetched.
 */

type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'ul' | 'ol' | 'li' | 'blockquote' | 'hr' | 'strong' | 'em' | 'code' | 'pre' | 'th' | 'td'

const styled = <Name extends Tag>(Tag: Name, className: string) =>
  function Styled({ node: _node, className: given, ...props }: ComponentProps<Name> & { node?: unknown }) {
    const Element = Tag as React.ElementType
    return <Element {...props} className={cn(given, className)} />
  }

const components: Components = {
  p: styled('p', 'mb-2.5 last:mb-0'),
  h1: styled('h1', 'mt-4 mb-1.5 font-heading text-[16px] leading-snug font-semibold first:mt-0'),
  h2: styled('h2', 'mt-4 mb-1.5 font-heading text-[15px] leading-snug font-semibold first:mt-0'),
  h3: styled('h3', 'mt-3 mb-1 font-heading text-[14px] leading-snug font-semibold first:mt-0'),
  h4: styled('h4', 'mt-3 mb-1 font-heading text-[14px] leading-snug font-medium first:mt-0'),
  ul: styled('ul', 'mb-2.5 list-disc pl-5 last:mb-0'),
  ol: styled('ol', 'mb-2.5 list-decimal pl-5 last:mb-0'),
  li: styled('li', 'my-0.5 pl-0.5 marker:text-muted-foreground'),
  blockquote: styled('blockquote', 'mb-2.5 border-l-2 border-border-strong pl-3 text-muted-foreground last:mb-0'),
  hr: styled('hr', 'my-3 border-border'),
  strong: styled('strong', 'font-semibold'),
  em: styled('em', 'italic'),
  code: styled('code', 'rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.86em]'),
  pre: styled('pre', 'mb-2.5 overflow-x-auto rounded-xl bg-code-bg p-3 font-mono text-[12px] leading-[1.7] text-code-text last:mb-0 [&_code]:bg-transparent [&_code]:p-0'),
  th: styled('th', 'border-b border-border-strong px-2 py-1 text-left font-semibold'),
  td: styled('td', 'border-b border-border px-2 py-1 align-top'),
  table: ({ node: _node, ...props }) => (
    <div className="mb-2.5 overflow-x-auto last:mb-0">
      <table {...props} className="w-full border-collapse text-[13px]" />
    </div>
  ),
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="underline decoration-border-strong underline-offset-2 hover:decoration-foreground" />
  ),
  img: ({ alt, src }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer" className="underline decoration-border-strong underline-offset-2">
      {alt || 'image'}
    </a>
  ),
}

const plugins = [remarkGfm]

export const Prose = memo(function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('text-[14px] leading-relaxed', className)}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
