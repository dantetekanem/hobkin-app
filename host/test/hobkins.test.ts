import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { HobkinConversation, HobkinSummary } from '#shared/protocol/hobkins.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, Unavailable, type HostHandlers } from '../src/commands.ts'
import { hobkinHandlers, type HobkinsSeat } from '../src/hobkins.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

const summary: HobkinSummary = {
  id: 'a1b2c3d4',
  title: 'Fix the tests',
  cwd: '/tmp',
  engine: { kind: 'claude' },
  state: 'waiting',
  turns: 1,
  run: null,
  last: { status: 'completed', said: 'Done.', at: '2026-11-13T10:00:00.000Z' },
  waiting: { since: '2026-11-13T10:00:00.000Z', seen: false },
  createdAt: '2026-11-13T09:00:00.000Z',
}
const conversation: HobkinConversation = {
  hobkin: summary,
  turns: [{ n: 1, run: 'hobkin:a1b2c3d4:1', asked: 'Fix it.', askedAt: summary.createdAt, status: 'completed', reply: 'Done.', error: null, endedAt: summary.last!.at }],
}

/** A runtime that remembers what it was asked. */
function fixture(t: Parameters<typeof temporaryDirectory>[0], seat: Partial<HobkinsSeat> = {}, hobkins: unknown = undefined) {
  const home = temporaryDirectory(t)
  mkdirSync(join(home, 'work'))
  writeFileSync(join(home, 'a-file'), '')
  const calls: [string, ...unknown[]][] = []
  const runtime = hobkins === undefined
    ? {
        start: async (args: unknown) => {
          calls.push(['start', args])
          return { id: 'a1b2c3d4', run: 'hobkin:a1b2c3d4:1' }
        },
        say: async (id: string, args: unknown) => {
          calls.push(['say', id, args])
          return { started: true, queued: false, run: 'hobkin:a1b2c3d4:2' }
        },
        end: async (id: string) => {
          calls.push(['end', id])
          return { ok: true as const }
        },
        rename: async (id: string, title: string) => {
          calls.push(['rename', id, title])
          return { ...summary, title }
        },
        seen: async (id: string) => {
          calls.push(['seen', id])
          return { ok: true as const }
        },
        read: async (id: string) => {
          calls.push(['read', id])
          return conversation
        },
      }
    : hobkins
  const handlers: HostHandlers = hobkinHandlers({
    app: () => ({ hobkins: runtime }) as never,
    claudeMissing: async () => null,
    modelProblem: () => null,
    home,
    ...seat,
  })
  return { handlers, calls, home }
}

const start = (cwd: string, engine: unknown = { kind: 'tier', tier: 'fast' }) => ({ text: 'Fix it.', cwd, engine })

test('the main hobkin reads a hobkin\'s turns and cannot start one, end one or speak as the user', async (t) => {
  const { handlers } = fixture(t)
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })

  const read = await tool.execute('1', { action: 'run', name: 'hobkin.read', args: { id: 'a1b2c3d4' } })
  assert.deepEqual(read.details, conversation)
  const listed = (await tool.execute('2', { action: 'list' })).details as { name: string }[]
  assert.ok(listed.some((command) => command.name === 'hobkin.read'))

  const refused: [string, Record<string, unknown>][] = [
    ['hobkin.start', start('/tmp')],
    ['hobkin.say', { id: 'a1b2c3d4', text: 'Hello' }],
    ['hobkin.end', { id: 'a1b2c3d4' }],
  ]
  for (const [name, args] of refused) {
    await assert.rejects(tool.execute('3', { action: 'run', name, args }), /cannot run/, name)
    assert.ok(!listed.some((command) => command.name === name), `${name} is not listed for hobkin`)
  }
})

test('the main hobkin lists and messages hobkins through the client tool', async (t) => {
  const calls: unknown[][] = []
  const reached = { hobkins: [{ id: 'a1b2c3d4', title: 'Fix the tests', state: 'waiting' as const }] }
  const runtime = {
    reach: async () => (calls.push(['reach']), reached),
    tell: async (id: string, args: unknown) => (calls.push(['tell', id, args]), { started: true, queued: false, run: 'hobkin:a1b2c3d4:2' }),
  }
  const { handlers } = fixture(t, {}, runtime)
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })

  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  assert.ok(listed.some((command) => command.name === 'hobkin.list') && listed.some((command) => command.name === 'hobkin.tell'))
  assert.deepEqual((await tool.execute('2', { action: 'run', name: 'hobkin.list', args: {} })).details, reached)
  const told = await tool.execute('3', { action: 'run', name: 'hobkin.tell', args: { id: 'a1b2c3d4', text: 'The user wants the tests fixed first.' } })
  assert.deepEqual(told.details, { started: true, queued: false, run: 'hobkin:a1b2c3d4:2' })
  assert.deepEqual(calls, [['reach'], ['tell', 'a1b2c3d4', { text: 'The user wants the tests fixed first.' }]])

  // A message is a note: a longer one is refused before it reaches the runtime, and so is one with no hobkin.
  await assert.rejects(tool.execute('4', { action: 'run', name: 'hobkin.tell', args: { id: 'a1b2c3d4', text: 'x'.repeat(4097) } }))
  await assert.rejects(tool.execute('5', { action: 'run', name: 'hobkin.tell', args: { text: 'Hello' } }))
  assert.equal(calls.length, 2)

  // A runtime with durable hobkins but from before messages says to restart.
  const { handlers: older } = fixture(t, {}, { read: async () => conversation })
  const sentence = 'This hobkin cannot pass messages between hobkins yet. Restart the app to load them.'
  for (const [name, args] of [['hobkin.list', {}], ['hobkin.tell', { id: 'a1b2c3d4', text: 'Hi' }]] as const) {
    assert.deepEqual(await runCommand(older, name, args), { ok: false, error: { code: 'unavailable', message: sentence } }, name)
  }
})

