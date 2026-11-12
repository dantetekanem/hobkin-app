/**
 * What the reviewer left behind in a review: nodes they moved, proposed wires they confirmed or removed,
 * and where they were in the story. Kept in the browser's storage for now. The host will hold it under
 * `work/<slug>/reviews/<item>/` with the review, see _specs/014-continuity.
 *
 * Nothing here changes the review file. The graph is a view of the review model.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { Review, ReviewEdge, ReviewNode, StoryStep } from '#shared/review/types.ts'
import type { ReviewNotes } from '#shared/review/status.ts'
import { foldNotes, type Note, type NoteEntry, type NoteIntent, type NoteTarget } from '../notes/notes.ts'

export interface Point {
  x: number
  y: number
}

export type WireDecision = 'confirmed' | 'removed'

/** Where the reviewer was in the story. Ids, so it survives nothing but the same review. */
export interface StoredProgress {
  /** The id of the step they were on. A review opens at its first step all the same (`startStory`). */
  step: string
  /** Ids of the steps they have seen, in the order they first saw them. */
  seen: string[]
  /** Ids of the nodes and wires that have drawn in. */
  revealed: string[]
}

/** A note being written. It is kept when the reviewer leaves the editor, so Escape never loses words. */
export interface NoteDraft {
  intent: NoteIntent
  text: string
  /** The id of the note being edited, when this is not a new one. */
  editing?: string
}

export interface ReviewMemory {
  positions: Record<string, Point>
  wires: Record<string, WireDecision>
  progress: StoredProgress | null
  /** The review has been opened before, so its entrance has played. */
  opened: boolean
  /** The reviewer's notes, as a log folded by id. The host will keep the same log beside the review file. */
  notes: NoteEntry[]
  draft: NoteDraft | null
}

/** What a new note needs. The store gives it an id, an author and a time. */
export interface NewNote {
  step: string
  target: NoteTarget
  intent: NoteIntent
  text: string
  author?: Note['author']
}

export interface MemoryState {
  reviews: Record<string, ReviewMemory>
  /** Unsaved notes belong to the source and target, not a historical graph snapshot. */
  unsyncedNotes: Record<string, ReviewNotes>
  /** The code panel's height as a share of the window's height, once the reviewer has dragged it. */
  panelShare: number | null
  /** One column or two in the code panel. */
  splitDiff: boolean
  /** The steps panel is kept open, instead of tucking away while the reviewer walks the story. */
  panelPinned: boolean
  /**
   * What the reviewer and hobkin said about each review, kept by the review and not its commit, so the conversation is
   * there when the review opens again: after a restart, after hobkin's chat has moved on or been cleared, and after the
   * review was built again for a newer commit.
   */
  threads: Record<string, ThreadEntry[]>

  of(review: Review): ReviewMemory
  moveNode(review: Review, nodeId: string, position: Point): void
  resetLayout(review: Review): void
  decideWire(review: Review, edgeId: string, decision: WireDecision | null): void
  saveProgress(review: Review, progress: StoredProgress): void
  markOpened(review: Review, opened?: boolean): void
  notesOf(review: Review): Note[]
  /** Adds a note. Null when there is nothing in it to keep. */
  addNote(review: Review, note: NewNote): Note | null
  /** Changes a note's words or its intent. A note left with no words is removed. */
  editNote(review: Review, id: string, change: { text?: string; intent?: NoteIntent }): void
  removeNote(review: Review, id: string): void
  /** Marks notes as sent: questions handed over to hobkin, comments that went with a verdict. None is sent twice. */
  markSent(review: Review, ids: readonly string[], at: number): void
  setDraft(review: Review, draft: NoteDraft | null): void
  setPanelShare(share: number): void
  setSplitDiff(split: boolean): void
  setPanelPinned(pinned: boolean): void
  threadOf(review: Review): ThreadEntry[]
  /** Keeps what the conversation shows now with what was kept before: each message once, in order, the newest kept. */
  keepThread(review: Review, entries: readonly ThreadEntry[]): void
}

