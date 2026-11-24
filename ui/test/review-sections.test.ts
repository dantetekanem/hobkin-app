import assert from 'node:assert/strict'
import { test } from 'node:test'
import { panelSections } from '../src/features/review/panel/sections.ts'

test('what the change does and the notes on the review are in the panel only where no story shows them: in Free Roam', () => {
  const given = { does: 'Rounds each line.', notices: 2, notes: 0 }
  assert.deepEqual(panelSections({ mode: 'story', ...given }), { does: false, notices: false, comments: false })
  assert.deepEqual(panelSections({ mode: 'roam', ...given }), { does: true, notices: true, comments: false })
})

test('a part with nothing to show takes no room: no sentence, no notices, no comments', () => {
  assert.deepEqual(panelSections({ mode: 'roam', does: null, notices: 0, notes: 0 }), { does: false, notices: false, comments: false })
  assert.equal(panelSections({ mode: 'story', does: null, notices: 0, notes: 3 }).comments, true, 'written notes are listed in either mode')
})
