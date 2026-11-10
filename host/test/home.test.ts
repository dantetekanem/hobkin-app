import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseArguments } from '../src/arguments.ts'
import { resolveHome } from '../src/home.ts'
import { runHostProcess, temporaryDirectory } from './support.ts'

test('refuses the real home without --home', async (t) => {
  const base = temporaryDirectory(t)
  const userHome = join(base, 'user')
  const repoRoot = join(base, 'repo')
  const realHome = join(userHome, '.hobkin')
  mkdirSync(realHome, { recursive: true })
  mkdirSync(repoRoot)
  const place = { userHome, repoRoot, env: {} }

  // With no --home the development home is used, whatever the environment says the real one is.
  assert.deepEqual(resolveHome(place), { root: join(repoRoot, '.dev-home'), real: false, notice: null })
  assert.equal(resolveHome({ ...place, env: { HOBKIN_HOME: realHome } }).root, join(repoRoot, '.dev-home'))
  const elsewhere = join(base, 'elsewhere')
  mkdirSync(elsewhere)
  assert.equal(resolveHome({ ...place, env: { HOBKIN_HOME: elsewhere } }).root, join(repoRoot, '.dev-home'))

  // A development home that is the real home under another name is refused.
  symlinkSync(realHome, join(repoRoot, '.dev-home'))
  assert.throws(() => resolveHome(place), /real hobkin home.*--home/s)

  // Naming the real home is allowed, and the host says which home it is using.
  const named = resolveHome({ ...place, home: realHome })
  assert.equal(named.root, realHome)
  assert.equal(named.real, true)
  assert.match(named.notice ?? '', /real hobkin home/)
  assert.equal(resolveHome({ ...place, home: elsewhere, env: { HOBKIN_HOME: elsewhere } }).real, true, 'HOBKIN_HOME names a real home too')
  assert.equal(resolveHome({ ...place, home: join(base, 'another') }).real, false)

  assert.deepEqual(parseArguments(['--home', realHome, '--live']), { home: realHome, live: true, dev: false, signedOut: false, port: null, help: false })
  assert.deepEqual(parseArguments(['--dev', '--signed-out', '--port', '0']), { home: null, live: false, dev: true, signedOut: true, port: 0, help: false })
  assert.throws(() => parseArguments(['--home']), /--home/)
  assert.throws(() => parseArguments(['--loud']), /Unknown option: --loud/)
  assert.throws(() => parseArguments(['--live', '--signed-out']), /scripted model/, 'a real sign-in is never scripted')

  // The whole host, started the way the shell starts it: the line is printed before anything opens.
  const host = await runHostProcess(t, ['--home', realHome], { HOME: userHome })
  assert.match(host.output(), /Using the real hobkin home at .*\.hobkin/)
})
