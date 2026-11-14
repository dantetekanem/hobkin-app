/**
 * Proves that a staged package runs on its own, as a Mac app would run it:
 *
 *   node scripts/package/check.ts [--trace] [<package folder, dist/package by default>]
 *
 * It fails on a link that leaves the staged tree or a /Users path in the host's own staged files. Then it copies the
 * package to a temporary folder outside the repository, since Node looks for packages in every folder above the code
 * and a copy inside the repository would quietly borrow its node_modules. The copy is made read only, as an app on a
 * disk image or a translocated app is. The staged Node starts the staged host there with only HOME and a short PATH,
 * the way Finder starts an app, on a fresh home and a free port. It passes when the host says it is listening and
 * its host.json names a pid, a port and a token. The host is stopped with SIGTERM and every temporary folder removed.
 *
 * --trace also notes what the host touches in the temporary HOME, the writes it tries in the copy, the /Users paths
 * it names and the programs it starts, through `trace-home.ts`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { leakedUserPaths } from './rules.ts'
import { entriesUnder, isInside, linksLeaving } from './tree.ts'

const REPO = resolve(import.meta.dirname, '..', '..')
const LISTENING = /hobkin host listening on 127\.0\.0\.1:(\d+)/
const SHORT_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const START_MS = 90_000
// Long enough for the scripted main session the host starts beside it to load, so a crash right after start shows.
const SETTLE_MS = 5_000
const STOP_MS = 15_000

/**
 * The scripted host may never load what only a live host uses, so the copy's Node also loads it directly, the way
 * the host finds it: Pi's SDK and its unexported files through `host/src/pi.ts`, hobkin's application, and pi-tui's
 * native helper, found from hobkin's package.json as `pi.ts` finds Pi. Loading the helper reads no clipboard.
 */
const LOAD_PROBE = `
import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const app = process.cwd()
const pi = await import(pathToFileURL(join(app, 'host/src/pi.ts')).href)
const [agent, ai] = await Promise.all([pi.loadPiCodingAgent(), pi.loadPiAi()])
const [pick, defaults, keys] = await Promise.all([pi.loadPiModelPick(), pi.loadPiDefaultModels(), pi.loadPiKeyVariables()])
const mcp = await import(pi.piCodingAgentFile('./extensions/mcp/config.js'))
const tuiManifest = findPackageJSON('@earendil-works/pi-tui', pathToFileURL(join(app, 'node_modules/hobkin/package.json')))
const tui = await import(pathToFileURL(join(dirname(tuiManifest), JSON.parse(readFileSync(tuiManifest, 'utf8')).main)).href)
const application = await import(pathToFileURL(join(app, 'node_modules/hobkin/src/cli/application.mjs')).href)
console.log(JSON.stringify({
  piCodingAgent: typeof agent.createAgentSession === 'function',
  piAi: typeof ai.getSupportedThinkingLevels === 'function',
  modelPick: pick !== null,
  defaultModels: Object.keys(defaults).length > 0,
  keyVariables: keys('anthropic').length > 0,
  mcpConfig: Object.keys(mcp).length > 0,
  nativeHelper: typeof tui.getNativeClipboard()?.getText === 'function',
  hobkinApplication: typeof application.HobkinApplication === 'function',
  piFrom: fileURLToPath(pi.piCodingAgentFile('./index.js')),
  piTuiFrom: tuiManifest,
}))
`

