import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareRoutines, selectPreparedView, withSkyWidth } from '../src/features/routines/prepare.ts'
import { factsOf } from '../src/features/routines/rules.ts'
import { buildSample } from '../src/features/routines/sample.ts'
import { rollingSpan, skyMarks, spanOf } from '../src/features/routines/sky-math.ts'
import { nextSevenDays } from '../src/features/routines/timeline.ts'

const TORONTO = 'America/Toronto'
const NOW = Date.parse('2026-11-10T14:04:00-05:00')
const data = buildSample(NOW, TORONTO)

test('the screen gets its facts, the rolling day and the week ready before it opens', () => {
  const prepared = prepareRoutines(data, NOW, TORONTO, 0)
  const facts = factsOf(data, NOW)
  const holds = Object.fromEntries(facts.map((item) => [item.routine.id, item.hold]))
  const day = rollingSpan(NOW, TORONTO, 8, 16)
  const week = spanOf(NOW, TORONTO, 7)

  assert.equal(prepared.now, NOW)
  assert.deepEqual(prepared.facts, facts)
  assert.deepEqual(prepared.holds, holds)
  assert.deepEqual(prepared.day.span, day)
  assert.deepEqual(prepared.day.marks, skyMarks({ span: day, now: NOW, routines: data.routines, logs: data.logs, holds, detail: true }))
  assert.deepEqual(prepared.week.span, week)
  assert.deepEqual(prepared.week.marks, skyMarks({ span: week, now: NOW, routines: data.routines, logs: data.logs, holds, detail: false }))
  assert.deepEqual(prepared.week.days, nextSevenDays(data.routines, NOW, TORONTO, holds))
})

test('the sky is drawn ahead once its width is known, for both views', () => {
  assert.equal(prepareRoutines(data, NOW, TORONTO, 0).day.scene, null, 'nothing to draw at no width')

  const drawn = prepareRoutines(data, NOW, TORONTO, 960)
  assert.equal(drawn.day.scene?.width, 960)
  assert.equal(drawn.week.scene?.width, 960)
  assert.equal(drawn.day.scene?.points.length, drawn.day.marks.length - drawn.day.marks.filter((mark) => mark.kind === 'band').length)

  const wider = withSkyWidth(drawn, 1040, TORONTO)
  assert.equal(wider.day.scene?.width, 1040)
  assert.equal(wider.facts, drawn.facts, 'a new width draws again and works nothing else out again')
  assert.equal(withSkyWidth(wider, 1040, TORONTO), wider, 'the same width changes nothing')
})

test('screen views select prepared facts, sky and week days without recomputing them', () => {
  const prepared = prepareRoutines(data, NOW, TORONTO, 960)
  const all = selectPreparedView(prepared, 'all')
  const week = selectPreparedView(prepared, 'week')

  for (const selected of [all, week]) {
    assert.equal(selected.facts, prepared.facts)
    assert.equal(selected.holds, prepared.holds)
  }
  assert.equal(all.span, prepared.day.span)
  assert.equal(all.marks, prepared.day.marks)
  assert.equal(all.scene, prepared.day.scene)
  assert.deepEqual(all.days, [])
  assert.equal(week.span, prepared.week.span)
  assert.equal(week.marks, prepared.week.marks)
  assert.equal(week.scene, prepared.week.scene)
  assert.equal(week.days, prepared.week.days)
})
