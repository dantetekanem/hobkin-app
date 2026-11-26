import { readMemoryNote, type MemoryNote } from '#shared/protocol/memory.ts'
import type { ChatMessage, NoticeLevel } from '#shared/protocol/snapshot.ts'

/**
 * What hobkin's desk (075-chief-of-staff S3, S4) puts on a Chat line, read without trust: a line's level, and a digest,
 * the one message that holds what waited. A hobkin from before sends neither, and its lines are as they always were.
 */

const LEVELS: readonly NoticeLevel[] = ['P0', 'P1', 'P2', 'P3']

/** A line's level, or null when it has none or one this window does not know. */
export const levelOf = (value: unknown): NoticeLevel | null => (LEVELS.includes(value as NoticeLevel) ? (value as NoticeLevel) : null)

/** One line a digest holds, with its level and what the user can do from it. */
export interface DigestLine {
  text: string
  level: NoticeLevel | null
  /** The review it is about, which the line offers to open. */
  review?: string
  /** The memory an agent changed, which the line offers to See and Undo. */
  memory?: MemoryNote
}

export interface Digest {
  /** Its first line, the count: "Digest: 2 for today, 1 that can wait." */
  point: string
  /** What hobkin says between the point and the lines, such as what to move so today fits. */
  notes: string[]
  lines: DigestLine[]
}

function lineOf(item: unknown): DigestLine | null {
  if (!item || typeof item !== 'object') return null
  const { content, level, review, memory } = item as Record<string, unknown>
  if (typeof content !== 'string' || !content.trim()) return null
  const note = readMemoryNote(memory)
  return {
    text: content.trim(),
    level: levelOf(level),
    ...(typeof review === 'string' && review ? { review } : {}),
    ...(note ? { memory: note } : {}),
  }
}

/** The digest a message is, or null when it is none, or holds no line this window can read: then it shows as any notice. */
export function readDigest(message: Pick<ChatMessage, 'content' | 'digest'>): Digest | null {
  const items: unknown = (message.digest as { items?: unknown } | undefined)?.items
  if (!Array.isArray(items)) return null
  const lines = items.map(lineOf).filter((line) => line !== null)
  if (!lines.length) return null
  // The content is the point, any notes, then a "- " line for each item, which `lines` already holds.
  const [point = '', ...rest] = message.content.split('\n').map((line) => line.trim())
  return { point: point || 'Digest', notes: rest.filter((line) => line && !line.startsWith('- ')), lines }
}
