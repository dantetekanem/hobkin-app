import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UNDO_MS,
  byDay,
  createInbox,
  filterReports,
  isUnread,
  neighbor,
  newestFirst,
  openReport,
  removeReport,
  settle,
  successor,
  summarize,
  undoRemove,
} from '../src/features/reports/inbox.ts'
import { kindOf, readerParts, sourceOf, summaryOf, toneOf, triageOf, type Report } from '../src/features/reports/report.ts'
import { replyToReport, useReportReply } from '../src/features/reports/reply.ts'

const report = (id: string, over: Partial<Report> = {}): Report => ({
  id,
  title: `Report ${id}`,
  scheduleId: 'morning-recap',
  at: '2026-11-09T08:00:00.000Z',
  body: 'Useful: Something was found.',
  outcome: 'completed',
  ...over,
})

const ids = (reports: readonly Report[]) => reports.map(({ id }) => id)

test("reads the triage from a report's first line", () => {
  assert.deepEqual(triageOf(report('a', { body: 'Nothing new' })), { level: 'nothing' })
  assert.deepEqual(triageOf(report('a', { body: '**Nothing new.**\n\nChecked 14 feeds.' })), { level: 'nothing' })
  assert.deepEqual(triageOf(report('a', { body: 'Useful: Two updates are worth taking.\n\n## Details' })), {
    level: 'useful',
    message: 'Two updates are worth taking.',
  })
  assert.deepEqual(triageOf(report('a', { body: 'Critical: The webhook secret leaked.\n\nNext: Rotate it today.\n\nMore.' })), {
    level: 'critical',
    message: 'The webhook secret leaked.',
    next: 'Rotate it today.',
  })
  assert.deepEqual(triageOf(report('a', { body: '**Blocked:** The status page needs a login.\n**Next:** Sign in once.' })), {
    level: 'blocked',
    message: 'The status page needs a login.',
    next: 'Sign in once.',
  })
  assert.deepEqual(triageOf(report('a', { body: '**Useful: The whole line is bold.**' })), { level: 'useful', message: 'The whole line is bold.' })
  assert.equal(triageOf(report('a', { body: '\n\n  useful: lower case counts too.' }))?.level, 'useful')

  assert.equal(triageOf(report('a', { body: '# Weekly summary\n\nUseful: not on the first line.' })), null, 'the marker is the first line or nothing')
  assert.equal(triageOf(report('a', { body: 'Useful: Found it.\n\nSome text.\n\nNext: Too late.' }))?.next, undefined, 'the next step follows the marker directly')
  assert.equal(triageOf(report('a', { body: 'Critical: said by a run that failed.', outcome: 'failed' })), null, 'only a completed run has a triage')
})

test('triage ignores blank lines but never reads a later next step from the report body', () => {
  const details = '\n## Details\n' + 'A detailed finding with context.\n'.repeat(5000)
  for (const gap of ['\n', '\r\n\r\n', '\n \t\n\u00a0\n']) {
    const body = ` \t\n **Useful: Found the result.** ${gap} **Next:** Read the change. ${details}`
    assert.deepEqual(triageOf(report('long', { body })), { level: 'useful', message: 'Found the result.', next: 'Read the change.' })
    assert.deepEqual(triageOf(report('late', { body: `Useful: Found the result.${gap}First, some context.${gap}Next: This is too late.${details}` })), { level: 'useful', message: 'Found the result.' })
  }
  assert.equal(triageOf(report('empty', { body: '\r\n \t\u00a0' })), null)
  assert.deepEqual(triageOf(report('bounded', { body: `Useful: ${'a'.repeat(2000)}\nNext: ${'b'.repeat(600)}` })), { level: 'useful', message: 'a'.repeat(1024), next: 'b'.repeat(300) })
})

