/**
 * What the reviewer left behind in a review: nodes they moved, proposed wires they confirmed or removed,
 * and where they were in the story. Kept in the browser's storage for now. The host will hold it under
 * `work/<slug>/reviews/<item>/` with the review, see _specs/014-continuity.
 *
 * Nothing here changes the review file. The graph is a view of the review model.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import { persist, type PersistStorage, type StateStorage, type StorageValue } from 'zustand/middleware'
import type { GraphFlow } from '#shared/review/layout.ts'
import type { Review, ReviewEdge, ReviewNode } from '#shared/review/types.ts'
import type { ReviewNotes } from '#shared/review/status.ts'
import { arrange, isTestGroup, type Arranged, type ViewStep } from '../graph/arrange.ts'
import { foldArranged, hasAttention, NO_FOCUS, planFocus, type FocusState, type Folded } from '../graph/focus.ts'
import { foldNotes, type Note, type NoteEntry, type NoteIntent, type NoteTarget } from '../notes/notes.ts'
import { readMode, type ReviewMode } from '../story/mode.ts'
import { marksOf } from './seen.ts'

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

/**
 * The layout the saved positions were made for. A node moved on another layout would stand in the wrong place, so
 * positions saved for an older one are dropped, once, as the memory is read (2: by zone, spec 055).
 */
export const LAYOUT_VERSION = 2

export interface ReviewMemory {
  /** Where the reviewer moved nodes on the graph that reads left to right. */
  positions: Record<string, Point>
  /** Where they moved nodes on the graph that reads top to bottom: the same node stands elsewhere there. */
  topToBottomPositions: Record<string, Point>
  /** The layout the positions were made for (`LAYOUT_VERSION`). */
  layout: number
  wires: Record<string, WireDecision>
  progress: StoredProgress | null
  /** The review has been opened before, so its entrance has played. */
  opened: boolean
  /** The reviewer's notes, as a log folded by id. The host will keep the same log beside the review file. */
  notes: NoteEntry[]
  draft: NoteDraft | null
  /**
   * The marks of the nodes the reviewer has seen at this commit (`seen.ts`). Null until something is marked here: then
   * the marks of the review's other commits stand in, for the nodes whose code is still the same.
   */
  seen: string[] | null
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
  /** Story or Free Roam, as the reviewer last chose: every review opens in it. Story until they choose. */
  reviewMode: ReviewMode

  of(review: Review): ReviewMemory
  /** Keeps where a node was moved to on the graph that reads `flow`, left to right unless it says. */
  moveNode(review: Review, nodeId: string, position: Point, flow?: GraphFlow): void
  /** Puts every moved node back where the layout has it, in both flows. */
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
  setReviewMode(mode: ReviewMode): void
  /** The marks of what the reviewer has seen in a review at its commit (`seen.ts`). */
  seenOf(review: Review): ReadonlySet<string>
  /** Marks nodes seen, by their marks, or takes the marks off. */
  markSeen(review: Review, marks: readonly string[], seen: boolean): void
}

const EMPTY: ReviewMemory = { positions: {}, topToBottomPositions: {}, layout: LAYOUT_VERSION, wires: {}, progress: null, opened: false, notes: [], draft: null, seen: null }

/** The record of the nodes moved on the graph that reads `flow`. */
const MOVED_ON = { 'left-to-right': 'positions', 'top-to-bottom': 'topToBottomPositions' } as const satisfies Record<GraphFlow, keyof ReviewMemory>
const STORAGE_NAME = 'hobkin-client-review'

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
  const sameLayout = value.layout === LAYOUT_VERSION
  const pointsOf = (saved: unknown): Record<string, Point> => {
    const points: Record<string, Point> = {}
    for (const [id, point] of Object.entries(sameLayout && isRecord(saved) ? saved : {})) {
      if (isPoint(point)) points[id] = { x: point.x, y: point.y }
    }
    return points
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

  return {
    positions: pointsOf(value.positions),
    topToBottomPositions: pointsOf(value.topToBottomPositions),
    layout: LAYOUT_VERSION,
    wires,
    progress,
    opened: value.opened === true,
    notes: readNotes(value.notes),
    draft,
    seen: Array.isArray(value.seen) ? strings(value.seen) : null,
  }
}

const TARGET_KINDS = ['step', 'node', 'wire', 'lines']

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

