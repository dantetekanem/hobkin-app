import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { Unavailable } from '../src/commands.ts'
import type { PiRun } from '../src/pi/install.ts'
import type { NodeFetch } from '../src/pi/node.ts'
import { addOwnGh, GH_VERSION, ghBin, ghBuild, ghFolder, installGh } from '../src/setup/gh.ts'
import { temporaryDirectory } from './support.ts'

const VERSION = '2.105.0'
const CARRIED = '/App.invalid/Contents/Resources/node/bin'
const RELEASE = `https://github.com/cli/cli/releases/download/v${VERSION}/`
const FOLDER = `gh_${VERSION}_macOS_arm64`
const FILE = `${FOLDER}.zip`
const ARCHIVE = Buffer.from('not a real zip, only bytes to check')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const SUMS = [`${'0'.repeat(64)}  gh_${VERSION}_linux_amd64.tar.gz`, `${sha(ARCHIVE)}  ${FILE}`, `${'1'.repeat(64)}  gh_${VERSION}_macOS_amd64.zip`, ''].join('\n')
const GITHUB = { [`${RELEASE}gh_${VERSION}_checksums.txt`]: SUMS, [`${RELEASE}${FILE}`]: ARCHIVE }
const onAMac = { version: VERSION, platform: 'darwin', arch: 'arm64' } as const

/** Serves GitHub's release from memory, and writes down every address asked for. Nothing is downloaded. */
function fakeFetch(files: Record<string, string | Buffer | Error | number>, asked: string[] = []): NodeFetch {
  return async (url) => {
    asked.push(url)
    const served = files[url]
    if (served instanceof Error) throw served
    if (typeof served === 'number' || served === undefined) return new Response('Not Found', { status: typeof served === 'number' ? served : 404 })
    return new Response(typeof served === 'string' ? served : new Uint8Array(served))
  }
}

interface Unzip { program: string; args: string[] }

/** Stands in for unzip: it writes the release's folder with its bin/gh where `-d` says, or fails. Nothing is ever unpacked. */
function fakeUnzip(calls: Unzip[] = [], { fail = false, gh = true } = {}): PiRun {
  return (file, args, _options, done) => {
    calls.push({ program: file, args: [...args] })
    if (fail) return done(Object.assign(Error('Command failed'), { code: 9 }), '', '  End-of-central-directory signature not found.\n')
    const into = args[args.indexOf('-d') + 1]!
    mkdirSync(join(into, FOLDER, 'bin'), { recursive: true })
    if (gh) writeFileSync(join(into, FOLDER, 'bin', 'gh'), '#!/bin/sh\n', { mode: 0o755 })
    done(null, '', '')
  }
}

const clientFolder = (root: string) => (existsSync(join(root, 'client')) ? readdirSync(join(root, 'client')).sort() : [])

async function failureOf(install: Promise<void>): Promise<Error> {
  const error = await install.then(() => null, (thrown: unknown) => thrown as Error)
  assert.ok(error instanceof Error, 'the install failed')
  return error
}

test("hobkin's gh is GitHub's macOS build of the gh it was tried with, for this Mac's chip, from the cli/cli release", () => {
  assert.deepEqual(ghBuild(VERSION, 'darwin', 'arm64'), {
    version: VERSION,
    file: FILE,
    folder: FOLDER,
    url: `${RELEASE}${FILE}`,
    sums: `${RELEASE}gh_${VERSION}_checksums.txt`,
  })
  assert.equal(ghBuild(VERSION, 'darwin', 'x64')?.url, `${RELEASE}gh_${VERSION}_macOS_amd64.zip`)
  assert.equal(ghBuild(VERSION, 'linux', 'x64'), null)
  assert.equal(ghBuild(VERSION, 'darwin', 'ia32'), null)
  assert.equal(ghBuild(undefined, 'darwin', 'arm64')?.version, GH_VERSION)
  assert.equal(ghFolder('/h.invalid'), '/h.invalid/client/gh')
  assert.equal(ghBin('/h.invalid'), '/h.invalid/client/gh/bin')
})

test('a download that matches its checksum is unpacked beside its place, moved in, and put on the PATH after the folders there', async (t) => {
  const root = temporaryDirectory(t)
  const asked: string[] = []
  const unzipped: Unzip[] = []
  const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', CARRIED].join(delimiter) }

  await installGh({ root, ...onAMac, fetch: fakeFetch(GITHUB, asked), run: fakeUnzip(unzipped), env, carried: CARRIED })

  assert.deepEqual(asked, [`${RELEASE}gh_${VERSION}_checksums.txt`, `${RELEASE}${FILE}`], 'the checksums first, then the build')
  assert.equal(unzipped.length, 1)
  const [quiet, archive, d, into] = unzipped[0]!.args
  assert.equal(unzipped[0]!.program, '/usr/bin/unzip')
  assert.deepEqual([quiet, d], ['-q', '-d'])
  assert.ok(archive!.startsWith(join(root, 'client')) && !archive!.startsWith(`${ghFolder(root)}/`), 'the archive waits beside the place')
  assert.ok(into!.startsWith(join(root, 'client')) && into !== ghFolder(root), 'unpacked beside the place first')

  assert.ok(existsSync(join(ghBin(root), 'gh')))
  assert.deepEqual(clientFolder(root), ['gh'], 'nothing is left beside it')
  // A gh the user has, earlier on the PATH, keeps coming first.
  assert.equal(env.PATH, ['/usr/bin', ghBin(root), CARRIED].join(delimiter))

  // A second install replaces the first.
  writeFileSync(join(ghFolder(root), 'from-before'), '')
  await installGh({ root, ...onAMac, fetch: fakeFetch(GITHUB), run: fakeUnzip(), env, carried: CARRIED })
  assert.equal(existsSync(join(ghFolder(root), 'from-before')), false)
  assert.deepEqual(clientFolder(root), ['gh'])
  assert.equal(env.PATH, ['/usr/bin', ghBin(root), CARRIED].join(delimiter), 'the folder goes on once')
})