/** Loads what a live host would load, in the copy, with the same short environment. */
function loadProbe(copy: string, user: string): string[] {
  const result = spawnSync(join(copy, 'node', 'bin', 'node'), ['--input-type=module', '-e', LOAD_PROBE], {
    cwd: join(copy, 'app'),
    env: { HOME: user, PATH: SHORT_PATH },
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (result.status !== 0) return [`the load probe failed: ${(result.stderr || result.error?.message || '').trim()}`]
  const loaded = JSON.parse(result.stdout.trim().split('\n').pop()!) as Record<string, boolean | string>
  console.log(`  load probe: ${JSON.stringify(loaded).replaceAll(copy, '<copy>')}`)
  const problems = Object.entries(loaded)
    .filter(([, value]) => value === false)
    .map(([name]) => `the load probe found no ${name}`)
  for (const name of ['piFrom', 'piTuiFrom']) {
    if (!isInside(copy, String(loaded[name]))) problems.push(`the load probe found ${name} outside the copy: ${String(loaded[name])}`)
  }
  return problems
}

/** The /Users paths in the host's own staged files and the manifest. Packages in node_modules are not ours to judge. */
function leaks(root: string): string[] {
  const files = [join(root, 'manifest.json')]
  for (const { path, stat } of entriesUnder(join(root, 'app'))) {
    if (stat.isFile() && !relative(root, path).split('/').includes('node_modules')) files.push(path)
  }
  return files.flatMap((file) => leakedUserPaths(readFileSync(file, 'utf8')).map((found) => `${relative(root, file)} names ${found}`))
}

/** Folders above the copy that hold node_modules, which Node would search for any package the copy lacks. */
function borrowable(copy: string): string[] {
  const found: string[] = []
  for (let folder = dirname(copy); folder !== dirname(folder); folder = dirname(folder)) {
    if (existsSync(join(folder, 'node_modules'))) found.push(join(folder, 'node_modules'))
  }
  if (existsSync('/node_modules')) found.push('/node_modules')
  return found
}

/** Takes write permission away, or gives the owner it back so the folder can be removed. */
function setWritable(root: string, writable: boolean): void {
  // Changing a mode needs no write permission on the folder above, so the order does not matter.
  for (const { path, stat } of [...entriesUnder(root)]) {
    if (stat.isSymbolicLink()) continue
    chmodSync(path, writable ? stat.mode | 0o200 : stat.mode & ~0o222)
  }
  chmodSync(root, writable ? 0o755 : 0o555)
}

/** Processes still running code from the copy, by their command line. */
function runningFrom(copy: string): { pid: number; command: string }[] {
  const listing = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? ''
  return listing
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null && match[2]!.includes(copy))
    .map((match) => ({ pid: Number(match[1]), command: match[2]! }))
}

interface Started {
  port: number | null
  output: string[]
  exit: Promise<number | null>
  pid: number | undefined
  stop(signal: NodeJS.Signals): void
}

function startHost(copy: string, user: string, home: string, traceArgs: string[]): Started {
  const environment: Record<string, string> = { HOME: user, PATH: SHORT_PATH }
  // Children the host starts with its own Node are traced too.
  if (traceArgs.length) environment.NODE_OPTIONS = traceArgs.join(' ')
  const child = spawn(join(copy, 'node', 'bin', 'node'), ['host/src/main.ts', '--home', home, '--port', '0'], {
    cwd: join(copy, 'app'),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const started: Started = {
    port: null,
    output: [],
    pid: child.pid,
    exit: new Promise((done) => {
      child.on('exit', (code, signal) => done(code ?? (signal ? -1 : null)))
      child.on('error', (error) => {
        started.output.push(`could not start: ${error.message}`)
        done(null)
      })
    }),
    stop: (signal) => child.kill(signal),
  }
  for (const [stream, name] of [
    [child.stdout, 'out'],
    [child.stderr, 'err'],
  ] as const) {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (text: string) => {
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        started.output.push(`${name}: ${line}`)
        const listening = LISTENING.exec(line)
        if (listening) started.port = Number(listening[1])
      }
    })
  }
  return started
}

/** Waits until the host says it is listening, or ends, or the time is up. Null when it listens, otherwise why not. */
async function untilListening(host: Started): Promise<string | null> {
  const exit = { ended: false, code: null as number | null }
  void host.exit.then((code) => Object.assign(exit, { ended: true, code }))
  const deadline = Date.now() + START_MS
  while (Date.now() < deadline && !exit.ended && host.port === null) await delay(100)
  if (host.port !== null) return null
  if (exit.ended) return `the host ended with code ${String(exit.code)} before it said it was listening`
  return `the host never said it was listening within ${START_MS / 1000} seconds`
}

function hostFileProblems(home: string, port: number): string[] {
  const file = join(home, 'client', 'host.json')
  let saved: { pid?: unknown; port?: unknown; token?: unknown }
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) as typeof saved
  } catch (error) {
    return [`${file} could not be read: ${(error as Error).message}`]
  }
  const problems: string[] = []
  if (!Number.isInteger(saved.pid)) problems.push('host.json has no pid')
  if (saved.port !== port) problems.push(`host.json names port ${String(saved.port)}, but the host said ${port}`)
  if (typeof saved.token !== 'string' || !saved.token) problems.push('host.json has no token')
  return problems
}

/** What the host left in the temporary HOME outside its own home. */
function writtenUnder(user: string, home: string): string[] {
  return [...entriesUnder(user)].map(({ path }) => path).filter((path) => !isInside(home, path)).map((path) => `~/${relative(user, path)}`)
}

/** The trace's notes, each kind of call on a path once, with the temporary folders named plainly. */
function traceNotes(log: string, names: Readonly<Record<string, string>>): string[] {
  if (!existsSync(log)) return []
  let text = readFileSync(log, 'utf8')
  for (const [path, name] of Object.entries(names)) text = text.replaceAll(path, name)
  return [...new Set(text.split('\n').filter(Boolean))].sort()
}

