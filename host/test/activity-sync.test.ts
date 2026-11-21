import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAIN_ACTIVITY, resetActivity, tailOf, type ActivityEntry } from '#shared/protocol/activity.ts'
import type { StateMessage } from '#shared/protocol/messages.ts'
import { applyHostMessage, initialHostState } from '../../ui/src/lib/host/state.ts'
import { ActivityKeeper } from '../src/activity.ts'
import { StateSync } from '../src/state-sync.ts'
import { readsOf, Windows } from '../src/windows.ts'
import type { RunChild } from '#shared/protocol/snapshot.ts'

const owner = { state: 'live', limits: { images: 4, imageBytes: 1024 } } as const
const signIn = { status: 'signed-in' } as const
const said = (id: string, text: string): ActivityEntry => ({ id: `message:${id}`, kind: 'assistant', text })
const read = (id: string, output: string): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'read', state: 'completed', input: JSON.stringify({ path: `src/${id}.ts` }, null, 2), output })

test('steering receipt IDs and times reach snapshots and reconnects without message bodies', () => {
  const sync = new StateSync({ owner, signIn, models: null })
  const steeringReceipts = { run: [{ noteId: '00000000-0000-4000-8000-000000000001', at: 123 }] }
  const message = sync.update({ owner, signIn, models: null, snapshot: { steeringReceipts } })!
  assert.deepEqual(applyHostMessage(initialHostState, message).snapshot.steeringReceipts, steeringReceipts)
  assert.deepEqual(sync.full().set?.steeringReceipts, steeringReceipts)
  assert.deepEqual(Object.keys(message.set!.steeringReceipts!.run![0]!), ['noteId', 'at'])
})

test('job activity travels as steps: the growing entry alone, never the whole key', () => {
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (jobActivity: Record<string, ActivityEntry[]>) => ({ owner, signIn, models: null, snapshot: { busy: true, jobActivity } })
  const reads = Array.from({ length: 200 }, (_, index) => read(`${index}`, 'export const value = 1\n'.repeat(200)))

  const first = sync.update(facts({ r1: [...reads, said('9:0', 'I will')] }))
  assert.equal(first?.set?.jobActivity, undefined, 'not in the keys that change')
  assert.deepEqual(first?.activity, [{ op: 'reset', job: 'r1', entries: [...reads, said('9:0', 'I will')] }])

  // hobkin rebuilds every entry on each refresh, many times a second while the agent writes.
  const growing = sync.update(facts({ r1: [...reads.map((entry) => ({ ...entry })), said('9:0', 'I will look')] }))
  assert.deepEqual(growing, { type: 'state', rev: 2, activity: [{ op: 'update', job: 'r1', entry: said('9:0', 'I will look') }] })
  assert.ok(JSON.stringify(growing).length < 300, 'a few words cost a few words')

  assert.equal(sync.update(facts({ r1: [...reads, said('9:0', 'I will look')] })), null, 'nothing changed, nothing sent')
  assert.deepEqual(sync.full().activity, [{ op: 'reset', job: 'r1', entries: [...reads, said('9:0', 'I will look')] }], 'a UI that connects later gets every job whole')
  assert.equal(sync.full().set?.jobActivity, undefined)
})

test('a job the host keeps after it ended sends nothing more, and a job gone is removed', () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (jobActivity: Record<string, ActivityEntry[]>) => ({ owner, signIn, models: null, snapshot: keeper.keep({ jobActivity }) })

  sync.update(facts({ done: [said('1:0', 'Finished.')], r1: [said('2:0', 'Reading')] }))
  // hobkin drops the ended job. The host keeps its last activity, as it was.
  assert.deepEqual(sync.update(facts({ r1: [said('2:0', 'Reading'), read('a', 'text')] }))?.activity, [{ op: 'append', job: 'r1', entries: [read('a', 'text')] }])
  assert.deepEqual(sync.update(facts({ r1: [said('2:0', 'Reading'), read('a', 'text')] })), null)

  const quiet = new StateSync({ owner, signIn, models: null })
  quiet.update({ owner, signIn, models: null, snapshot: { jobActivity: { r1: [said('1:0', 'Hi')] } } })
  assert.deepEqual(quiet.update({ owner, signIn, models: null, snapshot: { jobActivity: {} } })?.activity, [{ op: 'remove', job: 'r1' }])
})

