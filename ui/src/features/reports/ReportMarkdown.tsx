import { createContext, memo, useContext, useMemo, type ComponentProps } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { localPathOf, rehypeCodePaths, remarkFilePaths } from '../viewer/paths.ts'
import { foldsOf, type ReportPart } from './folds.ts'
import { reportLinkOf } from './report-link.ts'

/**
 * A report's Markdown, set for reading. What a run wrote is never markup of ours: raw HTML shows as the text it
 * is, a link keeps only a safe address and opens outside the app, and a picture is never fetched, because an
 * address a report chose could tell someone it was read. A link to another report (`report-link.ts`) opens it in
 * the reader instead. A local file path, in its words or its code, is a link the app's catcher opens in the file
 * sheet (`viewer/paths.ts`, `viewer/catch.ts`). The one HTML it draws is a fold, `<details>` with its
 * `<summary>` (`folds.ts`), whose inside is Markdown under these same rules.
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

/** Opens the report a link names, in the reader. Where nothing provides it, such a link does nothing. */
export const OpenReport = createContext<((id: string) => void) | null>(null)

/** A link to a report keeps its address so its press can find the report. Every other address goes through react-markdown's own rule. */
const keepReportLinks = (url: string, key: string) => (key === 'href' && reportLinkOf(url) !== null ? url : defaultUrlTransform(url))

function Link({ node: _node, href, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  const openReport = useContext(OpenReport)
  const file = localPathOf(href)
  if (file) return <a {...props} href="#" data-file={file} title={file} className={LINK} />
  const id = reportLinkOf(href)
  if (id === null) return <a {...props} href={href} target="_blank" rel="noopener noreferrer" className={LINK} />
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault()
        openReport?.(id)
      }}
      className={LINK}
    />
  )
}

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
  a: Link,
  // A picture shows as its words, linked to where it is. Nothing loads until the user opens it.
  img: ({ alt, src }) => {
    const file = typeof src === 'string' ? localPathOf(src) : null
    if (file) return <a href="#" data-file={file} title={file} className={LINK}>{alt || 'image'}</a>
    return (
      <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer" className={LINK}>
        {alt || 'image'}
      </a>
    )
  },
}

const plugins = [remarkGfm, remarkFilePaths]
const rehypePlugins = [rehypeCodePaths]

/** What a fold's label may hold of Markdown: marks within a line. Anything else in it shows as its words. */
const LABEL_MARKS = ['strong', 'em', 'del', 'code', 'a']

function Parts({ parts }: { parts: readonly ReportPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === 'markdown' ? (
          <ReactMarkdown key={index} remarkPlugins={plugins} rehypePlugins={rehypePlugins} components={components} urlTransform={keepReportLinks}>
            {part.text}
          </ReactMarkdown>
        ) : (
          <details key={index} open={part.open} className="my-4">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              <ReactMarkdown remarkPlugins={plugins} rehypePlugins={rehypePlugins} components={components} urlTransform={keepReportLinks} allowedElements={LABEL_MARKS} unwrapDisallowed>
                {part.summary}
              </ReactMarkdown>
            </summary>
            <div className="mt-2">
              <Parts parts={part.parts} />
            </div>
          </details>
        ),
      )}
    </>
  )
}

/** A failed run's raw error, which hobkin collapses at the end of its report, is one of its folds: "Error details", over the error as code. */
export const ReportMarkdown = memo(function ReportMarkdown({ text }: { text: string }) {
  const parts = useMemo(() => foldsOf(text), [text])
  return <Parts parts={parts} />
})