const EMPTY: ReviewMemory = { positions: {}, wires: {}, progress: null, opened: false, notes: [], draft: null }
const STORAGE_NAME = 'hobkin-client-review'

/** One message of a review's conversation with hobkin (`panel/thread.ts`). */
export interface ThreadEntry {
  id: string
  who: 'you' | 'hobkin'
  text: string
  /** Milliseconds. */
  at: number
}

/** How many messages a review keeps of its conversation, and how many reviews keep one: the ones talked about last. */
export const THREAD_LIMIT = 40
export const THREADS_KEPT = 20

/** The conversation a review kept, joined with what the conversation shows now: each message once, in order, the newest kept. */
export function joinThread(saved: readonly ThreadEntry[], shown: readonly ThreadEntry[], limit = THREAD_LIMIT): ThreadEntry[] {
  const byId = new Map<string, ThreadEntry>()
  for (const entry of [...saved, ...shown]) byId.set(entry.id, entry)
  // Array sort is stable, so messages of the same millisecond keep the order they came in.
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-limit)
}

/** A review's conversation outlives its commit: the key is the review's source and id alone. */
export function threadKey(review: Pick<Review, 'id'>): string {
  const scope = (review as typeof review & { memoryScope?: string }).memoryScope
  return `${scope ? `${scope}:` : ''}${review.id}`
}