test('a download that does not match its checksum, or is not listed, installs nothing and says so', async (t) => {
  const root = temporaryDirectory(t)
  const unzipped: Unzip[] = []
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

  const tampered = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch({ ...GITHUB, [`${RELEASE}${FILE}`]: Buffer.from('something else') }), run: fakeUnzip(unzipped), env, carried: CARRIED }))
  assert.match(tampered.message, /did not match its checksum/)
  assert.match(tampered.message, /nothing was installed/)

  const unlisted = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch({ ...GITHUB, [`${RELEASE}gh_${VERSION}_checksums.txt`]: `${'2'.repeat(64)}  other.zip\n` }), run: fakeUnzip(unzipped), env, carried: CARRIED }))
  assert.match(unlisted.message, /list no gh_2\.105\.0_macOS_arm64\.zip/)

  assert.deepEqual(unzipped, [], 'nothing is unpacked')
  assert.deepEqual(clientFolder(root), [])
  assert.equal(env.PATH, '/usr/bin')
})

test('a failed unpack, or one without gh in it, leaves nothing half-made and keeps a gh installed before', async (t) => {
  const root = temporaryDirectory(t)
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

  const failed = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch(GITHUB), run: fakeUnzip([], { fail: true }), env, carried: CARRIED }))
  assert.match(failed.message, /^The gh download could not be unpacked, so nothing was installed\./)
  assert.match(failed.message, /End-of-central-directory/)
  assert.deepEqual(clientFolder(root), [])

  mkdirSync(ghBin(root), { recursive: true })
  writeFileSync(join(ghFolder(root), 'from-before'), '')
  const empty = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch(GITHUB), run: fakeUnzip([], { gh: false }), env, carried: CARRIED }))
  assert.match(empty.message, /no bin\/gh/)
  assert.deepEqual(clientFolder(root), ['gh'])
  assert.ok(existsSync(join(ghFolder(root), 'from-before')), 'the gh from before is still there')
  assert.equal(env.PATH, '/usr/bin')
})

test('no network, or GitHub not answering as it should, is said in plain words, with no secret in them', async (t) => {
  const root = temporaryDirectory(t)
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
  const offline = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' }) })

  const noNetwork = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch({ [`${RELEASE}gh_${VERSION}_checksums.txt`]: offline }), run: fakeUnzip(), env, carried: CARRIED }))
  assert.match(noNetwork.message, /^Nothing could be downloaded from GitHub, so nothing was installed\./)
  assert.match(noNetwork.message, /offline/)

  const missing = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch({ ...GITHUB, [`${RELEASE}${FILE}`]: 404 }), run: fakeUnzip(), env, carried: CARRIED }))
  assert.match(missing.message, /GitHub answered 404/)

  const leaky = Object.assign(new TypeError('fetch failed'), { cause: Error('proxy https://someone:hunter2secretvalue@proxy.invalid refused') })
  const scrubbed = await failureOf(installGh({ root, ...onAMac, fetch: fakeFetch({ [`${RELEASE}gh_${VERSION}_checksums.txt`]: leaky }), run: fakeUnzip(), env, carried: CARRIED }))
  assert.doesNotMatch(scrubbed.message, /hunter2secretvalue/)
  assert.deepEqual(clientFolder(root), [])
})

test("only a Mac gets a gh of hobkin's own, and at a live host's start it goes on the PATH when it is there", async (t) => {
  const root = temporaryDirectory(t)
  const asked: string[] = []
  const refused = await failureOf(installGh({ root, version: VERSION, platform: 'linux', arch: 'x64', fetch: fakeFetch(GITHUB, asked), run: fakeUnzip(), env: {}, carried: CARRIED }))
  assert.ok(refused instanceof Unavailable)
  assert.deepEqual(asked, [])

  const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', CARRIED].join(delimiter) }
  assert.equal(addOwnGh(root, env, CARRIED), false)
  assert.equal(env.PATH, ['/usr/bin', CARRIED].join(delimiter))
  mkdirSync(ghBin(root), { recursive: true })
  writeFileSync(join(ghBin(root), 'gh'), '#!/bin/sh\n', { mode: 0o755 })
  assert.equal(addOwnGh(root, env, CARRIED), true)
  assert.equal(env.PATH, ['/usr/bin', ghBin(root), CARRIED].join(delimiter))
})
