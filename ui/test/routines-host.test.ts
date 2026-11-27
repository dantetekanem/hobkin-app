import assert from 'node:assert/strict'
import { after, afterEach, mock, test } from 'node:test'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'
import { factsOf } from '../src/features/routines/rules.ts'
import { useView } from '../src/app/view-store.ts'

const now = Date.parse('2026-11-10T12:00:00Z')
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now })
const { routinesHost, useRoutines } = await import('../src/features/routines/store.ts')
const routine = {
  id: 'real-check', title: 'Real check', enabled: true,
  cadence: 'daily', at: '09:30', timezone: 'America/Toronto',
  harness: 'pi', model: null, effort: 'medium', cwd: '/project', context: [],
  path: '/hobkin/routines/daily/real-check.md', prompt: 'Check the real source.',
  nextRun: { state: 'scheduled', at: '2026-11-11T14:30:00Z' },
}
const hello = (home = '/hobkin') => hostStore.setState({ home, link: 'open' })
const snapshot = (schedules: unknown, errors: unknown = [], reset = true) => {
  hostStore.setState((state) => applyHostMessage(state, { type: 'state', rev: 1, ...(reset ? { reset: true } : {}), set: { schedules, errors } }))
}
const data = () => useRoutines.getState().data

afterEach(() => {
  hostStore.setState(initialHostState, true)
  useRoutines.getState().close()
})
after(() => mock.timers.reset())

test('host schedules replace samples, preserving enabled, paused, window and recurrence settings', () => {
  assert.equal(useRoutines.getState().sample, 'full', 'a plain browser starts in sample mode')
  assert.ok(data().routines.length > 0)
  hello()
  assert.deepEqual(data().routines, [])
  const { at: _at, ...base } = routine
  const schedules = [routine, { ...routine, id: 'paused', enabled: false, nextRun: { state: 'paused', at: null } },
    { ...base, id: 'window', cadence: 'weekly', weekday: [1, 3], window: { start: '09:00', end: '17:00', everyMinutes: 120 } },
    { ...routine, id: 'monthly', cadence: 'monthly', day: 31 },
    { ...routine, id: 'once', cadence: 'once', date: '2026-11-12' }]
  snapshot(schedules)
  assert.deepEqual(data().routines, schedules)
  assert.equal(useRoutines.getState().sample, null)
  assert.deepEqual(data().logs, {})
  assert.deepEqual(data().templates, [])
  snapshot([])
  assert.deepEqual(data().routines, [])
})

test('updates preserve navigation, removal closes detail, disconnect retains real data, and a different home clears it', () => {
  hello()
  snapshot([routine])
  useRoutines.getState().open(routine.id, `routine-${routine.id}`)
  useRoutines.getState().setView('week')
  snapshot([{ ...routine, title: 'Updated' }], [], false)
  assert.equal(useRoutines.getState().openId, routine.id)
  assert.equal(useRoutines.getState().view, 'week')
  hostStore.setState((state) => applyLink(state, 'lost'))
  assert.equal(data().routines[0]?.title, 'Updated')
  hello()
  snapshot([])
  assert.equal(useRoutines.getState().openId, null)
  snapshot([routine])
  useRoutines.getState().open(routine.id, `routine-${routine.id}`)
  hello('/other-home')
  assert.deepEqual(data().routines, [])
  assert.equal(useRoutines.getState().openId, null)
})

