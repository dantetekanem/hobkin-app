/**
 * One open review: where the reviewer is, what is focused, what the pointer is over and what is open.
 * It joins the pure pieces (the story, the levels, the reviewer's memory) into the state the screen draws.
 * No React here, so the whole of a session can be driven from a test or, later, from a command.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { focusLevels, hoverLevels, type HoverLevel, type Levels, type NodeLevel, type WireLevel } from '../graph/levels.ts'
import { countNotes, noteTarget, type Note, type NoteCounts, type NoteIntent, type NoteTarget } from '../notes/notes.ts'
import { commitDigits, NO_DIGITS, pressDigit } from '../story/digits.ts'
import { goBack, goForward, NO_HISTORY, recordFocus, type FocusEntry, type FocusHistory } from '../story/history.ts'
import type { PendingAsk } from '../panel/thread.ts'
import { backToStep, focusGroup, focusNode, focusOf, goToStep, leaveFocus, offPath, progressOf, startStory, stepFrom, type Fresh, type Moved, type StoryState } from '../story/story.ts'
import { pickTravel, type Travel } from '../story/travel.ts'
import { applyMemory, type MemoryState, type Point, type ReviewView, type ViewEdge, type WireDecision } from './memory.ts'

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
  /** What the reviewer sent hobkin from this review that the conversation does not show yet. */
  asks: readonly PendingAsk[]
  /** The reviewer is talking to hobkin: the panel stays open, with the conversation, until they go back to the graph. */
  talking: boolean

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
  /** Shows another node's code in the open panel, without moving the focus. */
  showCode(nodeId: string): void
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
  /** Keeps what was written as a note and closes the editor. */
  saveNote(): void
  /** Leaves the editor. What was written stays as a draft. */
  closeEditor(): void
  selectLines(selection: Session['selection']): void
  setPanelOpen(open: boolean): void
  moveNode(nodeId: string, position: Point): void
  decideWire(edgeId: string, decision: WireDecision | null): void
  resetLayout(): void
  /** A message to hobkin is on its way. Returns its key. The reviewer is talking from now on. */
  startAsk(text: string): string
  /** hobkin took the message, now or after what it is doing, or it did not go and why. */
  settleAsk(key: string, outcome: 'queued' | 'taken' | { error: string }): void
  /** Messages the conversation shows now, which need no place of their own. */
  dropAsks(keys: readonly string[]): void
  setTalking(talking: boolean): void
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

/** Lookups over a view, rebuilt only when the view changes. */
function shapeOf(view: ReviewView): Pick<Session, 'nodeOf' | 'edgeOf' | 'pins'> {
  const pins: Record<string, { in: boolean; out: boolean }> = Object.fromEntries(view.nodes.map((node) => [node.id, { in: false, out: false }]))
  for (const edge of view.edges) {
    if (pins[edge.from]) pins[edge.from]!.out = true
    if (pins[edge.to]) pins[edge.to]!.in = true
  }
  return { nodeOf: new Map(view.nodes.map((node) => [node.id, node])), edgeOf: new Map(view.edges.map((edge) => [edge.id, edge])), pins }
}

export function createSession(review: Review, memory: StoreApi<MemoryState>): SessionStore {
  const viewNow = () => applyMemory(review, memory.getState().of(review))
  const firstView = viewNow()
  const firstStory = startStory({ ...review, ...firstView }, memory.getState().of(review).progress)

  let digits = NO_DIGITS
  let digitTimer: ReturnType<typeof setTimeout> | undefined
  let asked = 0

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
      set({
        history: history ?? (kind === 'step' ? before.history : recordFocus(before.history, entryOf(before.story), entryOf(moved.state))),
        ...next,
        move: { key: before.move.key + 1, fresh: moved.fresh, travel, kind },
        wire: null,
        // A move changes what is under the pointer, so whatever was hovered no longer is.
        hovered: null,
        hover: hoverLevels(next.view, null),
        pointed: null,
        // An open code panel follows the story, so stepping with code on screen reads like a tour.
        code: before.code == null ? null : (codeTarget(next.view, next.focus) ?? before.code),
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
      talking: false,

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
        const { story, focus } = get()
        if (!(focus.length === 1 && focus[0] === nodeId)) apply(focusNode(graph(), story, nodeId), 'detour')
        if (get().nodeOf.has(nodeId)) set({ pointed: nodeId })
      },
      back: () => {
        const { story } = get()
        if (offPath(graph(), story)) apply(backToStep(graph(), story), 'detour')
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
        const { view, focus } = get()
        const target = nodeId ?? codeTarget(view, focus)
        if (!target) return false
        if (nodeId && !focus.includes(nodeId)) get().focusOn(nodeId)
        set({ code: target, wire: null })
        return true
      },
      closeCode: () => set({ code: null, selection: null }),
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
        const stepIndex = get().view.story.findIndex((step) => step.id === note.step)
        const { target } = note
        if (target.kind === 'step') {
          if (stepIndex >= 0) get().goTo(stepIndex)
          return
        }
        if (target.kind === 'node') return get().focusOn(target.node)
        if (target.kind === 'wire') {
          const edge = get().edgeOf.get(target.wire)
          if (!edge) return
          get().focusOn(edge.from)
          return set({ wire: edge.id })
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
        const target = noteTarget({ step: step.id, detour: story.detour ?? pointed, wire, selection })
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
        if (!editor || !draft) return set({ editor: null })
        if (editor.editing) memory.getState().editNote(review, editor.editing, { text: draft.text, intent: draft.intent })
        else memory.getState().addNote(review, { step: editor.step, target: editor.target, intent: draft.intent, text: draft.text })
        memory.getState().setDraft(review, null)
        set({ editor: null, selection: null })
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
        if (get().code != null && get().nodeOf.has(nodeId)) set({ code: nodeId })
      },
      moveNode: (nodeId, position) => memory.getState().moveNode(review, nodeId, position),
      decideWire: (edgeId, decision) => memory.getState().decideWire(review, edgeId, decision),
      resetLayout: () => memory.getState().resetLayout(review),
      startAsk: (text) => {
        const key = `ask${(asked += 1)}`
        set({ asks: [...get().asks, { key, text, at: Date.now(), state: 'sending' }], talking: true })
        return key
      },
      settleAsk: (key, outcome) =>
        set({ asks: get().asks.map((ask) => (ask.key !== key ? ask : typeof outcome === 'string' ? { ...ask, state: outcome } : { ...ask, state: 'failed', error: outcome.error })) }),
      dropAsks: (keys) => {
        if (keys.length > 0) set({ asks: get().asks.filter((ask) => !keys.includes(ask.key)) })
      },
      setTalking: (talking) => {
        if (talking !== get().talking) set({ talking })
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
