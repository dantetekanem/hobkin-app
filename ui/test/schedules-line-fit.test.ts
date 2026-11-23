import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSchedule } from '#shared/protocol/schedules.ts'
import { COMPACT_WIDTH, COUNT_WIDTH, DOT_WIDTH, lineFit, quietRoom, shownWords, turnRoom, type TurnRow } from '../src/features/schedules/line-fit.ts'
import { scheduleLine } from '../src/features/schedules/schedules.ts'

const NOW = Date.parse('2026-11-23T15:00:00.000Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

// Six pixels a character, so a test can count the room it gives.
const measure = (text: string) => text.length * 6

const watch: AgentSchedule = { id: 'w', name: 'Watch CI for #412', state: 'waiting', nextAt: at(102_000) }
const deploy: AgentSchedule = { id: 'd', name: 'Watch the deploy', state: 'waiting', nextAt: at(250_000) }
const preview: AgentSchedule = { id: 'p', name: 'Preview is up', state: 'running' }

const lineOf = (...list: AgentSchedule[]) => scheduleLine(list, NOW)!

// The main chat's status row at the chat's narrowest (360px) and at its first width (460px): the row is 24px narrower.
const NARROWEST_ROW = 336
const FIRST_ROW = 436
const WIDE_ROW = 640

test('while the row is quiet the line takes 40% of it, between 8.5rem and 14rem', () => {
  assert.equal(quietRoom(FIRST_ROW), 174)
  assert.equal(quietRoom(NARROWEST_ROW), 136)
  assert.equal(quietRoom(WIDE_ROW), 224)
})

// What a running turn shows at the row's right, with the 8px gap inside it: the stop keys ("esc esc stops", 85px) after
// the elapsed time ("0:42", 28px) or after the working line ("Working… (7m 7s · ↓ 30.0k tokens)", 230px).
const ELAPSED = 28 + 8 + 85
const WORKING = 230 + 8 + 85
// The working line can be cut to nothing, the stop keys cannot: the least they take.
const STOP_KEYS = 8 + 85
// The bubble saying "reading StatusLine.tsx".
const READING = 172

const elapsedAt = (row: number, count = 3): TurnRow => ({ row, natural: ELAPSED, least: ELAPSED, bubble: READING, givesWay: false, count })
const workingAt = (row: number, count = 3): TurnRow => ({ row, natural: WORKING, least: STOP_KEYS, bubble: READING, givesWay: true, count })

/** What the working line and the stop keys get, and the most the bubble may take, beside a line of `line` pixels. */
function shares(turn: TurnRow) {
  const { line, reserve } = turnRoom(turn)
  const beside = turn.row - 8 - line
  return { line, kept: reserve - 96 - 8, bubbleMost: beside - reserve }
}

test('while a turn runs the elapsed time and the stop keys keep their whole width, and the line takes what the bubble can give', () => {
  assert.equal(shares(elapsedAt(WIDE_ROW)).line, 224, 'whole in a wide chat')
  assert.equal(shares(elapsedAt(FIRST_ROW)).line, COMPACT_WIDTH, 'its count and countdown at the first width')
  assert.equal(shares(elapsedAt(NARROWEST_ROW)).line, DOT_WIDTH, 'its dot alone at the narrowest')
  for (const row of [WIDE_ROW, FIRST_ROW, NARROWEST_ROW]) assert.equal(shares(elapsedAt(row)).kept, ELAPSED, `all of it at ${row}`)
})

test('the working line keeps what it has on a row with no schedules, and the line shows its dot with the count in what is left', () => {
  // With no schedule the bubble keeps its 172px and the working line has the rest: 436 - 96 - 8 - 172.
  const first = shares(workingAt(FIRST_ROW))
  assert.equal(first.kept, 160)
  assert.equal(first.line, COUNT_WIDTH)
  assert.equal(shares(workingAt(FIRST_ROW, 1)).line, DOT_WIDTH, 'one schedule has no count to show')

  const narrowest = shares(workingAt(NARROWEST_ROW))
  assert.equal(narrowest.kept, STOP_KEYS, 'at the narrowest the working line is cut to nothing, but the stop keys keep their room')
  assert.equal(narrowest.line, COUNT_WIDTH)
})

test('the bubble never reaches the working line: it takes what is left beside the line', () => {
  for (const turn of [elapsedAt(WIDE_ROW), elapsedAt(FIRST_ROW), elapsedAt(NARROWEST_ROW), workingAt(FIRST_ROW), workingAt(NARROWEST_ROW)]) {
    const { line, kept, bubbleMost } = shares(turn)
    assert.ok(bubbleMost > 0, `the bubble has room at ${turn.row}`)
    assert.equal(96 + bubbleMost + 8 + kept + 8 + line, turn.row, 'the bubble, the working line and the line fill the row and do not overlap')
  }
})

test('with room the line says the name and the countdown, cutting the name at a whole word', () => {
  const one = lineOf(watch)
  const whole = lineFit(224, one, measure)
  assert.equal(whole.form, 'full')
  assert.equal(shownWords(one, whole), 'Watch CI for #412 in 1:42')

  const cut = lineFit(170, one, measure)
  assert.equal(shownWords(one, cut), 'Watch CI… in 1:42', 'never "Watch C…"')
})

test('where no whole word of the name fits, the line says its count and countdown instead', () => {
  const three = lineOf(watch, deploy, preview)
  const fit = lineFit(136, three, measure)
  assert.equal(fit.form, 'compact')
  assert.equal(shownWords(three, fit), '3 · running')
})

test('the compact line: the count and the countdown, the countdown alone for one, that one runs, or that it is paused', () => {
  const compact = (...list: AgentSchedule[]) => {
    const line = lineOf(...list)
    return shownWords(line, lineFit(COMPACT_WIDTH, line, measure))
  }
  const later: AgentSchedule = { ...preview, state: 'waiting', nextAt: at(400_000) }

  assert.equal(compact(watch, deploy, later), '3 · 1:42')
  assert.equal(compact(watch), '1:42')
  assert.equal(compact(watch, deploy, preview), '3 · running')
  assert.equal(compact({ ...watch, state: 'paused', nextAt: undefined }), 'paused')
})

test('below the compact room the line shows its dot with the count, and with one schedule its dot alone', () => {
  const three = lineOf(watch, deploy, preview)
  const counted = lineFit(COUNT_WIDTH, three, measure)
  assert.equal(counted.form, 'count')
  assert.equal(shownWords(three, counted), '3')
  assert.equal(lineFit(COUNT_WIDTH, lineOf(watch), measure).form, 'dot')
})

test('below the compact room only the dot is left', () => {
  const fit = lineFit(DOT_WIDTH, lineOf(watch), measure)
  assert.equal(fit.form, 'dot')
  assert.equal(shownWords(lineOf(watch), fit), '')
})
