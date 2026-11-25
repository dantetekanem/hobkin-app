/**
 * One open review: where the reviewer is, what is focused, what the pointer is over and what is open.
 * It joins the pure pieces (the story, the levels, the reviewer's memory) into the state the screen draws.
 * No React here, so the whole of a session can be driven from a test or, later, from a command.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { FOCUS_BUDGET, isFoldGroup, NO_FOCUS, type FocusState } from '../graph/focus.ts'
import { focusLevels, hoverLevels, type HoverLevel, type Levels, type NodeLevel, type WireLevel } from '../graph/levels.ts'
import { countNotes, noteTarget, type Note, type NoteCounts, type NoteIntent, type NoteTarget } from '../notes/notes.ts'
import { commitDigits, NO_DIGITS, pressDigit } from '../story/digits.ts'
import { goBack, goForward, NO_HISTORY, recordFocus, type FocusEntry, type FocusHistory } from '../story/history.ts'
import type { PendingAsk } from '../panel/ask.ts'
import { backToStep, focusGroup, focusNode, focusOf, goToStep, leaveFocus, offPath, progressOf, startStory, stepFrom, type Fresh, type Moved, type StoryState } from '../story/story.ts'
import { modeStart, type ReviewMode } from '../story/mode.ts'
import { pickTravel, type Travel } from '../story/travel.ts'
import { applyMemory, type MemoryState, type Point, type ReviewView, type ViewEdge, type WireDecision } from './memory.ts'
import { partsInFile, partsToSee, placeOfPart, stepShowing, type DiffAt, type ReviewLook } from './look.ts'
import type { KeptEntry, SessionPlace } from './place.ts'
import type { NotesShown } from './quick-notes.ts'
import { marksOf } from './seen.ts'

/** What the last move put on screen, kept so the graph can play it once: what draws in and the wire to ride. */
export interface Move {
  /** Goes up by one on every move. */
  key: number
  fresh: Fresh
  travel: Travel | null
  /** How the move came about. A cut is a move that should not travel: opening the review, a resize. */
  kind: 'open' | 'step' | 'jump' | 'detour' | 'whole'
}

export interface Session {
  review: Review
  /** The review as the reviewer left it: moved nodes, removed and confirmed wires. */
  view: ReviewView
  nodeOf: ReadonlyMap<string, ReviewNode>
  edgeOf: ReadonlyMap<string, ViewEdge>
  /** Which pins of each node have a wire: `in` on the left, `out` on the right. */
  pins: Readonly<Record<string, { in: boolean; out: boolean }>>
  story: StoryState
  /** The nodes in focus now. Empty when the whole graph is shown. */
  focus: string[]
  levels: Levels<NodeLevel, WireLevel>
  hovered: string | null
  hover: Levels<HoverLevel, HoverLevel>
  /** Ids of the nodes and wires that have drawn in. */
  revealed: ReadonlySet<string>
  move: Move
  /** The wire whose label is open. */
  wire: string | null
  /** The node whose code is shown. Null when the code panel is closed. */
  code: string | null
  /** The reviewer's notes on this review, and how many each step, node, wire and line range has. */
  notes: readonly Note[]
  counts: NoteCounts
  /** Lines selected in the code panel. A note started now is about them. */
  selection: Extract<NoteTarget, { kind: 'lines' }> | null
  /** The node the reviewer last pointed at, by a click or the arrows, until the next step. A note started now is about it. */
  pointed: string | null
  /** The note being written: what it is about, and the note it replaces when it is an edit. */
  editor: { step: string; target: NoteTarget; editing?: string } | null
  /** The steps panel is open, not tucked away. The panel says so, and the camera and the step's text follow. */
  panelOpen: boolean
  /** The finder is open: any node, by name, path or kind. */
  finder: boolean
  /** Digits typed toward a step number, while they wait for a second digit. */
  pendingDigits: string
  /** The places the reviewer jumped to, to go back and forward through. */
  history: FocusHistory
  /** What the reviewer sent hobkin from this review, the newest last, and where each stands. */
  asks: readonly PendingAsk[]
  /** The notes panel on the canvas: the notes about a node, or taken on a step, read beside the node. Null when closed. */
  notesShown: NotesShown | null
  /** The card of folded tests whose tests are listed under it. Null when none is. */
  opened: string | null
  /** Story, where the steps lead, or Free Roam, where nothing does (`story/mode.ts`). The window remembers the last chosen. */
  mode: ReviewMode
  /**
   * Graph or Code (spec 071, `look.ts`): the review walked as a graph, or the change as a diff, file by file. A review
   * opens in the look the window's settings choose, or in the one it was left in for another page.
   */
  look: ReviewLook
  /**
   * The code view: the file it shows, by id, null for the first it lists, and lines a step, a part or a note asked it to
   * show, which its cursor goes to. `ask` goes up each time it is asked to show something, so the same ask moves it again.
   */
  diff: { file: string | null; at: DiffAt | null; ask: number }
  /** Which groups of a large change are open, and the nodes reached in them (`graph/focus.ts`). */
  fold: FocusState
  /**
   * The nodes of the review the reviewer has seen, by id (`seen.ts`): a step of theirs was visited, their code was
   * opened, or Z marked them. Kept in the review's memory for each commit.
   */
  seen: ReadonlySet<string>
  /** The outline is open at the left (`outline/Outline.tsx`). A review in Focus opens with it open, any other without. */
  outline: boolean
  /** How many times L opened the outline: each time, its filter takes the keyboard (`outline/asked-focus.ts`). */
  outlineAsked: number
  /** A short word to the reviewer, said again on each press that asks: `key` goes up each time it is said. */
  notice: { key: number; text: string } | null
  /**
   * The proof open beside the review (spec 053, `proof/ProofBeside.tsx`): the run it opened on, and the control that
   * opened it by its `data-proof-from`, which takes the keyboard back when it closes (null: the review itself).
   */
  proof: { run: string; from: string | null } | null
  /**
   * When the proof and the code last opened, as a count that goes up (`entry.ts`): Escape closes the one opened last.
   * Opening another run in the proof counts as opening it.
   */
  proofAt: number
  codeAt: number

