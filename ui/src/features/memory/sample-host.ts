import type { MemoryEntry, MemoryForget, MemoryList, MemoryNowChange, MemorySave, MemoryUndo } from '#shared/protocol/memory.ts'
import { MEMORY_NOW_MAX } from '#shared/protocol/memory.ts'
import { todayOf } from './groups.ts'
import type { MemoryCommand } from './store.ts'

/**
 * The sample's own host, with no hobkin running (`057-shared-memory`): it answers the five memory commands on a copy of
 * the sample kept in memory, by the rules the user would meet (a version that moved on, a secret, a full Right now list),
 * so the page can be tried for real. Nothing leaves the window, and a reload starts the sample again.
 */

/** What looks like a secret, as hobkin refuses it: a password, a key or a token, or a long run of digits. */
const SECRET = /\b(password|passcode|api key|secret key|token)\b|\b\d{12,19}\b/i

interface Change {
  name: string
  before: MemoryEntry | null
  after: MemoryEntry | null
}

const slugOf = (words: string) =>
  words
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'memory'

export function createSampleHost(start: MemoryList, now: () => number = Date.now) {
  let memories: MemoryEntry[] = [...start.memories]
  let lines: string[] = [...(start.now ?? [])]
  let serial = 0
  let nowVersion = start.nowVersion ?? 'sample-now'
  const changes = new Map<string, Change>()

  const stamp = () => ({ at: new Date(now()).toISOString(), by: { kind: 'user' as const } })
  const nextVersion = () => `sample-v${++serial}`
  const named = (name: string) => memories.find((memory) => memory.name === name)
  const pastOf = (memory: MemoryEntry): MemoryEntry => {
    const past = memory.until !== undefined && memory.until < todayOf(new Date(now()))
    return { ...memory, past }
  }
  const record = (change: Change) => {
    const id = `sample-change-${++serial}`
    changes.set(id, change)
    return id
  }

  function save(args: MemorySave) {
    const description = args.description.trim()
    if (!description) return { saved: false, message: 'A memory needs a description.' }
    if (SECRET.test(`${description} ${args.text ?? ''}`)) return { saved: false, message: 'That looks like a secret: a password, a key, a token or a card number. hobkin does not keep those.' }
    const fields = { description, kind: args.kind, text: args.text ?? '', private: args.private === true, ...(args.until ? { until: args.until } : {}) }
    if (args.version !== undefined) {
      const before = args.name ? named(args.name) : undefined
      if (!before) return { saved: false, message: 'That memory is not here any more.' }
      if (before.version !== args.version) return { saved: false, message: 'It changed while you were editing it. Your words are kept here: cancel to see it as it is now.' }
      const { until: _until, ...kept } = before
      const after = pastOf({ ...kept, ...fields, changed: stamp(), version: nextVersion() })
      memories = memories.map((memory) => (memory === before ? after : memory))
      return { saved: true, memory: after, change: record({ name: after.name, before, after }) }
    }
    let name = args.name ?? slugOf(description)
    if (args.name && named(name)) return { saved: false, message: `The name ${name} is in use. Change that memory instead.` }
    for (let n = 2; named(name); n += 1) name = `${slugOf(description).slice(0, 36)}-${n}`
    const after = pastOf({ name, ...fields, added: stamp(), source: { kind: 'window' }, version: nextVersion() })
    memories = [after, ...memories]
    return { saved: true, memory: after, change: record({ name, before: null, after }) }
  }

  function forget({ name, version }: MemoryForget) {
    const before = named(name)
    if (!before) return { forgot: false, message: 'That memory is not here any more.' }
    if (version !== undefined && before.version !== version) return { forgot: false, message: 'It changed since the page read it. Look at it again first.' }
    memories = memories.filter((memory) => memory !== before)
    return { forgot: true, change: record({ name, before, after: null }) }
  }

  function undo({ change }: MemoryUndo) {
    const done = changes.get(change)
    if (!done) return { ok: false, reason: 'There is nothing to undo for that.' }
    const current = named(done.name)
    if (done.after === null) {
      if (current) return { ok: false, reason: 'A memory of that name is here again already.' }
      memories = [{ ...done.before!, version: nextVersion() }, ...memories]
    } else {
      if (!current || current.version !== done.after.version) return { ok: false, reason: 'It changed since. Edit it instead.' }
      memories = done.before === null ? memories.filter((memory) => memory !== current) : memories.map((memory) => (memory === current ? { ...done.before!, version: nextVersion() } : memory))
    }
    changes.delete(change)
    return { ok: true }
  }

  function changeNow({ action, item, text, version }: MemoryNowChange) {
    if (version !== undefined && version !== nowVersion) return { ok: false, reason: 'The list changed since the page read it. Look at it again first.' }
    const words = text?.trim() ?? ''
    if (action !== 'remove' && !words) return { ok: false, reason: 'Write the line first.' }
    if (words.length > 200) return { ok: false, reason: 'A line holds at most 200 characters.' }
    if (action === 'add') {
      if (lines.length >= MEMORY_NOW_MAX) return { ok: false, reason: `The list is full: ${MEMORY_NOW_MAX} lines. Remove one first.` }
      lines = [...lines, words]
    } else {
      const at = lines.indexOf(item ?? '')
      if (at < 0) return { ok: false, reason: 'That line is not on the list any more.' }
      lines = action === 'remove' ? lines.toSpliced(at, 1) : lines.with(at, words)
    }
    nowVersion = `sample-now-${++serial}`
    return { ok: true }
  }

  const list = (): MemoryList => ({ memories: memories.map(pastOf), now: [...lines], nowVersion })

  /** Answers a memory command as a host would, a moment later, on the sample. */
  const send = async (name: MemoryCommand, args: object): Promise<unknown> => {
    if (name === 'memory.list') return list()
    if (name === 'memory.save') return save(args as MemorySave)
    if (name === 'memory.forget') return forget(args as MemoryForget)
    if (name === 'memory.undo') return undo(args as MemoryUndo)
    return changeNow(args as MemoryNowChange)
  }

  return { send }
}