/** The clock the memory's writes wait on: the real one, or a test's. */
export interface WriteClock {
  now(): number
  later(run: () => void, ms: number): unknown
  cancel(timer: unknown): void
}
const REAL_CLOCK: WriteClock = {
  now: () => Date.now(),
  later: (run, ms) => setTimeout(run, ms),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

/** What of the memory is kept in storage. */
type Persisted = Pick<MemoryState, 'reviews' | 'unsyncedNotes' | 'panelShare' | 'splitDiff' | 'panelPinned' | 'reviewMode'>

/**
 * How the memory reaches storage (spec 053). zustand hands over the whole memory on every change, and a move through a
 * review is one or two changes, while the memory holds every review kept. So what it hands over is kept as it is, and
 * turned into text only as it is written: at once with no `every`, else at most once in `every` milliseconds, and at
 * once on `flush`, as when a review closes or a note is kept. What waits is read back as it is.
 */
function writerOf(storage: StateStorage, every: number, clock: WriteClock): PersistStorage<Persisted> & { flush(): void } {
  let waiting: { name: string; value: StorageValue<Persisted> } | null = null
  let timer: unknown = null
  let wrote = Number.NEGATIVE_INFINITY
  const write = () => {
    if (timer != null) clock.cancel(timer)
    timer = null
    if (!waiting) return
    const { name, value } = waiting
    waiting = null
    wrote = clock.now()
    void storage.setItem(name, JSON.stringify(value))
  }
  const parse = (text: string | null): StorageValue<Persisted> | null => {
    try {
      return text == null ? null : (JSON.parse(text) as StorageValue<Persisted>)
    } catch {
      // Storage can hold anything: what cannot be read is left behind, as `readMemory` leaves behind what it cannot use.
      return null
    }
  }
  return {
    getItem: (name) => {
      if (waiting?.name === name) return waiting.value
      const text = storage.getItem(name)
      return typeof text === 'string' || text == null ? parse(text) : Promise.resolve(text).then(parse)
    },
    setItem: (name, value) => {
      if (waiting && waiting.name !== name) write()
      waiting = { name, value }
      if (every <= 0) return write()
      timer ??= clock.later(write, Math.max(0, wrote + every - clock.now()))
    },
    removeItem: (name) => {
      if (waiting?.name === name) waiting = null
      return storage.removeItem(name)
    },
    flush: write,
  }
}

/** The most reviews whose memory is kept: those changed last. One that holds a note or a draft is never let go of. */
export const KEPT_REVIEWS = 30

/** The reviews' memories: the most kept, changed last, and any older one that holds a note or a draft. */
function keptReviews(reviews: Record<string, ReviewMemory>): Record<string, ReviewMemory> {
  const keys = Object.keys(reviews)
  if (keys.length <= KEPT_REVIEWS) return reviews
  const recent = new Set(keys.slice(-KEPT_REVIEWS))
  const kept: Record<string, ReviewMemory> = {}
  for (const key of keys) {
    const memory = reviews[key]!
    if (recent.has(key) || memory.notes.length > 0 || memory.draft != null) kept[key] = memory
  }
  return kept
}

/** The marks a review's other commits lend it while nothing is marked at its own: those of its nodes whose code is the same. */
function carriedMarks(review: Review, reviews: Record<string, ReviewMemory>): Set<string> {
  const key = memoryKey(review)
  const sameReview = `${key.slice(0, key.lastIndexOf('@'))}@`
  const mine = new Set(marksOf(review.nodes).values())
  const marks = new Set<string>()
  for (const [other, memory] of Object.entries(reviews)) {
    if (other === key || !other.startsWith(sameReview)) continue
    for (const mark of memory.seen ?? []) {
      if (mine.has(mark)) marks.add(mark)
    }
  }
  return marks
}

/** The memory of every review, and the way to write it to storage now. */
export type ReviewMemoryStore = StoreApi<MemoryState> & { flush(): void }

interface WriteOptions {
  /** At most one write in this many milliseconds. None, or 0, writes on each change. */
  every?: number
  clock?: WriteClock
}

/**
 * The reviewer's memory of every review. With `every`, it is written to `storage` at most once in that many
 * milliseconds and at once on `flush`; with none, at once on each change, as tests and a storage in memory want.
 */
export function createReviewMemory(storage: StateStorage = memoryStorage(), { every = 0, clock = REAL_CLOCK }: WriteOptions = {}): ReviewMemoryStore {
  const writer = writerOf(storage, every, clock)
  let written = 0
  // Folding is cheap, but every marker on screen asks for the notes. The answer is kept until the log changes.
  let folded: { log: NoteEntry[]; notes: Note[] } | null = null
  // The seen marks of a review, kept until what they come from changes.
  const ownSeen = new WeakMap<readonly string[], ReadonlySet<string>>()
  const carriedSeen = new WeakMap<Review, { from: Record<string, ReviewMemory>; marks: ReadonlySet<string> }>()
  const store = createStore<MemoryState>()(
    persist(
      (set, get) => {
        // A review changed goes to the end, so the reviews changed longest ago are the first let go of.
        const update = (review: Review, change: (memory: ReviewMemory) => ReviewMemory) => {
          const key = memoryKey(review)
          const { [key]: before, ...others } = get().reviews
          set({ reviews: keptReviews({ ...others, [key]: change(before ?? EMPTY) }) })
        }
        // The reviewer's words are written as they change, as they always were: only the place and the marks wait.
        const keepWords = (review: Review, change: (memory: ReviewMemory) => ReviewMemory) => {
          update(review, change)
          writer.flush()
        }
        return {
          reviews: {},
          unsyncedNotes: {},
          panelShare: null,
          splitDiff: false,
          panelPinned: false,
          reviewMode: 'story',

          of: (review) => get().reviews[memoryKey(review)] ?? EMPTY,
          moveNode: (review, nodeId, position, flow = 'left-to-right') => {
            // A card of folded tests is drawn like any node, so it can be moved like one.
            if (!isPoint(position) || !(review.nodes.some((node) => node.id === nodeId) || isTestGroup(nodeId))) return
            const moved = MOVED_ON[flow]
            update(review, (memory) => ({ ...memory, [moved]: { ...memory[moved], [nodeId]: { x: Math.round(position.x), y: Math.round(position.y) } } }))
          },
          resetLayout: (review) => update(review, (memory) => ({ ...memory, positions: {}, topToBottomPositions: {} })),
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
            keepWords(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'put', note }] }))
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
            keepWords(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'put', note: { ...note, text, intent: change.intent ?? note.intent } }] }))
          },
          removeNote: (review, id) => keepWords(review, (memory) => ({ ...memory, notes: [...memory.notes, { op: 'remove', id }] })),
          markSent: (review, ids, at) => {
            const sent = get().notesOf(review).filter((note) => ids.includes(note.id) && note.sent == null)
            if (sent.length > 0) keepWords(review, (memory) => ({ ...memory, notes: [...memory.notes, ...sent.map((note) => ({ op: 'put' as const, note: { ...note, sent: at } }))] }))
          },
          setDraft: (review, draft) => keepWords(review, (memory) => ({ ...memory, draft })),
          setPanelShare: (panelShare) => set({ panelShare }),
          setSplitDiff: (splitDiff) => set({ splitDiff }),
          setPanelPinned: (panelPinned) => set({ panelPinned }),
          setReviewMode: (reviewMode) => set({ reviewMode }),
          seenOf: (review) => {
            const own = get().of(review).seen
            if (own) {
              let marks = ownSeen.get(own)
              if (!marks) ownSeen.set(own, (marks = new Set(own)))
              return marks
            }
            // Nothing marked at this commit yet: the review's other commits lend the marks of the code that is the same.
            const { reviews } = get()
            const cached = carriedSeen.get(review)
            if (cached?.from === reviews) return cached.marks
            const marks = carriedMarks(review, reviews)
            carriedSeen.set(review, { from: reviews, marks })
            return marks
          },
          markSeen: (review, marks, seen) => {
            if (marks.length === 0) return
            const before = get().seenOf(review)
            const after = new Set(before)
            for (const mark of marks) {
              if (seen) after.add(mark)
              else after.delete(mark)
            }
            const unchanged = after.size === before.size && [...after].every((mark) => before.has(mark))
            // Marks lent by another commit become this commit's own, even when they are the same.
            if (unchanged && get().of(review).seen) return
            update(review, (memory) => ({ ...memory, seen: [...after] }))
          },
        }
      },
      {
        name: STORAGE_NAME,
        version: 1,
        storage: writer,
        // A conversation an earlier version kept beside a review is left behind: hobkin's chat holds it.
        partialize: ({ reviews, unsyncedNotes, panelShare, splitDiff, panelPinned, reviewMode }) => ({ reviews, unsyncedNotes, panelShare, splitDiff, panelPinned, reviewMode }),
        merge: (persisted, current) => {
          const saved = isRecord(persisted) ? persisted : {}
          const read: Record<string, ReviewMemory> = {}
          for (const [key, value] of Object.entries(isRecord(saved.reviews) ? saved.reviews : {})) read[key] = readMemory(value)
          const reviews = keptReviews(read)
          const unsyncedNotes: Record<string, ReviewNotes> = {}
          for (const [key, value] of Object.entries(isRecord(saved.unsyncedNotes) ? saved.unsyncedNotes : {})) {
            if (!isRecord(value)) continue
            const restored = readMemory({ notes: value.entries, draft: value.draft })
            unsyncedNotes[key] = { entries: restored.notes, draft: restored.draft }
          }
          return {
            ...current,
            reviews,
            unsyncedNotes,
            panelShare: typeof saved.panelShare === 'number' && Number.isFinite(saved.panelShare) ? saved.panelShare : null,
            splitDiff: saved.splitDiff === true,
            panelPinned: saved.panelPinned === true,
            // What an older window saved has no mode: it opens in Story.
            reviewMode: readMode(saved.reviewMode),
          }
        },
      },
    ),
  )
  return Object.assign(store, { flush: writer.flush })
}