test('the folder is expanded against the home, and must be an absolute folder that exists', async (t) => {
  const { handlers, calls, home } = fixture(t)
  await handlers['hobkin.start']!(start('~/work') as never)
  await handlers['hobkin.start']!(start('~') as never)
  assert.deepEqual(calls.map(([, args]) => (args as { cwd: string }).cwd), [join(home, 'work'), home])

  for (const cwd of ['work', './work', join(home, 'missing'), join(home, 'a-file')]) {
    await assert.rejects(Promise.resolve(handlers['hobkin.start']!(start(cwd) as never)), (error: Error) => error instanceof Unavailable && /folder/.test(error.message), cwd)
  }
  assert.equal(calls.length, 2, 'a refused folder starts nothing')
})

test('a Claude hobkin is refused with the reason while Claude Code cannot run', async (t) => {
  const { handlers, calls, home } = fixture(t, { claudeMissing: async () => 'Claude Code is not installed on this Mac.' })
  await assert.rejects(Promise.resolve(handlers['hobkin.start']!(start(home, { kind: 'claude' }) as never)), (error: Error) => error instanceof Unavailable && error.message === 'Claude Code is not installed on this Mac.')
  await handlers['hobkin.start']!(start(home) as never)
  assert.equal(calls.length, 1, 'a tier is not held back by it')
})

test('a Pi model that cannot run is refused with the reason', async (t) => {
  const seen: unknown[] = []
  const { handlers, calls, home } = fixture(t, { modelProblem: (model, effort) => (seen.push([model, effort]), 'Anthropic is not connected.') })
  await assert.rejects(Promise.resolve(handlers['hobkin.start']!(start(home, { kind: 'pi', model: 'anthropic/x', effort: 'high' }) as never)), (error: Error) => error instanceof Unavailable && error.message === 'Anthropic is not connected.')
  assert.deepEqual(seen, [['anthropic/x', 'high']])
  assert.equal(calls.length, 0)
})

test('a runtime from before durable hobkins says to restart the app', async (t) => {
  const { home } = fixture(t)
  const old = hobkinHandlers({ app: () => ({}) as never, claudeMissing: async () => null, modelProblem: () => null, home })
  const sentence = 'This hobkin does not have durable hobkins yet. Restart the app to load them.'
  const commands = [
    ['hobkin.start', start(home)],
    ['hobkin.say', { id: 'a1b2c3d4', text: 'x' }],
    ['hobkin.end', { id: 'a1b2c3d4' }],
    ['hobkin.rename', { id: 'a1b2c3d4', title: 'x' }],
    ['hobkin.seen', { id: 'a1b2c3d4' }],
    ['hobkin.read', { id: 'a1b2c3d4' }],
  ] as const
  for (const [name, args] of commands) {
    const outcome = await runCommand(old, name, args)
    assert.deepEqual(outcome, { ok: false, error: { code: 'unavailable', message: sentence } }, name)
  }
})

test("a runtime refusal becomes the command's reason", async (t) => {
  const refusing = new Proxy({}, { get: () => async () => { throw new Error('Twelve hobkins are kept. End one first.') } })
  const { handlers, home } = fixture(t, {}, refusing)
  const outcome = await runCommand(handlers, 'hobkin.start', start(home))
  assert.deepEqual(outcome, { ok: false, error: { code: 'unavailable', message: 'Twelve hobkins are kept. End one first.' } })
  assert.deepEqual(await runCommand(handlers, 'hobkin.end', { id: 'a1b2c3d4' }), { ok: false, error: { code: 'unavailable', message: 'Twelve hobkins are kept. End one first.' } })
})

