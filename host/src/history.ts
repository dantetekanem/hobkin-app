import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { withoutBriefNote } from 'hobkin/src/cli/brief.mjs'
import { isHoldBrief } from 'hobkin/src/cli/holds.mjs'
import { withoutLearningNote } from 'hobkin/src/cli/learning/note.mjs'
import { resolveDataRoot } from 'hobkin/src/cli/migration/admission.mjs'
import { reportText, splitReportReference } from 'hobkin/src/cli/reports.mjs'
import { isWakeBrief } from 'hobkin/src/cli/wake.mjs'
import { withoutWorkNote } from 'hobkin/src/cli/work/chat.mjs'
import type { HistoryConversation, HistoryEntry, HistoryMessage } from '#shared/commands/registry.ts'
import { Unavailable } from './commands.ts'

/** hobkin's names for its main conversations: `mainSessionFile` and `openImportedPiSession` in its `src/cli/pi-session.mjs`. */
const MAIN = /^(?:main(?:-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})?|legacy-[\da-f]{64})\.jsonl$/i
/** Chat's own cut for one message (`chatMessage` in hobkin's `src/cli/application.mjs`), and a title's. */
const LONGEST = 8192
const TITLE = 80

/** How much History reads, so a home of long conversations cannot hold the host up. */
export interface HistoryLimits {
  /** Conversations listed, newest file first. */
  files: number
  /** Bytes read of one file. Of a longer one, its start. */
  bytes: number
  /** Messages a conversation opens with: the newest. */
  messages: number
}
const LIMITS: HistoryLimits = { files: 100, bytes: 32 * 1024 * 1024, messages: 400 }

interface PiEntry {
  type?: unknown
  id?: unknown
  parentId?: unknown
  timestamp?: unknown
  name?: unknown
  message?: { role?: unknown; content?: unknown; display?: unknown; timestamp?: unknown }
}
interface Read {
  title: string
  at: number
  cut: boolean
  messages: HistoryMessage[]
}
type Found = { id: string; file: string; size: number; changed: number }

const timeOf = (value: unknown): number | null => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) ? at : null
}
const parts = (content: unknown): { type?: unknown; text?: unknown }[] => (Array.isArray(content) ? content : [])
/** Only a message's text is words. Thinking, tool calls and pictures are not. */
const wordsOf = (content: unknown) =>
  typeof content === 'string' ? content : parts(content).flatMap((part) => (part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('\n')

/** A message as hobkin's Chat shows it, or null for one Chat leaves out. */
function shown(entry: PiEntry): HistoryMessage | null {
  const { message } = entry
  if (entry.type !== 'message' || (message?.role !== 'user' && message?.role !== 'assistant') || message.display === false) return null
  const words = wordsOf(message.content)
  if (isHoldBrief(words) || isWakeBrief(words)) return null
  const { text, about } = splitReportReference(withoutBriefNote(withoutLearningNote(withoutWorkNote(words))))
  const said = reportText(text).slice(0, LONGEST)
  const images = parts(message.content).filter((part) => part?.type === 'image').length
  if (!said && !images) return null
  return { role: message.role, text: said, at: timeOf(message.timestamp) ?? timeOf(entry.timestamp), ...(about ? { about } : {}), ...(images ? { images } : {}) }
}

/** One conversation, read from its start up to the limit: Pi's header, then the branch its last entry is on. Null for a file that is not one. */
async function readConversation({ file, size, changed }: Found, bytes: number): Promise<Read | null> {
  const input = createReadStream(file, { encoding: 'utf8', end: Math.max(0, bytes - 1) })
  let header: PiEntry | null = null
  let name: string | null = null
  let last: string | null = null
  const entries = new Map<string, { parent: unknown; message: HistoryMessage | null }>()
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      let entry: PiEntry
      try {
        entry = JSON.parse(line) as PiEntry
      } catch {
        // A line cut short, by a crash or by the limit, costs that line.
        continue
      }
      if (!header) {
        if (entry?.type !== 'session') return null
        header = entry
      } else if (typeof entry?.id === 'string') {
        if (entry.type === 'session_info') name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null
        entries.set(entry.id, { parent: entry.parentId, message: shown(entry) })
        last = entry.id
      }
    }
  } finally {
    input.destroy()
  }
  if (!header) return null

  // Pi keeps a conversation as a tree, and the one it reopens is the branch of its last entry.
  const messages: HistoryMessage[] = []
  for (let at = entries.get(last ?? ''), steps = 0; at && steps < entries.size; at = entries.get(String(at.parent)), steps++) {
    if (at.message) messages.push(at.message)
  }
  messages.reverse()
  const first = messages.find(({ role, text }) => role === 'user' && text.trim())?.text.trim().split('\n')[0]!.trim()
  return {
    title: (name ?? first ?? 'A conversation without words').slice(0, TITLE),
    at: messages.at(-1)?.at ?? timeOf(header.timestamp) ?? changed,
    cut: size > bytes,
    messages,
  }
}

