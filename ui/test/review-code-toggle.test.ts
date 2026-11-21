import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession, type Session } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const effects = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, openModelRun: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, effects)
/** What the reviewer sees of where they are: the step, the focus, the open wire, the code, selected lines and the last move. */
const where = ({ story, focus, wire, code, selection, pointed, move }: Session) => ({ step: story.step, detour: story.detour, focus, wire, code, selection, pointed, move: move.key })

test('Enter opens the code of the node in focus, and Enter again closes it and puts the review back as it was', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  session.getState().goTo(3)
  // A wire's label is open when Enter is pressed: the code takes its place, and gives it back.
  const focus = new Set(session.getState().focus)
  const wire = session.getState().view.edges.find((edge) => focus.has(edge.from) || focus.has(edge.to))!.id
  session.getState().openWire(wire)
  const before = where(session.getState())

  assert.equal(press(session, 'Enter'), true)
  assert.ok(session.getState().code, 'the first Enter opens the code')
  assert.equal(session.getState().wire, null)
  // Lines picked in the code for a note are the code's, and go with it.
  const anchor = session.getState().nodeOf.get(session.getState().code!)!.anchors[0]!
  session.getState().selectLines({ kind: 'lines', fileId: anchor.fileId, side: anchor.side, startLine: anchor.startLine, endLine: anchor.startLine, hash: 'h' })

  assert.equal(press(session, 'Enter'), true, 'the second Enter is the review\'s too')
  assert.deepEqual(where(session.getState()), before, 'the review is back as it was before the code opened')
})

test('a move while the code is open keeps the reviewer where they went once Enter closes it, and Escape still closes it as before', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  session.getState().goTo(3)
  press(session, 'Enter')
  press(session, 'ArrowRight')
  assert.ok(session.getState().code, 'the code follows the step')
  press(session, 'Enter')
  assert.deepEqual([session.getState().story.step, session.getState().code, session.getState().wire], [4, null, null])

  // Opened again, Escape's path closes it the same way, and the next Enter opens it once more.
  press(session, 'Enter')
  session.getState().closeCode()
  assert.equal(session.getState().code, null)
  press(session, 'Enter')
  assert.ok(session.getState().code)
})