test("Run now, the switch and new times go to hobkin, pending until it answers, and a refusal stays in hobkin's words", async () => {
  hello()
  snapshot([routine])
  const calls: unknown[][] = []
  let answer: (name: string) => Promise<unknown> = async () => ({ ok: true })
  const real = routinesHost.run
  routinesHost.run = ((name: string, args: unknown) => {
    calls.push([name, args])
    return answer(name)
  }) as never
  const state = () => useRoutines.getState()

  // The switch shows where it is going until hobkin answers. By then its snapshot has the change.
  let resolve!: (value: unknown) => void
  const later = new Promise<unknown>((done) => { resolve = done })
  answer = () => later
  const switching = state().setEnabled(routine.id, false)
  assert.deepEqual(state().pending, { [routine.id]: { action: 'enable', enabled: false } })
  assert.equal(await state().changeTimes(routine.id, { at: '15:00' }), 'hobkin is still busy with this routine.')
  snapshot([{ ...routine, enabled: false }], [], false)
  resolve({ ok: true })
  assert.equal(await switching, null)
  assert.deepEqual(state().pending, {})
  assert.equal(data().routines[0]?.enabled, false)

  // A refusal comes back in hobkin's words: by the routine for Run now and the switch, to the form for its times.
  answer = async (name) => {
    throw Error(name === 'routine.run' ? 'Routine is already running.' : 'window may contain at most 48 checks per day')
  }
  assert.equal(await state().runNow(routine.id), 'Routine is already running.')
  assert.deepEqual(state().refused, { [routine.id]: 'Routine is already running.' })
  const window = { start: '08:00', end: '17:00', everyMinutes: 1 }
  assert.equal(await state().changeTimes(routine.id, { window }), 'window may contain at most 48 checks per day')
  assert.deepEqual(state().refused, {}, 'the next action clears the last refusal')
  assert.deepEqual(calls, [
    ['routine.enable', { id: routine.id, enabled: false }],
    ['routine.run', { id: routine.id }],
    ['routine.times', { id: routine.id, window }],
  ])

  // hobkin's routines never run on the sample's clock.
  mock.timers.tick(180_000)
  assert.equal(state().sample, null)
  assert.deepEqual(data().running, {})
  routinesHost.run = real
})

test('delete confirmation cancels without a command, pins the definition, and requires a matching receipt', async () => {
  hello(); snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }])
  const state = () => useRoutines.getState()
  state().open(routine.id, 'row')
  const calls: unknown[] = []
  const real = routinesHost.run
  routinesHost.run = (async (name: string, args: unknown) => { calls.push([name, args]); return { id: routine.id, deleted: true } }) as never
  try {
    state().askDelete(routine.id); state().cancelDelete()
    assert.equal(await state().confirmDelete(), 'Confirm this routine first.')
    assert.deepEqual(calls, [])
    state().askDelete(routine.id)
    assert.equal(await state().confirmDelete(), null)
    assert.deepEqual(calls, [['routine.delete', { id: routine.id, expectedDefinition: 'a'.repeat(64) }]])
    assert.equal(state().openId, null)
    assert.equal(data().routines.length, 1, 'only host snapshots remove data')
    state().open(routine.id, 'row'); state().askDelete(routine.id)
    routinesHost.run = (async () => { throw Error('Routine is running.') }) as never
    assert.equal(await state().confirmDelete(), 'Routine is running.')
    assert.equal(state().openId, routine.id)
    routinesHost.run = (async () => ({ id: 'other', deleted: true })) as never
    assert.match((await state().confirmDelete())!, /confirm/)
  } finally { routinesHost.run = real }
})

test('deletion refuses changed definitions, homes, resets, offline, running and old-host/sample data', async () => {
  const state = () => useRoutines.getState()
  const real = routinesHost.run
  routinesHost.run = (async () => { assert.fail('invalid confirmation must not send') }) as never
  try {
    for (const change of [
      () => snapshot([{ ...routine, expectedDefinition: 'b'.repeat(64) }], [], false),
      () => hello('/different'), () => snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }]),
      () => hostStore.setState({ link: 'lost' }),
      () => snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64), nextRun: { state: 'running', at: null } }], [], false),
    ]) {
      hello(); snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }]); state().open(routine.id, 'row'); state().askDelete(routine.id)
      change(); const refusal = await state().confirmDelete(); assert.ok(refusal)
      if (state().deletion) assert.equal(state().deletion?.refusal, refusal)
    }
    hello(); snapshot([routine]); state().open(routine.id, 'row')
    assert.ok(state().askDelete(routine.id))
    hostStore.setState(initialHostState, true)
    assert.ok(state().askDelete(routine.id))
  } finally { routinesHost.run = real }
})

