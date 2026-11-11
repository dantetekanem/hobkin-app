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
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
const previousFileReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
  result: string | null = null
  onload?: () => void
  readAsDataURL() { this.result = 'data:image/png;base64,aW1hZ2U='; this.onload?.() }
} })

after(() => {
  if (previousFileReader) Object.defineProperty(globalThis, 'FileReader', previousFileReader)
  else Reflect.deleteProperty(globalThis, 'FileReader')
  Reflect.deleteProperty(globalThis, 'window')
  aliasHooks.deregister()
})
const { canSendDraft, useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyDraft } = await import('../src/features/chat/draft.ts')

type PendingCommand = { name: CommandName; args: unknown; resolve(value: unknown): void; reject(error: Error): void }
const file = () => new File(['image'], 'chart.png', { type: 'image/png' })
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function prepare(t: TestContext) {
  const calls: PendingCommand[] = []
  const command = <Name extends CommandName>(name: Name, args: CommandArgs<Name>) =>
    new Promise<CommandResults[Name]>((resolve, reject) => calls.push({ name, args, resolve, reject }))
  t.mock.method(HostConnection.prototype, 'command', command)
  const owner = { state: 'live' as const, limits: { images: 4, imageBytes: 1_000_000 } }
  hostStore.setState({ ...initialHostState, link: 'open', home: '/isolated', owner }, true)
  useChat.setState({ draft: emptyDraft, problem: null })
  let preview = 0
  t.mock.method(URL, 'createObjectURL', () => `blob:upload-${++preview}`)
  const revoked: string[] = []
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url) })
  return { calls, revoked }
}

function uploadCall(calls: PendingCommand[]) {
  const call = calls.filter(({ name }) => name === 'conversation.attach').at(-1)
  assert.ok(call, 'the attachment upload reached the fake host')
  return call
}

async function startUpload(calls: PendingCommand[]) {
  useChat.getState().attach([file()])
  await flush()
  return uploadCall(calls)
}

test('opening another kept draft preserves and can send an in-flight image', async (t) => {
  const { calls } = prepare(t)
  useChat.getState().change({ type: 'typed', text: 'Other draft' })
  useChat.getState().change({ type: 'editor-toggled' })
  useChat.getState().change({ type: 'leave-kept', at: 1, id: 'other' })
  useChat.getState().change({ type: 'typed', text: 'Draft with image' })
  const upload = await startUpload(calls)
  useChat.getState().change({ type: 'draft-opened', id: 'other', at: 2, keepAs: 'upload' })

  upload.resolve({ id: 'host-image' })
  await flush()
  assert.equal(useChat.getState().draft.text, 'Other draft')
  assert.equal(useChat.getState().draft.kept[0]?.attachments[0]?.handle, 'host-image')
  assert.equal(calls.filter(({ name }) => name === 'conversation.detach').length, 0, 'an upload still owned by a kept draft is not detached')
  useChat.getState().change({ type: 'draft-opened', id: 'upload', at: 3, keepAs: 'other' })
  assert.equal(canSendDraft(useChat.getState().draft), true)
  const sending = useChat.getState().send()
  assert.deepEqual(calls.at(-1)?.args, { text: 'Draft with image', images: ['host-image'] })
  calls.at(-1)!.resolve({ id: 'message', queued: false })
  assert.equal(await sending, true)
})

test('a failed kept upload removes its pending image, preserves its text, and reports the error', async (t) => {
  const { calls, revoked } = prepare(t)
  useChat.getState().change({ type: 'typed', text: 'Keep the words' })
  const upload = await startUpload(calls)
  useChat.getState().change({ type: 'editor-toggled' })
  useChat.getState().change({ type: 'leave-kept', at: 10, id: 'draft-1' })

  upload.reject(new Error('Host upload failed'))
  await flush()
  assert.deepEqual(useChat.getState().draft.kept[0]?.attachments, [])
  assert.equal(useChat.getState().draft.kept[0]?.text, 'Keep the words')
  assert.match(useChat.getState().problem ?? '', /Host upload failed/)
  assert.deepEqual(revoked, ['blob:upload-1'])
})

test('successful uploads removed or discarded while pending are detached from the host', async (t) => {
  const { calls } = prepare(t)
  const removed = await startUpload(calls)
  useChat.getState().detach(useChat.getState().draft.attachments[0]!.id)
  removed.resolve({ id: 'removed-image' })
  await flush()
  assert.equal(calls.at(-1)?.name, 'conversation.detach')
  assert.deepEqual(calls.at(-1)?.args, { id: 'removed-image' })

  const discarded = await startUpload(calls)
  useChat.getState().change({ type: 'editor-toggled' })
  useChat.getState().change({ type: 'editor-escaped', at: 20, id: 'discarded' })
  useChat.getState().change({ type: 'leave-discarded' })
  discarded.resolve({ id: 'discarded-image' })
  await flush()
  assert.equal(calls.at(-1)?.name, 'conversation.detach')
  assert.deepEqual(calls.at(-1)?.args, { id: 'discarded-image' })
})