  step(delta: number): void
  goTo(index: number): void
  focusOn(nodeId: string): void
  back(): void
  /** Leaves focus for the whole graph. False when there was no focus to leave. */
  leave(): boolean
  /** Frames again what is in focus, or the whole graph. For when the reviewer has panned away. */
  refit(): boolean
  hoverOn(nodeId: string | null): void
  openWire(edgeId: string | null): void
  /** Opens the code of a node, or of the focus when none is given. False when there is no code to open. */
  openCode(nodeId?: string): boolean
  closeCode(): void
  /**
   * Enter's: opens the code of the focus, or closes the open code and puts the review back as it was before it opened,
   * with the wire it closed open again when nothing moved meanwhile. False when there is no code to open.
   */
  toggleCode(): boolean
  /** Shows another node's code in the open panel, without moving the focus. */
  showCode(nodeId: string): void
  /**
   * Shows a test's code, opening the panel when it is closed, from the list of tests on the card beside the focus: the
   * focus, the step and the camera stay where they are. False for a node the review does not have.
   */
  showTest(testId: string): boolean
  /** A digit toward a step number: 1 to 9 are steps 1 to 9, 0 is step 10, and two quick digits make one number. */
  typeDigit(digit: string): void
  openFinder(): void
  closeFinder(): void
  /** Back and forward through the places the reviewer jumped to. False when there is nowhere to go. */
  historyBack(): boolean
  historyForward(): boolean
  /** Goes to what a note is about: its step, node, wire, or lines in the code. */
  showNote(noteId: string): void
  /** Starts a note about what the reviewer is on: selected lines, an open wire, a node off the path, or the step. */
  startNote(intent: NoteIntent): void
  /** Opens a note to change its words. */
  editNote(noteId: string): void
  /** Keeps what was written as a note and closes the editor. Returns the note when a new one was kept. */
  saveNote(): Note | null
  /** Leaves the editor. What was written stays as a draft. */
  closeEditor(): void
  selectLines(selection: Session['selection']): void
  setPanelOpen(open: boolean): void
  moveNode(nodeId: string, position: Point): void
  decideWire(edgeId: string, decision: WireDecision | null): void
  resetLayout(): void
  /** A message to hobkin is on its way. Returns its key. */
  startAsk(text: string): string
  /** hobkin took the message, now or after what it is doing, or it did not go and why. */
  settleAsk(key: string, outcome: 'queued' | 'taken' | { error: string }): void
  /**
   * Opens the notes panel beside a node, for a quick read of its comments and questions. `node` lists the notes about
   * that node. `step`, the step's index in the story from 0 as `goTo` takes it, goes to that step and lists the notes
   * taken on it. Null closes the panel, and so does a node or a step the review does not have.
   */
  showNotes(target: { node?: string; step?: number } | null): void
  /** Lists the tests of a card under it, or closes the list. A card that is not one closes it. */
  openTests(groupId: string | null): void
  /**
   * Opens a group of a large change in place: its members become cards while the budget lasts, and they and the group
   * card are focused, so the camera frames them. False for a group the review does not have.
   */
  openGroup(groupId: string): boolean
  /** Closes an open group, the last opened when none is named, and focuses its card. False when none was open. */
  closeGroup(groupId?: string): boolean
  /**
   * Escape's: closes every open group at once, whoever opened it, and puts a reviewer who was on one, or on what it
   * opened to, on its card. False when none was open.
   */
  closeGroups(): boolean
  /** Enter on a group card: opens it, or closes it when it is open. A zone's card opens the zone again. */
  toggleGroup(groupId: string): boolean
  /**
   * A zone's heading (spec 055): folds the whole zone into one card, its way in on a card of its own, or opens it again.
   * A reviewer on what folded is on its card, and one on the card is on the zone's first node once it opens. A zone of
   * tests folds only with the code it covers: false for one, and for a zone the review does not have.
   */
  toggleZone(zoneId: string): boolean
  /**
   * Goes to any node of the review, drawn or folded: a node folded into a group opens that group, drawn first in it, and
   * is focused. The outline and the next-unseen key go this way.
   */
  reach(nodeId: string): void
  /**
   * Z: marks what the reviewer is on as seen, or takes the mark off when all of it is: the node named, else the node
   * pointed at, else the focus. A group card, or a card of tests, stands for every node it holds. False when nothing is.
   */
  toggleSeen(nodeId?: string): boolean
  /** L: opens the outline, or closes it. */
  toggleOutline(): void
  /**
   * U, and Shift+U back: goes to the next node that needs the reviewer and is not seen, in the host's rank, round from the
   * end to the start, opening its group when it is folded. Says so when none is left. False when it went nowhere.
   */
  nextUnseen(delta: 1 | -1): boolean
  /**
   * J, and K back (spec 055): goes to the next zone the graph draws, round from the last to the first, on its first node
   * that needs the reviewer in the host's rank, else its first node as drawn, in Story and Free Roam alike. A zone the
   * reviewer folded is gone to on its card. From the whole graph, J goes to the first zone and K to the last. False when
   * the graph draws no zone.
   */
  nextZone(delta: 1 | -1): boolean
  /** Says a short word to the reviewer (`notice`). */
  say(text: string): void
  /** Opens the proof beside the review on a run, or shows another run in it. Nothing else of the review moves. */
  openProof(run: string, from?: string | null): void
  closeProof(): void
  /** Where the reviewer is, to come back to after another page (`place.ts`). */
  placeNow(): SessionPlace
  /** The session came back to a place kept from before: its step was still there, by its id. */
  resumed: boolean
  /**
   * Chooses Story or Free Roam, and starts it from the beginning, whichever was on: Story at its first step, Free Roam
   * with the whole graph and nothing in focus. The code closes. The choice is remembered for the next review.
   */
  setMode(mode: ReviewMode): void
  /**
   * Graph or Code. Code closes the graph's code panel and starts on the code it had open. The graph is where it was left.
   * In the code view, whatever goes to a step or a part (`goTo`, `focusOn`, `showNote`, `openCode`) shows its code there,
   * and the graph's story follows along.
   */
  setLook(look: ReviewLook): void
  /** Shows a file in the code view, its cursor on `at` when given. A selection on another file goes. */
  showFile(fileId: string, at?: DiffAt | null): void
  /** Z in the code view: marks every changed part of the review in a file seen, or takes the marks off when all are. False when it has none. */
  toggleFileSeen(fileId: string): boolean
  /**
   * Takes in a newer copy of the same review, at the same commit, such as one whose change review rewrote its story:
   * the graph, its levels and the story follow it in place. The reviewer stays on the step, the node or the whole graph
   * they were on, and what they have open stays open, while the review still has it; a step it no longer has puts them
   * on its first. The camera frames where they are again, and nothing draws in again.
   */
  adopt(review: Review): void
}