test('a new owner starts over with every job whole', () => {
  const sync = new StateSync({ owner: { state: 'opening' }, signIn, models: null })
  const message = sync.update({ owner, signIn, models: null, snapshot: { jobActivity: { r1: [said('1:0', 'Hi')] } } })
  assert.equal(message?.reset, true)
  assert.deepEqual(message?.activity, [{ op: 'reset', job: 'r1', entries: [said('1:0', 'Hi')] }])
})

test('a run that ended keeps its spawned agents as hobkin last sent them, and a UI that connects later gets them whole', () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (snapshot: object) => ({ owner, signIn, models: null, snapshot: keeper.keep(snapshot) })
  const scout = { name: 'scout', role: 'read', state: 'running', startedAt: 1 } as const

  assert.deepEqual(sync.update(facts({ jobActivity: { r1: [] }, jobChildren: { r1: [scout] } }))?.set?.jobChildren, { r1: [scout] })
  // hobkin publishes an ended run once more, with what never reported marked stopped, then drops it.
  sync.update(facts({ jobActivity: { r1: [] }, jobChildren: { r1: [{ ...scout, state: 'stopped' }] } }))
  assert.equal(sync.update(facts({ jobActivity: {}, jobChildren: {} })), null, 'the ended run stands as it was sent')
  assert.deepEqual(sync.full().set?.jobChildren, { r1: [{ ...scout, state: 'stopped' }] })
  assert.deepEqual(keeper.keep({ busy: false }).jobChildren, { r1: [{ ...scout, state: 'stopped' }] }, 'a saved view changes nothing kept')
})

test('owned ancestry and late child-only updates survive deltas and reconnects without a synthetic feed', () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (snapshot: object) => ({ owner, signIn, models: null, snapshot: keeper.keep(snapshot) })
  const parent = { id: 'p', parentId: 'root', rootId: 'root', depth: 1, name: 'same', state: 'completed', activity: [] } as const
  const grandchild = { ...parent, id: 'g', parentId: 'p', depth: 2, state: 'running', activity: [said('g', 'Reading')] } as const
  sync.update(facts({ jobActivity: { root: [said('p', 'Done')] }, jobChildren: { root: [parent, grandchild] } }))
  let client = applyHostMessage(initialHostState, sync.full())
  assert.deepEqual(client.snapshot.jobChildren?.root, [rowOf(parent), rowOf(grandchild)])

  const final = { ...grandchild, state: 'cancelled', activity: [said('g', 'Ended')] } as const
  const other = { ...parent, id: 'o', rootId: 'other', parentId: 'other' }
  const delta = sync.update(facts({ jobActivity: {}, jobChildren: { root: [parent, final], other: [other] } }))
  assert.ok(delta, 'a late descendant update must travel even without the parent feed')
  client = applyHostMessage(client, delta)
  assert.deepEqual(client.snapshot.jobChildren?.other, [rowOf(other)])
  assert.deepEqual(client.snapshot.jobChildren?.root, [rowOf(parent), rowOf(final)])
  assert.deepEqual(client.snapshot.jobActivity, { root: [said('p', 'Done')] })
  assert.deepEqual(applyHostMessage(initialHostState, sync.full()).snapshot, client.snapshot)
})

/** A helper's row as the window gets it: everything but its steps, which stay in the host. */
const rowOf = ({ activity: _steps, ...row }: RunChild) => row

