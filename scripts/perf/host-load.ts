/**
 * What the Node host spends with N agents writing at once (spec 052, A11): its share of a core, publishes a second,
 * milliseconds per publish and socket bytes a second.
 *
 * Run from the repo root: node scripts/perf/host-load.ts --agents 100 --history 500 --seconds 60
 *   --agents N      work agents streaming at once (1)
 *   --history K     past cycles each agent has already worked, a message and a tool call each (0)
 *   --seconds S     the measured window (60)
 *   --rate R        text deltas a second per agent (30)
 *   --cycle S       seconds from one tool call to the next (2)
 *   --no-session    agents do not grow their session files, so token counts never move
 *   --no-client     no window connected
 *   --profile FILE  also write a CPU profile of the measured window to FILE and print where its time went
 *   --json          print the whole result as JSON
 *
 * It seeds a home of its own under the system temp folder (50 chat turns, 700 finished runs with reports, 50 routines;
 * about the size of a real one), starts the real host on it with the scripted main model and port 0 (`host/lab.ts`),
 * connects a fake window in another process (`host/window.ts`), and removes the folder afterwards. Every child runs
 * under a timeout, and at the end it checks that no process it started is left. It never touches `~/.hobkin` or the
 * live host's port. The test run does not include this folder.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyze } from './host/analyze.ts'
import { descendants, kill, leftOver, type Running } from './host/processes.ts'

const argv = process.argv.slice(2)
const value = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : fallback)
const agents = Number(value('--agents', '1'))
const history = Number(value('--history', '0'))
const seconds = Number(value('--seconds', '60'))
const profile = argv.includes('--profile') ? value('--profile', '') : ''
const passed = ['--agents', '--history', '--seconds', '--rate', '--cycle'].flatMap((name) => (argv.includes(name) ? [name, value(name, '')] : []))
const switches = ['--no-session', '--no-client'].filter((name) => argv.includes(name))
for (const number of [agents, history, seconds]) if (!(number >= 0)) throw Error('--agents, --history and --seconds take a number.')

const lab = fileURLToPath(new URL('./host/lab.ts', import.meta.url))
const run = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-host-load-')))
const home = join(run, 'home')
const backups = join(run, 'backups')
const piFolder = join(run, 'pi-agent')
mkdirSync(piFolder)
// Pi's folder for anything that asks is this run's own, and nothing reaches a terminal multiplexer.
const env = Object.fromEntries(Object.entries({ ...process.env, PI_CODING_AGENT_DIR: piFolder }).filter(([name]) => !name.startsWith('HERDR_')))

const seen: Running[] = []
let current: ChildProcess | null = null

/** Runs the lab once, killed with everything it started when it takes longer than `limit` seconds. */
function runLab(args: string[], limit: number): Promise<{ result?: Record<string, any>; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', lab, '--home', home, '--backups', backups, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    current = child
    let out = ''
    let errors = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => {
      errors += chunk
      if (argv.includes('--verbose')) process.stderr.write(chunk)
    })
    const timer = setTimeout(() => {
      process.stderr.write(`host-load: the lab ran past ${limit} s and is stopped\n`)
      stopTree(child)
    }, limit * 1000)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      current = null
      const line = out.trim().split('\n').at(-1) ?? ''
      try {
        const said = JSON.parse(line) as { result?: Record<string, any>; error?: string; started?: Running[] }
        seen.push(...(said.started ?? []))
        if (code === 0 && said.result) return resolve(said)
      } catch {
        // No result line: the lab died early.
      }
      process.stderr.write(errors.split('\n').slice(-40).join('\n'))
      reject(Error(`The lab stopped (${signal ?? `exit ${code}`}).`))
    })
  })
}

function stopTree(child: ChildProcess) {
  if (!child.pid) return
  const tree = descendants(child.pid)
  seen.push(...tree)
  kill(tree)
  child.kill('SIGKILL')
}

function cleanUp(): Running[] {
  if (current) stopTree(current)
  const left = leftOver(seen, run)
  kill(left)
  rmSync(run, { recursive: true, force: true })
  return left
}

// The whole run has a ceiling too, whatever happens inside it.
setTimeout(() => {
  process.stderr.write('host-load: the run went past its ceiling and is stopped\n')
  cleanUp()
  process.exit(1)
}, (300 + seconds + history / 20 + 240) * 1000).unref()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanUp()
    process.exit(130)
  })
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`
const fixed = (number: number, digits = 2) => number.toFixed(digits)

let failed = false
try {
  const seed = (await runLab(['--seed'], 300)).result!
  process.stderr.write(`host-load: home seeded in ${fixed(seed.seconds, 0)} s\n`)
  const result = (await runLab([...passed, ...switches, ...(profile ? ['--profile', profile] : [])], seconds + history / 20 + 180)).result!
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  const socket = result.socket as Record<string, number> | null
  console.log([
    `host-load: ${agents} agents${history ? `, each with ${history * 2 + 1} steps` : ''}, ${fixed(result.seconds, 0)} s${result.window ? ', a window connected' : ', no window'}${result.session ? '' : ', no session growth'}`,
    `  host CPU        ${percent(result.cpuPerWall)} of a core`,
    `  publishes       ${fixed(result.publishesPerSecond, 1)} a second, ${fixed(result.hostPublishMs)} ms each (activity ${fixed(result.activityPublishMs)} ms, others ${fixed(result.otherPublishMs)} ms, slowest ${fixed(result.maxPublishMs, 1)} ms)`,
    ...(socket ? [`  socket          ${fixed(socket.bytesPerSecond / 1024, 0)} KB a second in ${fixed(socket.messagesPerSecond, 1)} messages, median ${fixed(socket.p50 / 1024, 1)} KB`] : []),
    `  full refreshes  ${fixed(result.refreshesPerSecond)} a second, ${fixed(result.refreshWallMs, 1)} ms each; tick ${fixed(result.tickWallMs, 1)} ms`,
    `  memory          RSS ${fixed(result.memory.rssStartMB, 0)} to ${fixed(result.memory.rssEndMB, 0)} MB, heap ${fixed(result.memory.heapStartMB, 0)} to ${fixed(result.memory.heapEndMB, 0)} MB`,
  ].join('\n'))
  if (profile) console.log(`\n${analyze(profile)}`)
} catch (error) {
  failed = true
  process.stderr.write(`host-load: ${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  const left = cleanUp()
  if (left.length) {
    failed = true
    console.log(`  left running and stopped now: ${left.map(({ pid, command }) => `${pid} ${command.slice(0, 120)}`).join('; ')}`)
  } else console.log('  no process left')
  process.exitCode = failed ? 1 : 0
}