/** The node whose code a focus opens: the first that points at lines. */
export function codeTarget(view: ReviewView, focus: readonly string[]): string | null {
  return focus.find((id) => (view.nodes.find((node) => node.id === id)?.anchors.length ?? 0) > 0) ?? focus[0] ?? null
}

export interface SessionStore extends StoreApi<Session> {
  /**
   * Follows the reviewer's memory: moved nodes, wire choices and notes. Returns the way to stop.
   * Called from an effect, so React's development double mount stops and starts it cleanly.
   */
  connect(): () => void
}

/**
 * Lookups over a view, rebuilt only when the view changes. The tests folded into a card are not drawn, and are still
 * found by their id: the code panel shows one, and a note can be about one.
 */
function shapeOf(view: ReviewView): Pick<Session, 'nodeOf' | 'edgeOf' | 'pins'> {
  const pins: Record<string, { in: boolean; out: boolean }> = Object.fromEntries(view.nodes.map((node) => [node.id, { in: false, out: false }]))
  for (const edge of view.edges) {
    if (pins[edge.from]) pins[edge.from]!.out = true
    if (pins[edge.to]) pins[edge.to]!.in = true
  }
  const nodeOf = new Map([...view.hidden, ...view.nodes].map((node) => [node.id, node]))
  return { nodeOf, edgeOf: new Map(view.edges.map((edge) => [edge.id, edge])), pins }
}

/** Where a node is drawn: a folded test on its card, a node folded into a closed group on the group's card, any other as itself. */
export const drawnAs = (view: Pick<ReviewView, 'groupOf'> & Partial<Pick<ReviewView, 'foldOf'>>, nodeId: string): string => {
  const card = view.groupOf[nodeId] ?? nodeId
  return view.foldOf?.[card] ?? card
}

/** The nodes of the review a drawn node stands for: a card's tests and helpers, a group's members, or itself. */
export function reviewNodesOf(view: Pick<ReviewView, 'groups' | 'plan'>, id: string): string[] {
  const tests = view.groups[id]
  if (tests) return [...tests.tests, ...tests.helpers]
  const group = view.plan.groups[id]
  if (group) return group.members.flatMap((member) => reviewNodesOf(view, member))
  return [id]
}

/** True when every node of the review a drawn node stands for is seen. */
export function seenAll(session: Pick<Session, 'view' | 'seen'>, id: string): boolean {
  return reviewNodesOf(session.view, id).every((member) => session.seen.has(member))
}

/** The same place, among what a view draws: a detour or a group on a node that folded away is on its group's card. */
function onDrawn(view: ReviewView, story: StoryState): StoryState {
  const drawn = new Set(view.nodes.map((node) => node.id))
  const as = (id: string) => (drawn.has(id) ? id : drawnAs(view, id))
  const detour = story.detour == null ? null : as(story.detour)
  const group = story.group == null ? null : [...new Set(story.group.map(as))].filter((id) => drawn.has(id))
  // A group of one card left on screen, with no detour, is a detour to that card.
  const lone = group?.length === 1 && story.detour == null ? group[0]! : null
  return {
    ...story,
    detour: lone ?? (detour != null && drawn.has(detour) ? detour : null),
    group: group && group.length > 1 ? group : null,
  }
}

type Placed = Pick<Review, 'nodes' | 'edges'> & Pick<ReviewView, 'story' | 'stepOf'>

/** A place to go back to, on the review as it is now: its step found by its id. Null when it is gone or not drawn. */
function keptEntry(graph: Placed, drawn: ReadonlySet<string>, { stepId, ...entry }: KeptEntry): FocusEntry | null {
  const step = graph.stepOf[stepId]
  if (step == null) return null
  if (entry.detour != null && !drawn.has(entry.detour)) return null
  if (entry.group && !entry.group.every((id) => drawn.has(id))) return null
  return { ...entry, step }
}

/**
 * A place kept from before, on the review as it is now: its step found by its id, as `adopt` finds it, and its way back
 * and forward without the places it no longer has. Null when its step is gone or what it focused is not drawn.
 */
function keptPlace(graph: Placed, kept: SessionPlace): { story: StoryState; history: FocusHistory } | null {
  const drawn = new Set(graph.nodes.map((node) => node.id))
  const step = typeof kept.stepId === 'string' ? graph.stepOf[kept.stepId] : undefined
  if (step == null) return null
  if (kept.story.detour != null && !drawn.has(kept.story.detour)) return null
  if (kept.story.group && !kept.story.group.every((id) => drawn.has(id))) return null

  const steps = new Set(graph.story.map((each) => each.id))
  const known = new Set([...drawn, ...graph.edges.map((edge) => edge.id)])
  const story = {
    ...kept.story,
    step,
    seen: kept.story.seen.filter((id) => steps.has(id)),
    revealed: kept.story.revealed.filter((id) => known.has(id)),
  }
  const entries = (list: readonly KeptEntry[]) =>
    list.map((entry) => keptEntry(graph, drawn, entry)).filter((entry): entry is FocusEntry => entry != null)
  return {
    story,
    history: { back: entries(kept.history.back), forward: entries(kept.history.forward) },
  }
}

/**
 * A session on a review. `kept` is where the reviewer was when they left it for another page (`place.ts`): the session
 * comes back there, as long as the review at this commit still has it. `opens.look` is the look the window's settings
 * open reviews in; a place kept wins over it.
 */
