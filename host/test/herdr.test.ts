import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepToSurroundings } from '../src/owner.ts'

test('no home sees a Herdr pane, the real one live included', () => {
  for (const live of [false, true]) {
    for (const real of [false, true]) {
      const env: Record<string, string | undefined> = {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'p-test',
        HERDR_SOCKET_PATH: '/tmp/herdr.sock',
        PATH: '/usr/bin',
        HOBKIN_HOME: '/Users/someone/.hobkin',
      }

      keepToSurroundings({ root: '/tmp/home', live, real }, env)

      const named = `live ${live}, real ${real}`
      assert.deepEqual(Object.keys(env).filter((name) => name.startsWith('HERDR_')), [], named)
      assert.equal(env.PATH, '/usr/bin', named)
      // Only the real home, live, may reach the real home. Every other run is kept to its own.
      assert.equal(env.HOBKIN_HOME, live && real ? '/Users/someone/.hobkin' : '/tmp/home', named)
    }
  }
})
