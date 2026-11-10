import { motion, type Variants } from 'motion/react'
import { createElement, memo, type ComponentProps, type ElementType, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stillVariants } from '../../app/still-rule.ts'
import { spring, tween } from '../../lib/motion.ts'

/**
 * Markdown as the conversation and the prompt editor draw it. What a model writes is never markup of ours:
 * raw HTML shows as the text it is, a link keeps only a safe address, and a picture is never fetched, because
 * an address a message chose could tell someone the message was read.
 *
 * This file has no JSX so the tests can render it with Node alone.
 */

type Tag = keyof Components & keyof React.JSX.IntrinsicElements

/** The blocks of a message. In a reply being written, each one rises into place as it first appears. */
const BLOCKS = {
  p: 'mb-3 whitespace-pre-wrap last:mb-0',
  h1: 'mt-5 mb-2 text-[20px] leading-snug font-semibold first:mt-0',
  h2: 'mt-5 mb-2 text-[17px] leading-snug font-semibold first:mt-0',
  h3: 'mt-4 mb-1.5 text-[15px] leading-snug font-semibold first:mt-0',
  h4: 'mt-4 mb-1.5 text-[15px] leading-snug font-medium first:mt-0',
  ul: 'mb-3 list-disc pl-5 last:mb-0 [&_ul]:mb-0',
  ol: 'mb-3 list-decimal pl-5 last:mb-0 [&_ol]:mb-0',
  li: 'my-0.5 pl-0.5 marker:text-muted-foreground',
  blockquote: 'mb-3 border-l-2 border-border-strong pl-3 text-muted-foreground last:mb-0',
  hr: 'my-4 border-border',
  pre: 'mb-3 overflow-x-auto rounded-xl bg-code-bg p-3 font-mono text-[13px] leading-[1.7] text-code-text last:mb-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[13px]',
} as const satisfies Partial<Record<Tag, string>>

const TABLE_WRAP = 'mb-3 overflow-x-auto last:mb-0'
const TABLE = 'w-full border-collapse text-[14px]'

/**
 * A plain element with the app's classes. A class Markdown itself set, such as a code block's `language-ts`,
 * is kept for the highlighter. react-markdown's own `node` prop stays out of the DOM.
 */
const styled =
  <Name extends Tag>(tag: ElementType, className: string, motionProps?: object) =>
  ({ node: _node, className: given, ...props }: ComponentProps<Name> & { node?: unknown }) =>
    createElement(tag, { ...props, ...motionProps, className: given ? `${given} ${className}` : className })

const inline: Components = {
  strong: styled('strong', 'font-semibold'),
  em: styled('em', 'italic'),
  // Inline code. Inside a block the `pre` takes the look over.
  code: styled('code', 'rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.87em]'),
  th: styled('th', 'border-b border-border-strong px-2.5 py-1.5 text-left font-semibold'),
  td: styled('td', 'border-b border-border px-2.5 py-1.5 align-top'),
  a: ({ node: _node, ...props }) =>
    createElement('a', {
      ...props,
      // Links open outside the app, and the page they open gets no handle on this window.
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'underline decoration-border-strong underline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:decoration-foreground',
    }),
  // A picture shows as its words, linked to where it is. Nothing loads until the user opens it.
  img: ({ alt, src }) => createElement('a', { href: typeof src === 'string' ? src : undefined, target: '_blank', rel: 'noopener noreferrer', className: 'underline decoration-border-strong underline-offset-2' }, alt || 'image'),
}

const blockNames = Object.keys(BLOCKS) as (keyof typeof BLOCKS)[]

const components: Components = {
  ...inline,
  ...Object.fromEntries(blockNames.map((tag) => [tag, styled(tag, BLOCKS[tag])])),
  // A wide table scrolls by itself and never widens the conversation.
  table: ({ node: _node, ...props }) => createElement('div', { className: TABLE_WRAP }, createElement('table', { ...props, className: TABLE })),
}

const plugins = [remarkGfm]