test('a report wears the tone of its triage, or of how its run ended', () => {
  assert.equal(toneOf(report('a', { body: 'Critical: The secret leaked.' })), 'critical')
  assert.equal(toneOf(report('a', { body: 'Blocked: It needs a login.' })), 'blocked')
  assert.equal(toneOf(report('a', { body: 'Useful: Two updates.' })), 'useful')
  assert.equal(toneOf(report('a', { body: 'Nothing new' })), 'nothing')

  assert.equal(toneOf(report('a', { body: 'The run stopped: timeout.', outcome: 'failed' })), 'critical')
  assert.equal(toneOf(report('a', { body: 'Half of it is done.', outcome: 'incomplete' })), 'blocked')
  assert.equal(toneOf(report('a', { body: '# Notes\n\nNo marker here.' })), 'plain')
})

test('a work or session report counts as done', () => {
  assert.equal(kindOf(report('a', { scheduleId: 'work.storefront.build' })), 'done')
  assert.equal(kindOf(report('a', { scheduleId: 'work.discover' })), 'done')
  assert.equal(kindOf(report('a', { scheduleId: 'session.alex' })), 'done')
  assert.equal(kindOf(report('a', { scheduleId: 'sessionary' })), 'scheduled')
  assert.equal(kindOf(report('a', { scheduleId: 'morning-recap' })), 'scheduled')
  assert.equal(kindOf(report('a', { scheduleId: 'workout-plan' })), 'scheduled', 'a work prefix must include its dot')
  assert.equal(kindOf(report('a', { scheduleId: undefined })), 'scheduled')
})

test('a report names its routine or source', () => {
  assert.equal(sourceOf(report('a', { scheduleId: 'morning-recap' })), 'morning-recap', 'a routine by its name')
  assert.equal(sourceOf(report('a', { scheduleId: 'work.storefront.do' })), 'storefront', 'work by its project')
  assert.equal(sourceOf(report('a', { scheduleId: 'work.billing-api.look' })), 'billing-api')
  assert.equal(sourceOf(report('a', { scheduleId: 'work.discover' })), 'Work mode', 'a look for projects belongs to no project')
  assert.equal(sourceOf(report('a', { scheduleId: 'work.session' })), 'Another session', 'a session that ended with a report')
  assert.equal(sourceOf(report('a', { scheduleId: 'session.alex' })), 'Another session', 'a native session report')
  assert.equal(sourceOf(report('a', { scheduleId: 'sessionary' })), 'sessionary', 'only the session. prefix counts')
  assert.equal(sourceOf(report('a', { scheduleId: undefined })), 'hobkin')
})

test('lists newest first', () => {
  const list = [
    report('old', { at: '2026-11-07T08:00:00.000Z' }),
    report('new', { at: '2026-11-09T08:00:00.000Z' }),
    report('undated', { at: undefined }),
    report('mid', { at: '2026-11-08T08:00:00.000Z' }),
    report('mid-twin', { at: '2026-11-08T08:00:00.000Z' }),
  ]

  assert.deepEqual(ids(newestFirst(list)), ['new', 'mid', 'mid-twin', 'old', 'undated'])
  assert.deepEqual(ids(list), ['old', 'new', 'undated', 'mid', 'mid-twin'], 'the list it was given is left alone')
})

test('filters by kind and title', () => {
  const list = [
    report('recap', { title: 'Morning recap', scheduleId: 'morning-recap' }),
    report('fix', { title: 'Fix the login redirect loop', scheduleId: 'work.storefront.build' }),
    report('deps', { title: 'Dependency look', scheduleId: 'dependency-look' }),
    report('retry', { title: 'Retry failed webhooks', scheduleId: 'work.billing-api.build' }),
  ]
  const shown = (kind: 'all' | 'scheduled' | 'done', title = '') => ids(filterReports(list, { kind, title }))

  assert.deepEqual(shown('all'), ['recap', 'fix', 'deps', 'retry'])
  assert.deepEqual(shown('scheduled'), ['recap', 'deps'])
  assert.deepEqual(shown('done'), ['fix', 'retry'])

  assert.deepEqual(shown('all', 're'), ['recap', 'fix', 'retry'], 'any part of the title')
  assert.deepEqual(shown('all', '  LOGIN '), ['fix'], 'whatever the case, and spaces around it do not count')
  assert.deepEqual(shown('done', 're'), ['fix', 'retry'], 'both filters narrow together')
  assert.deepEqual(shown('scheduled', 'login'), [])
})

