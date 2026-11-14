import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { Unavailable } from '../src/commands.ts'
import type { PiRun } from '../src/pi/install.ts'
import { addOwnNode, checksumOf, installNode, nodeBin, nodeBuild, nodeFolder, type NodeFetch } from '../src/pi/node.ts'
import { temporaryDirectory } from './support.ts'

const VERSION = '26.1.0'
const CARRIED = '/App.invalid/Contents/Resources/node/bin'
const FILE = `node-v${VERSION}-darwin-arm64.tar.gz`
const FOLDER = `https://nodejs.org/dist/v${VERSION}/`
const ARCHIVE = Buffer.from('not a real archive, only bytes to check')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const SUMS = [`${'0'.repeat(64)}  node-v${VERSION}-darwin-x64.tar.gz`, `${sha(ARCHIVE)}  ${FILE}`, `${'1'.repeat(64)}  node-v${VERSION}.tar.gz`, ''].join('\n')

/** Serves nodejs.org's folder from memory, and writes down every address asked for. Nothing is downloaded. */
function fakeFetch(files: Record<string, string | Buffer | Error | number>, asked: string[] = []): NodeFetch {
  return async (url) => {
    asked.push(url)
    const served = files[url]
    if (served instanceof Error) throw served
    if (typeof served === 'number' || served === undefined) return new Response('Not Found', { status: typeof served === 'number' ? served : 404 })
    return new Response(typeof served === 'string' ? served : new Uint8Array(served))
  }
}

const NODEJS = { [`${FOLDER}SHASUMS256.txt`]: SUMS, [`${FOLDER}${FILE}`]: ARCHIVE }

interface Unpack { program: string; args: string[] }

/** Stands in for tar: it writes a Node's bin folder where `-C` says, or fails. Nothing is ever unpacked. */
function fakeTar(calls: Unpack[] = [], { fail = false, npm = true } = {}): PiRun {
  return (file, args, _options, done) => {
    calls.push({ program: file, args: [...args] })
    if (fail) return done(Object.assign(Error('Command failed'), { code: 1 }), '', 'tar: Error opening archive: Unrecognized archive format\n')
    const into = args[args.indexOf('-C') + 1]!
    mkdirSync(join(into, 'bin'), { recursive: true })
    writeFileSync(join(into, 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 })
    if (npm) writeFileSync(join(into, 'bin', 'npm'), '#!/bin/sh\n', { mode: 0o755 })
    done(null, '', '')
  }
}

const onAMac = { version: VERSION, platform: 'darwin', arch: 'arm64' } as const
/** What the home's client folder holds, so nothing half-made is missed. */
const clientFolder = (root: string) => (existsSync(join(root, 'client')) ? readdirSync(join(root, 'client')).sort() : [])

test("hobkin's Node is the official build of the host's own Node version, for this Mac's chip", () => {
  assert.deepEqual(nodeBuild('22.19.0', 'darwin', 'arm64'), {
    version: '22.19.0',
    file: 'node-v22.19.0-darwin-arm64.tar.gz',
    url: 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-darwin-arm64.tar.gz',
    sums: 'https://nodejs.org/dist/v22.19.0/SHASUMS256.txt',
  })
  assert.equal(nodeBuild('22.19.0', 'darwin', 'x64')?.url, 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-darwin-x64.tar.gz')
  assert.equal(nodeBuild(VERSION, 'linux', 'x64'), null)
  assert.equal(nodeBuild(VERSION, 'darwin', 'ia32'), null)
  assert.equal(nodeBuild(undefined, 'darwin', 'arm64')?.version, process.versions.node, "the host's own version when none is named")
  assert.equal(nodeFolder('/h.invalid'), '/h.invalid/client/node')
  assert.equal(nodeBin('/h.invalid'), '/h.invalid/client/node/bin')
})

test("a file's checksum is the one on its own line of SHASUMS256.txt, and no line is no checksum", () => {
  assert.equal(checksumOf(SUMS, FILE), sha(ARCHIVE))
  assert.equal(checksumOf(SUMS, `node-v${VERSION}-darwin-arm64.tar.xz`), null)
  assert.equal(checksumOf('', FILE), null)
})

test('a download that matches its checksum is unpacked beside its place, moved in, and put on the PATH before the carried Node', async (t) => {
  const root = temporaryDirectory(t)
  const asked: string[] = []
  const unpacked: Unpack[] = []
  const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', CARRIED].join(delimiter) }

  await installNode({ root, ...onAMac, fetch: fakeFetch(NODEJS, asked), run: fakeTar(unpacked), env, carried: CARRIED })

  assert.deepEqual(asked, [`${FOLDER}SHASUMS256.txt`, `${FOLDER}${FILE}`], 'the checksums first, then the build')
  assert.equal(unpacked.length, 1)
  assert.equal(unpacked[0]!.program, '/usr/bin/tar')
  const [x, archive, c, into, strip, one] = unpacked[0]!.args
  assert.deepEqual([x, c, strip, one], ['-xzf', '-C', '--strip-components', '1'])
  assert.ok(archive!.startsWith(join(root, 'client')) && !archive!.startsWith(nodeFolder(root) + '/'), 'the archive waits beside the place, not in it')
  assert.ok(into!.startsWith(join(root, 'client')) && into !== nodeFolder(root), 'unpacked beside the place first')

  assert.ok(existsSync(join(nodeBin(root), 'node')))
  assert.ok(existsSync(join(nodeBin(root), 'npm')))
  assert.deepEqual(clientFolder(root), ['node'], 'nothing is left beside it')
  assert.equal(env.PATH, ['/usr/bin', nodeBin(root), CARRIED].join(delimiter))
})

test('a second install replaces the first', async (t) => {
  const root = temporaryDirectory(t)
  mkdirSync(join(nodeFolder(root), 'bin'), { recursive: true })
  writeFileSync(join(nodeFolder(root), 'from-before'), '')

  await installNode({ root, ...onAMac, fetch: fakeFetch(NODEJS), run: fakeTar(), env: { PATH: '' }, carried: CARRIED })

  assert.equal(existsSync(join(nodeFolder(root), 'from-before')), false)
  assert.ok(existsSync(join(nodeBin(root), 'npm')))
  assert.deepEqual(clientFolder(root), ['node'])
})

/** The install's error, which a failed install must give. */
async function failureOf(install: Promise<void>): Promise<Error> {
  const error = await install.then(() => null, (thrown: unknown) => thrown as Error)
  assert.ok(error instanceof Error, 'the install failed')
  return error
}

test('a download that does not match its checksum installs nothing and says so', async (t) => {
  const root = temporaryDirectory(t)
  const unpacked: Unpack[] = []
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
  const tampered = { ...NODEJS, [`${FOLDER}${FILE}`]: Buffer.from('something else') }

  const error = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch(tampered), run: fakeTar(unpacked), env, carried: CARRIED }))

  assert.match(error.message, /did not match its checksum/)
  assert.match(error.message, /nothing was installed/)
  assert.deepEqual(unpacked, [], 'nothing is unpacked')
  assert.deepEqual(clientFolder(root), [])
  assert.equal(env.PATH, '/usr/bin')

  const unlisted = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch({ ...NODEJS, [`${FOLDER}SHASUMS256.txt`]: 'abc  other.tar.gz\n' }), run: fakeTar(unpacked), env, carried: CARRIED }))
  assert.match(unlisted.message, new RegExp(`no checksum for ${FILE.replaceAll('.', '\\.')}`))
  assert.deepEqual(unpacked, [])
})

