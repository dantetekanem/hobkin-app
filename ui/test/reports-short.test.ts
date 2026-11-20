import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { shortOf, type Report } from '../src/features/reports/report.ts'
import { useReports } from '../src/features/reports/store.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'

const full: Report = {
  id: 'run:import',
  title: 'Statement import',
  scheduleId: 'import',
  at: '2026-11-20T10:00:00Z',
  body: 'Useful: The nightly import missed 12 rows.\n\nNext: Re-run it.\n\nThe long account of what was checked.',
  outcome: 'completed',
}

afterEach(() => {
  hostStore.setState(initialHostState, true)
  useReports.getState().close()
})

test('a report\'s short version reaches the reader, and one without reads as before', () => {
  hostStore.setState({ home: '/hobkin', link: 'open' })
  hostStore.setState((state) => applyHostMessage(state, {
    type: 'state',
    rev: 1,
    reset: true,
    set: { reports: [{ ...full, short: '  The import missed 12 rows. Re-run it.\n' }, { ...full, id: 'run:older' }, { ...full, id: 'run:odd', short: 42 }] },
  }))

  const listed = new Map(useReports.getState().inbox.reports.map((report) => [report.id, report]))
  assert.equal(listed.size, 3, 'a report with an odd short field is still listed')
  assert.equal(shortOf(listed.get('run:import')!), 'The import missed 12 rows. Re-run it.')
  assert.equal(shortOf(listed.get('run:older')!), null, 'an older hobkin sends none, and the report reads as it does today')
  assert.equal(shortOf(listed.get('run:odd')!), null)
  assert.equal(shortOf({ ...full, short: '   ' }), null)
  assert.equal(listed.get('run:import')!.body, full.body, 'the full report stays whole under it')
})
