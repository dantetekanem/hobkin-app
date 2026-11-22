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
  /** Which groups of a large change are open, and the nodes reached in them (`graph/focus.ts`). */
  fold: FocusState
  /**
   * The nodes of the review the reviewer has seen, by id (`seen.ts`): a step of theirs was visited, their code was
   * opened, or Z marked them. Kept in the review's memory for each commit.
   */
  seen: ReadonlySet<string>
  /** The outline is open at the left (`outline/Outline.tsx`). A review in Focus opens with it open, any other without. */
  outline: boolean
  /** A short word to the reviewer, said again on each press that asks: `key` goes up each time it is said. */
  notice: { key: number; text: string } | null

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
  /** Enter on a group card: opens it, or closes it when it is open. */
  toggleGroup(groupId: string): boolean
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
   * Chooses Story or Free Roam, and starts it from the beginning, whichever was on: Story at its first step, Free Roam
   * with the whole graph and nothing in focus. The code closes. The choice is remembered for the next review.
   */
  setMode(mode: ReviewMode): void
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
  return {
    ...story,
    detour: detour != null && drawn.has(detour) ? detour : null,
    group: group && group.length > 1 ? group : null,
    ...(group?.length === 1 && story.detour == null ? { detour: group[0]! } : {}),
  }
}