/** A wire as the graph draws it. */
export interface ViewEdge extends ReviewEdge {
  /** Proposed by the model and not confirmed yet: drawn dashed. */
  proposed: boolean
  decision?: WireDecision
}

/**
 * The review as the canvas draws it (`graph/arrange.ts`): tests folded into cards, and the graph laid out from them.
 * Each review is arranged once, from all its wires, so removing a proposed wire never moves a node. A review whose nodes
 * say what they ask of the reviewer is drawn in Focus (`graph/focus.ts`): its safe nodes fold into group cards.
 */
export interface ReviewView extends Pick<Folded, 'hidden' | 'groups' | 'groupOf' | 'covers' | 'stepOf' | 'plan' | 'foldOf' | 'zones' | 'zoneOf' | 'flow'> {
  nodes: ReviewNode[]
  edges: ViewEdge[]
  /** Proposed wires the reviewer removed. They are not drawn, and they can be brought back. */
  removed: ReviewEdge[]
  /** The story on screen: steps that land on the same card of tests are one (`ViewStep.steps`). */
  story: ViewStep[]
}

const arranged = new WeakMap<Review, Partial<Record<GraphFlow, Arranged>>>()
function arrangedOf(review: Review, flow: GraphFlow): Arranged {
  let shapes = arranged.get(review)
  if (!shapes) arranged.set(review, (shapes = {}))
  return (shapes[flow] ??= arrange(review, flow))
}

