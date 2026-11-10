import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEV_UI_ORIGIN } from '../src/access.ts'
import { afterTest, Client, hostFor } from './support.ts'

test('refuses a missing token and a foreign origin', async (t) => {
  const host = await hostFor(t)

  await assert.rejects(Client.connect(host, { token: '' }), /401/)
  await assert.rejects(Client.connect(host, { token: `${host.token}x` }), /401/)
  await assert.rejects(Client.connect(host, { origin: 'https://example.com' }), /403/)
  await assert.rejects(Client.connect(host, { origin: 'http://127.0.0.1:5188' }), /403/)
  await assert.rejects(Client.connect(host, { origin: null }), /403/, 'a connection that names no origin is refused too')

  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.until((view) => view.hello, 'hello')

  // Without --dev nothing hands the token out.
  const handshake = await fetch(`http://127.0.0.1:${host.port}/dev/handshake`, { headers: { origin: DEV_UI_ORIGIN } })
  assert.equal(handshake.status, 404)
})

test('in development the token is handed only to the development UI', async (t) => {
  const host = await hostFor(t, { dev: true, port: 0 })
  const ask = (origin?: string) => fetch(`http://127.0.0.1:${host.port}/dev/handshake`, { headers: origin ? { origin } : {} })

  assert.equal((await ask()).status, 403)
  assert.equal((await ask('https://example.com')).status, 403)

  const answer = await ask(DEV_UI_ORIGIN)
  assert.equal(answer.status, 200)
  assert.equal(answer.headers.get('access-control-allow-origin'), DEV_UI_ORIGIN)
  assert.deepEqual(await answer.json(), { url: `ws://127.0.0.1:${host.port}`, token: host.token })

  // The token it hands out still has to come with an allowed origin.
  await assert.rejects(Client.connect(host, { origin: 'https://example.com' }), /403/)
})
