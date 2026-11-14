import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { CommandName } from '#shared/commands/registry.ts'
import type { SkillEntry } from '#shared/pi-resources/wire.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { initialHostState, type HostState } from '../src/lib/host/state.ts'

const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
after(() => {
  Reflect.deleteProperty(globalThis, 'window')
  aliasHooks.deregister()
})
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyDraft } = await import('../src/features/chat/draft.ts')
const { askForChange, changeRequestText } = await import('../src/features/skills/ask.ts')

type PendingCommand = { name: CommandName; args: unknown; resolve(value: unknown): void; reject(error: Error): void }

const alpha: Pick<SkillEntry, 'name' | 'file' | 'package'> = { name: 'alpha', file: '~/skills/alpha/SKILL.md', package: null }

/** A fake host that holds every command, and a composer with an unfinished draft. */
function prepare(t: TestContext, link: HostState['link'] = 'open') {
  const calls: PendingCommand[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: CommandName, args: unknown) => new Promise((resolve, reject) => calls.push({ name, args, resolve, reject })))
  hostStore.setState({ ...initialHostState, link, home: '/isolated' }, true)
  useChat.setState({ draft: emptyDraft, problem: null })
  useChat.getState().change({ type: 'typed', text: 'My unfinished draft' })
  return { calls, draft: useChat.getState().draft }
}

test('a change request names the skill and its file, and keeps the draft', async (t) => {
  const { calls, draft } = prepare(t)
  const message = 'Change the skill “alpha” (~/skills/alpha/SKILL.md): ask before it rewrites a whole post'

  const asked = askForChange(alpha, '  ask before it rewrites a whole post  ', useChat, hostStore)

  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [['conversation.send', { text: message }]])
  assert.equal(useChat.getState().outbox.entries.at(-1)?.text, message, 'it shows in the conversation as the message sent')
  calls[0]!.resolve({ id: 'sent', queued: false })
  assert.deepEqual(await asked, { sent: true, note: 'Sent to hobkin. Its answer comes in the chat.' })
  assert.equal(useChat.getState().draft, draft)
})

test("a package's skill names the package it comes from", () => {
  const gamma = { name: 'gamma', file: '~/.pi/agent/npm/node_modules/pi-tools/skills/gamma/SKILL.md', package: { source: 'npm:pi-tools', name: 'pi-tools' } }
  assert.equal(changeRequestText(gamma, 'shorter'), 'Change the skill “gamma” from the Pi package pi-tools (~/.pi/agent/npm/node_modules/pi-tools/skills/gamma/SKILL.md): shorter')
})

test('nothing is sent without a connected host or without words', async (t) => {
  const { calls, draft } = prepare(t, 'lost')

  assert.deepEqual(await askForChange(alpha, 'shorter', useChat, hostStore), { sent: false, note: 'Not sent. Connect to hobkin first.' })
  hostStore.setState({ link: 'open' })
  assert.equal((await askForChange(alpha, '   ', useChat, hostStore)).sent, false)

  assert.deepEqual(calls, [])
  assert.equal(useChat.getState().draft, draft)
})

test('a request hobkin refuses says why and keeps the draft', async (t) => {
  const { calls, draft } = prepare(t)

  const asked = askForChange(alpha, 'shorter', useChat, hostStore)
  calls[0]!.reject(new Error('hobkin is starting.'))

  const { sent, note } = await asked
  assert.equal(sent, false)
  assert.match(note, /hobkin is starting/)
  assert.equal(useChat.getState().draft, draft)
})
