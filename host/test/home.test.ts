import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { APP_ORIGIN, DEV_UI_ORIGIN } from '../src/access.ts'
import { originsFor, parseArguments } from '../src/arguments.ts'
import { resolveHome } from '../src/home.ts'
import { whyNotOrigin } from '../src/main.ts'
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

test('--origin adds one page on this Mac, and a host on the real model is refused it by default', (t) => {
  assert.equal(parseArguments(['--dev', '--signed-out', '--origin', 'http://localhost:5187']).origin, 'http://localhost:5187')
  assert.equal(parseArguments(['--origin', 'http://127.0.0.1:5190']).origin, 'http://127.0.0.1:5190')
  assert.equal('origin' in parseArguments(['--dev', '--signed-out']), false, 'a run without it parses as before')

  // The pages the host talks to: its usual ones, then the one given. Without it the host keeps its own list.
  assert.deepEqual(originsFor(parseArguments(['--dev', '--origin', 'http://localhost:5187'])), [APP_ORIGIN, DEV_UI_ORIGIN, 'http://localhost:5187'])
  assert.deepEqual(originsFor(parseArguments(['--origin', 'http://localhost:5187'])), [APP_ORIGIN, 'http://localhost:5187'])
  assert.equal(originsFor(parseArguments(['--dev'])), undefined)

  assert.throws(() => parseArguments(['--origin']), /--origin needs a value/)
  const notLoopback = ['https://localhost:5187', 'http://localhost', 'http://localhost:80', 'http://example.invalid:5187', 'http://[::1]:5187', 'http://localhost:5187/', 'http://localhost:5187/setup', 'http://me@localhost:5187', 'http://LOCALHOST:5187', 'localhost:5187', 'tauri://localhost']
  for (const page of notLoopback) assert.throws(() => parseArguments(['--origin', page]), /--origin takes a page on this Mac/, page)

  // With --live it parses, in either order, and the host refuses it where it starts, since nothing names a throwaway home.
  const userHome = join(temporaryDirectory(t), 'user')
  for (const args of [['--live', '--origin', 'http://localhost:5187'], ['--origin', 'http://localhost:5187', '--live']]) {
    const options = parseArguments(args)
    assert.equal(options.live && options.origin, 'http://localhost:5187', args.join(' '))
    const home = resolveHome({ home: options.home, userHome, repoRoot: join(userHome, 'repo'), env: {} })
    assert.match(whyNotOrigin(options, home, {}, userHome) ?? '', /Name a new folder with --home/, args.join(' '))
  }
})

test('a live host talks to --origin only on a throwaway home and a throwaway Pi folder', (t) => {
  const base = temporaryDirectory(t)
  const userHome = join(base, 'user')
  const realHome = join(userHome, '.hobkin')
  const realPi = join(userHome, '.pi', 'agent')
  const throwaway = join(base, 'throwaway')
  const throwawayHome = join(throwaway, 'home')
  const throwawayPi = join(throwaway, 'pi')
  for (const folder of [realHome, realPi, throwawayPi]) mkdirSync(folder, { recursive: true })
  symlinkSync(realPi, join(throwaway, 'pi-link'))

  // The host as the lead starts it, with the home and Pi's folder each test names.
  const verdict = (home: string | null, env: NodeJS.ProcessEnv) => {
    const options = parseArguments([...(home ? ['--home', home] : []), '--dev', '--live', '--port', '5190', '--origin', 'http://localhost:5187'])
    return whyNotOrigin(options, resolveHome({ home: options.home, userHome, repoRoot: join(base, 'repo'), env: {} }), env, userHome)
  }
  const ownPi = { PI_CODING_AGENT_DIR: throwawayPi }

  assert.equal(verdict(throwawayHome, ownPi), null, 'a throwaway home and a throwaway Pi folder')

  assert.match(verdict(realHome, ownPi) ?? '', /is the real hobkin home/)
  assert.match(verdict(null, ownPi) ?? '', /Name a new folder with --home/)
  assert.match(verdict(throwawayHome, {}) ?? '', /Set PI_CODING_AGENT_DIR/)
  assert.match(verdict(throwawayHome, { PI_CODING_AGENT_DIR: '' }) ?? '', /Set PI_CODING_AGENT_DIR/, 'empty is unset, as Pi reads it')
  assert.match(verdict(throwawayHome, { PI_CODING_AGENT_DIR: join(throwaway, 'missing') }) ?? '', /which is not a folder/)
  assert.match(verdict(throwawayHome, { PI_CODING_AGENT_DIR: realPi }) ?? '', /Pi's real folder/)
  assert.match(verdict(throwawayHome, { PI_CODING_AGENT_DIR: join(throwaway, 'pi-link') }) ?? '', /Pi's real folder/, 'a link to it too')
  assert.match(verdict(throwawayHome, { PI_CODING_AGENT_DIR: '~/.pi/agent' }) ?? '', /Pi's real folder/, 'written the way Pi reads ~')

  // A scripted host talks to the page as before, on any home, and a live host without --origin is never asked.
  const scripted = parseArguments(['--dev', '--signed-out', '--origin', 'http://localhost:5187'])
  assert.equal(whyNotOrigin(scripted, resolveHome({ home: null, userHome, repoRoot: join(base, 'repo'), env: {} }), {}, userHome), null)
  assert.equal(whyNotOrigin(parseArguments(['--home', realHome, '--dev', '--live']), resolveHome({ home: realHome, userHome, env: {} }), {}, userHome), null)
})