export function createSession(opened: Review, memory: StoreApi<MemoryState>): SessionStore {
  /** The review on screen: the one opened, then each newer copy of it taken in (`adopt`). */
  let review = opened
  /** Which of its groups are open. Kept here too, so the view can be worked out before the store holds it. */
  let fold: FocusState = NO_FOCUS
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
    memory.getState().markSeen(review, ids.map((id) => marks.get(id)).filter((mark): mark is string => mark != null), seen)
    takeSeen()
  }
  const firstView = viewNow()
  // A review opens in the mode chosen last, at that mode's start.
  const firstMode = memory.getState().reviewMode
  const opening = startStory({ ...review, ...firstView }, memory.getState().of(review).progress)
  const firstStory = firstMode === 'roam' ? modeStart({ ...review, ...firstView }, opening, 'roam').state : opening

  let digits = NO_DIGITS
  let digitTimer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
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
      // A step visited on the path is seen: every node the review's own steps under it focus.
      const { detour, group, whole, step } = moved.state
      if (detour == null && group == null && !whole) {
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
      const drawn = (id: string | null) => (id != null && shaped.nodeOf.has(id) ? drawnAs(view, id) : null)
      set({
        fold,
        ...shaped,
        hovered: null,
        hover: hoverLevels(view, null),
        wire: before.wire != null && shaped.edgeOf.has(before.wire) ? before.wire : null,
        pointed: drawn(before.pointed),
        opened: before.opened != null && view.groups[before.opened] && view.nodes.some((node) => node.id === before.opened) ? before.opened : null,
      })
    }

    return {
      review,
      ...derive(firstView, firstStory),
      hovered: null,
      hover: hoverLevels(firstView, null),
      move: { key: 0, fresh: { nodes: [], wires: [] }, travel: null, kind: 'open' },
      wire: null,
      code: null,
      notes: memory.getState().notesOf(review),
      counts: countNotes(memory.getState().notesOf(review)),
      selection: null,
      pointed: null,
      editor: null,
      // Open until the reviewer first moves: the panel is where a review is introduced.
      panelOpen: true,
      finder: false,
      pendingDigits: '',
      history: NO_HISTORY,
      asks: [],
      notesShown: null,
      opened: null,
      mode: firstMode,
      fold,
      seen: seenNow(),
      outline: firstView.plan.active,
      notice: null,

      step: (delta) => {
        const { story } = get()
        const index = stepFrom(graph(), story, delta)
        if (index === story.step && !offPath(graph(), story)) return
        // Riding the wire the review names only makes sense when moving one step forward along the path.
        const forward = index === story.step + 1 && !offPath(graph(), story)
        apply(goToStep(graph(), story, index), 'step', forward ? get().view.story[index]?.travel : undefined)
      },
      goTo: (index) => {
        const { story } = get()
        if (index === story.step && !offPath(graph(), story)) return
        apply(goToStep(graph(), story, index), Math.abs(index - story.step) === 1 ? 'step' : 'jump')
      },
      focusOn: (nodeId) => {
        const { story, focus, mode } = get()
        // A folded test is focused on its card.
        const drawn = drawnAs(get().view, nodeId)
        // In Free Roam a node of a step is focused alone, as any other: no step takes the focus back.
        if (!(focus.length === 1 && focus[0] === drawn)) apply(focusNode(graph(), story, drawn, { alone: mode === 'roam' }), 'detour')
        if (get().nodeOf.has(drawn)) set({ pointed: drawn })
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
        // A folded test shows its own code, with its card in focus.
        if (nodeId && !focus.includes(drawnAs(view, nodeId))) get().focusOn(nodeId)
        set({ code: target, wire: null })
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
        set({ editor: null, selection: null })
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
        if (get().code == null || !get().nodeOf.has(nodeId)) return
        set({ code: nodeId })
        markSeen(reviewNodesOf(get().view, nodeId))
      },
      showTest: (testId) => {
        if (!get().nodeOf.has(testId)) return false
        beforeCode = null
        set({ code: testId, wire: null })
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
        if (!get().view.plan.groups[groupId]) return false
        refold({ opened: [...fold.opened.filter((id) => id !== groupId), groupId], pinned: fold.pinned })
        apply(focusGroup(graph(), get().story, [groupId, ...(get().view.plan.shown[groupId] ?? [])]), 'jump')
        return true
      },
      closeGroup: (groupId) => {
        const id = groupId ?? fold.opened.at(-1)
        if (id == null || !fold.opened.includes(id)) return false
        const members = new Set(get().view.plan.groups[id]?.members ?? [])
        refold({ opened: fold.opened.filter((each) => each !== id), pinned: fold.pinned.filter((pin) => !members.has(pin)) })
        if (!(get().focus.length === 1 && get().focus[0] === id)) apply(focusNode(graph(), get().story, id, { alone: get().mode === 'roam' }), 'detour')
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
      toggleOutline: () => set({ outline: !get().outline }),
      nextUnseen: (delta) => {
        const say = (text: string) => set({ notice: { key: (get().notice?.key ?? 0) + 1, text } })
        const wanted = review.nodes.filter((node) => node.attention?.tier === 'needs-you').sort((a, b) => a.attention!.rank - b.attention!.rank).map((node) => node.id)
        if (wanted.length === 0) return say('This review does not say what needs you.'), false
        const { focus, pointed, view, seen } = get()
        const here = new Set([...(pointed ? [pointed] : focus)].flatMap((id) => reviewNodesOf(view, id)))
        const at = delta > 0 ? wanted.findLastIndex((id) => here.has(id)) : wanted.findIndex((id) => here.has(id))
        const start = at >= 0 ? at : delta > 0 ? -1 : wanted.length
        for (let step = 1; step <= wanted.length; step += 1) {
          const id = wanted[(((start + delta * step) % wanted.length) + wanted.length) % wanted.length]!
          if (seen.has(id) || here.has(id)) continue
          get().reach(id)
          return true
        }
        say(wanted.some((id) => here.has(id) && !seen.has(id)) ? 'This is the last node that needs you and is not seen yet.' : 'Every node that needs you is seen.')
        return false
      },
      toggleGroup: (groupId) => (fold.opened.includes(groupId) ? get().closeGroup(groupId) : get().openGroup(groupId)),
      reach: (nodeId) => {
        const { view } = get()
        const card = view.groupOf[nodeId] ?? nodeId
        const group = view.foldOf[card]
        if (group && isFoldGroup(group)) {
          const pinned = [card, ...fold.pinned.filter((pin) => pin !== card)].slice(0, FOCUS_BUDGET.cards)
          refold({ opened: [...fold.opened.filter((id) => id !== group), group], pinned })
        }
        get().focusOn(nodeId)
      },
      setMode: (mode) => {
        memory.getState().setReviewMode(mode)
        beforeCode = null
        set({ mode, code: null, selection: null, finder: false })
        // Its start, as a fresh one: nothing to go back to from before it.
        apply(modeStart(graph(), get().story, mode), mode === 'roam' ? 'whole' : 'jump', undefined, NO_HISTORY)
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
          selection: code == null ? null : before.selection,
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
