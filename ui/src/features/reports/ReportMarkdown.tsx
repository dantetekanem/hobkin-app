import { memo, type ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitErrorDetails } from './report.ts'

/**
 * A report's Markdown, set for reading. What a run wrote is never markup of ours: raw HTML shows as the text it
 * is, a link keeps only a safe address and opens outside the app, and a picture is never fetched, because an
 * address a report chose could tell someone it was read. The same rules as the conversation's Markdown.
 */

type Tag = keyof Components & keyof React.JSX.IntrinsicElements

/** A plain element with the reader's classes. A class Markdown set itself, such as a code block's language, is kept. */
const styled =
  <Name extends Tag>(Tag: Name, className: string) =>
  ({ node: _node, className: given, ...props }: ComponentProps<Name> & { node?: unknown }) => {
    const Element = Tag as React.ElementType
    return <Element {...props} className={given ? `${given} ${className}` : className} />
  }

const PRE =
  'my-4 overflow-x-auto rounded-2xl bg-code-bg px-4 py-3 font-mono text-[13px] leading-[1.7] text-code-text [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px]'

const LINK = 'underline decoration-border-strong underline-offset-[3px] transition-colors duration-[160ms] ease-[ease] hover:decoration-foreground'

const components: Components = {
  p: styled('p', 'my-3 first:mt-0 last:mb-0'),
  h1: styled('h1', 'mt-7 mb-2 font-heading text-[20px] leading-snug font-semibold first:mt-0'),
  h2: styled('h2', 'mt-7 mb-2 font-heading text-[17px] leading-snug font-semibold first:mt-0'),
  h3: styled('h3', 'mt-5 mb-1.5 font-heading text-[15px] leading-snug font-semibold first:mt-0'),
  h4: styled('h4', 'mt-5 mb-1.5 font-heading text-[15px] leading-snug font-medium first:mt-0'),
  ul: styled('ul', 'my-3 list-disc pl-5 [&_ul]:my-1'),
  ol: styled('ol', 'my-3 list-decimal pl-5 [&_ol]:my-1'),
  li: styled('li', 'my-1 pl-1 marker:text-muted-foreground'),
  blockquote: styled('blockquote', 'my-3 border-l-2 border-border-strong pl-3 text-muted-foreground'),
  hr: styled('hr', 'my-6 border-border'),
  strong: styled('strong', 'font-semibold'),
  em: styled('em', 'italic'),
  // Inline code. Inside a block, `pre` takes the look over.
  code: styled('code', 'rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.86em]'),
  pre: styled('pre', PRE),
  th: styled('th', 'border-b border-border-strong px-3 py-2 text-left font-heading text-[13px] font-semibold first:pl-0'),
  td: styled('td', 'border-b border-border px-3 py-2 align-top tabular-nums first:pl-0'),
  // A wide table scrolls by itself and never widens the reader.
  table: ({ node: _node, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table {...props} className="w-full border-collapse text-[14px]" />
    </div>
  ),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className={LINK} />,
  // A picture shows as its words, linked to where it is. Nothing loads until the user opens it.
  img: ({ alt, src }) => (
    <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer" className={LINK}>
      {alt || 'image'}
    </a>
  ),
}

const plugins = [remarkGfm]

/** A failed run's raw error, which hobkin collapses at the end of its report, stays folded under "Error details" as plain text. */
export const ReportMarkdown = memo(function ReportMarkdown({ text }: { text: string }) {
  const { markdown, errorDetails } = splitErrorDetails(text)
  return (
    <>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {markdown}
      </ReactMarkdown>
      {errorDetails === null ? null : (
        <details className="my-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">Error details</summary>
          <pre className={PRE}>{errorDetails}</pre>
        </details>
      )}
    </>
  )
})