/** Renders Markdown text. The same component draws a message in the conversation and the preview in the prompt editor. */
export const Markdown = memo(function Markdown({ text }: { text: string }): ReactElement {
  return createElement(ReactMarkdown, { remarkPlugins: plugins, components }, text)
})

/** A message's words. hobkin's replies and the user's own messages are both Markdown. */
export function MessageText({ text }: { text: string; role: 'user' | 'assistant' | 'note' }): ReactElement {
  return createElement(Markdown, { text })
}

/**
 * How a piece of a canvas screen rises into place (`Rise` in the frame's `Reveal.tsx`): from a little below,
 * a little small and clear, to rest. Messages and the blocks of a reply being written arrive the same way.
 */
export const sunk = { opacity: 0, transform: 'translateY(26px) scale(0.98)' }
export const risen = { opacity: 1, transform: 'translateY(0px) scale(1)' }
export const rise: Variants = {
  enter: sunk,
  center: { ...risen, transition: { transform: spring.rise, opacity: tween.enter } },
}

const rising = { variants: rise, initial: 'enter', animate: 'center' }
// Under Still a block only fades in.
const risingStill = { variants: stillVariants(rise, true), initial: 'enter', animate: 'center' }
const moving = motion as unknown as Record<string, ElementType>

function streamingComponentsWith(arrival: typeof rising): Components {
  return {
  ...inline,
  ...Object.fromEntries(blockNames.map((tag) => [tag, styled(moving[tag]!, BLOCKS[tag], arrival)])),
  table: ({ node: _node, ...props }) => createElement(motion.div, { ...arrival, className: TABLE_WRAP }, createElement('table', { ...props, className: TABLE })),
  // Text that just arrived fades in. Only opacity moves, so the block around it never jumps.
  span: ({ node: _node, ...props }) =>
    'data-fresh' in props ? createElement(motion.span, { ...(props as object), initial: { opacity: 0 }, animate: { opacity: 1 }, transition: tween.enter }) : createElement('span', props),
  }
}

const streamingComponents = streamingComponentsWith(rising)
const stillStreamingComponents = streamingComponentsWith(risingStill)

interface TreeNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: TreeNode[]
  position?: { start: { offset?: number } }
}

/**
 * Wraps the text that arrived lately in spans of its own. `marks` are the places in the source where the
 * recent pieces began, so a piece is wrapped from its first letter, wherever in the structure that falls.
 */
function freshSpans(marks: readonly number[]) {
  const sorted = [...marks].sort((left, right) => left - right)
  const span = (mark: number, value: string): TreeNode => ({ type: 'element', tagName: 'span', properties: { dataFresh: mark }, children: [{ type: 'text', value }] })

  const split = (node: TreeNode): TreeNode[] => {
    const start = node.position?.start.offset
    const value = node.value ?? ''
    if (start === undefined || start + value.length <= sorted[0]!) return [node]

    const pieces: TreeNode[] = []
    // The piece this text begins in, if it begins after a mark.
    let mark = sorted.findLast((at) => at <= start) ?? null
    let from = 0
    for (const cut of [...sorted.filter((at) => at > start && at < start + value.length).map((at) => at - start), value.length]) {
      const piece = value.slice(from, cut)
      if (piece) pieces.push(mark === null ? { type: 'text', value: piece } : span(mark, piece))
      mark = start + cut
      from = cut
    }
    return pieces
  }
  const walk = (parent: TreeNode) => {
    parent.children = (parent.children ?? []).flatMap((child) => {
      if (child.type === 'text') return split(child)
      walk(child)
      return [child]
    })
  }
  return () => (tree: TreeNode) => {
    if (sorted.length) walk(tree)
  }
}

/**
 * A reply as it is being written. It is the same Markdown as the stored message will be, and it moves: each
 * new block rises into place as it first appears, and the words that just arrived fade in.
 */
export function StreamingMarkdown({ text, marks, still = false }: { text: string; marks: readonly number[]; still?: boolean }): ReactElement {
  return createElement(ReactMarkdown, { remarkPlugins: plugins, rehypePlugins: [freshSpans(marks)], components: still ? stillStreamingComponents : streamingComponents }, text)
}
