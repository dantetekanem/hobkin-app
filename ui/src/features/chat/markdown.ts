import { motion, type Variants } from 'motion/react'
import { createElement, Fragment, memo, type ComponentProps, type ElementType, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stillVariants } from '../../app/still-rule.ts'
import { spring, tween } from '../../lib/motion.ts'
import { localPathOf, remarkFilePaths } from '../viewer/paths.ts'
import { Fence } from './CopyBlock.ts'
import { blockScan, type Definition } from './stream-buffer.ts'

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
} as const satisfies Partial<Record<Tag, string>>

const TABLE_WRAP = 'mb-3 overflow-x-auto last:mb-0'
const TABLE = 'w-full border-collapse text-[14px]'

/** Whether `freshSpans` found an element on screen before. Drawn again, it starts where it is and does not arrive again. */
const wasShown = (node: unknown): boolean =>
  typeof node === 'object' && node !== null && 'data' in node && typeof node.data === 'object' && node.data !== null && 'shown' in node.data

/**
 * A plain element with the app's classes. A class Markdown itself set, such as a code block's `language-ts`,
 * is kept for the highlighter. react-markdown's own `node` prop stays out of the DOM. An element that moves as it
 * arrives does not move again if it was on screen before.
 */
const styled =
  <Name extends Tag>(tag: ElementType, className: string, motionProps?: object) =>
  ({ node, className: given, ...props }: ComponentProps<Name> & { node?: unknown }) =>
    createElement(tag, { ...props, ...motionProps, ...(motionProps && wasShown(node) ? { initial: false } : {}), className: given ? `${given} ${className}` : className })

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
  pre: Fence,
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
  /** The definitions of the rest of the text, which the block parses with and does not draw (`ownText`). */
  prefix: string
  /** Where the newest piece of the whole text begins: what starts before it was on screen already. */
  drawn: number
}

/** A block shorter than this takes in the ones after it, so a long reply is a few dozen blocks to draw, not hundreds. */
const BLOCK_CHARS = 500

/** How CommonMark matches a label: case and runs of white space do not count. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Whether the text parses only whole. A footnote is numbered and listed for the whole text, and a label defined twice
 * takes its first definition, wherever the reference is.
 */
function parsesWhole(definitions: readonly Definition[]): boolean {
  const labels = new Set<string>()
  for (const { label } of definitions) {
    const key = labelKey(label)
    if (key.startsWith('^') || labels.has(key)) return true
    labels.add(key)
  }
  return false
}

/** Whether a stretch of the text holds only definitions and blank lines. */
function onlyDefines(text: string, from: number, to: number, definitions: readonly Definition[]): boolean {
  let at = from
  for (const line of text.slice(from, to).split('\n')) {
    if (line.trim() && !definitions.some((definition) => definition.at === at)) return false
    at += line.length + 1
  }
  return true
}

/** What ends whatever the definitions above it left open, before the block that reads them. */
const AFTER_DEFINITIONS = '\n\n***\n\n'

/**
 * Markdown that may still grow, in blocks it parses the same in alone (`blockScan`), each at least BLOCK_CHARS long
 * but the last. A finished block keeps its text and its marks, so it is not drawn, or parsed, again: only the block
 * still being written is. A link's definition reaches every block, so each block parses with the definitions of the
 * others, and one that arrives parses the blocks again once, where they are.
 */
export function blocksOf(text: string, marks: readonly number[] = []): Block[] {
  const drawn = Math.max(0, ...marks)
  const { starts: found, definitions } = blockScan(text)
  const whole = parsesWhole(definitions)
  const starts: number[] = []
  for (const [at, start] of (whole ? [0] : found).entries()) {
    const last = starts.at(-1)
    // Definitions alone draw nothing, so they stay with the block before them, as the whole text draws no break there.
    if (last === undefined || (start - last >= BLOCK_CHARS && !onlyDefines(text, start, found[at + 1] ?? text.length, definitions))) starts.push(start)
  }

  return starts.map((offset, key) => {
    const end = starts[key + 1] ?? text.length
    let before: number | undefined
    const within: number[] = []
    for (const mark of marks) {
      if (mark <= offset) before = before === undefined ? mark : Math.max(before, mark)
      else if (mark < end) within.push(mark)
    }
    const elsewhere = whole ? [] : definitions.filter(({ at }) => at < offset || at >= end)
    return {
      key,
      text: text.slice(offset, end),
      offset,
      marks: before === undefined ? within : [before, ...within],
      prefix: elsewhere.length ? `${elsewhere.map(({ line }) => line).join('\n')}${AFTER_DEFINITIONS}` : '',
      drawn,
    }
  })
}

interface TreeRoot {
  type: string
  children?: TreeRoot[]
  position?: { start: { offset?: number } }
}

/**
 * Keeps of a block parsed after its prefix only what the block itself says, and the prefix's definitions, which draw
 * nothing and make the block's references links.
 */