export function createSession(opened: Review, memory: StoreApi<MemoryState>, kept: SessionPlace | null = null, opens: { look?: ReviewLook } = {}): SessionStore {
  /** The review on screen: the one opened, then each newer copy of it taken in (`adopt`). */
  let review = opened
  /** Which of its groups are open. Kept here too, so the view can be worked out before the store holds it. */
  let fold: FocusState = kept?.fold ?? NO_FOCUS
  const viewNow = () => applyMemory(review, memory.getState().of(review), fold)
  /** Each node's mark, and the nodes whose marks the memory holds (`seen.ts`). */
  let marks = marksOf(review.nodes)
  const seenNow = (): ReadonlySet<string> => {
    const held = memory.getState().seenOf(review)
    return new Set([...marks].filter(([, mark]) => held.has(mark)).map(([id]) => id))
  }
  /** The memory's marks the session shows, so it takes them in once each time they change. */
  let shownMarks = memory.getState().of(review).seen
  const takeSeen = () => {
    const held = memory.getState().of(review).seen
    if (held === shownMarks) return
    shownMarks = held
    store.setState({ seen: seenNow() })
  }
  /** Marks nodes of the review seen, by their ids, or takes their marks off. */
  const markSeen = (ids: readonly string[], seen = true) => {
    const nodeMarks = ids.map((id) => marks.get(id)).filter((mark): mark is string => mark != null)
    memory.getState().markSeen(review, nodeMarks, seen)
    takeSeen()
  }
  const firstView = viewNow()
  // A review opens in the mode chosen last, at that mode's start, or where the reviewer was when they left it.
  const back = kept ? keptPlace({ ...review, ...firstView }, kept) : null
  const firstMode = back ? kept!.mode : memory.getState().reviewMode
  const opening = startStory({ ...review, ...firstView }, memory.getState().of(review).progress)
  const firstStory = back?.story ?? (firstMode === 'roam' ? modeStart({ ...review, ...firstView }, opening, 'roam').state : opening)

  let digits = NO_DIGITS
  let digitTimer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
  /** The count `proofAt` and `codeAt` take from. */
  let openedCount = 0
  /** What Enter found when it opened the code: the wire it closed, and the move the review was on. */
  let beforeCode: { wire: string | null; move: number } | null = null

  const store = createStore<Session>()((set, get) => {
    /** Everything that follows from the story and the view. */
    const derive = (view: ReviewView, story: StoryState) => {
      const focus = focusOf({ ...review, ...view }, story)
      return { view, ...shapeOf(view), story, focus, levels: focusLevels(view, focus), revealed: new Set(story.revealed) }
    }

    const entryOf = (story: StoryState): FocusEntry => ({ step: story.step, detour: story.detour, group: story.group, whole: story.whole })
    /**
     * Moves the focus. Every move but a single step along the story is kept in the history: a walk with
     * Left and Right already goes back and forward on its own.
     */
    const apply = (moved: Moved, kind: Move['kind'], preferred?: string, history?: FocusHistory) => {
      const before = get()
      const next = derive(before.view, moved.state)
      const travel = kind === 'whole' ? null : pickTravel(before.view.edges, before.focus, next.focus, preferred)
      memory.getState().saveProgress(review, progressOf(review, moved.state))
      // A step visited on the path is seen: every node the review's own steps under it focus. In the code view a file is
      // seen when the reviewer says so, so a step gone to from the panel marks nothing there.
      const { detour, group, whole, step } = moved.state
      if (before.look !== 'code' && detour == null && group == null && !whole) {
        const told = new Set(before.view.story[step]?.steps ?? [])
        markSeen(review.story.filter((each) => told.has(each.id)).flatMap((each) => each.focus))
      }
      const code = before.code == null ? null : (codeTarget(next.view, next.focus) ?? before.code)
      if (code != null) markSeen(reviewNodesOf(next.view, code))
      set({
        history: history ?? (kind === 'step' ? before.history : recordFocus(before.history, entryOf(before.story), entryOf(moved.state))),
        ...next,
        move: { key: before.move.key + 1, fresh: moved.fresh, travel, kind },
        wire: null,
        // A move changes what is under the pointer, so whatever was hovered no longer is.
        hovered: null,
        hover: hoverLevels(next.view, null),
        pointed: null,
        // The notes panel belongs to what it was opened beside, and so does a card's list of tests.
        notesShown: null,
        opened: null,
        // An open code panel follows the story, so stepping with code on screen reads like a tour.
        code,
      })
    }
    const graph = () => ({ ...review, ...get().view })
    const partOf = (id: string) => review.nodes.find((node) => node.id === id)
    /**
     * In the code view, what goes to a step or a part shows its code there: the first of `ids`, or of the parts they stand
     * for, with code in a file the code view lists. Nothing moves for code it does not list, such as unchanged context.
     */
    const followInCode = (ids: readonly string[]) => {
      if (get().look !== 'code') return
      for (const id of ids.flatMap((each) => reviewNodesOf(get().view, each))) {
        const node = partOf(id)
        const place = node ? placeOfPart(node, review.files) : null
        if (place) return get().showFile(place.fileId, place.at)
      }
    }
    /** The move that puts the reviewer back on a place they were. */
    const movedTo = (entry: FocusEntry): Moved => {
      let moved = goToStep(graph(), get().story, entry.step)
      if (entry.detour || entry.group?.length) {
        const detour = entry.detour ? focusNode(graph(), moved.state, entry.detour) : focusGroup(graph(), moved.state, entry.group!)
        moved = { state: detour.state, fresh: { nodes: [...moved.fresh.nodes, ...detour.fresh.nodes], wires: [...moved.fresh.wires, ...detour.fresh.wires] } }
      }
      if (entry.whole) moved = { state: leaveFocus(graph(), moved.state), fresh: moved.fresh }
      return moved
    }
    /** Folds the review again as `next` says. The reviewer stays where they are, on what is drawn now. */
    const refold = (next: FocusState) => {
      fold = next
      const before = get()
      const view = viewNow()
      const shaped = derive(view, onDrawn(view, before.story))
      const asDrawn = (id: string | null) => (id != null && shaped.nodeOf.has(id) ? drawnAs(view, id) : null)
      // A card's list of tests stays open while that card is still drawn.
      const listed = before.opened
      const stillListed = listed != null && view.groups[listed] != null && view.nodes.some((node) => node.id === listed)
      set({
        fold,
        ...shaped,
        hovered: null,
        hover: hoverLevels(view, null),
        wire: before.wire != null && shaped.edgeOf.has(before.wire) ? before.wire : null,
        pointed: asDrawn(before.pointed),
        opened: stillListed ? listed : null,
      })
    }

    const first = derive(firstView, firstStory)
    return {
      review,
      ...first,
      hovered: null,
      hover: hoverLevels(firstView, null),
      move: { key: 0, fresh: { nodes: [], wires: [] }, travel: null, kind: 'open' },
      wire: null,
      code: back && kept!.code != null && first.nodeOf.has(kept!.code) ? kept!.code : null,
      notes: memory.getState().notesOf(review),
      counts: countNotes(memory.getState().notesOf(review)),
      selection: null,
      pointed: null,
      editor: null,
      // Open until the reviewer first moves: the panel is where a review is introduced.
      panelOpen: true,
      finder: false,
      pendingDigits: '',
      history: back ? back.history : NO_HISTORY,
      asks: [],
      notesShown: null,
      opened: null,
      mode: firstMode,
      look: back ? (kept!.look ?? 'graph') : (opens.look ?? 'graph'),
      diff: { file: back && kept!.file != null && review.files.some((file) => file.id === kept!.file) ? kept!.file : null, at: null, ask: 0 },
      fold,
      seen: seenNow(),
      outline: back ? kept!.outline : firstView.plan.active,
      outlineAsked: 0,
      notice: null,
      // A place not taken brings nothing back: not its proof, and not its camera (`resumedCamera`).
      proof: back && kept?.proof ? { run: kept.proof, from: null } : null,
      proofAt: 0,
      codeAt: 0,
      resumed: back != null,

      step: (delta) => {
        const { story } = get()
        const index = stepFrom(graph(), story, delta)
        if (index === story.step && !offPath(graph(), story)) return
        // Riding the wire the review names only makes sense when moving one step forward along the path.
        const forward = index === story.step + 1 && !offPath(graph(), story)
        apply(goToStep(graph(), story, index), 'step', forward ? get().view.story[index]?.travel : undefined)
        followInCode(get().view.story[index]?.focus ?? [])
      },
      goTo: (index) => {
        const { story } = get()
        if (!(index === story.step && !offPath(graph(), story))) apply(goToStep(graph(), story, index), Math.abs(index - story.step) === 1 ? 'step' : 'jump')
        followInCode(get().view.story[index]?.focus ?? [])
      },
      focusOn: (nodeId) => {
        const { story, focus, mode } = get()
        // A folded test is focused on its card.
        const drawn = drawnAs(get().view, nodeId)
        // In Free Roam a node of a step is focused alone, as any other: no step takes the focus back.
        if (!(focus.length === 1 && focus[0] === drawn)) apply(focusNode(graph(), story, drawn, { alone: mode === 'roam' }), 'detour')
        if (get().nodeOf.has(drawn)) set({ pointed: drawn })
        followInCode([nodeId])
      },
      back: () => {
        const { story, mode } = get()
        // Going back to the step is going to a step: it is framed again. In Free Roam there is no step to go back to.
        if (mode === 'story' && offPath(graph(), story)) apply(backToStep(graph(), story), 'jump')
      },
      leave: () => {
        const { story, focus } = get()
        if (focus.length === 0) return false
        apply({ state: leaveFocus(graph(), story), fresh: { nodes: [], wires: [] } }, 'whole')
        return true
      },
      refit: () => {
        set({ move: { key: get().move.key + 1, fresh: { nodes: [], wires: [] }, travel: null, kind: 'whole' } })
        return true
      },
      hoverOn: (hovered) => {
        if (hovered !== get().hovered) set({ hovered, hover: hoverLevels(get().view, hovered) })
      },
      openWire: (wire) => set({ wire }),
      openCode: (nodeId) => {
        const { view, focus, story } = get()
        // On the path, the code a step offers is its own: a step told beside its neighbor's node offers none of that node's.
        const onPath = story.detour == null && story.group == null && !story.whole
        const target = nodeId ?? codeTarget(view, onPath ? (view.story[story.step]?.focus ?? []) : focus)
        beforeCode = null
        if (!target) return false
        // The code view has no code panel: the code is shown there.
        if (get().look === 'code') return followInCode([target]), true
        // A folded test shows its own code, with its card in focus.
        if (nodeId && !focus.includes(drawnAs(view, nodeId))) get().focusOn(nodeId)
        set({ code: target, wire: null, ...(get().code == null ? { codeAt: (openedCount += 1) } : {}) })
        markSeen(reviewNodesOf(get().view, target))
        return true
      },
      closeCode: () => {
        beforeCode = null
        set({ code: null, selection: null })
      },
      toggleCode: () => {
        const { code, wire, move } = get()
        if (code == null) {
          if (!get().openCode()) return false
          beforeCode = { wire, move: move.key }
          return true
        }
        // A move since takes the reviewer elsewhere: they stay there, and the wire that was open belongs to where they were.
        const back = beforeCode?.move === get().move.key ? beforeCode.wire : null
        get().closeCode()
        if (back != null && get().edgeOf.has(back)) set({ wire: back })
        return true
      },
      typeDigit: (digit) => {
        const total = get().view.story.length
        clearTimeout(digitTimer)
        const result = pressDigit(digits, digit, Date.now(), total)
        digits = result.buffer
        set({ pendingDigits: digits.digits })
        if (result.jump != null) get().goTo(result.jump)
        if (result.wait != null) {
          digitTimer = setTimeout(() => {
            const taken = commitDigits(digits, get().view.story.length)
            digits = taken.buffer
            set({ pendingDigits: '' })
            if (taken.jump != null) get().goTo(taken.jump)
          }, result.wait)
        }
      },
      openFinder: () => set({ finder: true, wire: null }),
      closeFinder: () => {
        if (get().finder) set({ finder: false, hovered: null, hover: hoverLevels(get().view, null) })
      },
      historyBack: () => {
        const result = goBack(get().history, entryOf(get().story))
        if (!result) return false
        apply(movedTo(result.entry), result.entry.whole ? 'whole' : 'jump', undefined, result.history)
        return true
      },
      historyForward: () => {
        const result = goForward(get().history, entryOf(get().story))
        if (!result) return false
        apply(movedTo(result.entry), result.entry.whole ? 'whole' : 'jump', undefined, result.history)
        return true
      },
      showNote: (noteId) => {
        const note = get().notes.find((entry) => entry.id === noteId)
        if (!note) return
        const stepIndex = get().view.stepOf[note.step] ?? -1
        const { target } = note
        // The code view shows a note's lines, else the code of what it is about.
        if (get().look === 'code' && target.kind === 'lines') return get().showFile(target.fileId, { side: target.side, startLine: target.startLine, endLine: target.endLine })
        if (target.kind === 'step') {
          if (stepIndex >= 0) get().goTo(stepIndex)
          return
        }
        if (target.kind === 'node') {
          get().focusOn(target.node)
          return
        }
        if (target.kind === 'wire') {
          const edge = get().edgeOf.get(target.wire)
          if (!edge) return
          get().focusOn(edge.from)
          set({ wire: edge.id })
          return
        }
        // Lines: the code of the node they belong to, with the lines selected.
        const owner =
          get().focus.find((id) => get().nodeOf.get(id)?.anchors.some((anchor) => anchor.fileId === target.fileId)) ??
          get().view.nodes.find((node) => node.anchors.some((anchor) => anchor.fileId === target.fileId && anchor.side === target.side && anchor.startLine <= target.endLine && target.startLine <= anchor.endLine))?.id
        if (owner && get().openCode(owner)) set({ selection: target })
      },
      startNote: (intent) => {
        const { story, wire, selection, view, pointed } = get()
        const step = view.story[story.step]
        if (!step) return
        if (get().look === 'code') {
          // C or D on lines that carry a note of that kind opens it, as in pi-coder.
          const held = selection
            ? get().notes.find(({ author, intent: kind, target }) => author === 'user' && kind === intent && target.kind === 'lines' && target.fileId === selection.fileId && target.side === selection.side && target.startLine <= selection.startLine && selection.endLine <= target.endLine)
            : undefined
          if (held) return get().editNote(held.id)
          // Lines selected, or with none, as with the files focused, the file, through its first part.
          const file = review.files.find((each) => each.id === (selection?.fileId ?? get().diff.file))
          const part = file ? partsInFile(review.nodes, file)[0] : undefined
          const target: NoteTarget = selection ?? (part ? { kind: 'node', node: part.id } : { kind: 'step' })
          const on = stepShowing(view.story, (id) => reviewNodesOf(view, id), partOf, target) ?? step.id
          const draft = memory.getState().of(review).draft
          memory.getState().setDraft(review, { intent, text: draft && !draft.editing ? draft.text : '' })
          set({ editor: { step: on, target } })
          return
        }
        // A note on a card of folded tests is about its first test: a node of the review, which hobkin can read.
        const on = story.detour ?? pointed
        const target = noteTarget({ step: step.id, detour: on ? (get().view.groups[on]?.tests[0] ?? on) : null, wire, selection })
        const draft = memory.getState().of(review).draft
        // A draft left behind is picked up again, unless it was an edit of another note.
        memory.getState().setDraft(review, { intent, text: draft && !draft.editing ? draft.text : '' })
        set({ editor: { step: step.id, target } })
      },
      editNote: (noteId) => {
        const note = get().notes.find((entry) => entry.id === noteId)
        if (!note) return
        memory.getState().setDraft(review, { intent: note.intent, text: note.text, editing: note.id })
        set({ editor: { step: note.step, target: note.target, editing: note.id } })
      },
      saveNote: () => {
        const { editor } = get()
        const draft = memory.getState().of(review).draft
        if (!editor || !draft) {
          set({ editor: null })
          return null
        }
        let kept: Note | null = null
        if (editor.editing) memory.getState().editNote(review, editor.editing, { text: draft.text, intent: draft.intent })
        else kept = memory.getState().addNote(review, { step: editor.step, target: editor.target, intent: draft.intent, text: draft.text })
        memory.getState().setDraft(review, null)
        // In the code view the selection is the cursor's, and stays: the next note, as the next question, is about it too.
        set({ editor: null, ...(get().look === 'code' ? {} : { selection: null }) })
        return kept
      },
      closeEditor: () => {
        // An edit that was abandoned leaves the note as it was, and no draft behind.
        if (get().editor?.editing) memory.getState().setDraft(review, null)
        set({ editor: null })
      },
      selectLines: (selection) => set({ selection }),
      setPanelOpen: (panelOpen) => {
        if (panelOpen !== get().panelOpen) set({ panelOpen })
      },
      showCode: (nodeId) => {
        if (get().look === 'code') return followInCode([nodeId])
        if (get().code == null || !get().nodeOf.has(nodeId)) return
        set({ code: nodeId })
        markSeen(reviewNodesOf(get().view, nodeId))
      },
      showTest: (testId) => {
        if (!get().nodeOf.has(testId)) return false
        if (get().look === 'code') return followInCode([testId]), true
        beforeCode = null
        set({ code: testId, wire: null, ...(get().code == null ? { codeAt: (openedCount += 1) } : {}) })
        markSeen([testId])
        return true
      },
      moveNode: (nodeId, position) => memory.getState().moveNode(review, nodeId, position),
      decideWire: (edgeId, decision) => memory.getState().decideWire(review, edgeId, decision),
      resetLayout: () => memory.getState().resetLayout(review),
      startAsk: (text) => {
        const key = `ask${(asked += 1)}`
        set({ asks: [...get().asks, { key, text, at: Date.now(), state: 'sending' }] })
        return key
      },
      settleAsk: (key, outcome) => {
        const settled = (ask: PendingAsk): PendingAsk => {
          if (ask.key !== key) return ask
          return typeof outcome === 'string' ? { ...ask, state: outcome } : { ...ask, state: 'failed', error: outcome.error }
        }
        set({ asks: get().asks.map(settled) })
      },
      showNotes: (target) => {
        const close = () => {
          if (get().notesShown) set({ notesShown: null })
        }
        if (!target) return close()
        if (target.step != null) {
          const step = Number.isInteger(target.step) ? get().view.story[target.step] : undefined
          if (!step) return close()
          get().goTo(target.step)
          set({ notesShown: { kind: 'step', step: step.id } })
          return
        }
        const node = target.node == null ? null : drawnAs(get().view, target.node)
        if (node == null || !get().nodeOf.has(node)) return close()
        set({ notesShown: { kind: 'node', node } })
      },
      openTests: (groupId) => {
        const opened = groupId != null && get().view.groups[groupId] ? groupId : null
        if (opened !== get().opened) set({ opened })
      },
      openGroup: (groupId) => {
        const group = get().view.plan.groups[groupId]
        if (!group) return false
        // A zone the reviewer folded opens as a zone, not in place.
        if (group.kind === 'zone') return group.zone != null && (fold.zones ?? []).includes(group.zone) && get().toggleZone(group.zone)
        refold({ ...fold, opened: [...fold.opened.filter((id) => id !== groupId), groupId], pinned: fold.pinned })
        const drawnNow = [groupId, ...(get().view.plan.shown[groupId] ?? [])]
        apply(focusGroup(graph(), get().story, drawnNow), 'jump')
        return true
      },
      closeGroup: (groupId) => {
        const id = groupId ?? fold.opened.at(-1)
        if (id == null || !fold.opened.includes(id)) return false
        const members = new Set(get().view.plan.groups[id]?.members ?? [])
        // The reviewer on the group, or on what it opened to, is put back on its card. Anywhere else, they stay there.
        const inside = get().focus.some((each) => each === id || members.has(each))
        refold({
          ...fold,
          opened: fold.opened.filter((each) => each !== id),
          pinned: fold.pinned.filter((pin) => !members.has(pin)),
        })
        // The card is brought into view: what the reviewer was on may have stood far from it, in the block.
        if (inside) apply(focusNode(graph(), get().story, id, { alone: get().mode === 'roam' }), 'detour')
        return true
      },
      closeGroups: () => {
        if (fold.opened.length === 0) return false
        const { focus, view } = get()
        // The group the reviewer is on, its card or a member, the last opened first.
        const holds = (id: string) => focus.some((each) => each === id || view.plan.groupOf[each] === id)
        const holding = [...fold.opened].reverse().find(holds)
        refold({ ...fold, opened: [], pinned: [] })
        if (holding != null) apply(focusNode(graph(), get().story, holding, { alone: get().mode === 'roam' }), 'detour')
        return true
      },
      toggleSeen: (nodeId) => {
        const { focus, pointed, view, seen } = get()
        const on = nodeId != null ? [nodeId] : pointed != null ? [pointed] : focus
        const ids = [...new Set(on.flatMap((id) => reviewNodesOf(view, id)))].filter((id) => marks.has(id))
        if (ids.length === 0) return false
        markSeen(ids, !ids.every((id) => seen.has(id)))
        return true
      },
      toggleOutline: () => set(get().outline ? { outline: false } : { outline: true, outlineAsked: get().outlineAsked + 1 }),
      placeNow: () => {
        const { story, mode, history, outline, code, proof, view, look, diff } = get()
        const stepId = (step: number) => view.story[step]?.id ?? ''
        const kept = (entry: FocusEntry): KeptEntry => ({ ...entry, stepId: stepId(entry.step) })
        return {
          story,
          stepId: stepId(story.step),
          mode,
          history: { back: history.back.map(kept), forward: history.forward.map(kept) },
          fold,
          outline,
          code,
          proof: proof?.run ?? null,
          look,
          file: diff.file,
        }
      },
      say: (text) => set({ notice: { key: (get().notice?.key ?? 0) + 1, text } }),
      openProof: (run, from = null) => {
        const now = get().proof
        if (now?.run !== run || now.from !== from) set({ proof: { run, from }, proofAt: (openedCount += 1) })
      },
      closeProof: () => {
        if (get().proof) set({ proof: null })
      },
      nextUnseen: (delta) => {
        const say = get().say
        const wanted = review.nodes
          .filter((node) => node.attention?.tier === 'needs-you')
          .sort((a, b) => a.attention!.rank - b.attention!.rank)
          .map((node) => node.id)
        if (wanted.length === 0) {
          say('This review does not say what needs you.')
          return false
        }

        const { focus, pointed, view, seen } = get()
        // Where the reviewer is: the node pointed at or focused. A group card in focus is not its members: they are next.
        const on = pointed ? [pointed] : focus
        const here = new Set(on.filter((id) => !isFoldGroup(id)).flatMap((id) => reviewNodesOf(view, id)))
        const at = delta > 0 ? wanted.findLastIndex((id) => here.has(id)) : wanted.findIndex((id) => here.has(id))
        const start = at >= 0 ? at : delta > 0 ? -1 : wanted.length
        // Round from the end to the start, and from the start to the end going back.
        const around = (index: number) => ((index % wanted.length) + wanted.length) % wanted.length
        for (let step = 1; step <= wanted.length; step += 1) {
          const id = wanted[around(start + delta * step)]!
          if (seen.has(id) || here.has(id)) continue
          get().reach(id)
          return true
        }

        const onLastUnseen = wanted.some((id) => here.has(id) && !seen.has(id))
        say(onLastUnseen ? 'This is the last node that needs you and is not seen yet.' : 'Every node that needs you is seen.')
        return false
      },
      nextZone: (delta) => {
        const { view, focus, pointed, nodeOf } = get()
        const drawn = view.zones.filter((zone) => view.nodes.some((node) => node.zone === zone.id))
        if (drawn.length === 0) return false

        // The zone the reviewer is on, and the one after it, round from the last to the first.
        const on = pointed ?? focus[0]
        const here = drawn.findIndex((zone) => zone.id === view.nodes.find((node) => node.id === on)?.zone)
        const from = here < 0 ? (delta > 0 ? -1 : drawn.length) : here
        const zone = drawn[(from + delta + drawn.length) % drawn.length]!

        const [needsYou] = zone.nodes
          .map((id) => nodeOf.get(id))
          .filter((node): node is ReviewNode => node?.attention?.tier === 'needs-you')
          .sort((a, b) => a.attention!.rank - b.attention!.rank)
        if (needsYou && !(fold.zones ?? []).includes(zone.id)) {
          get().reach(needsYou.id)
          return true
        }
        const [first] = view.nodes
          .filter((node) => node.zone === zone.id)
          .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
        get().focusOn(first!.id)
        return true
      },
      toggleGroup: (groupId) => {
        const zone = get().view.plan.groups[groupId]
        if (zone?.kind === 'zone' && zone.zone != null) return get().toggleZone(zone.zone)
        return fold.opened.includes(groupId) ? get().closeGroup(groupId) : get().openGroup(groupId)
      },
      toggleZone: (zoneId) => {
        const { view, focus } = get()
        const zone = view.zones.find((each) => each.id === zoneId)
        if (!zone || zone.tests) return false
        const folded = fold.zones ?? []
        const opening = folded.includes(zoneId)
        const onCard = focus.some((id) => view.plan.groups[id]?.kind === 'zone' && view.plan.groups[id]!.zone === zoneId)
        refold({ ...fold, zones: opening ? folded.filter((id) => id !== zoneId) : [...folded, zoneId] })
        if (opening && onCard) {
          const drawn = new Set(get().view.nodes.map((node) => node.id))
          const first = zone.members.find((id) => drawn.has(id))
          if (first) apply(focusNode(graph(), get().story, first, { alone: get().mode === 'roam' }), 'detour')
        }
        return true
      },
      reach: (nodeId) => {
        const holding = () => {
          const { view } = get()
          const card = view.groupOf[nodeId] ?? nodeId
          const group = view.foldOf[card]
          return { card, group, folded: group ? view.plan.groups[group] : undefined }
        }
        // A node in a zone the reviewer folded opens the zone first, then the group Focus folded it into, if any.
        const inZone = holding().folded
        if (inZone?.kind === 'zone' && inZone.zone != null) refold({ ...fold, zones: (fold.zones ?? []).filter((id) => id !== inZone.zone) })
        const { card, group, folded } = holding()
        if (group && isFoldGroup(group) && folded?.kind !== 'zone') {
          const pinned = [card, ...fold.pinned.filter((pin) => pin !== card)].slice(0, FOCUS_BUDGET.cards)
          refold({ ...fold, opened: [...fold.opened.filter((id) => id !== group), group], pinned })
        }
        get().focusOn(nodeId)
      },
      setMode: (mode) => {
        memory.getState().setReviewMode(mode)
        beforeCode = null
        // A mode is the graph's: from the code view it goes back to the graph.
        set({ mode, look: 'graph', code: null, selection: null, finder: false })
        // Its start, as a fresh one: nothing to go back to from before it.
        apply(modeStart(graph(), get().story, mode), mode === 'roam' ? 'whole' : 'jump', undefined, NO_HISTORY)
      },
      setLook: (look) => {
        const before = get()
        if (look === before.look) return
        // The graph is where it was left. What the code view had selected is the code view's.
        if (look === 'graph') return set({ look, selection: null })
        // The code the graph's panel had open is where the code view starts, with what was selected in it.
        beforeCode = null
        set({ look, code: null, wire: null, finder: false, notesShown: null, opened: null, ...(before.code == null ? { selection: null } : {}) })
        if (before.code != null) followInCode([before.code])
      },
      showFile: (fileId, at = null) => {
        const { diff, selection } = get()
        set({ diff: { file: fileId, at, ask: diff.ask + 1 }, selection: selection?.fileId === fileId ? selection : null })
      },
      toggleFileSeen: (fileId) => {
        const file = review.files.find((each) => each.id === fileId)
        const ids = file ? partsToSee(review.nodes, file).map((node) => node.id).filter((id) => marks.has(id)) : []
        if (ids.length === 0) return false
        markSeen(ids, !ids.every((id) => get().seen.has(id)))
        return true
      },
      adopt: (next) => {
        if (next === review) return
        const before = get()
        const was = before.view.story[before.story.step]?.id
        review = next
        marks = marksOf(review.nodes)
        shownMarks = memory.getState().of(review).seen
        const view = viewNow()
        const now = { ...review, ...view }
        // What the reviewer saw and what drew in, of what the review still has.
        const steps = new Set(now.story.map((step) => step.id))
        const known = new Set([...now.nodes.map((node) => node.id), ...now.edges.map((edge) => edge.id)])
        const kept: StoryState = { ...before.story, seen: before.story.seen.filter((id) => steps.has(id)), revealed: before.story.revealed.filter((id) => known.has(id)) }
        const index = was == null ? undefined : view.stepOf[was]
        let story = goToStep(now, kept, index ?? 0).state
        if (index != null && before.story.detour != null) story = focusNode(now, story, before.story.detour, { alone: before.mode === 'roam' }).state
        else if (index != null && before.story.group) story = focusGroup(now, story, before.story.group).state
        else if (index != null && before.story.whole) story = leaveFocus(now, story)
        // Free Roam has no step to stand on: without its node, it has the whole graph, as it starts.
        if (before.mode === 'roam' && story.detour == null && story.group == null) story = leaveFocus(now, story)

        const shaped = derive(view, story)
        const has = (id: string | null): id is string => id != null && shaped.nodeOf.has(id)
        const code = has(before.code) ? before.code : null
        const hovered = has(before.hovered) ? before.hovered : null
        const shown = before.notesShown
        const sameSteps = before.view.story.length === view.story.length && before.view.story.every((step, at) => step.id === view.story[at]!.id)
        if (code == null) beforeCode = null
        set({
          review,
          fold,
          seen: seenNow(),
          ...shaped,
          move: { key: before.move.key + 1, fresh: { nodes: [], wires: [] }, travel: null, kind: story.whole ? 'whole' : story.detour != null ? 'detour' : 'jump' },
          // The places to go back to are steps by their place in the story, so they go with a story that changed.
          history: sameSteps ? before.history : NO_HISTORY,
          wire: before.wire != null && shaped.edgeOf.has(before.wire) ? before.wire : null,
          hovered,
          hover: hoverLevels(view, hovered),
          pointed: has(before.pointed) ? before.pointed : null,
          code,
          // The code view stays on its file and lines, while the review still has the file.
          selection: code == null && before.look !== 'code' ? null : before.selection,
          diff: before.diff.file == null || review.files.some((file) => file.id === before.diff.file) ? before.diff : { file: null, at: null, ask: before.diff.ask + 1 },
          notesShown: shown && (shown.kind === 'node' ? has(shown.node) : view.stepOf[shown.step] != null) ? shown : null,
          opened: before.opened != null && view.groups[before.opened] ? before.opened : null,
        })
      },
    }
  })

  // The reviewer's memory is the source of moved nodes, wire choices and notes. When it changes, the view follows.
  let known = memory.getState().of(review)
  const sync = (state: MemoryState) => {
    const now = state.of(review)
    if (now.notes !== known.notes) {
      const notes = state.notesOf(review)
      store.setState({ notes, counts: countNotes(notes) })
    }
    if (now.seen !== known.seen) takeSeen()
    const moved = now.positions !== known.positions || now.wires !== known.wires
    known = now
    if (!moved) return
    const view = viewNow()
    const { story, hovered, focus, wire } = store.getState()
    store.setState({ view, ...shapeOf(view), levels: focusLevels(view, focus), hover: hoverLevels(view, hovered), revealed: new Set(story.revealed), wire: view.edges.some((edge) => edge.id === wire) ? wire : null })
  }
  const connect = () => {
    // Whatever changed while not connected is taken in first.
    sync(memory.getState())
    return memory.subscribe(sync)
  }
  return Object.assign(store, { connect })
}
