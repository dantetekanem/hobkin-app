/**
 * The review's keys. Tab belongs to the frame everywhere, so inside the review the rule is the terminal's:
 * Left and Right change the step, Up and Down move between nodes, Enter opens the code and closes it again.
 * O is Free Roam and P is Story (`story/mode.ts`): in Free Roam no step leads, every arrow moves between nodes, and
 * the keys that walk the story move nothing.
 * See _specs/019-keyboard and the keys in _specs/007-review-story.
 *
 * A key that was used is prevented, and the frame then leaves it alone. Escape is the screen's own
 * (`escapeReview` in entry.ts): it closes the note being written, the finder, a wire, selected lines or the code, and
 * otherwise the review.
 */
import type { Verdict } from '#shared/review/verdict.ts'
import { isFoldGroup } from './graph/focus.ts'
import { nodeAlongWire, nodeToward, type Direction } from './graph/navigate.ts'
import { modeOfKey } from './story/mode.ts'
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
  /** Shows what a verdict would do, ready for the reviewer's yes. */
  verdict(kind: Verdict): void
  /** Opens the run of the change's first TLA+ model check, as its row in the panel does (050-tla-proofs). */
  openModelRun(): void
}

/**
 * What a key does in the review's input, at the bottom of the canvas: Enter sends, Shift with Enter starts a new line,
 * and Escape gives the keyboard back to the review. Every key there is the input's, so none walks the graph, and
 * Escape never reaches hobkin's chat, where it would stop hobkin.
 */
export function inputKey({ key, shift, composing = false }: { key: string; shift: boolean; composing?: boolean }): 'send' | 'leave' | 'type' {
  if (key === 'Enter' && !shift && !composing) return 'send'
  if (key === 'Escape') return 'leave'
  return 'type'
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

/** The keys of the panel, the review's input and the verdict. Null for any other. */
function panelKeys(session: Session, key: string, effects: KeyEffects): boolean | null {
  switch (key) {
    // S for the steps panel: 1 now goes to step 1.
    case 's':
    case 'S':
      return effects.toggleSteps(), true
    // A comment in the review's input, kept for the verdict. N is the key 009 promises, and C is the one pi-coder uses.
    case 'n':
    case 'N':
    case 'c':
    case 'C':
      return session.startNote('comment'), true
    // A question in the review's input, asked of hobkin about what the reviewer is on. D was a question to discuss
    // later, and H was talking to hobkin: both are asking it now.
    case 'd':
    case 'D':
    case 'h':
    case 'H':
      return session.startNote('question'), true
    // The verdicts, each shown first and done only on a second press: A approves, M approves and merges, X sends the fixes.
    case 'a':
    case 'A':
      return effects.verdict('approve'), true
    case 'm':
    case 'M':
      return effects.verdict('approve-merge'), true
    case 'x':
    case 'X':
      return effects.verdict('request-changes'), true
    // T for TLA+: the run of the change's first model check, on the proof screen. Back there comes back here.
    case 't':
    case 'T':
      return effects.openModelRun(), true
    // L for the outline at the left: every unit and file, the folded ones too (spec 053).
    case 'l':
    case 'L':
      return session.toggleOutline(), true
    // Z marks what the reviewer is on as seen, and again takes the mark off (spec 053). S, which the spec names, is the
    // steps panel's; Z is the free key beside it.
    case 'z':
    case 'Z':
      return session.toggleSeen(), true
    default:
      return null
  }
}

/** Does what a key means in the review. True when the key was the review's, and should go no further. */
export function pressKey(session: Session, press: KeyPress, effects: KeyEffects): boolean {
  const { key, shift, alt } = press
  if (alt) return false

  // An open wire takes its two letters first: Y to say yes to a proposed wire, R to remove it.
  const open = session.wire ? session.edgeOf.get(session.wire) : undefined
  if (open?.certainty === 'model' && !shift) {
    if (key === 'y' || key === 'Y') return session.decideWire(open.id, open.proposed ? 'confirmed' : null), true
    if (key === 'r' || key === 'R') return session.decideWire(open.id, 'removed'), session.openWire(null), true
  }

  // With code open, Shift with Up and Down selects lines for a note.
  if (session.code && shift && (key === 'ArrowUp' || key === 'ArrowDown')) return effects.panelKey(key, true)

  const roam = session.mode === 'roam'
  const direction = ARROWS[key]
  if (direction && (shift || roam || direction === 'up' || direction === 'down')) {
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

  // O and P choose the mode, and start it from the beginning, wherever the reviewer is.
  const mode = modeOfKey(key)
  if (mode) return session.setMode(mode), true
  // In Free Roam no step leads: the keys that walk the story are still the review's, and move nothing.
  if (roam && (/^[0-9]$/.test(key) || [' ', 'Home', 'End', 'b', 'B'].includes(key))) return true

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
    // Enter opens the code of the focus, and Enter again closes it, putting the review back as it was. On a group card
    // of a large change, it opens the group in place, and closes it again.
    case 'Enter': {
      const only = session.focus.length === 1 ? session.focus[0]! : null
      if (session.code == null && only != null && isFoldGroup(only)) return session.toggleGroup(only), true
      return session.toggleCode(), true
    }
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
    default:
      return panelKeys(session, key, effects) ?? (session.code ? effects.panelKey(key, false) : false)
  }
}