test('groups the list by day, today first', () => {
  // Local time, so the days are the ones the user's clock shows.
  const now = new Date(2026, 10, 9, 12, 0).getTime()
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString()
  const groups = byDay(
    [report('a', { at: at(9, 8) }), report('b', { at: at(9, 7) }), report('c', { at: at(8, 23) }), report('d', { at: at(5, 9) }), report('e', { at: undefined })],
    now,
  )

  assert.deepEqual(
    groups.map(({ label, reports }) => [label, ids(reports)]),
    [
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Thu, Nov 5', ['d']],
      ['Undated', ['e']],
    ],
  )
  assert.equal(new Set(groups.map(({ key }) => key)).size, groups.length, 'each day has a key of its own')
  assert.deepEqual(byDay([], now), [])
})

test('opening a report marks it read', () => {
  const inbox = createInbox([report('a'), report('b')], ['b'])
  assert.equal(isUnread(inbox, 'a'), true)
  assert.equal(isUnread(inbox, 'b'), false)

  const after = openReport(inbox, 'a')
  assert.equal(isUnread(after, 'a'), false, 'the unread mark clears')
  assert.equal(isUnread(inbox, 'a'), true, 'the inbox it was given is left alone')

  assert.equal(openReport(after, 'a'), after, 'opening it again changes nothing')
  assert.equal(openReport(inbox, 'missing'), inbox, 'a report that is not there cannot be read')
})

test('a deleted report leaves the list, and undo puts it back', () => {
  const inbox = createInbox([report('a'), report('b'), report('c')], ['b'])

  const gone = removeReport(inbox, 'b', 1_000)
  assert.deepEqual(ids(gone.reports), ['a', 'c'])
  assert.equal(gone.removed?.report.id, 'b')
  assert.equal(gone.removed?.until, 1_000 + UNDO_MS)

  const back = undoRemove(gone)
  assert.deepEqual(ids(back.reports), ['a', 'b', 'c'], 'in its old place')
  assert.equal(isUnread(back, 'b'), false, 'as read as it was')
  assert.equal(back.removed, null)

  assert.equal(undoRemove(inbox), inbox, 'with nothing deleted there is nothing to undo')
  assert.equal(removeReport(inbox, 'missing', 1_000), inbox)
})

test('the undo line leaves after its time, and a second delete settles the first', () => {
  const inbox = createInbox([report('a'), report('b'), report('c')])

  const first = removeReport(inbox, 'a', 0)
  assert.equal(settle(first, UNDO_MS - 1), first, 'there is still time to undo')
  assert.equal(settle(first, UNDO_MS).removed, null)
  assert.deepEqual(ids(settle(first, UNDO_MS).reports), ['b', 'c'])
  assert.equal(settle(inbox, UNDO_MS), inbox, 'nothing was waiting to settle')

  const second = removeReport(first, 'c', 500)
  assert.equal(second.removed?.report.id, 'c')
  assert.deepEqual(ids(undoRemove(second).reports), ['b', 'c'], 'only the last delete comes back')
})

