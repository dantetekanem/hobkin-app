import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replyToReport, replyToRoutine, splitRoutineReference, useReportReply, withRoutineReference } from '../src/features/reports/reply.ts'

const routine = { id: 'inbox-watch', title: 'Inbox watch', file: 'routines/daily/inbox-watch.md' }

test('a routine reply puts one reference line before the words, and the chat splits it back', () => {
  const sent = withRoutineReference(routine, 'why did it skip Monday?')
  assert.equal(sent, 'About the routine “Inbox watch” (routines/daily/inbox-watch.md):\n\nwhy did it skip Monday?')
  assert.deepEqual(splitRoutineReference(sent), { about: 'Inbox watch', text: 'why did it skip Monday?' })
})

test('text without the line is left as it is', () => {
  assert.deepEqual(splitRoutineReference('hello\n\nAbout the routine'), { text: 'hello\n\nAbout the routine' })
})

test('replying to a routine attaches and clears like a report, one at a time', () => {
  replyToRoutine(routine)
  assert.deepEqual(useReportReply.getState().report, { id: 'inbox-watch', title: 'Inbox watch', kind: 'routine', file: routine.file })
  replyToReport({ id: 'r1', title: 'Report' } as never)
  assert.deepEqual(useReportReply.getState().report, { id: 'r1', title: 'Report' })
  useReportReply.getState().clear()
  assert.equal(useReportReply.getState().report, null)
})
