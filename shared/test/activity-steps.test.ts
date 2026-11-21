import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyActivity, diffActivity, resetActivity, sameEntry, type ActivityEntry, type ActivityStep, type JobActivity } from '#shared/protocol/activity.ts'

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

/** An entry that counts every read of its fields and keys. */
const counted = (entry: ActivityEntry, count: { reads: number }): ActivityEntry => new Proxy(entry, {
  get: (target, key, receiver) => {
    count.reads += 1
    return Reflect.get(target, key, receiver)
  },
  ownKeys: (target) => {
    count.reads += 1
    return Reflect.ownKeys(target)
  },
})

test('one grown entry among 1,000 kept gives one update and compares no kept entry', () => {
  const count = { reads: 0 }
  const kept = Array.from({ length: 1000 }, (_, index) => counted(ran(`${index}`, 'completed', 'a line of output\n'), count))
  // hobkin keeps each entry it did not change as the same copy, in a new list on each refresh. The host saw this
  // list once already, when the entry that grows was appended to it.
  const writing = { r1: [...kept, said('9:0', 'I will')] }
  assert.deepEqual(diffActivity({ r1: kept }, writing), [{ op: 'append', job: 'r1', entries: [said('9:0', 'I will')] }])

  count.reads = 0
  assert.deepEqual(diffActivity(writing, { r1: [...kept, said('9:0', 'I will look')] }), [{ op: 'update', job: 'r1', entry: said('9:0', 'I will look') }])
  assert.equal(count.reads, 0, 'no kept entry was read')
})

test('kept entries give no step, entries added at the end one append, and a reordered list or a repeated id a reset', () => {
  const [a, b, c, d] = [said('1'), ran('2'), said('3'), ran('4', 'running')]
  const held: JobActivity = { r1: [a, b] }

  assert.deepEqual(diffActivity(held, { r1: [a, b] }), [], 'the same entries in a new list')
  assert.deepEqual(diffActivity(held, { r1: [a, b, c, d] }), [{ op: 'append', job: 'r1', entries: [c, d] }])
  assert.deepEqual(diffActivity(held, { r1: [b, a] }), [{ op: 'reset', job: 'r1', entries: [b, a] }], 'reordered')
  assert.deepEqual(diffActivity(held, { r1: [a, b, said('1', 'again')] }), [{ op: 'reset', job: 'r1', entries: [a, b, said('1', 'again')] }], 'an added id the list holds')
  assert.deepEqual(diffActivity(held, { r1: [a, b, c, said('3', 'again')] }), [{ op: 'reset', job: 'r1', entries: [a, b, c, said('3', 'again')] }], 'an id added twice')
  const twice = [a, said('1', 'twice')]
  assert.deepEqual(diffActivity({ r1: twice }, { r1: [...twice] }), [{ op: 'reset', job: 'r1', entries: twice }], 'a list that held an id twice')
  assert.deepEqual(diffActivity({ r1: twice }, { r1: [...twice, c] }), [{ op: 'reset', job: 'r1', entries: [...twice, c] }])
})

/** The steps as the host worked them out before it skipped kept entries: every entry compared by id and fields. */
function comparedSteps(previous: JobActivity, next: JobActivity): ActivityStep[] {
  const steps: ActivityStep[] = Object.keys(previous).filter((job) => !Object.hasOwn(next, job)).map((job) => ({ op: 'remove', job }))
  for (const [job, after] of Object.entries(next)) {
    const before = Object.hasOwn(previous, job) ? previous[job]! : undefined
    if (before === after) continue
    const reset: ActivityStep = { op: 'reset', job, entries: [...after] }
    if (!before) {
      steps.push(reset)
      continue
    }
    const ids = new Set(after.map((entry) => entry.id))
    const kept = before.filter((entry) => ids.has(entry.id))
    if (new Set(before.map((entry) => entry.id)).size !== before.length || ids.size !== after.length || after.slice(0, kept.length).some((entry, index) => entry.id !== kept[index]!.id)) {
      steps.push(reset)
      continue
    }
    const removed = before.filter((entry) => !ids.has(entry.id)).map((entry) => entry.id)
    if (removed.length) steps.push({ op: 'remove', job, ids: removed })
    after.slice(0, kept.length).forEach((entry, index) => {
      if (!sameEntry(kept[index]!, entry)) steps.push({ op: 'update', job, entry })
    })
    if (after.length > kept.length) steps.push({ op: 'append', job, entries: after.slice(kept.length) })
  }
  return steps
}

test('on any mix of kept, grown, copied, added, dropped, moved and repeated entries the steps are the same and rebuild the next activity', () => {
  let seed = 23
  const random = (below: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % below
  let made = 0
  const fresh = (): ActivityEntry => (random(2) ? said(`${made++}`, 'Reading') : ran(`${made++}`, 'running'))
  // What hobkin hands over next: most entries kept as the same copy, and now and then any other change.
  const change = (entries: readonly ActivityEntry[]): ActivityEntry[] => {
    let next = entries.map((entry) => {
      const roll = random(20)
      if (roll === 0) return entry.kind === 'assistant' ? { ...entry, text: `${entry.text} more` } : { ...entry, state: 'completed' as const, output: `${entry.output}ok` }
      if (roll === 1) return { ...entry }
      return entry
    })
    if (!random(8) && next.length) next.splice(random(next.length), 1)
    if (!random(10) && next.length > 1) next = [...next.slice(1), next[0]!]
    if (random(3)) next.push(...Array.from({ length: 1 + random(3) }, fresh))
    if (!random(12) && next.length) next.push({ ...next[random(next.length)]!, text: 'repeated' })
    return next
  }
  let previous: JobActivity = {}
  for (let round = 0; round < 2000; round += 1) {
    const next: JobActivity = Object.fromEntries(['r1', 'r2', 'r3'].filter(() => random(6)).map((job) => [job, random(15) ? change(previous[job] ?? []) : [fresh()]]))
    if (random(10) === 0) Object.assign(next, previous)
    const steps = diffActivity(previous, next)
    assert.deepEqual(steps, comparedSteps(previous, next), `round ${round}`)
    assert.deepEqual(applyActivity(previous, steps), next, `round ${round}`)
    // Now and then a list starts over, as after a reset.
    previous = random(25) ? next : structuredClone(next)
  }
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