function ownText(prefix: number) {
  return () => (tree: TreeRoot) => {
    const definitions: TreeRoot[] = []
    const collect = (node: TreeRoot) => {
      if (node.type === 'definition') definitions.push(node)
      else node.children?.forEach(collect)
    }
    const own = (tree.children ?? []).filter((child) => {
      if ((child.position?.start.offset ?? 0) >= prefix) return true
      collect(child)
      return false
    })
    tree.children = [...definitions, ...own]
  }
}

/** The remark plugins of a block parsed after a prefix of definitions. */
const pluginsAfter = (prefix: string) => (prefix ? [ownText(prefix.length), ...plugins] : plugins)

type BlockProps = Omit<Block, 'key'> & { still: boolean }

/** Blocks one after another, with the line break that Markdown parsed whole puts between its blocks. */
const joined = (blocks: ReactElement[]): ReactElement => createElement(Fragment, null, blocks.flatMap((block, at) => (at ? ['\n', block] : [block])))

/** Whether a block draws as it drew last: the same text at the same place, with the same fresh pieces. What was drawn before matters only when it draws. */
export const sameBlock = (left: BlockProps, right: BlockProps): boolean =>
  left.text === right.text &&
  left.offset === right.offset &&
  left.prefix === right.prefix &&
  left.still === right.still &&
  left.marks.length === right.marks.length &&
  left.marks.every((mark, at) => mark === right.marks[at])

/** One block of Markdown that may still grow, parsed after the definitions of the rest. */
const BlockMarkdown = memo(function BlockMarkdown({ text, prefix }: { text: string; prefix: string }): ReactElement {
  return createElement(ReactMarkdown, { remarkPlugins: pluginsAfter(prefix), components }, prefix + text)
})

/**
 * Markdown that may still grow, such as what an agent is saying on its page, drawn plainly as it arrives: nothing rises
 * or fades in. While it grows only its last block parses again. `whole` parses it as one, as a stored message is, once
 * it stops growing. Both are drawn by the same blocks, so the page keeps its elements when it goes from one to the other.
 */
export function GrowingMarkdown({ text, whole = false }: { text: string; whole?: boolean }): ReactElement {
  const blocks = whole ? [{ key: 0, text, prefix: '' }] : blocksOf(text)
  return joined(blocks.map(({ key, text: block, prefix }) => createElement(BlockMarkdown, { key, text: block, prefix })))
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
  pre: Fence,
  table: ({ node, ...props }) =>
    createElement(motion.div, { ...arrival, ...(wasShown(node) ? { initial: false } : {}), className: TABLE_WRAP }, createElement('table', { ...props, className: TABLE })),
  // Text that just arrived fades in. Only opacity moves, so the block around it never jumps.
  span: ({ node, ...props }) =>
    'data-fresh' in props
      ? createElement(motion.span, { ...(props as object), initial: wasShown(node) ? false : { opacity: 0 }, animate: { opacity: 1 }, transition: tween.enter })
      : createElement('span', props),
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
  data?: Record<string, unknown>
}

/** The elements that rise into place as they first appear. */
const ARRIVING = new Set<string>([...blockNames, 'table'])

/**
 * Wraps the text that arrived lately in spans of its own. `marks` are the places in the source where the
 * recent pieces began, so a piece is wrapped from its first letter, wherever in the structure that falls. A block
 * parsed alone starts `offset` into the source. What starts before `drawn`, where the newest piece begins, was on
 * screen already: it is marked shown, so drawn again, as when a definition arrives, it does not rise or fade in again.
 */
function freshSpans(marks: readonly number[], offset = 0, drawn = 0) {
  const sorted = [...marks].sort((left, right) => left - right)
  const newest = drawn
  const shown = (node: TreeNode) => {
    node.data = { ...node.data, shown: true }
  }
  const span = (mark: number, value: string): TreeNode => {
    const node = { type: 'element', tagName: 'span', properties: { dataFresh: mark }, children: [{ type: 'text', value }] }
    if (mark < newest) shown(node)
    return node
  }

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
      const at = child.position?.start.offset
      if (child.tagName && ARRIVING.has(child.tagName) && at !== undefined && offset + at < newest) shown(child)
      walk(child)
      return [child]
    })
  }
  return () => (tree: TreeNode) => {
    if (sorted.length) walk(tree)
  }
}

/** One block of a reply being written. It draws, and parses, again only when its text or its fresh pieces change. */
const StreamingBlock = memo(function StreamingBlock({ text, offset, marks, prefix, drawn, still }: BlockProps): ReactElement {
  return createElement(
    ReactMarkdown,
    {
      remarkPlugins: pluginsAfter(prefix),
      rehypePlugins: [freshSpans(marks, offset - prefix.length, drawn)],
      components: still ? stillStreamingComponents : streamingComponents,
    },
    prefix + text,
  )
}, sameBlock)

/**
 * A reply as it is being written. It is the same Markdown as the stored message will be, and it moves: each
 * new block rises into place as it first appears, and the words that just arrived fade in. It is drawn block by
 * block, so each step parses only the block still being written.
 */
export function StreamingMarkdown({ text, marks, still = false }: { text: string; marks: readonly number[]; still?: boolean }): ReactElement {
  return joined(blocksOf(text, marks).map(({ key, ...block }) => createElement(StreamingBlock, { key, ...block, still })))
}