test('a failed unpack, or one without npm, leaves nothing half-made and keeps a Node installed before', async (t) => {
  const root = temporaryDirectory(t)
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

  const failed = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch(NODEJS), run: fakeTar([], { fail: true }), env, carried: CARRIED }))
  assert.match(failed.message, /^The Node download could not be unpacked, so nothing was installed\./)
  assert.match(failed.message, /Unrecognized archive format/)
  assert.deepEqual(clientFolder(root), [])

  mkdirSync(join(nodeFolder(root), 'bin'), { recursive: true })
  writeFileSync(join(nodeFolder(root), 'from-before'), '')
  const empty = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch(NODEJS), run: fakeTar([], { npm: false }), env, carried: CARRIED }))
  assert.match(empty.message, /no npm/)
  assert.deepEqual(clientFolder(root), ['node'])
  assert.ok(existsSync(join(nodeFolder(root), 'from-before')), 'the Node from before is still there')
  assert.equal(env.PATH, '/usr/bin')
})

test('no network, or nodejs.org not answering as it should, is said in plain words, with no secret in them', async (t) => {
  const root = temporaryDirectory(t)
  const offline = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(Error('getaddrinfo ENOTFOUND nodejs.org'), { code: 'ENOTFOUND' }) })
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

  const noNetwork = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch({ [`${FOLDER}SHASUMS256.txt`]: offline }), run: fakeTar(), env, carried: CARRIED }))
  assert.match(noNetwork.message, /^Node could not be downloaded from nodejs\.org, so nothing was installed\./)
  assert.match(noNetwork.message, /offline/)
  assert.match(noNetwork.message, /ENOTFOUND/)

  const missing = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch({ [`${FOLDER}SHASUMS256.txt`]: SUMS, [`${FOLDER}${FILE}`]: 404 }), run: fakeTar(), env, carried: CARRIED }))
  assert.match(missing.message, new RegExp(`nodejs\\.org answered 404 for ${FILE.replaceAll('.', '\\.')}`))

  const leaky = Object.assign(new TypeError('fetch failed'), { cause: Error('proxy https://someone:hunter2secretvalue@proxy.invalid refused') })
  const scrubbed = await failureOf(installNode({ root, ...onAMac, fetch: fakeFetch({ [`${FOLDER}SHASUMS256.txt`]: leaky }), run: fakeTar(), env, carried: CARRIED }))
  assert.doesNotMatch(scrubbed.message, /hunter2secretvalue/)
  assert.deepEqual(clientFolder(root), [])
})

test('only a Mac with Apple silicon or an Intel chip gets a Node of hobkin\'s own', async (t) => {
  const root = temporaryDirectory(t)
  const asked: string[] = []
  const refused = await failureOf(installNode({ root, version: VERSION, platform: 'linux', arch: 'x64', fetch: fakeFetch(NODEJS, asked), run: fakeTar(), env: {}, carried: CARRIED }))
  assert.ok(refused instanceof Unavailable)
  assert.deepEqual(asked, [])
})

test("at a live host's start, hobkin's own Node goes on the PATH when it is there, before the carried Node", (t) => {
  const root = temporaryDirectory(t)
  const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', CARRIED].join(delimiter) }

  assert.equal(addOwnNode(root, env, CARRIED), false)
  assert.equal(env.PATH, ['/usr/bin', CARRIED].join(delimiter))

  mkdirSync(nodeBin(root), { recursive: true })
  writeFileSync(join(nodeBin(root), 'node'), '#!/bin/sh\n', { mode: 0o755 })
  assert.equal(addOwnNode(root, env, CARRIED), true)
  assert.equal(env.PATH, ['/usr/bin', nodeBin(root), CARRIED].join(delimiter))
  assert.equal(readFileSync(join(nodeBin(root), 'node'), 'utf8'), '#!/bin/sh\n')
})