test("a helper's steps stay in the host: its words and tool calls alone send nothing, and its rows travel without them", () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (snapshot: object) => ({ owner, signIn, models: null, snapshot: keeper.keep(snapshot) })
  const helper = (state: RunChild['state'], activity: ActivityEntry[]): RunChild => ({ id: 'h', parentId: 'r', rootId: 'r', depth: 1, name: 'scout', state, activity })
  const row = { id: 'h', parentId: 'r', rootId: 'r', depth: 1, name: 'scout' }
  const words = [said('h:0', 'Reading the login tests'), read('h1', 'export const login = true\n')]

  const first = sync.update(facts({ jobActivity: {}, jobChildren: { r: [helper('running', [])] }, mainChildren: [helper('running', [])] }))
  assert.deepEqual(first?.set?.jobChildren, { r: [{ ...row, state: 'running' }] })
  assert.deepEqual(first?.set?.mainChildren, [{ ...row, state: 'running' }])
  assert.equal(sync.update(facts({ jobActivity: {}, jobChildren: { r: [helper('running', words)] }, mainChildren: [helper('running', words)] })), null, 'its words and calls alone send nothing')

  const ended = sync.update(facts({ jobActivity: {}, jobChildren: { r: [helper('completed', words)] }, mainChildren: [helper('completed', words)] }))
  assert.deepEqual(ended?.set, { jobChildren: { r: [{ ...row, state: 'completed' }] }, mainChildren: [{ ...row, state: 'completed' }] }, 'how it stands still travels')
  assert.doesNotMatch(JSON.stringify(sync.full()), /Reading the login tests|export const login/)
})

test('helper rows that did not change keep their lists, so a publish with nothing new encodes nothing and sends nothing', () => {
  const keeper = new ActivityKeeper()
  const sync = new StateSync({ owner, signIn, models: null })
  const row = (state: RunChild['state']): RunChild => ({ id: 'h', parentId: 'r', rootId: 'r', depth: 1, name: 'scout', state })
  // hobkin copies every helper row on each publish.
  const published = (state: RunChild['state']) => keeper.keep({ jobActivity: { r: [] }, jobChildren: { r: [row(state)] }, mainChildren: [row(state)] })
  const first = published('running')
  sync.update({ owner, signIn, models: null, snapshot: first })
  const again = published('running')
  assert.equal(again.jobChildren, first.jobChildren, 'the same lists')
  assert.equal(again.mainChildren, first.mainChildren)
  assert.equal(sync.update({ owner, signIn, models: null, snapshot: again }), null)

  const moved = published('completed')
  assert.notEqual(moved.jobChildren, first.jobChildren)
  assert.deepEqual(sync.update({ owner, signIn, models: null, snapshot: moved })?.set, { jobChildren: { r: [row('completed')] }, mainChildren: [row('completed')] })

  // A run still writing whose helpers hobkin no longer lists keeps them as last known, and they stay the same list.
  const gone = () => keeper.keep({ jobActivity: { r: [] }, jobChildren: {} })
  const known = gone()
  assert.deepEqual(known.jobChildren, { r: [row('completed')] })
  assert.equal(gone().jobChildren, known.jobChildren)
})

test('child-only roots retain twenty copied last-known groups without source mutation or resurrection', () => {
  const keeper = new ActivityKeeper()
  const source: RunChild[] = [
    { id: 'c', parentId: 'r', rootId: 'r', depth: 1, name: 'c', state: 'running', activity: [] },
    { name: 'legacy', state: 'running' },
  ]
  assert.deepEqual(keeper.keep({ jobChildren: { r: source } }).jobActivity, {})
  const removed = keeper.keep({ jobChildren: {} })
  assert.deepEqual((removed.jobChildren.r as RunChild[]).map(({ state }) => state), ['unknown', 'unknown'])
  assert.deepEqual(source.map(({ state }) => state), ['running', 'running'])

  for (let i = 0; i < 21; i++) {
    keeper.keep({ jobActivity: {}, jobChildren: { [`r${i}`]: [{ ...source[0], state: 'completed' }] } })
    keeper.keep({ jobActivity: {}, jobChildren: {} })
  }
  const retained = keeper.keep({ busy: false })
  assert.equal(Object.keys(retained.jobChildren).length, 20)
  assert.equal(retained.jobChildren.r, undefined)
  assert.equal(retained.jobChildren.r0, undefined)
  assert.deepEqual(new ActivityKeeper().keep({ busy: false }).jobChildren, {})
  assert.deepEqual(keeper.keep({ jobChildren: { r: source } }).jobActivity, {})
})

