/**
 * The review's keys. Tab belongs to the frame everywhere, so inside the review the rule is the terminal's:
 * Left and Right change the step, Up and Down move between nodes, Enter opens.
 * See _specs/019-keyboard and the keys in _specs/007-review-story.
 *
 * A key that was used is prevented, and the frame then leaves it alone. Escape is the screen's own
 * (`escapeReview` in entry.ts): it closes the editor, the finder, a wire, selected lines or the code, and otherwise the review.
 */
import type { Verdict } from '#shared/review/verdict.ts'
import { nodeAlongWire, nodeToward, type Direction } from './graph/navigate.ts'
import type { Session } from './state/session.ts'

export interface KeyPress {
  key: string
  shift: boolean
  alt: boolean
}

export interface KeyEffects {
  /** Keys of the code panel, handled by it when it is open. True when it used the key. */
  panelKey(key: string, shift: boolean): boolean
  /** Goes to the steps panel, or back from it to the graph. */
  toggleSteps(): void
  /** Goes to the box where the reviewer talks to hobkin. */
  talk(): void
  /** Shows what a verdict would do, ready for the reviewer's yes. */
  verdict(kind: Verdict): void
}

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/** Walks the wires that touch the focus, one per press, and closes after the last. */
function nextWire(session: Session): string | null {
  const focused = new Set(session.focus)
  const wires = session.view.edges.filter((edge) => focused.has(edge.from) || focused.has(edge.to)).map((edge) => edge.id)
  if (wires.length === 0) return null
  const at = session.wire ? wires.indexOf(session.wire) : -1
  return wires[at + 1] ?? null
}

/** The keys that mean the same in the story and in the graph: the panel, notes, hobkin and the verdict. Null for any other. */
function sharedKey(session: Session, key: string, effects: KeyEffects): boolean | null {
  switch (key) {
    // S for the steps panel: 1 now goes to step 1.
    case 's':
    case 'S':
      return effects.toggleSteps(), true
    // A comment, kept for the verdict. N is the key 009 promises, and C is the one pi-coder uses.
    case 'n':
    case 'N':
    case 'c':
    case 'C':
      return session.startNote('comment'), true
    // A question, to discuss with hobkin.
    case 'd':
    case 'D':
      return session.startNote('question'), true
    // H talks to hobkin about what the reviewer is on.
    case 'h':
    case 'H':
      return effects.talk(), true
    // The verdicts, each shown first and sent only on a second yes: A approves, M approves and merges, X sends the fixes.
    case 'a':
    case 'A':
      return effects.verdict('approve'), true
    case 'm':
    case 'M':
      return effects.verdict('approve-merge'), true
    case 'x':
    case 'X':
      return effects.verdict('request-changes'), true
    default:
      return null
  }
}

/**
 * The story is a page to read: the arrows, Space and the page keys scroll it, and Enter presses what it is on. T goes
 * to the graph, and G to the whole graph, as it does there.
 */
function storyKey(session: Session, key: string, effects: KeyEffects): boolean {
  if (key === 't' || key === 'T') return session.toggleMode()
  if (key === 'g' || key === 'G') {
    session.setMode('graph')
    return session.leave() || session.refit()
  }
  return sharedKey(session, key, effects) ?? false
}

/** Does what a key means in the review. True when the key was the review's, and should go no further. */
export function pressKey(session: Session, press: KeyPress, effects: KeyEffects): boolean {
  const { key, shift, alt } = press
  if (alt) return false
  if (session.mode === 'story') return shift ? false : storyKey(session, key, effects)

  // An open wire takes its two letters first: Y to say yes to a proposed wire, R to remove it.
  const open = session.wire ? session.edgeOf.get(session.wire) : undefined
  if (open?.certainty === 'model' && !shift) {
    if (key === 'y' || key === 'Y') return session.decideWire(open.id, open.proposed ? 'confirmed' : null), true
    if (key === 'r' || key === 'R') return session.decideWire(open.id, 'removed'), session.openWire(null), true
  }

  // With code open, Shift with Up and Down selects lines for a note.
  if (session.code && shift && (key === 'ArrowUp' || key === 'ArrowDown')) return effects.panelKey(key, true)

  const direction = ARROWS[key]
  if (direction && (shift || direction === 'up' || direction === 'down')) {
    const from = session.pointed ?? session.focus[0] ?? null
    // Sideways, the focus follows a wire to the node it connects to, because connection matters more than
    // place. Where no wire leaves that side, it goes to the nearest node that way.
    const along = from && (direction === 'left' || direction === 'right') ? nodeAlongWire(session.view.nodes, session.view.edges, from, direction) : null
    const next = along ?? nodeToward(session.view.nodes, from, direction)
    if (next) session.focusOn(next)
    // At the edge of the graph the key is still the review's: it must not fall through to something else.
    return true
  }
  if (shift) return false

  // 1 to 9 and 0 go to a step. Two digits typed quickly make one number.
  if (/^[0-9]$/.test(key)) return session.typeDigit(key), true

  switch (key) {
    case 'ArrowRight':
    case ' ':
      return session.step(1), true
    case 'ArrowLeft':
      return session.step(-1), true
    case 'Home':
      return session.goTo(0), true
    case 'End':
      return session.goTo(session.view.story.length - 1), true
    case 'Enter':
      return session.openCode(), true
    // G for the whole graph: 0 now goes to step 10.
    case 'g':
    case 'G':
      return session.leave() || session.refit()
    case '/':
      return session.openFinder(), true
    case ',':
      return session.historyBack(), true
    case '.':
      return session.historyForward(), true
    case 'b':
    case 'B':
      return session.back(), true
    case 'w':
    case 'W':
      return session.openWire(nextWire(session)), true
    // T for the story of the change review, when it has one.
    case 't':
    case 'T':
      return session.toggleMode()
    default:
      return sharedKey(session, key, effects) ?? (session.code ? effects.panelKey(key, false) : false)
  }
}
