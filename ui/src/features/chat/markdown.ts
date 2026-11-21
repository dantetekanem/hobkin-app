import { motion, type Variants } from 'motion/react'
import { createElement, Fragment, memo, type ComponentProps, type ElementType, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stillVariants } from '../../app/still-rule.ts'
import { spring, tween } from '../../lib/motion.ts'
import { localPathOf, remarkFilePaths } from '../viewer/paths.ts'
import { blockStarts } from './stream-buffer.ts'

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

const LINK = 'underline decoration-border-strong underline-offset-2 transition-colors duration-[160ms] ease-[ease] hover:decoration-foreground'

const inline: Components = {
  strong: styled('strong', 'font-semibold'),
  em: styled('em', 'italic'),
  // Inline code. Inside a block the `pre` takes the look over.
  code: styled('code', 'rounded-md bg-surface-2 px-1 py-0.5 font-mono text-[0.87em]'),
  th: styled('th', 'border-b border-border-strong px-2.5 py-1.5 text-left font-semibold'),
  td: styled('td', 'border-b border-border px-2.5 py-1.5 align-top'),
  a: ({ node: _node, ...props }) => {
    const file = localPathOf(props.href)
    // A local file opens in the viewer (the app's link catcher, `viewer/catch.ts`). It opens no window of its own.
    if (file) return createElement('a', { ...props, href: '#', 'data-file': file, title: file, className: LINK })
    return createElement('a', {
      ...props,
      // Links open outside the app, and the page they open gets no handle on this window.
      target: '_blank',
      rel: 'noopener noreferrer',
      className: LINK,
    })
  },
  // A picture shows as its words, linked to where it is. Nothing loads until the user opens it.
  img: ({ alt, src }) => {
    const file = typeof src === 'string' ? localPathOf(src) : null
    if (file) return createElement('a', { href: '#', 'data-file': file, title: file, className: 'underline decoration-border-strong underline-offset-2' }, alt || 'image')
    return createElement('a', { href: typeof src === 'string' ? src : undefined, target: '_blank', rel: 'noopener noreferrer', className: 'underline decoration-border-strong underline-offset-2' }, alt || 'image')
  },
}

const blockNames = Object.keys(BLOCKS) as (keyof typeof BLOCKS)[]

const components: Components = {
  ...inline,
  ...Object.fromEntries(blockNames.map((tag) => [tag, styled(tag, BLOCKS[tag])])),
  // A wide table scrolls by itself and never widens the conversation.
  table: ({ node: _node, ...props }) => createElement('div', { className: TABLE_WRAP }, createElement('table', { ...props, className: TABLE })),
}

const plugins = [remarkGfm, remarkFilePaths]

/** Renders Markdown text. The same component draws a message in the conversation and the preview in the prompt editor. */
export const Markdown = memo(function Markdown({ text }: { text: string }): ReactElement {
  return createElement(ReactMarkdown, { remarkPlugins: plugins, components }, text)
})

/** A message's words. hobkin's replies and the user's own messages are both Markdown. */
export function MessageText({ text }: { text: string; role: 'user' | 'assistant' | 'note' }): ReactElement {
  return createElement(Markdown, { text })
}

/** A block of Markdown that may still grow: its text, where it starts in the whole, and where its fresh pieces began. */
export interface Block {
  key: number
  text: string
  offset: number
  /** In the whole text: the last mark before the block, whose piece may run into it, and every mark inside it. */
  marks: readonly number[]
}

/** A block shorter than this takes in the ones after it, so a long reply is a few dozen blocks to draw, not hundreds. */
const BLOCK_CHARS = 500

/**
 * Markdown that may still grow, in blocks it parses the same in alone (`blockStarts`), each at least BLOCK_CHARS long
 * but the last. A finished block keeps its text and its marks, so it is not drawn, or parsed, again: only the block
 * still being written is.
 */
export function blocksOf(text: string, marks: readonly number[] = []): Block[] {
  const starts: number[] = []
  for (const start of blockStarts(text)) {
    const last = starts.at(-1)
    if (last === undefined || start - last >= BLOCK_CHARS) starts.push(start)
  }

  return starts.map((offset, key) => {
    const end = starts[key + 1] ?? text.length
    let before: number | undefined
    const within: number[] = []
    for (const mark of marks) {
      if (mark <= offset) before = before === undefined ? mark : Math.max(before, mark)
      else if (mark < end) within.push(mark)
    }
    return { key, text: text.slice(offset, end), offset, marks: before === undefined ? within : [before, ...within] }
  })
}

type BlockProps = Omit<Block, 'key'> & { still: boolean }

/** Blocks one after another, with the line break that Markdown parsed whole puts between its blocks. */
const joined = (blocks: ReactElement[]): ReactElement => createElement(Fragment, null, blocks.flatMap((block, at) => (at ? ['\n', block] : [block])))

/** Whether a block draws as it drew last: the same text at the same place, with the same fresh pieces. */
export const sameBlock = (left: BlockProps, right: BlockProps): boolean =>
  left.text === right.text &&
  left.offset === right.offset &&
  left.still === right.still &&
  left.marks.length === right.marks.length &&
  left.marks.every((mark, at) => mark === right.marks[at])

/** Markdown that may still grow, such as what an agent is saying on its page. Only its last block parses again as it grows. */
export function GrowingMarkdown({ text }: { text: string }): ReactElement {
  return joined(blocksOf(text).map(({ key, text: block }) => createElement(Markdown, { key, text: block })))
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
 * recent pieces began, so a piece is wrapped from its first letter, wherever in the structure that falls. A block
 * parsed alone starts `offset` into the source.
 */
function freshSpans(marks: readonly number[], offset = 0) {
  const sorted = [...marks].sort((left, right) => left - right)
  const span = (mark: number, value: string): TreeNode => ({ type: 'element', tagName: 'span', properties: { dataFresh: mark }, children: [{ type: 'text', value }] })

  const split = (node: TreeNode): TreeNode[] => {
    const at = node.position?.start.offset
    const start = at === undefined ? undefined : offset + at
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

/** One block of a reply being written. It draws, and parses, again only when its text or its fresh pieces change. */
const StreamingBlock = memo(function StreamingBlock({ text, offset, marks, still }: BlockProps): ReactElement {
  return createElement(ReactMarkdown, { remarkPlugins: plugins, rehypePlugins: [freshSpans(marks, offset)], components: still ? stillStreamingComponents : streamingComponents }, text)
}, sameBlock)

/**
 * A reply as it is being written. It is the same Markdown as the stored message will be, and it moves: each
 * new block rises into place as it first appears, and the words that just arrived fade in. It is drawn block by
 * block, so each step parses only the block still being written.
 */
export function StreamingMarkdown({ text, marks, still = false }: { text: string; marks: readonly number[]; still?: boolean }): ReactElement {
  return joined(blocksOf(text, marks).map(({ key, ...block }) => createElement(StreamingBlock, { key, ...block, still })))
}
