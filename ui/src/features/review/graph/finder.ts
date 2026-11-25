/**
 * The finder: any node of the graph by its name, its path, its acceptance id or its kind.
 * Every word typed must match. The start of a name counts most, then the start of a word in it,
 * then anywhere in it, then its letters in order. Matches that score the same come in the order the graph is read.
 */
import type { GraphFlow } from '#shared/review/layout.ts'
import type { NodeKind, ReviewNode } from '#shared/review/types.ts'
import { readingOrder } from './navigate.ts'

export interface FinderHit {
  id: string
  score: number
  /** Where the words matched in the title, as start and end offsets, so the screen can mark them. */
  marks: [number, number][]
}

const KIND_WORDS: Record<NodeKind, string> = { criterion: 'acceptance spec criterion', test: 'test', code: 'code', file: 'file', context: 'context unchanged' }

/** Where each word of a name starts: after a space, a separator, or a change from lower to upper case. */
function wordStarts(title: string): number[] {
  const starts: number[] = []
  for (let index = 0; index < title.length; index += 1) {
    const before = title[index - 1]
    const here = title[index]!
    if (index === 0 || /[\s._\-/:()]/.test(before!) || (/[a-z0-9]/.test(before!) && /[A-Z]/.test(here))) if (/\S/.test(here)) starts.push(index)
  }
  return starts
}

/** How well one word matches a title, and where. */
function titleMatch(title: string, word: string): { score: number; marks: [number, number][] } | null {
  const lower = title.toLowerCase()
  if (lower === word) return { score: 100, marks: [[0, title.length]] }
  if (lower.startsWith(word)) return { score: 80, marks: [[0, word.length]] }
  const starts = wordStarts(title)
  // The humps of a name: "wr" for workingRow, "sd" for streamedDoing. Typed on purpose, so it counts more
  // than the same letters starting some word of a long test name.
  if (word.length >= 2 && word.length <= starts.length) {
    const humps = starts.map((start) => lower[start]).join('')
    if (humps.startsWith(word)) return { score: 65, marks: starts.slice(0, word.length).map((start) => [start, start + 1] as [number, number]) }
  }
  const atWord = starts.find((start) => lower.startsWith(word, start))
  if (atWord != null) return { score: 60, marks: [[atWord, atWord + word.length]] }
  const inside = lower.indexOf(word)
  if (inside >= 0) return { score: 40, marks: [[inside, inside + word.length]] }
  // Its letters in order, closer together counting more.
  const marks: [number, number][] = []
  let from = 0
  for (const letter of word) {
    const at = lower.indexOf(letter, from)
    if (at < 0) return null
    marks.push([at, at + 1])
    from = at + 1
  }
  const spread = marks.at(-1)![1] - marks[0]![0]
  return { score: Math.max(5, 25 - (spread - word.length)), marks }
}

function wordScore(node: Pick<ReviewNode, 'id' | 'kind' | 'title' | 'subtitle'>, word: string): { score: number; marks: [number, number][] } | null {
  if (node.id.toLowerCase() === word) return { score: 90, marks: [] }
  const title = titleMatch(node.title, word)
  const path = (node.subtitle ?? '').toLowerCase()
  const fileName = path.split('/').at(-1) ?? ''
  const inPath = fileName.startsWith(word) ? 35 : path.includes(word) ? 20 : 0
  const inKind = KIND_WORDS[node.kind].split(' ').some((kind) => kind.startsWith(word)) ? 15 : 0
  // Between two names that match the same way, the shorter one is the closer match: "after" is more of
  // doingAfter than of a test named in a whole sentence.
  const named = title ? title.score + (10 * word.length) / node.title.length : 0
  const best = Math.max(named, inPath, inKind)
  if (best === 0) return null
  return { score: best, marks: title && named >= best ? title.marks : [] }
}

type Findable = Pick<ReviewNode, 'id' | 'kind' | 'title' | 'subtitle' | 'position'>

export function findNodes(nodes: readonly Findable[], query: string, limit = 8, flow: GraphFlow = 'left-to-right'): FinderHit[] {
  const reading = [...nodes].sort(readingOrder(flow))
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return reading.slice(0, limit).map((node) => ({ id: node.id, score: 0, marks: [] }))
  const hits: (FinderHit & { order: number })[] = []
  reading.forEach((node, order) => {
    let score = 0
    const marks: [number, number][] = []
    for (const word of words) {
      const match = wordScore(node, word)
      if (!match) return
      score += match.score
      marks.push(...match.marks)
    }
    hits.push({ id: node.id, score, marks, order })
  })
  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ id, score, marks }) => ({ id, score, marks }))
}
