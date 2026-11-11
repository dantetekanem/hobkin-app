import assert from 'node:assert/strict'
import { after, afterEach, mock, test } from 'node:test'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'
import { factsOf } from '../src/features/routines/rules.ts'

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
  const later = Promise.withResolvers<unknown>()
  answer = () => later.promise
  const switching = state().setEnabled(routine.id, false)
  assert.deepEqual(state().pending, { [routine.id]: { action: 'enable', enabled: false } })
  assert.equal(await state().changeTimes(routine.id, { at: '15:00' }), 'hobkin is still busy with this routine.')
  snapshot([{ ...routine, enabled: false }], [], false)
  later.resolve({ ok: true })
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