/** A socket that keeps what it was sent. */
function windowSocket() {
  const sent: string[] = []
  return {
    socket: { OPEN: 1, readyState: 1, send: (text: string) => void sent.push(text) },
    sent,
    last: () => JSON.parse(sent.at(-1)!) as StateMessage,
  }
}

const READS = '/?token=t&reads=tails,extend'
const long = (job: string) => Array.from({ length: 1000 }, (_, index) => read(`${job}-${index}`, 'export const value = 1\n'.repeat(20)))
const busy = (jobActivity: Record<string, ActivityEntry[]>) => ({ owner, signIn, models: null, snapshot: { busy: true, jobActivity } })
const quiet = () => () => {}

test('a new window gets whole steps only for the agents it watches', () => {
  let now = 0
  const sync = new StateSync({ owner, signIn, models: null })
  const windows = new Windows({ sync, now: () => now, later: quiet })
  const activity = { r1: [...long('r1'), said('r1:0', 'Reading the login code')], r2: [...long('r2'), said('r2:0', 'Fixing')] }
  windows.publish(busy(activity))

  const before = windowSocket()
  const after = windowSocket()
  const whole = windows.open(before.socket, readsOf('/?token=t'))
  const first = windows.open(after.socket, readsOf(READS))
  assert.deepEqual(whole.activity, resetActivity(activity), 'a window from before gets every feed whole')
  assert.deepEqual(first.activity, [{ op: 'reset', job: 'r1', entries: tailOf(activity.r1) }, { op: 'reset', job: 'r2', entries: tailOf(activity.r2) }])
  assert.ok(JSON.stringify(first).length * 100 < JSON.stringify(whole).length, `${JSON.stringify(first).length} bytes against ${JSON.stringify(whole).length}`)

  windows.watch(after.socket, ['r2'])
  assert.deepEqual(after.last().activity, [{ op: 'reset', job: 'r2', entries: activity.r2 }])
  assert.equal(before.sent.length, 0, 'what one window watches sends the others nothing')

  now = 1000
  const grown = { r1: [...activity.r1.slice(0, -1), said('r1:0', 'Reading the login code again')], r2: [...activity.r2.slice(0, -1), said('r2:0', 'Fixing it')] }
  windows.publish(busy(grown))
  assert.deepEqual(after.last().activity, [
    { op: 'update', job: 'r1', entry: tailOf(grown.r1)[0] },
    { op: 'extend', job: 'r2', id: 'message:r2:0', field: 'text', add: ' it' },
  ])
  assert.deepEqual(before.last().activity, [{ op: 'update', job: 'r1', entry: grown.r1.at(-1) }, { op: 'update', job: 'r2', entry: grown.r2.at(-1) }])
})

test('a window from before gets whole feeds exactly as today, whatever a new window beside it watches', () => {
  let now = 0
  const sync = new StateSync({ owner, signIn, models: null }, { now: () => now })
  const today = new StateSync({ owner, signIn, models: null }, { now: () => now })
  const windows = new Windows({ sync, now: () => now, later: quiet })
  const before = windowSocket()
  const after = windowSocket()
  const feeds: Record<string, ActivityEntry[]>[] = [
    { r1: [said('1:0', 'I will')], r2: [read('a', 'text')] },
    { r1: [said('1:0', 'I will look')], r2: [read('a', 'text'), said('2:0', 'Done')] },
    { r2: [read('a', 'text'), said('2:0', 'Done.')] },
  ]
  windows.publish(busy(feeds[0]!))
  today.update(busy(feeds[0]!))
  assert.equal(JSON.stringify(windows.open(before.socket, readsOf(undefined))), JSON.stringify(today.full()))
  windows.open(after.socket, readsOf(READS))
  windows.watch(after.socket, ['r1'])

  for (const feed of feeds.slice(1)) {
    now += 400
    windows.publish(busy(feed))
    assert.equal(before.sent.at(-1), JSON.stringify(today.update(busy(feed))))
  }
})