/** A review prepared again from another head is another review, so its key carries the fingerprint of its bytes. */
export function memoryKey(review: Pick<Review, 'id' | 'snapshot'>): string {
  const scope = (review as typeof review & { memoryScope?: string }).memoryScope
  return `${scope ? `${scope}:` : ''}${review.id}@${review.snapshot.slice(0, 12)}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)
const isPoint = (value: unknown): value is Point => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])

/** Storage can hold anything: an older version, a hand edit. Read it without trusting its shape. */
function readMemory(value: unknown): ReviewMemory {
  if (!isRecord(value)) return EMPTY
  const positions: Record<string, Point> = {}
  for (const [id, point] of Object.entries(isRecord(value.positions) ? value.positions : {})) {
    if (isPoint(point)) positions[id] = { x: point.x, y: point.y }
  }

  const wires: Record<string, WireDecision> = {}
  for (const [id, decision] of Object.entries(isRecord(value.wires) ? value.wires : {})) {
    if (decision === 'confirmed' || decision === 'removed') wires[id] = decision
  }

  const saved = value.progress
  const progress = isRecord(saved) && typeof saved.step === 'string'
    ? { step: saved.step, seen: strings(saved.seen), revealed: strings(saved.revealed) }
    : null

  const draft = isRecord(value.draft) && typeof value.draft.text === 'string'
    ? {
        intent: value.draft.intent === 'question' ? ('question' as const) : ('comment' as const),
        text: value.draft.text,
        ...(typeof value.draft.editing === 'string' ? { editing: value.draft.editing } : {}),
      }
    : null

  return { positions, wires, progress, opened: value.opened === true, notes: readNotes(value.notes), draft }
}

const TARGET_KINDS = ['step', 'node', 'wire', 'lines']

/** A kept conversation as it was saved, with anything that is not a message of it left out. */
function readThread(value: unknown): ThreadEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): ThreadEntry[] =>
    isRecord(entry) && typeof entry.id === 'string' && (entry.who === 'you' || entry.who === 'hobkin') && typeof entry.text === 'string' && Number.isFinite(entry.at)
      ? [{ id: entry.id, who: entry.who, text: entry.text, at: entry.at as number }]
      : [],
  )
}
const sameThread = (a: readonly ThreadEntry[], b: readonly ThreadEntry[]) => a.length === b.length && a.every((entry, index) => entry.id === b[index]!.id && entry.text === b[index]!.text)
const NO_THREAD: ThreadEntry[] = []
/** The conversations of the reviews talked about last, so what is kept stays small in the browser's storage. */
function newestThreads(threads: Record<string, ThreadEntry[]>): Record<string, ThreadEntry[]> {
  const last = (entries: readonly ThreadEntry[]) => entries.at(-1)?.at ?? 0
  return Object.fromEntries(Object.entries(threads).sort(([, a], [, b]) => last(b) - last(a)).slice(0, THREADS_KEPT))
}

/** The notes log as it was saved, with anything that is not a note left out. Folded, so the log does not grow with every edit. */
function readNotes(value: unknown): NoteEntry[] {
  if (!Array.isArray(value)) return []
  const entries: NoteEntry[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if (entry.op === 'remove' && typeof entry.id === 'string') entries.push({ op: 'remove', id: entry.id })
    const note = entry.note
    if (entry.op !== 'put' || !isRecord(note) || !isRecord(note.target)) continue
    if (typeof note.id !== 'string' || typeof note.step !== 'string' || typeof note.text !== 'string' || !TARGET_KINDS.includes(note.target.kind as string)) continue
    entries.push({ op: 'put', note: note as unknown as Note })
  }
  return foldNotes(entries).map((note) => ({ op: 'put', note }))
}

/** A storage that lives in memory, for tests and for when the browser's storage is unavailable. */
export function memoryStorage(): StateStorage & { setItem(name: string, value: string): void } {
  const items = new Map<string, string>()
  return {
    getItem: (name) => items.get(name) ?? null,
    setItem: (name, value) => void items.set(name, value),
    removeItem: (name) => void items.delete(name),
  }
}

export function createReviewMemory(storage: StateStorage = memoryStorage()): StoreApi<MemoryState> {
  let written = 0
  // Folding is cheap, but every marker on screen asks for the notes. The answer is kept until the log changes.
  let folded: { log: NoteEntry[]; notes: Note[] } | null = null
  return createStore<MemoryState>()(
    persist(
      (set, get) => {
        const update = (review: Review, change: (memory: ReviewMemory) => ReviewMemory) => {
          const key = memoryKey(review)
          set({ reviews: { ...get().reviews, [key]: change(get().reviews[key] ?? EMPTY) } })
        }
        return {
          reviews: {},
          unsyncedNotes: {},
          panelShare: null,
          splitDiff: false,
          panelPinned: false,
          threads: {},

          of: (review) => get().reviews[memoryKey(review)] ?? EMPTY,
          moveNode: (review, nodeId, position) => {
            if (!isPoint(position) || !review.nodes.some((node) => node.id === nodeId)) return
            update(review, (memory) => ({ ...memory, positions: { ...memory.positions, [nodeId]: { x: Math.round(position.x), y: Math.round(position.y) } } }))
          },
          resetLayout: (review) => update(review, (memory) => ({ ...memory, positions: {} })),
          decideWire: (review, edgeId, decision) => {
            // Only a wire the model proposed is the reviewer's to confirm or remove.
            if (review.edges.find((edge) => edge.id === edgeId)?.certainty !== 'model') return
            update(review, (memory) => {
              const { [edgeId]: _previous, ...wires } = memory.wires
              return { ...memory, wires: decision ? { ...wires, [edgeId]: decision } : wires }
            })
          },
          saveProgress: (review, progress) => update(review, (memory) => ({ ...memory, progress })),
          markOpened: (review, opened = true) => {
            if (get().of(review).opened !== opened) update(review, (memory) => ({ ...memory, opened }))
          },
          notesOf: (review) => {
            const log = get().of(review).notes
            if (folded?.log !== log) folded = { log, notes: foldNotes(log) }
            return folded.notes
          },
          addNote: (review, { step, target, intent, text, author = 'user' }) => {
            const words = text.trim()
            if (!words) return null
            const at = Date.now()
            const note: Note = { id: `n${at.toString(36)}${(written += 1).toString(36)}`, step, target, intent, text: words, author, at }
            update(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'put', note }] }))
            return note
          },
          editNote: (review, id, change) => {
            const note = get().notesOf(review).find((entry) => entry.id === id)
            if (!note) return
            const text = change.text == null ? note.text : change.text.trim()
            if (!text) {
              get().removeNote(review, id)
              return
            }
            update(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'put', note: { ...note, text, intent: change.intent ?? note.intent } }] }))
          },
          removeNote: (review, id) => update(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'remove', id }] })),
          markSent: (review, ids, at) => {
            const sent = get().notesOf(review).filter((note) => ids.includes(note.id) && note.sent == null)
            if (sent.length > 0) update(review, (memory) => ({ ...memory, notes: [...memory.notes, ...sent.map((note) => ({ op: 'put' as const, note: { ...note, sent: at } }))] }))
          },
          setDraft: (review, draft) => update(review, (memory) => ({ ...memory, draft })),
          setPanelShare: (panelShare) => set({ panelShare }),
          setSplitDiff: (splitDiff) => set({ splitDiff }),
          setPanelPinned: (panelPinned) => set({ panelPinned }),
          threadOf: (review) => get().threads[threadKey(review)] ?? NO_THREAD,
          keepThread: (review, entries) => {
            const key = threadKey(review)
            const kept = get().threads[key] ?? NO_THREAD
            const next = joinThread(kept, entries)
            if (!sameThread(kept, next)) set({ threads: newestThreads({ ...get().threads, [key]: next }) })
          },
        }
      },
      {
        name: STORAGE_NAME,
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ reviews, unsyncedNotes, panelShare, splitDiff, panelPinned, threads }) => ({ reviews, unsyncedNotes, panelShare, splitDiff, panelPinned, threads }),
        merge: (persisted, current) => {
          const saved = isRecord(persisted) ? persisted : {}
          const reviews: Record<string, ReviewMemory> = {}
          for (const [key, value] of Object.entries(isRecord(saved.reviews) ? saved.reviews : {})) reviews[key] = readMemory(value)
          const unsyncedNotes: Record<string, ReviewNotes> = {}
          for (const [key, value] of Object.entries(isRecord(saved.unsyncedNotes) ? saved.unsyncedNotes : {})) {
            if (!isRecord(value)) continue
            const restored = readMemory({ notes: value.entries, draft: value.draft })
            unsyncedNotes[key] = { entries: restored.notes, draft: restored.draft }
          }
          const threads: Record<string, ThreadEntry[]> = {}
          for (const [key, value] of Object.entries(isRecord(saved.threads) ? saved.threads : {})) {
            const thread = readThread(value)
            if (thread.length > 0) threads[key] = thread
          }
          return {
            ...current,
            reviews,
            unsyncedNotes,
            panelShare: typeof saved.panelShare === 'number' && Number.isFinite(saved.panelShare) ? saved.panelShare : null,
            splitDiff: saved.splitDiff === true,
            panelPinned: saved.panelPinned === true,
            threads: newestThreads(threads),
          }
        },
      },
    ),
  )
}

/** A wire as the graph draws it. */
export interface ViewEdge extends ReviewEdge {
  /** Proposed by the model and not confirmed yet: drawn dashed. */
  proposed: boolean
  decision?: WireDecision
}

export interface ReviewView {
  nodes: ReviewNode[]
  edges: ViewEdge[]
  /** Proposed wires the reviewer removed. They are not drawn, and they can be brought back. */
  removed: ReviewEdge[]
  story: StoryStep[]
}

/** The review as the reviewer left it: moved nodes in their new places, removed wires gone, confirmed wires solid. */
export function applyMemory(review: Review, memory: ReviewMemory): ReviewView {
  const removed = review.edges.filter((edge) => edge.certainty === 'model' && memory.wires[edge.id] === 'removed')
  const gone = new Set(removed.map((edge) => edge.id))
  return {
    nodes: review.nodes.map((node) => (memory.positions[node.id] ? { ...node, position: memory.positions[node.id]! } : node)),
    edges: review.edges
      .filter((edge) => !gone.has(edge.id))
      .map((edge) => {
        const decision = edge.certainty === 'model' ? memory.wires[edge.id] : undefined
        return { ...edge, proposed: edge.certainty === 'model' && decision !== 'confirmed', ...(decision ? { decision } : {}) }
      }),
    removed,
    // A step cannot ride a wire that is no longer drawn. It glides instead.
    story: review.story.map((step) => {
      if (!step.travel || !gone.has(step.travel)) return step
      const { travel: _travel, ...rest } = step
      return rest
    }),
  }
}