async function check(args: readonly string[]): Promise<boolean> {
  const trace = args.includes('--trace')
  const named = args.find((arg) => !arg.startsWith('--'))
  const root = resolve(named ?? join(REPO, 'dist', 'package'))
  for (const part of ['app/host/src/main.ts', 'node/bin/node', 'manifest.json']) {
    if (!existsSync(join(root, part))) throw Error(`${root} has no ${part}. Run node scripts/package/stage.ts first.`)
  }
  const failures: string[] = []
  failures.push(...linksLeaving(root).map((link) => `a link leaves the staged tree: ${link}`))
  failures.push(...leaks(root).map((leak) => `a staged file names a user folder: ${leak}`))

  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-package-check-')))
  const copy = join(temporary, 'package')
  const user = join(temporary, 'user')
  const home = join(user, 'hobkin-home')
  const log = join(temporary, 'trace.log')
  try {
    if (isInside(REPO, temporary)) throw Error(`The temporary folder ${temporary} is inside the repository, so the check would prove nothing.`)
    failures.push(...borrowable(copy).map((folder) => `Node could borrow packages from ${folder}, above the copy`))

    cpSync(root, copy, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
    setWritable(copy, false)
    mkdirSync(home, { recursive: true })

    const traceArgs: string[] = []
    if (trace) {
      copyFileSync(join(import.meta.dirname, 'trace-home.ts'), join(temporary, 'trace-home.ts'))
      writeFileSync(join(temporary, 'trace.json'), JSON.stringify({ log, home: user, hobkinHome: home, copy }))
      traceArgs.push(`--import=${pathToFileURL(join(temporary, 'trace-home.ts')).href}`)
    }

    type Part = { version: string; commit: string; source: string }
    const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8')) as { app: Part; runtime: Part; node: { version: string } }
    const at = ({ version, commit, source }: Part) => `${version} at ${commit.slice(0, 12)} (${source})`
    console.log(`Checking a copy of ${relative(REPO, root) || root}: app ${at(manifest.app)}, hobkin ${at(manifest.runtime)}, Node ${manifest.node.version}.`)
    console.log(`  env -i HOME=<temp>/user PATH=${SHORT_PATH} <copy>/node/bin/node host/src/main.ts --home <temp>/user/hobkin-home --port 0  (cwd <copy>/app, read only)`)

    const host = startHost(copy, user, home, traceArgs)
    const notListening = await untilListening(host)
    const listening = notListening === null
    if (listening) {
      failures.push(...hostFileProblems(home, host.port!))
      const ended = await Promise.race([host.exit.then(() => true), delay(SETTLE_MS).then(() => false)])
      if (ended) failures.push(`the host ended within ${SETTLE_MS / 1000} seconds of saying it was listening`)
    } else failures.push(notListening)

    host.stop('SIGTERM')
    const code = await Promise.race([host.exit, delay(STOP_MS).then(() => 'late' as const)])
    if (code === 'late') {
      host.stop('SIGKILL')
      failures.push(`the host did not stop within ${STOP_MS / 1000} seconds of SIGTERM`)
    } else if (listening && code !== 0) failures.push(`the host stopped with code ${String(code)} after SIGTERM`)

    // Children the host started must go with it.
    await delay(500)
    for (const left of runningFrom(copy)) {
      failures.push(`process ${left.pid} was still running from the copy after the host stopped: ${left.command.replaceAll(copy, '<copy>')}`)
      process.kill(left.pid, 'SIGKILL')
    }

    const names = { [copy]: '<copy>', [home]: '<home>', [user]: '~', [temporary]: '<temp>' }
    const clean = (line: string) => Object.entries(names).reduce((text, [path, name]) => text.replaceAll(path, name), line)
    console.log(`  host pid ${String(host.pid)}, ${listening ? `listening on port ${host.port}` : 'not listening'}`)
    console.log('  host output:')
    for (const line of host.output) console.log(`    ${clean(line)}`)
    failures.push(...loadProbe(copy, user))
    const written = writtenUnder(user, home)
    console.log(`  written in HOME outside the hobkin home: ${written.length ? written.join(', ') : 'nothing'}`)
    if (trace) {
      const notes = traceNotes(log, names)
      console.log(`  trace (${notes.length} notes):`)
      for (const note of notes) console.log(`    ${note}`)
    }
  } finally {
    if (existsSync(copy)) setWritable(copy, true)
    rmSync(temporary, { recursive: true, force: true })
  }

  for (const failure of failures) console.log(`FAIL ${failure}`)
  const count = `${failures.length} ${failures.length === 1 ? 'problem' : 'problems'}`
  console.log(failures.length ? `The staged package does not stand alone (${count}).` : 'PASS The staged package stands alone.')
  return failures.length === 0
}

if (import.meta.main) {
  check(process.argv.slice(2)).then(
    (passed) => {
      process.exitCode = passed ? 0 : 1
    },
    (error: unknown) => {
      console.error(`check: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}