test('the other commands pass straight through', async (t) => {
  const { handlers, calls } = fixture(t)
  assert.deepEqual(await handlers['hobkin.say']!({ id: 'a1b2c3d4', text: 'Go on.', noteId: '0b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b' }), { started: true, queued: false, run: 'hobkin:a1b2c3d4:2' })
  await handlers['hobkin.rename']!({ id: 'a1b2c3d4', title: 'New' })
  await handlers['hobkin.seen']!({ id: 'a1b2c3d4' })
  await handlers['hobkin.end']!({ id: 'a1b2c3d4' })
  assert.deepEqual(calls, [
    ['say', 'a1b2c3d4', { text: 'Go on.', noteId: '0b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b' }],
    ['rename', 'a1b2c3d4', 'New'],
    ['seen', 'a1b2c3d4'],
    ['end', 'a1b2c3d4'],
  ])
})

test('a message to a hobkin passes the time the user sent it on unchanged, and leaves it out when none came', async (t) => {
  const { handlers, calls } = fixture(t)
  await runCommand(handlers, 'hobkin.say', { id: 'a1b2c3d4', text: 'Go on.', sentAt: 1763114400000 })
  await runCommand(handlers, 'hobkin.say', { id: 'a1b2c3d4', text: 'And then?' })
  assert.deepEqual(calls, [
    ['say', 'a1b2c3d4', { text: 'Go on.', sentAt: 1763114400000 }],
    ['say', 'a1b2c3d4', { text: 'And then?' }],
  ])
})

test('a hobkin started from the window runs its turn, waits, takes another message and ends', async (t) => {
  // The real host over hobkin's real runtime, with the scripted job runner, which answers at once and runs no model.
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const folder = temporaryDirectory(t)
  const hobkins = () => client.view.snapshot.hobkins ?? []

  const started = await client.run<{ id: string; run: string }>('hobkin.start', { text: 'Look at the tests.\nThen say what you saw.', cwd: folder, engine: { kind: 'tier', tier: 'fast' } })
  assert.match(started.id, /^[0-9a-f]{8}$/)
  assert.equal(started.run, `hobkin:${started.id}:1`)
  await client.until(() => hobkins()[0]?.state === 'waiting', 'the first turn to end')
  const waiting = hobkins()[0]!
  assert.deepEqual(
    [waiting.id, waiting.title, waiting.cwd, waiting.engine, waiting.turns, waiting.run, waiting.last?.status, waiting.waiting?.seen],
    [started.id, 'Look at the tests.', folder, { kind: 'tier', tier: 'fast' }, 1, null, 'completed', false],
  )
  // Its turn is the hobkin's own: no report of it waits in Reports.
  assert.equal((client.view.snapshot as { reports?: { id: string }[] }).reports?.some((report) => report.id === started.run) ?? false, false)

  const said = await client.run<{ started: boolean; queued: boolean; run: string }>('hobkin.say', { id: started.id, text: 'And the build?' })
  assert.deepEqual(said, { started: true, queued: false, run: `hobkin:${started.id}:2` })
  await client.until(() => hobkins()[0]?.turns === 2 && hobkins()[0]?.state === 'waiting', 'the second turn to end')

  const read = await client.run<HobkinConversation>('hobkin.read', { id: started.id })
  assert.deepEqual(read.turns.map(({ n, asked, status }) => [n, asked, status]), [
    [1, 'Look at the tests.\nThen say what you saw.', 'completed'],
    [2, 'And the build?', 'completed'],
  ])
  assert.ok(read.turns.every((turn) => typeof turn.reply === 'string' && turn.reply.length > 0))

  await client.run('hobkin.seen', { id: started.id })
  await client.until(() => hobkins()[0]?.waiting?.seen === true, 'the wait to read as seen')

  const refused = await client.command('hobkin.start', { text: 'Hello', cwd: join(folder, 'missing'), engine: { kind: 'tier', tier: 'fast' } })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')

  await client.run('hobkin.end', { id: started.id })
  await client.until(() => hobkins().length === 0, 'the hobkin to leave the list')

  // Started with nothing to do, it waits with no turn, and its first message is its first turn and its name.
  const empty = await client.run<{ id: string; run: string | null }>('hobkin.start', { cwd: folder, engine: { kind: 'tier', tier: 'fast' } })
  assert.equal(empty.run, null)
  await client.until(() => hobkins()[0]?.id === empty.id, 'the new hobkin to be listed')
  assert.deepEqual([hobkins()[0]!.title, hobkins()[0]!.state, hobkins()[0]!.turns, hobkins()[0]!.run], ['New hobkin', 'waiting', 0, null])
  assert.deepEqual(await client.run('hobkin.say', { id: empty.id, text: 'Count the tests.' }), { started: true, queued: false, run: `hobkin:${empty.id}:1` })
  await client.until(() => hobkins()[0]?.turns === 1 && hobkins()[0]?.state === 'waiting', 'its first turn to end')
  assert.equal(hobkins()[0]!.title, 'Count the tests.')
})