test('late deletion replies after away-and-back cannot clear a newer confirmation', async () => {
  hello(); snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }])
  const state = () => useRoutines.getState()
  const real = routinesHost.run
  let resolve!: (value: unknown) => void
  routinesHost.run = (() => new Promise((done) => { resolve = done })) as never
  try {
    for (const leave of [
      () => { state().close(); state().open(routine.id, 'row') },
      () => { useView.setState({ screen: 'reports' }); useView.setState({ screen: 'routines' }) },
      () => snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }]),
      () => snapshot([{ ...routine, expectedDefinition: 'b'.repeat(64) }], [], false),
      () => { hello('/other'); snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }]) },
      () => { hostStore.setState({ link: 'lost' }); hello() },
    ]) {
      hello(); snapshot([{ ...routine, expectedDefinition: 'a'.repeat(64) }]); useView.setState({ screen: 'routines' })
      state().open(routine.id, 'row'); state().askDelete(routine.id)
      const deletion = state().confirmDelete()
      assert.equal(state().deletion?.pending, true)
      assert.ok(state().askDelete(routine.id), 'cannot replace an in-flight operation')
      leave(); assert.equal(state().deletion, null)
      state().open(routine.id, 'row'); state().askDelete(routine.id)
      const newer = state().deletion
      resolve({ id: routine.id, deleted: true }); await deletion
      assert.equal(state().deletion, newer)
      assert.equal(state().openId, routine.id)
    }
    state().cancelDelete(); state().askDelete(routine.id)
    const disappearing = state().confirmDelete()
    snapshot([], [], false)
    assert.equal(state().openId, null, 'the authoritative snapshot closes a removed routine')
    resolve({ id: routine.id, deleted: true }); await disappearing
    assert.equal(state().deletion, null)
  } finally { routinesHost.run = real }
})

test('host next-run times and held/running states override the local sample forecast', () => {
  hello()
  snapshot([routine])
  assert.equal(factsOf(data(), now)[0]?.next?.at, Date.parse(routine.nextRun.at))
  snapshot([{ ...routine, nextRun: { state: 'held', at: routine.nextRun.at, reason: 'Two failed checks' } }])
  const held = factsOf(data(), now)[0]!
  assert.equal(held.state, 'held')
  assert.deepEqual(held.hold, { until: routine.nextRun.at, reason: 'Two failed checks' })
  snapshot([{ ...routine, nextRun: { state: 'running', at: null } }])
  assert.equal(factsOf(data(), now)[0]?.state, 'running')
  assert.equal(factsOf(data(), now)[0]?.next, null)
  snapshot([{ ...routine, nextRun: { state: 'blocked', at: null } }])
  assert.equal(factsOf(data(), now)[0]?.next, null)
})

test('invalid and unsupported schedule rows are reported, not replaced with samples', () => {
  hello()
  const broken = { path: '/hobkin/broken.md', message: 'Invalid file' }
  snapshot([routine, null, {}, { ...routine, id: 'bad-zone', timezone: 'not/a-zone' },
    { ...routine, id: 'bad-time', at: '99:00' }, { ...routine, id: 'legacy', cadence: 'compatibility' }], [broken])
  assert.deepEqual(data().routines, [routine])
  assert.ok(data().errors.some((error) => error.path === broken.path && error.message === broken.message))
  assert.equal(data().errors.length, 6)
  snapshot(undefined)
  assert.deepEqual(data().routines, [])
})

test("on a host the templates come from hobkin, once for each home, and a row the screen cannot draw is left out", async () => {
  const template = {
    id: 'job-openings', version: 1, source: 'hobkin', title: 'Roles that fit', summary: 'New openings that fit.',
    recurrence: 'Twice a week', goals: ['job'], fits: 'Someone looking for a job.', needs: ['web access'], effort: 'medium', asks: null,
  }
  let asked = 0
  const real = routinesHost.templates
  routinesHost.templates = (async () => {
    asked += 1
    return { templates: [template, { id: 'no-title' }] }
  }) as never

  hello()
  snapshot([routine])
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(data().templates, [template])
  // Another snapshot of the same home keeps them, and does not ask again.
  snapshot([{ ...routine, title: 'Updated' }], [], false)
  assert.deepEqual(data().templates, [template])
  assert.equal(asked, 1)
  routinesHost.templates = real
})

test('a routine keeps the template it names, and one named another way is reported, not drawn', () => {
  hello()
  snapshot([{ ...routine, template: 'job-openings@1' }, { ...routine, id: 'odd', template: 'job openings' }])

  assert.equal(data().routines[0]?.template, 'job-openings@1')
  assert.equal(data().routines.length, 1)
  assert.equal(data().errors.length, 1)
})