/**
 * hobkin's main conversations, read from the home's `sessions` folder and never written: the one hobkin is in, and
 * each one a `/reset` left behind (`connectMain` in hobkin's `src/cli/runtime.mjs` opens a new file and keeps the old).
 * What `/clear` hides stays in its conversation, so History shows it too.
 */
export class History {
  private readonly root: string
  private readonly current: () => string | null | undefined
  private readonly limits: HistoryLimits
  /** What each file held when it was last listed, so a file that did not change is not read again. */
  private readonly listed = new Map<string, { stamp: string; read: Omit<HistoryEntry, 'id' | 'current'> | null }>()

  /** `current` is the file of the conversation hobkin is in now, when hobkin is open. */
  constructor(root: string, current: () => string | null | undefined, limits: HistoryLimits = LIMITS) {
    this.root = root
    this.current = current
    this.limits = limits
  }

  async list(): Promise<{ conversations: HistoryEntry[] }> {
    const current = this.current()
    const conversations: HistoryEntry[] = []
    for (const found of await this.files()) {
      const stamp = `${found.size} ${found.changed}`
      let kept = this.listed.get(found.file)
      if (kept?.stamp !== stamp) {
        const read = await readConversation(found, this.limits.bytes)
        kept = { stamp, read: read && { ...read, messages: read.messages.length } }
        this.listed.set(found.file, kept)
      }
      if (kept.read) conversations.push({ id: found.id, ...kept.read, current: !!current && resolve(current) === found.file })
    }
    return { conversations: conversations.sort((a, b) => b.at - a.at) }
  }

  async open(id: string): Promise<HistoryConversation> {
    const file = join(this.folder(), id)
    const stat = MAIN.test(id) ? await lstat(file).catch(() => null) : null
    const read = stat?.isFile() ? await readConversation({ id, file, size: stat.size, changed: stat.mtimeMs }, this.limits.bytes) : null
    if (!read) throw new Unavailable(`${id} is not one of hobkin's conversations.`)
    const current = this.current()
    const earlier = Math.max(0, read.messages.length - this.limits.messages)
    return { id, ...read, messages: read.messages.slice(earlier), earlier, current: !!current && resolve(current) === file }
  }

  private folder(): string {
    return resolve(resolveDataRoot(this.root), 'sessions')
  }

  /** The main conversation files, newest first. A link is never followed out of the folder. */
  private async files(): Promise<Found[]> {
    const folder = this.folder()
    const found: Found[] = []
    // A home with no conversation yet has no folder.
    for (const id of (await readdir(folder).catch(() => [])).filter((name) => MAIN.test(name))) {
      const stat = await lstat(join(folder, id)).catch(() => null)
      if (stat?.isFile()) found.push({ id, file: join(folder, id), size: stat.size, changed: stat.mtimeMs })
    }
    return found.sort((a, b) => b.changed - a.changed).slice(0, this.limits.files)
  }
}
