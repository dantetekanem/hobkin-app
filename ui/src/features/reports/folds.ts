/**
 * A report's folds (012-reports-actions, A13): the parts its writer put inside `<details>`, each with its `<summary>`.
 * They are the only HTML the reader draws. A fold counts only as `<details>` or `<details open>`, written outside
 * code and closed. Anything else is left in the Markdown, where the reader shows it as the text it is. Pure.
 */

export type ReportPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'fold'; summary: string; open: boolean; parts: ReportPart[] }

/** A stretch of the text, from its first character to the one after its last. */
type Range = readonly [start: number, end: number]

interface FoldTag {
  start: number
  end: number
  closes: boolean
  /** An opening tag that says `open`. */
  open: boolean
}

interface Fold {
  from: FoldTag
  to: FoldTag
}

const FOLD_TAG = /<details(\s+open)?\s*>|<\/details\s*>/gi
const SUMMARY = /^\s*<summary\s*>([\s\S]*?)<\/summary\s*>/i
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
// A run of backticks, what follows up to the same run again, and never across an empty line.
const INLINE_CODE = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?(?<!`)\1(?!`)/g
const NO_SUMMARY = 'Details'

/** Each fenced code block, fences included. One that is never closed runs to the end, as Markdown reads it. */
function fencedCode(text: string): Range[] {
  const blocks: Range[] = []
  let opened: { mark: string; length: number; start: number } | null = null
  let lineStart = 0

  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line)
    const mark = fence?.[1] ?? ''
    const rest = fence?.[2] ?? ''

    if (opened) {
      const closes = mark.startsWith(opened.mark) && mark.length >= opened.length && rest.trim() === ''
      if (closes) {
        blocks.push([opened.start, lineStart + line.length])
        opened = null
      }
    } else if (fence) {
      // Backticks after a backtick fence make the line inline code, not a fence.
      const opens = mark[0] === '~' || !rest.includes('`')
      if (opens) opened = { mark: mark[0]!, length: mark.length, start: lineStart }
    }

    lineStart += line.length + 1
  }

  if (opened) blocks.push([opened.start, text.length])
  return blocks
}

/** Each inline code span of the text between the fenced blocks. */
function inlineCode(text: string, blocks: readonly Range[]): Range[] {
  const spans: Range[] = []
  const edges = [0, ...blocks.flat(), text.length]

  for (let index = 0; index < edges.length; index += 2) {
    const start = edges[index]!
    const between = text.slice(start, edges[index + 1])
    for (const span of between.matchAll(INLINE_CODE)) spans.push([start + span.index, start + span.index + span[0].length])
  }

  return spans
}

/** The fold tags written as markup: every one outside code. */
function foldTags(text: string): FoldTag[] {
  const blocks = fencedCode(text)
  const code = [...blocks, ...inlineCode(text, blocks)]
  const inCode = (at: number) => code.some(([start, end]) => start <= at && at < end)

  return [...text.matchAll(FOLD_TAG)]
    .filter((tag) => !inCode(tag.index))
    .map((tag) => ({
      start: tag.index,
      end: tag.index + tag[0].length,
      closes: tag[0].startsWith('</'),
      open: tag[1] !== undefined,
    }))
}

/** Each opening tag with the tag that closes it, in the order they open. A tag with no partner makes no fold. */
function pairs(tags: readonly FoldTag[]): Fold[] {
  const folds: Fold[] = []
  const waiting: FoldTag[] = []

  for (const tag of tags) {
    if (!tag.closes) {
      waiting.push(tag)
      continue
    }
    const from = waiting.pop()
    if (from) folds.push({ from, to: tag })
  }

  return folds.sort((first, second) => first.from.start - second.from.start)
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The parts of one stretch of the text: its outermost folds, each read the same way inside, and the Markdown between them. */
function partsBetween(text: string, folds: readonly Fold[], start: number, end: number): ReportPart[] {
  const parts: ReportPart[] = []
  const addMarkdown = (from: number, to: number) => {
    const markdown = text.slice(from, to).trim()
    if (markdown) parts.push({ kind: 'markdown', text: markdown })
  }

  let cursor = start
  for (const { from, to } of folds) {
    const outermostHere = from.start >= cursor && to.end <= end
    if (!outermostHere) continue

    addMarkdown(cursor, from.start)

    const label = SUMMARY.exec(text.slice(from.end, to.start))
    const bodyStart = from.end + (label?.[0].length ?? 0)
    parts.push({
      kind: 'fold',
      summary: oneLine(label?.[1] ?? '') || NO_SUMMARY,
      open: from.open,
      parts: partsBetween(text, folds, bodyStart, to.start),
    })

    cursor = to.end
  }

  addMarkdown(cursor, end)
  return parts
}

/** A report's Markdown as the reader draws it: its folds, and the Markdown before, between and after them. */
export function foldsOf(markdown: string): ReportPart[] {
  return partsBetween(markdown, pairs(foldTags(markdown)), 0, markdown.length)
}