/** The review folded as Focus has it open, kept for the few ways it was open lately: each is worked out once. */
const folds = new WeakMap<Review, Map<string, Folded>>()
const KEPT_FOLDS = 16
function foldedOf(review: Review, focus: FocusState, flow: GraphFlow): Folded {
  const shape = arrangedOf(review, flow)
  // A review that says nothing of attention folds nothing, however it is asked, but the zones the reviewer folded.
  const state = hasAttention(review.nodes) ? focus : { ...NO_FOCUS, ...(focus.zones ? { zones: focus.zones } : {}) }
  const key = `${flow}|${state.opened.join(' ')}|${state.pinned.join(' ')}|${(state.zones ?? []).join(' ')}`
  let kept = folds.get(review)
  if (!kept) folds.set(review, (kept = new Map()))
  let folded = kept.get(key)
  if (!folded) {
    const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
    const plan = planFocus({ nodes: shape.nodes, groups: shape.groups, nodeOf, covers: shape.covers, zones: shape.zones }, state)
    folded = foldArranged(shape, plan)
    if (kept.size >= KEPT_FOLDS) kept.delete(kept.keys().next().value!)
    kept.set(key, folded)
  }
  return folded
}

/**
 * The review as the reviewer left it: moved nodes in their new places, removed wires gone, confirmed wires solid. Laid
 * out to read `flow`, left to right unless it says, with the nodes moved on that graph.
 */
export function applyMemory(review: Review, memory: ReviewMemory, focus: FocusState = NO_FOCUS, flow: GraphFlow = 'left-to-right'): ReviewView {
  const { nodes, edges, story, ...shape } = foldedOf(review, focus, flow)
  const moved = memory[MOVED_ON[flow]]
  const removed = review.edges.filter((edge) => edge.certainty === 'model' && memory.wires[edge.id] === 'removed')
  const gone = new Set(removed.map((edge) => edge.id))
  const drawn = edges.filter((edge) => edge.members.some((id) => !gone.has(id)))
  const kept = new Set(drawn.map((edge) => edge.id))
  return {
    ...shape,
    nodes: nodes.map((node) => (moved[node.id] ? { ...node, position: moved[node.id]! } : node)),
    edges: drawn.map(({ members: _members, ...edge }) => {
      const decision = edge.certainty === 'model' ? memory.wires[edge.id] : undefined
      return { ...edge, proposed: edge.certainty === 'model' && decision !== 'confirmed', ...(decision ? { decision } : {}) }
    }),
    removed,
    // A step cannot ride a wire that is no longer drawn. It glides instead.
    story: story.map((step) => {
      if (!step.travel || kept.has(step.travel)) return step
      const { travel: _travel, ...rest } = step
      return rest
    }),
  }
}
