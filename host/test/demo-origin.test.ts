import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { APP_ORIGIN, DEV_UI_ORIGIN } from '../src/access.ts'
import { originsFor, parseArguments } from '../src/arguments.ts'
import { scriptedModelAccess } from '../src/scripted-access.ts'
import { afterTest, Client, hostFor } from './support.ts'

/** A second tab on the development UI. The usual host never talks to it, so it shows the demo host or nothing. */
const DEMO_PAGE = 'http://localhost:5187'

const ask = (host: { port: number }, origin: string) => fetch(`http://127.0.0.1:${host.port}/dev/handshake`, { headers: { origin } })

/** A scripted host with nobody signed in, on a temporary home, with the pages these arguments name, as `main.ts` passes them. */
const demoHost = (t: TestContext, args: string[]) =>
  hostFor(t, { dev: true, port: 0, origins: originsFor(parseArguments(['--dev', '--signed-out', ...args])), access: async () => scriptedModelAccess({ connected: [] }) })

test('a signed-out demo host hands its token to the extra page and takes its connection', async (t) => {
  const host = await demoHost(t, ['--origin', DEMO_PAGE])

  const answer = await ask(host, DEMO_PAGE)
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('access-control-allow-origin'), DEMO_PAGE)
  assert.deepEqual(await answer.json(), { url: `ws://127.0.0.1:${host.port}`, token: host.token })

  const client = await Client.connect(host, { origin: DEMO_PAGE })
  afterTest(t, () => client.close())
  const view = await client.until((now) => now.models && now.signIn, 'the sign-in state')
  assert.equal(view.signIn?.status, 'signed-out')
  assert.deepEqual(view.models?.models, [])

  // The usual development page still works beside it.
  assert.equal((await ask(host, DEV_UI_ORIGIN)).status, 200)
})

test('without --origin the same host turns that page away, as it always has', async (t) => {
  const host = await demoHost(t, [])

  assert.equal((await ask(host, DEMO_PAGE)).status, 403)
  await assert.rejects(Client.connect(host, { origin: DEMO_PAGE }), /403/)

  const answer = await ask(host, DEV_UI_ORIGIN)
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('access-control-allow-origin'), DEV_UI_ORIGIN)
})

test('the handshake answers only pages served on this Mac, whatever the host was told to accept', async (t) => {
  const elsewhere = ['https://example.invalid', 'http://example.invalid:5187', 'https://localhost:5187']
  const host = await hostFor(t, { dev: true, port: 0, origins: [APP_ORIGIN, DEV_UI_ORIGIN, ...elsewhere] })

  for (const origin of [APP_ORIGIN, ...elsewhere]) assert.equal((await ask(host, origin)).status, 403, origin)
  assert.equal((await ask(host, DEV_UI_ORIGIN)).status, 200)
})
