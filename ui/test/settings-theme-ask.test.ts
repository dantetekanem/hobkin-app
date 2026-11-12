import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { CommandName } from '#shared/commands/registry.ts'
import { DARK_PALETTE, migrateSettings } from '../src/features/settings/rules.ts'
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
const { useSettings } = await import('../src/features/settings/store.ts')

type PendingCommand = { name: CommandName; args: unknown; resolve(value: unknown): void; reject(error: Error): void }

/** A fake host that holds every command, and a composer with an unfinished draft. */
function prepare(t: TestContext, link: HostState['link'] = 'open') {
  const calls: PendingCommand[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: CommandName, args: unknown) =>
    new Promise((resolve, reject) => calls.push({ name, args, resolve, reject })))
  hostStore.setState({ ...initialHostState, link, home: '/isolated' }, true)
  useChat.setState({ draft: emptyDraft, problem: null })
  useChat.getState().change({ type: 'typed', text: 'My unfinished draft' })
  useSettings.setState({ themeSending: false, themeNote: null })
  return { calls, draft: useChat.getState().draft }
}

test('Custom asks main hobkin to build the theme as a chat message, leaving the draft alone', async (t) => {
  const { calls, draft } = prepare(t)
  const asked = useSettings.getState().ask('  a quiet forest  ', useChat, hostStore)
  assert.deepEqual(calls.map(({ name, args }) => [name, args]), [['conversation.send', { text: 'Build a theme: a quiet forest' }]])
  assert.equal(useChat.getState().outbox.entries.at(-1)?.text, 'Build a theme: a quiet forest', 'it shows in the conversation as the user’s message')
  assert.equal(await useSettings.getState().ask('again', useChat, hostStore), false, 'one request at a time')
  assert.equal(calls.length, 1)
  calls[0]!.resolve({ id: 'sent', queued: false })
  assert.equal(await asked, true)
  assert.equal(useChat.getState().draft, draft)
  assert.equal(useSettings.getState().themeSending, false)
})

test('nothing is sent without a connected host or without words', async (t) => {
  const { calls, draft } = prepare(t, 'lost')
  assert.equal(await useSettings.getState().ask('forest', useChat, hostStore), false)
  assert.match(useSettings.getState().themeNote ?? '', /Connect to hobkin first/)
  hostStore.setState({ link: 'open' })
  assert.equal(await useSettings.getState().ask('   ', useChat, hostStore), false)
  assert.deepEqual(calls, [])
  assert.equal(useChat.getState().draft, draft)
})

test('a request hobkin refuses says why and keeps the draft', async (t) => {
  const { calls, draft } = prepare(t)
  const asked = useSettings.getState().ask('forest', useChat, hostStore)
  calls[0]!.reject(new Error('hobkin is starting.'))
  assert.equal(await asked, false)
  assert.match(useSettings.getState().themeNote ?? '', /hobkin is starting/)
  assert.equal(useChat.getState().draft, draft)
  assert.equal(useSettings.getState().themeSending, false)
})

test('a theme ask saved by an older version is dropped, and its colors stay', () => {
  const saved = { movement: 'still', palette: DARK_PALETTE, customTheme: true, backgroundOpacity: 0.5 }
  const ask = { text: 'forest', askedAt: 1, appliedAt: 2, name: 'Forest' }
  assert.deepEqual(migrateSettings({ ...saved, request: ask }), { ...saved, appearanceId: 0 })
})
