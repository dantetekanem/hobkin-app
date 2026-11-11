import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyActivity, diffActivity, resetActivity, type ActivityEntry, type JobActivity } from '#shared/protocol/activity.ts'

const said = (id: string, text = id): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const ran = (id: string, state: ActivityEntry['state'] = 'completed', output = ''): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name: 'bash',
  state,
  input: JSON.stringify({ command: `pnpm test ${id}` }, null, 2),
  output,
})
/** hobkin hands over a fresh copy of every entry on each refresh (`JobActivity.snapshot`). */
const copied = (activity: JobActivity): JobActivity => Object.fromEntries(Object.entries(activity).map(([job, entries]) => [job, entries.map((entry) => ({ ...entry }))]))

test('the steps between two activities rebuild the second from the first', () => {
  const cases: [JobActivity, JobActivity][] = [
    [{}, { a: [said('1')] }],
    [{ a: [said('1')] }, { a: [said('1'), ran('2', 'running')] }],
    [{ a: [said('1'), ran('2', 'running')] }, { a: [said('1'), ran('2', 'completed', 'ok')] }],
    [{ a: [said('1'), said('2')] }, { a: [said('2')] }],
    [{ a: [said('1')] }, { a: [said('2'), said('1')] }],
    [{ a: [said('1')], b: [said('2')] }, { b: [said('2')] }],
    [{ a: [said('1')] }, { a: [] }],
    [{ a: [said('1'), said('2')] }, { a: [said('2'), said('1')] }],
  ]
  for (const [before, after] of cases) {
    assert.deepEqual(applyActivity(before, diffActivity(before, after)), after, `${JSON.stringify(before)} to ${JSON.stringify(after)}`)
  }

  // Any two, including ones that share nothing or put what they share in another order.
  let seed = 11
  const random = (below: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % below
  const anyFeed = () => [...'abcdef'].filter(() => random(2)).sort(() => random(3) - 1).map((id) => ran(id, random(2) ? 'running' : 'completed', `${random(3)}`))
  const anyActivity = (): JobActivity => Object.fromEntries(['r1', 'r2', 'r3'].filter(() => random(3)).map((job) => [job, anyFeed()]))
  for (let round = 0; round < 500; round += 1) {
    const before = anyActivity()
    const after = anyActivity()
    assert.deepEqual(applyActivity(before, diffActivity(before, after)), after)
  }
})

test('a few more words from the agent send only the entry that grew', () => {
  const long = Array.from({ length: 300 }, (_, index) => ran(`${index}`, 'completed', 'a line of output\n'.repeat(120)))
  const before: JobActivity = { r1: [...long, said('9:0', 'I will')] }
  const after = copied({ r1: [...long, said('9:0', 'I will look at the session code')] })

  assert.deepEqual(diffActivity(before, after), [{ op: 'update', job: 'r1', entry: said('9:0', 'I will look at the session code') }])
  assert.deepEqual(diffActivity(after, copied(after)), [], 'the same activity copied again sends nothing')
})

test('a new step is appended alone, a job that ended sends nothing more, and a job gone is removed', () => {
  const ended = [said('1'), ran('2')]
  const before: JobActivity = { old: ended, r1: [said('3')] }

  assert.deepEqual(diffActivity(before, { old: ended, r1: [said('3'), ran('4', 'running')] }), [{ op: 'append', job: 'r1', entries: [ran('4', 'running')] }])
  assert.deepEqual(diffActivity(before, { r1: [said('3')] }), [{ op: 'remove', job: 'old' }])
  assert.deepEqual(diffActivity(before, { ...before, r2: [said('5')] }), [{ op: 'reset', job: 'r2', entries: [said('5')] }], 'a new job comes whole')
  assert.deepEqual(diffActivity({ r1: [said('1'), said('2')] }, { r1: [said('2')] }), [{ op: 'remove', job: 'r1', ids: ['message:1'] }], 'a text hobkin dropped at the end of its message')
  assert.deepEqual(diffActivity({ r1: [said('1')] }, { r1: [said('2'), said('1')] }), [{ op: 'reset', job: 'r1', entries: [said('2'), said('1')] }], 'anything but adding at the end resends the job')
})

test('equivalent codemode metadata avoids churn while nested changes send an update', () => {
  const entry: ActivityEntry = { ...ran('cm'), name: 'codemode', codemode: { calls: [{ id: 'cm/?', name: 'read', args: 'x', status: 'running' }] } }
  const before = { job: [entry] }
  const equal = structuredClone(before)
  assert.deepEqual(diffActivity(before, equal), [])
  equal.job[0]!.codemode!.calls[0]!.status = 'ok'
  const delta = diffActivity(before, equal)
  assert.equal(delta.length, 1)
  assert.deepEqual(applyActivity(before, delta), equal)
})

test('a connection that holds nothing gets every job whole', () => {
  const activity: JobActivity = { r1: [said('1')], r2: [] }
  assert.deepEqual(resetActivity(activity), [
    { op: 'reset', job: 'r1', entries: [said('1')] },
    { op: 'reset', job: 'r2', entries: [] },
  ])
  assert.deepEqual(applyActivity({ stale: [said('0')] }, [{ op: 'remove', job: 'stale' }, ...resetActivity(activity)]), activity)
})

test('applying the steps keeps every job and entry they do not touch', () => {
  const quiet = [said('1')]
  const first = ran('2', 'running')
  const held: JobActivity = { quiet, r1: [first, said('3')] }
  const next = applyActivity(held, [{ op: 'update', job: 'r1', entry: said('3', 'more') }])

  assert.equal(next.quiet, quiet, 'a job with no steps is the same array')
  assert.equal(next.r1![0], first, 'an entry with no step is the same object')
  assert.deepEqual(next.r1, [first, said('3', 'more')])
  assert.notEqual(next, held, 'the held activity itself is never changed')
  assert.deepEqual(held.r1, [first, said('3')])
  assert.deepEqual(applyActivity(held, [{ op: 'update', job: 'r1', entry: said('9') }]).r1, [first, said('3'), said('9')], 'an update for an entry not held adds it')
})
