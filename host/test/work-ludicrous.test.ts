import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { LudicrousState } from '#shared/protocol/ludicrous.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { LudicrousKeeper, ludicrousHandlers, type LudicrousConductor } from '../src/ludicrous.ts'
// hobkin's own test home and fake Pi processes, so the conductor here is hobkin's real one and starts no real agent.
import { ludicrousHome, PLAN } from '../../packages/hobkin/test/helpers/ludicrous.mjs'

const MACHINE = { picked: 50, checks: 3, perAgentMb: 475, spareMb: 43008, tiers: [] } as unknown as LudicrousState['machine']

/** Stands in for hobkin's conductor: it writes down what it was asked, and answers a view that changes when asked to. */
function fakeConductor() {
  const calls: unknown[][] = []
  let views = 0
  const conductor: LudicrousConductor = {
    view: () => ({ run: null, machine: { ...MACHINE, spareMb: MACHINE.spareMb + views++ } }),
    plan: async (asked) => void calls.push(['plan', asked]),
    go: async (asked) => void calls.push(['go', asked]),
    stop: async () => void calls.push(['stop']),
  }
  return { conductor, calls, read: () => views }
}

test('only the window starts or stops Ludicrous', async (t) => {
  const { conductor, calls } = fakeConductor()
  const keeper = new LudicrousKeeper({ conductor: () => conductor, onChange: () => {} })
  t.after(() => keeper.close())
  const handlers = ludicrousHandlers({ conductor: () => conductor, root: () => '/nowhere', keeper })

  // hobkin's own tool is refused all three, and does not list them.
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  for (const [name, args] of [['work.ludicrous.plan', { slug: 'harbor', idea: 'A harbor master.', tier: 30 }], ['work.ludicrous.go', {}], ['work.ludicrous.stop', {}]] as const) {
    await assert.rejects(tool.execute('1', { action: 'run', name, args }), /needs the user's yes in the window/, name)
  }
  const listed = (JSON.parse((await tool.execute('2', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name)
  assert.deepEqual(listed.filter((name) => name.startsWith('work.ludicrous.')), [])
  assert.deepEqual(calls, [])

  // The window's own commands reach the conductor, and answer Ludicrous as it stands then.
  const planned = await runCommand(handlers, 'work.ludicrous.plan', { slug: 'harbor', idea: 'A harbor master.', tier: 50 })
  assert.equal(planned.ok, true)
  assert.deepEqual(await runCommand(handlers, 'work.ludicrous.go', { answers: { q1: 'b' } }).then(({ ok }) => ok), true)
  assert.deepEqual(await runCommand(handlers, 'work.ludicrous.stop', {}).then(({ ok }) => ok), true)
  assert.deepEqual(calls, [['plan', { slug: 'harbor', idea: 'A harbor master.', tier: 50 }], ['go', { answers: { q1: 'b' } }], ['stop']])

  // A tier other than 30, 50 or 100 never reaches it.
  const refused = await runCommand(handlers, 'work.ludicrous.plan', { slug: 'harbor', idea: 'A harbor master.', tier: 40 })
  assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')
})

test('Ludicrous agents are not running agents', async (t) => {
  // hobkin's real conductor, building, with fake Pi processes for its agents.
  const h = ludicrousHome(t)
  await h.building(PLAN, { statuses: { foundation: { contracts: true } }, queues: { api: [{ id: 'api-1', paths: ['src/api/users.ts'] }, { id: 'api-2', paths: ['src/api/teams.ts'] }] } })
  const conductor = h.conductor()
  await h.ticks(conductor, 6)
  assert.equal(h.pis.running().length, 4)

  let frames = 0
  const keeper = new LudicrousKeeper({ conductor: () => conductor as unknown as LudicrousConductor, onChange: () => frames++ })
  t.after(() => keeper.close())
  const frame = keeper.read()!
  assert.equal(frames, 1)
  // The window hears how many run and where, and nothing about any one of them.
  assert.equal(frame.run!.running, 4)
  assert.deepEqual(frame.run!.areas.map(({ id, agents, leader }) => [id, agents, leader]), [['foundation', 1, true], ['api', 3, true]])
  const sent = JSON.stringify(frame)
  for (const agent of h.pis.started) {
    assert.equal(sent.includes(agent.env.LUDICROUS_AGENT), false)
    assert.equal(sent.includes(agent.args[agent.args.indexOf('--session') + 1]), false)
    assert.equal(sent.includes(agent.args.at(-1) ?? ''), false)
  }
  // None of them is one of hobkin's runs: nothing of the run reaches the jobs or sessions every agents list and agent page reads.
  assert.equal(existsSync(join(h.root, 'jobs')), false)
  assert.equal(existsSync(join(h.root, 'sessions')), false)
})

test('the window gets at most one Ludicrous frame a second', async (t) => {
  const { conductor, read } = fakeConductor()
  let frames = 0
  const keeper = new LudicrousKeeper({ conductor: () => conductor, onChange: () => frames++, pollMs: 60000 })
  t.after(() => keeper.close())
  // A view that changes every time it is read, asked for every 50 ms for two and a half seconds.
  for (let step = 0; step < 50; step += 1) {
    keeper.schedule()
    await new Promise((done) => setTimeout(done, 50))
  }
  // Read at once, then once each second after: three reads, each a frame.
  assert.equal(read(), 3)
  assert.equal(frames, 3)
})