test('counts what is unread and names the worst of it', () => {
  const reports = [
    report('critical', { body: 'Critical: The secret leaked.' }),
    report('blocked', { body: 'Blocked: It needs a login.' }),
    report('useful-1', { body: 'Useful: Two updates.' }),
    report('useful-2', { body: 'Useful: One more.' }),
    report('quiet', { body: 'Nothing new' }),
  ]
  const none = { critical: 0, blocked: 0, useful: 0, nothing: 0, plain: 0 }

  const summary = summarize(reports, new Set(['critical', 'quiet']))
  assert.equal(summary.total, 5)
  assert.equal(summary.unread, 3)
  assert.deepEqual(summary.tones, { ...none, critical: 1, blocked: 1, useful: 2, nothing: 1 }, 'every report is counted by its tone')
  assert.equal(summary.worst, 'blocked', 'the critical one was read')
  assert.equal(summary.worstCount, 1)

  assert.equal(summarize(reports, new Set()).worst, 'critical')
  assert.equal(summarize(reports, new Set(ids(reports))).worst, null, 'with everything read there is nothing to name')
  assert.deepEqual(summarize([], new Set()), { total: 0, unread: 0, tones: none, worst: null, worstCount: 0 })
})

test('the reader shows the triage apart from the text', () => {
  assert.deepEqual(readerParts(report('a', { body: 'Critical: The secret leaked.\n\nNext: Rotate it.\n\n## What happened\n\nDetails.' })), {
    triage: { level: 'critical', message: 'The secret leaked.', next: 'Rotate it.' },
    markdown: '## What happened\n\nDetails.',
  })
  assert.deepEqual(readerParts(report('a', { body: 'Useful: Two updates.\n\n- one\n- two' })), {
    triage: { level: 'useful', message: 'Two updates.' },
    markdown: '- one\n- two',
  })
  assert.deepEqual(readerParts(report('a', { body: 'Nothing new' })), { triage: { level: 'nothing' }, markdown: '' })
  assert.deepEqual(readerParts(report('a', { body: '# Notes\n\nText.', outcome: 'failed' })), { triage: null, markdown: '# Notes\n\nText.' })
})

test('the list line says what a report found', () => {
  assert.equal(summaryOf(report('a', { body: 'Useful: Two updates are **worth** taking, see [the list](https://example.com/list).' })), 'Two updates are worth taking, see the list.')
  assert.equal(summaryOf(report('a', { body: 'Nothing new' })), 'Nothing new.')

  // With no triage it is the first line that says something: not a rule, and not a heading that repeats the title.
  const failed = report('a', {
    title: 'Backup check',
    body: '# Backup check\n\n---\n\nThe run stopped: [the bucket](https://example.com/bucket) did not answer.\n\nMore below.',
    outcome: 'failed',
  })
  assert.equal(summaryOf(failed), 'The run stopped: the bucket did not answer.')
  assert.equal(summaryOf(report('a', { body: '', outcome: 'failed' })), '')
})

test('steps to the next and the previous report, and stops at the ends', () => {
  const list = [report('a'), report('b'), report('c')]

  assert.equal(neighbor(list, 'a', 1)?.id, 'b')
  assert.equal(neighbor(list, 'b', -1)?.id, 'a')
  assert.equal(neighbor(list, 'c', 1), null)
  assert.equal(neighbor(list, 'a', -1), null)
  assert.equal(neighbor(list, 'missing', 1), null)
})

test('after a delete the keyboard lands on the report that takes its place', () => {
  const list = [report('a'), report('b'), report('c')]

  assert.equal(successor(list, 'b')?.id, 'c', 'the one below moves up')
  assert.equal(successor(list, 'c')?.id, 'b', 'the last one hands over to the one above')
  assert.equal(successor([report('a')], 'a'), null)
})

test('reply in chat puts the report on the next message', () => {
  replyToReport(report('a', { title: 'Morning recap' }))
  assert.deepEqual(useReportReply.getState().report, { id: 'a', title: 'Morning recap' })

  replyToReport(report('b', { title: 'Dependency look' }))
  assert.deepEqual(useReportReply.getState().report, { id: 'b', title: 'Dependency look' }, 'one report at a time, the last one chosen')

  useReportReply.getState().clear()
  assert.equal(useReportReply.getState().report, null)
})
