import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNothingNewReport, withoutNothingNew } from '../reports/nothing-new.ts'

const completed = (body: unknown) => ({ body, outcome: 'completed' })

test('a report that opens with the Nothing new line is a nothing-new report, whatever follows it', () => {
  for (const text of ['Nothing new.', 'Nothing new', '  nothing new.\n', 'NOTHING NEW.', '**Nothing new.**', '**Nothing new**.', 'Nothing new.\n\nBut the deploy is late.', '\n**Nothing new**\r\nChecked 14 feeds.']) {
    assert.equal(isNothingNewReport(completed(text)), true, JSON.stringify(text))
  }
  assert.equal(isNothingNewReport({ body: 'Nothing new.\n\nOld history.', outcome: 'imported' }), true)
})

test('a report that says something else on its first line, or whose run went wrong, is a real report', () => {
  for (const text of ['Nothing new. The build is green.', 'Useful: Nothing new.', 'Nothing newer.', '', 'Nothing', '# Report\n\nNothing new.']) {
    assert.equal(isNothingNewReport(completed(text)), false, JSON.stringify(text))
  }
  for (const outcome of ['failed', 'incomplete', 'interrupted']) {
    assert.equal(isNothingNewReport({ body: 'Nothing new.\n\n---\n\n**Execution failure:** Stopped.', outcome }), false, outcome)
  }
  assert.equal(isNothingNewReport(completed(undefined)), false)
  assert.equal(isNothingNewReport(null), false)
  assert.equal(isNothingNewReport('Nothing new.'), false, 'a row is judged, not a bare text')
})

test('withoutNothingNew drops nothing-new reports and keeps the rest in order', () => {
  const rows = [{ id: 'a', ...completed('Nothing new.') }, { id: 'b', ...completed('Critical: Down.') }, { id: 'c', ...completed('nothing new\n\nLooked.') }, { id: 'd' }]
  assert.deepEqual(withoutNothingNew(rows).map(({ id }) => id), ['b', 'd'])
})
