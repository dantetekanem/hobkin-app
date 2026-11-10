import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentControls, type AgentControlState } from '../src/features/work/actions.ts'

const agent = { id: 'work:one:1', title: 'Fix checkout', project: 'storefront', kind: 'work' }
function fixture() {
  let selected: (typeof agent & { asks?: string; source?: string }) | undefined = agent
  let state: AgentControlState = { target: null, busy: false, result: null }
  const sent: string[] = []
  let send = async (id: string) => { sent.push(id); return 'Stop requested.' }
  const controls = createAgentControls({ selected: () => selected, send: (id) => send(id), changed: (next) => { state = next } })
  return { controls, sent, state: () => state, select: (next: typeof selected) => { selected = next }, sender: (next: typeof send) => { send = next } }
}

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

test('confirm stops the exact selected run only once while pending and awaiting its final snapshot', async () => {
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
  f.controls.request(agent.id)
  await f.controls.confirm()
  assert.deepEqual(f.sent, [agent.id])
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
