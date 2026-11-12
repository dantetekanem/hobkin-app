import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentControls, createStopConfirmationAuthority, type AgentControlState, type AgentStopTarget } from '../src/features/work/actions.ts'

const agent = { id: 'work:one:1', title: 'Fix checkout', project: 'storefront', kind: 'work' }
function fixture() {
  let selected: (typeof agent & { asks?: string; source?: string }) | undefined = agent
  let state: AgentControlState = { target: null, busy: false, result: null }
  const sent: string[] = []
  let send = async (id: string) => { sent.push(id); return 'Stop requested.' }
  const controls = createAgentControls({ selected: () => selected, send: (id) => send(id), changed: (next) => { state = next } })
  return { controls, sent, state: () => state, select: (next: typeof selected) => { selected = next }, sender: (next: typeof send) => { send = next } }
}

test('a retained map Stop callback is consumed and must still match the current target', () => {
  let current: AgentStopTarget | undefined = { ...agent, source: 'home:1' }
  const sent: string[] = []
  const answer = createStopConfirmationAuthority(current, () => current, (how) => sent.push(how))
  answer('for-now')
  answer('not-approved')
  current = { ...agent, source: 'home:2' }
  answer('not-approved')
  assert.deepEqual(sent, ['for-now'])

  const cancel = createStopConfirmationAuthority(current, () => current, (how) => sent.push(how))
  cancel(null)
  cancel('for-now')
  current = { ...agent, source: 'home:3' }
  cancel('for-now')
  const moved = createStopConfirmationAuthority(current, () => current, (how) => sent.push(how))
  current = { ...agent, source: 'home:4' }
  moved('for-now')
  const departed = createStopConfirmationAuthority(current, () => undefined, (how) => sent.push(how))
  departed('for-now')
  const changed = createStopConfirmationAuthority(current, () => ({ ...current!, title: 'Replacement' }), (how) => sent.push(how))
  changed('for-now')
  assert.deepEqual(sent, ['for-now'])
})

test('Stop requires confirmation, names the selected identity, and Cancel sends nothing', async () => {
  const f = fixture()
  f.controls.request(agent.id)
  assert.deepEqual(f.state().target, agent)
  assert.equal(f.sent.length, 0)
  f.controls.cancel()
  await f.controls.confirm()
  assert.equal(f.sent.length, 0)
  assert.equal(f.state().target, null)
})

test('confirm deduplicates pending Stop but permits retry while the same agent is still running', async () => {
  const f = fixture()
  let finish!: (value: string) => void
  f.sender((id) => { f.sent.push(id); return new Promise((resolve) => { finish = resolve }) })
  f.controls.request(agent.id)
  const first = f.controls.confirm()
  assert.equal(f.state().busy, true)
  await f.controls.confirm()
  f.controls.request(agent.id)
  assert.deepEqual(f.sent, [agent.id])
  finish('Stopped checkout.')
  await first
  assert.equal(f.state().busy, false)
  assert.equal(f.state().result?.text, 'Stopped checkout.')
  f.sender(async (id) => { f.sent.push(id); return 'Stop requested again.' })
  f.controls.request(agent.id)
  await f.controls.confirm()
  assert.deepEqual(f.sent, [agent.id, agent.id])
})

test('a parent Force confirmation remains independent while ordinary Stop is pending', async () => {
  const f = fixture()
  let finish!: (text: string) => void
  f.sender(() => new Promise(resolve => { finish = resolve }))
  f.controls.request(agent.id)
  const stop = f.controls.confirm()
  assert.equal(f.controls.pending(agent.id), true)
  f.sender(async () => 'Force closure unknown; detached cleanup unknown.')
  f.controls.request(agent.id, 'force')
  assert.equal(f.state().target?.mode, 'force')
  await f.controls.confirm()
  assert.match(f.state().result!.text, /closure unknown/)
  assert.equal(f.controls.pending(agent.id), true)
  finish('Late Stop reply.'); await stop
  assert.match(f.state().result!.text, /Force/)
})

test('a pending agent does not block another target or overwrite its newer result', async () => {
  const f = fixture()
  let finish!: (value: string) => void
  f.sender((id) => { f.sent.push(id); return id === agent.id ? new Promise(resolve => { finish = resolve }) : Promise.resolve('B requested.') })
  f.controls.request(agent.id)
  const first = f.controls.confirm()
  f.select({ ...agent, id: 'session:other', kind: 'session' })
  f.controls.request('session:other')
  await f.controls.confirm()
  assert.deepEqual(f.sent, [agent.id, 'session:other'])
  assert.equal(f.state().result?.text, 'B requested.')
  finish('A requested.')
  await first
  assert.equal(f.state().result?.text, 'B requested.')
})

test('an old home completion cannot replace a newer attempt for the same id', async () => {
  const f = fixture()
  let finish!: (value: string) => void
  f.select({ ...agent, source: 'home:1' })
  f.sender(() => new Promise(resolve => { finish = resolve }))
  f.controls.request(agent.id)
  const old = f.controls.confirm()
  f.select({ ...agent, source: 'home:2' })
  f.sender(async () => 'New home requested.')
  f.controls.request(agent.id)
  await f.controls.confirm()
  finish('Old home requested.')
  await old
  assert.equal(f.state().result?.text, 'New home requested.')
})

test('reset invalidates an old pending token without releasing its replacement', async () => {
  const f = fixture()
  let oldFinish!: (value: string) => void
  let newFinish!: (value: string) => void
  f.sender(() => new Promise(resolve => { oldFinish = resolve }))
  f.controls.request(agent.id)
  const old = f.controls.confirm()
  f.controls.reset()
  assert.deepEqual(f.state(), { target: null, busy: false, result: null })
  f.sender(() => new Promise(resolve => { newFinish = resolve }))
  f.controls.request(agent.id)
  const replacement = f.controls.confirm()
  oldFinish('Old reply.')
  await old
  assert.equal(f.controls.pending(agent.id), true)
  assert.equal(f.state().result, null)
  newFinish('Current reply.')
  await replacement
  assert.equal(f.state().result?.text, 'Current reply.')
})

test('a stale, ended or changed selection never stops another run', async () => {
  for (const next of [undefined, { ...agent, id: 'other' }, { ...agent, title: 'Another execution' }, { ...agent, source: 'another-home:2' }]) {
    const f = fixture()
    f.controls.request('missing')
    assert.equal(f.state().target, null)
    f.controls.request(agent.id)
    f.select(next)
    await f.controls.confirm()
    assert.deepEqual(f.sent, [])
    assert.match(f.state().result!.text, /changed|finished/)
  }
})

test('a waiting routine can stop; refusal stays visible and allows a fresh confirmation', async () => {
  const f = fixture()
  f.select({ ...agent, kind: 'routine', title: 'Morning recap', asks: 'Keep going?' })
  f.sender(async () => { throw Error('Host disconnected; nothing stopped.') })
  f.controls.request(agent.id)
  await f.controls.confirm()
  assert.match(f.state().result!.text, /disconnected/)
  f.controls.request(agent.id)
  assert.equal(f.state().target?.kind, 'routine')
})

test('interrupt explicitly reports unsupported without sending Stop, even for an ended selection', () => {
  const f = fixture()
  f.controls.interrupt(agent.id)
  assert.match(f.state().result!.text, /cannot interrupt.*without stopping/)
  f.select(undefined)
  f.controls.interrupt(agent.id)
  assert.match(f.state().result!.text, /finished/)
  assert.deepEqual(f.sent, [])
})
