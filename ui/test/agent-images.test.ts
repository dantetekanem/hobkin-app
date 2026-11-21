import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { CommandArgs, CommandName, CommandResults } from '#shared/commands/registry.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { initialHostState } from '../src/lib/host/state.ts'

const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
const previousFileReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
  result: string | null = null
  onload?: () => void
  readAsDataURL() { this.result = 'data:image/png;base64,aW1hZ2U='; this.onload?.() }
} })
after(() => {
  if (previousFileReader) Object.defineProperty(globalThis, 'FileReader', previousFileReader)
  else Reflect.deleteProperty(globalThis, 'FileReader')
  aliasHooks.deregister()
})
const { imagesReady, useAgentImages } = await import('../src/features/work/agent-images.ts')
const { useAgentThreads } = await import('../src/features/work/agent-threads.ts')
const { sayToAgent } = await import('../src/features/work/say.ts')

type Call = { name: CommandName; args: Record<string, unknown>; resolve(value: unknown): void; reject(error: Error): void }
const picture = (name = 'chart.png') => new File(['image'], name, { type: 'image/png' })
const flush = () => new Promise<void>((done) => setImmediate(done))
const AGENT = 'once:recap'

function prepare(t: TestContext) {
  const calls: Call[] = []
  const command = <Name extends CommandName>(name: Name, args: CommandArgs<Name>) =>
    new Promise<CommandResults[Name]>((resolve, reject) => calls.push({ name, args: args as Record<string, unknown>, resolve, reject }))
  t.mock.method(HostConnection.prototype, 'command', command)
  hostStore.setState({ ...initialHostState, link: 'open', home: '/isolated', owner: { state: 'live', limits: { images: 2, imageBytes: 1_000_000 } } }, true)
  useAgentImages.setState({ trays: {}, problems: {} })
  let preview = 0
  t.mock.method(URL, 'createObjectURL', () => `blob:agent-${++preview}`)
  const revoked: string[] = []
  t.mock.method(URL, 'revokeObjectURL', (url: string) => void revoked.push(url))
  const named = (name: CommandName) => calls.filter((call) => call.name === name)
  return { calls, revoked, named }
}

const tray = (agent = AGENT) => useAgentImages.getState().trays[agent] ?? []

test("an image for an agent goes to hobkin for that agent's message, under the main input's limits", async (t) => {
  const { named } = prepare(t)
  useAgentImages.getState().attach(AGENT, [picture()])
  await flush()
  const [upload] = named('conversation.attach')
  assert.deepEqual(upload?.args, { name: 'chart.png', data: 'aW1hZ2U=', agent: AGENT })
  assert.equal(imagesReady(tray()), false, 'nothing goes while the image is on its way')

  upload!.resolve({ id: 'host-chart' })
  await flush()
  assert.equal(tray()[0]?.handle, 'host-chart')
  assert.equal(imagesReady(tray()), true)

  // Each agent's message holds hobkin's number of images, and one more is turned away with the reason.
  useAgentImages.getState().attach(AGENT, [picture('two.png'), picture('three.png')])
  assert.equal(tray().length, 2)
  assert.match(useAgentImages.getState().problems[AGENT] ?? '', /2 images/)
  useAgentImages.getState().attach('hobkin:a1b2c3d4', [picture('other.png')])
  assert.equal(tray('hobkin:a1b2c3d4').length, 1, "another agent's message has room of its own")
})

test('an image taken out is let go of by hobkin, and a failed upload leaves with its reason', async (t) => {
  const { named, revoked } = prepare(t)
  useAgentImages.getState().attach(AGENT, [picture()])
  await flush()
  named('conversation.attach')[0]!.resolve({ id: 'host-chart' })
  await flush()
  useAgentImages.getState().detach(AGENT, tray()[0]!.id)
  assert.deepEqual(tray(), [])
  assert.deepEqual(named('conversation.detach').map(({ args }) => args), [{ id: 'host-chart' }])
  assert.deepEqual(revoked, ['blob:agent-1'])

  useAgentImages.getState().attach(AGENT, [picture('broken.png')])
  await flush()
  named('conversation.attach')[1]!.reject(new Error('That image could not be shrunk to send.'))
  await flush()
  assert.deepEqual(tray(), [])
  assert.equal(useAgentImages.getState().problems[AGENT], 'That image could not be shrunk to send.')
})

test('sent images go with the note and stay drawn there, and a message that did not go gives them back', async (t) => {
  const { named, revoked } = prepare(t)
  useAgentImages.getState().attach(AGENT, [picture()])
  await flush()
  named('conversation.attach')[0]!.resolve({ id: 'host-chart' })
  await flush()

  const images = useAgentImages.getState().take(AGENT)
  assert.deepEqual(tray(), [], 'the tray empties as the words do')
  useAgentThreads.setState({ notes: {} })
  const sending = useAgentThreads.getState().send(AGENT, '', (noteId) => sayToAgent(AGENT, '', { live: true, noteId, images: images.map(({ handle }) => handle!) }), images)
  await flush()
  const say = named('agent.say')[0]!
  assert.deepEqual(say.args, { run: AGENT, images: ['host-chart'], noteId: useAgentThreads.getState().notes[AGENT]![0]!.id }, 'pictures alone go without words')
  say.resolve({ queued: true })
  assert.deepEqual(await sending, { sent: true })
  assert.deepEqual(useAgentThreads.getState().notes[AGENT]![0]!.images, images)
  assert.deepEqual(revoked, [], 'the note still draws them')

  // A durable hobkin's page puts the images of a message that failed back in the empty tray.
  useAgentImages.getState().restore('hobkin:a1b2c3d4', images)
  assert.deepEqual(tray('hobkin:a1b2c3d4'), images)
  // With other images attached since, hobkin lets go of them instead.
  useAgentImages.getState().restore('hobkin:a1b2c3d4', [{ id: 'local:old', name: 'old.png', mimeType: 'image/png', preview: 'blob:old', handle: 'host-old' }])
  assert.deepEqual(tray('hobkin:a1b2c3d4'), images)
  assert.deepEqual(named('conversation.detach').at(-1)?.args, { id: 'host-old' })
})