test('watching a job sends its whole feed, and no longer watching it sends its tail, each as one reset', () => {
  const sync = new StateSync({ owner, signIn, models: null })
  const windows = new Windows({ sync, now: () => 0, later: quiet })
  const feed = [said('1:0', 'Reading'), read('a', 'export const login = true\n')]
  windows.publish(busy({ r1: feed }))
  const window = windowSocket()
  windows.open(window.socket, readsOf(READS))

  windows.watch(window.socket, ['r1'])
  assert.deepEqual(window.last().activity, [{ op: 'reset', job: 'r1', entries: feed }])
  windows.watch(window.socket, [])
  assert.deepEqual(window.last().activity, [{ op: 'reset', job: 'r1', entries: tailOf(feed) }])
  const sent = window.sent.length
  windows.watch(window.socket, [])
  assert.equal(window.sent.length, sent, 'the same set again sends nothing')
})

test("a job's tail changes at most four times a second, and a job that starts or goes does so at once", () => {
  let now = 0
  const timers: { run: () => void; at: number }[] = []
  const sync = new StateSync({ owner, signIn, models: null })
  const windows = new Windows({ sync, now: () => now, later: (run, ms) => (timers.push({ run, at: now + ms }), () => {}) })
  const window = windowSocket()
  windows.open(window.socket, readsOf(READS))
  const words = (text: string) => ({ r1: [said('1:0', text)] })

  windows.publish(busy(words('I')))
  assert.deepEqual(window.last().activity, [{ op: 'reset', job: 'r1', entries: [said('1:0', 'I')] }], 'a job that starts goes at once')
  const tails = () => window.sent.filter((text) => text.includes('"op":"update"')).length
  // A word every 25 ms for a second, the last one 25 ms after a tail went out.
  for (let tick = 1; tick <= 41; tick++) {
    now = tick * 25
    windows.publish(busy(words(`I${' word'.repeat(tick)}`)))
    const due = timers.filter(({ at }) => at <= now)
    for (const timer of due) timers.splice(timers.indexOf(timer), 1)
    for (const timer of due) timer.run()
  }
  assert.ok(tails() <= 4, `${tails()} tail changes in a second`)
  assert.notDeepEqual(window.last().activity, [{ op: 'update', job: 'r1', entry: said('1:0', `I${' word'.repeat(41)}`) }], 'the last words wait')
  now = 1300
  for (const timer of timers.splice(0)) timer.run()
  assert.deepEqual(window.last().activity, [{ op: 'update', job: 'r1', entry: said('1:0', `I${' word'.repeat(41)}`) }], 'and arrive without another message')

  windows.publish(busy({}))
  assert.deepEqual(window.last().activity, [{ op: 'remove', job: 'r1' }], 'a job that goes goes at once')
})

test("the main chat's activity travels as steps beside the jobs', and reaches the UI as its own key", () => {
  const sync = new StateSync({ owner, signIn, models: null })
  const facts = (mainActivity: ActivityEntry[]) => ({ owner, signIn, models: null, snapshot: { jobActivity: { r1: [said('1:0', 'Job')] }, mainActivity } })
  let client = applyHostMessage({ ...initialHostState, home: '/h' }, sync.update(facts([said('2:0', 'I will')]))!)
  const growing = sync.update(facts([said('2:0', 'I will look')]))
  assert.deepEqual(growing, { type: 'state', rev: 2, activity: [{ op: 'update', job: MAIN_ACTIVITY, entry: said('2:0', 'I will look') }] }, 'never the whole key')
  client = applyHostMessage(client, growing!)
  assert.deepEqual(client.snapshot.mainActivity, [said('2:0', 'I will look')])
  assert.deepEqual(Object.keys(client.snapshot.jobActivity ?? {}), ['r1'], 'it is no job')
  assert.deepEqual(applyHostMessage({ ...initialHostState, home: '/h' }, sync.full()).snapshot.mainActivity, [said('2:0', 'I will look')], 'a UI that connects later gets it whole')
})

