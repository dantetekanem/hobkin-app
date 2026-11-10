import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEV_UI_ORIGIN } from '../../host/src/access.ts'
import { startHost, type RunningHost } from '../../host/src/host.ts'
import { buildConversation } from '../src/features/chat/conversation.ts'
import { HostConnection, type HostAddress, type SocketLike } from '../src/lib/host/connection.ts'
import { applyHostMessage, applyLink, initialHostState, isLive, type HostState } from '../src/lib/host/state.ts'

/**
 * The UI's own connection and state, against a real host with real sockets and timers.
 * Only the browser is missing: its WebSocket names the page's origin by itself, and Node's has to be told.
 */
function browserSide(hostNow: () => RunningHost | null) {
  let state: HostState = initialHostState
  const watchers = new Set<() => void>()
  const changed = () => {
    for (const watcher of [...watchers]) watcher()
  }
  const connection = new HostConnection({
    // The development handshake, as `discover.ts` does it in the browser.
    discover: async () => {
      const host = hostNow()
      if (!host) return null
      const answer = await fetch(`http://127.0.0.1:${host.port}/dev/handshake`, { headers: { origin: DEV_UI_ORIGIN } })
      return answer.ok ? ((await answer.json()) as HostAddress) : null
    },
    createSocket: (url) => new WebSocket(url, { headers: { origin: DEV_UI_ORIGIN } } as unknown as string[]) as unknown as SocketLike,
    onMessage: (message) => {
      state = applyHostMessage(state, message)
      changed()
    },
    onLink: (link) => {
      state = applyLink(state, link)
      changed()
    },
  })
  const until = (passes: (state: HostState) => unknown, what: string) =>
    new Promise<HostState>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Timed out waiting for ${what}. Link ${state.link}, ${state.messages.length} messages.`)), 10000)
      const look = () => {
        if (!passes(state)) return
        clearTimeout(timer)
        watchers.delete(look)
        resolve(state)
      }
      watchers.add(look)
      look()
    })
  const shown = () =>
    buildConversation({ messages: state.messages, live: state.live, now: Date.now() }).flatMap((day) =>
      day.entries.map((entry) => (entry.kind === 'message' ? `${entry.role}${entry.state ? ` (${entry.state})` : ''}: ${entry.text}` : entry.text)),
    )
  return { connection, until, shown, state: () => state }
}

test('the UI talks to a real host, and finds it again after a restart', { timeout: 30000 }, async (t) => {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-client-ui-'))), 'home')
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const scripted = {
    reply: async ({ prompt }: { prompt: string }) => {
      if (prompt.endsWith('Take your time')) await held
      return { text: `You said: ${prompt.split('\n').at(-1)}` }
    },
  }

  let host: RunningHost | null = await startHost({ root, dev: true, port: 0, scripted })
  let before: RunningHost | null = null
  const ui = browserSide(() => host)
  // In this order: the home is deleted only once the host that owns it has closed. A turn still held would keep
  // the host from closing, and the test process alive after a failure, so it is let go first.
  t.after(async () => {
    release()
    ui.connection.stop()
    await Promise.all([before?.close(), host?.close()])
    rmSync(join(root, '..'), { recursive: true, force: true })
  })
  ui.connection.start()

  await ui.until(isLive, 'a live host')
  assert.equal(ui.state().home, root)
  assert.deepEqual(ui.shown(), [])

  // A command goes out, and the reply comes back first as live text and then as hobkin's stored message.
  assert.deepEqual(Object.keys(await ui.connection.command('conversation.send', { text: 'Hello' })).sort(), ['id', 'queued'])
  await ui.until((state) => state.snapshot.busy === false && state.messages.length === 2, 'the stored reply')
  assert.deepEqual(ui.shown(), ['user: Hello', 'assistant: You said: Hello'])
  assert.equal(ui.state().live, null)

  // A turn is under way when the host goes down.
  await ui.connection.command('conversation.send', { text: 'Take your time' })
  await ui.until((state) => state.snapshot.busy === true, 'a turn under way')
  before = host
  host = null
  await before.close()
  await ui.until((state) => state.link === 'lost', 'the loss to show')
  assert.equal(ui.state().messages.length >= 2, true, 'what was on screen stays while the host is away')
  await assert.rejects(ui.connection.command('conversation.send', { text: 'Anyone?' }), /Disconnected/)

  // A new host, on another port with another token. Nobody tells the UI: it looks, finds it and takes its state.
  release()
  const lostAt = ui.state().epoch
  host = await startHost({ root, dev: true, port: 0, scripted })
  assert.notEqual(host.token, before.token)
  const back = await ui.until((state) => isLive(state) && state.snapshot.busy === false && state.epoch > lostAt, 'the UI to be live again')
  assert.equal(back.link, 'open')
  assert.deepEqual(ui.shown().slice(0, 3), ['user: Hello', 'assistant: You said: Hello', 'user: Take your time'])

  await ui.connection.command('conversation.send', { text: 'Back again' })
  await ui.until((state) => state.snapshot.busy === false && state.messages.at(-1)?.content === 'You said: Back again', 'a reply from the new host')
})
