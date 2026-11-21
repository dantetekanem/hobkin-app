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
 *   --old-window    a window from before tails, which gets every feed whole
 *   --watch N       the jobs a window that reads tails watches, as N agents' pages open (1)
 *   --pi real       the agents are real `pi --mode rpc` children through hobkin's own harness (so through taskpolicy),
 *                   each streaming from a fake model on this machine (`host/model.ts`); it adds what they cost
 *   --limit-rss-mb M  with --pi real, stop once the children hold more than M MB together (16384)
 *   --limit-cores C   with --pi real, stop once the children use more than C cores together (8)
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
import { descendants, kill, leftOver, machineCpu, therm, type Running } from './host/processes.ts'

const argv = process.argv.slice(2)
const value = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : fallback)
const agents = Number(value('--agents', '1'))
const history = Number(value('--history', '0'))
const seconds = Number(value('--seconds', '60'))
const profile = argv.includes('--profile') ? value('--profile', '') : ''
const passed = ['--agents', '--history', '--seconds', '--rate', '--cycle', '--watch', '--pi', '--limit-rss-mb', '--limit-cores'].flatMap((name) => (argv.includes(name) ? [name, value(name, '')] : []))
const switches = ['--no-session', '--no-client', '--old-window'].filter((name) => argv.includes(name))
for (const number of [agents, history, seconds]) if (!(number >= 0)) throw Error('--agents, --history and --seconds take a number.')

const lab = fileURLToPath(new URL('./host/lab.ts', import.meta.url))
const run = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-host-load-')))
const home = join(run, 'home')
const backups = join(run, 'backups')
const piFolder = join(run, 'pi-agent')
mkdirSync(piFolder)
const realPi = value('--pi', 'lab') === 'real'
// The machine before this run starts anything, for real Pi agents: what it was doing, and its heat.
const machineBefore = realPi ? { cpu: machineCpu(), therm: therm() } : null
// Pi's folder for anything that asks is this run's own, and nothing reaches a terminal multiplexer. Real Pi agents get a
// home folder of their own too, so they read no skills or settings of the user's, no keys from the environment, and
// Pi's own catalog only.
const userHome = join(run, 'user-home')
mkdirSync(userHome)
const KEYS = /(_API_KEY|_TOKEN|_SECRET|_KEY_ID)$|^(AWS|GOOGLE|GCLOUD|AZURE|CLOUDFLARE|ANTHROPIC|OPENAI|DEEPSEEK)_/
const env = Object.fromEntries(
  Object.entries({ ...process.env, PI_CODING_AGENT_DIR: piFolder, ...(realPi ? { HOME: userHome, PI_OFFLINE: '1', PI_TELEMETRY: '0' } : {}) })
    .filter(([name]) => !name.startsWith('HERDR_') && !(realPi && KEYS.test(name))),
)

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
}, (300 + seconds + history / 20 + (realPi ? agents * 3 : 0) + 240) * 1000).unref()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanUp()
    process.exit(130)
  })
}

const fixed = (number: number, digits = 2) => number.toFixed(digits)

/** The measured run as a few lines: what ran, then the host's share of a core, its publishes, the socket and memory. */
function summary(result: Record<string, any>): string {
  const what = [
    `${agents} agents`,
    ...(history ? [`each after ${history * 2 + 1} steps`] : []),
    `${fixed(result.seconds, 0)} s`,
    result.window === 'old' ? 'a window from before tails' : result.window ? `a window watching ${result.watched.length} of them` : 'no window',
    ...(result.session ? [] : ['no session growth']),
  ]
  const { socket, memory } = result
  const publishes = `activity ${fixed(result.activityPublishMs)} ms, others ${fixed(result.otherPublishMs)} ms, slowest ${fixed(result.maxPublishMs, 1)} ms`
  return [
    `host-load: ${what.join(', ')}`,
    `  host CPU        ${fixed(result.cpuPerWall * 100, 1)}% of a core`,
    `  publishes       ${fixed(result.publishesPerSecond, 1)} a second, ${fixed(result.hostPublishMs)} ms each (${publishes})`,
    ...(socket ? [`  first state     ${fixed(socket.firstStateBytes / 2 ** 20, 1)} MB`] : []),
    ...(socket ? [`  socket          ${fixed(socket.bytesPerSecond / 1024, 0)} KB a second in ${fixed(socket.messagesPerSecond, 1)} messages, median ${fixed(socket.p50 / 1024, 1)} KB`] : []),
    `  full refreshes  ${fixed(result.refreshesPerSecond)} a second, ${fixed(result.refreshWallMs, 1)} ms each; tick ${fixed(result.tickWallMs, 1)} ms`,
    `  memory          RSS ${fixed(memory.rssStartMB, 0)} to ${fixed(memory.rssEndMB, 0)} MB, heap ${fixed(memory.heapStartMB, 0)} to ${fixed(memory.heapEndMB, 0)} MB`,
    ...(result.pi ? piLines(result.pi) : []),
  ].join('\n')
}

/** What real Pi agents cost: their CPU and memory, together and each, the priority they run at, and the machine. */
function piLines(pi: Record<string, any>): string[] {
  const each = (total: number) => (pi.children ? total / pi.children : 0)
  const priorities = Object.entries(pi.priorities as Record<string, number>).map(([priority, count]) => `${count} at ${priority}`).join(', ')
  return [
    `  Pi children     ${pi.children}, at priority ${priorities} (31 is normal, 20 is utility); ${pi.answers} model answers begun`,
    `  their CPU       ${fixed(pi.cores * 100, 1)}% of a core together, ${fixed(each(pi.cores) * 100, 1)}% each`,
    `  their memory    ${fixed(pi.rssMB, 0)} MB resident together (peak ${fixed(pi.peakRssMB, 0)}), ${fixed(each(pi.rssMB), 0)} MB each`,
    `  the machine     ${fixed(machineBefore!.cpu, 0)}% before the run, ${pi.machine.cpuDuring === null ? 'not read' : `${fixed(pi.machine.cpuDuring, 0)}%`} during (ps -A %cpu summed, 100 a core)`,
    `  pmset before    ${machineBefore!.therm.join(' | ')}`,
    `  pmset after     ${pi.machine.thermAfter.join(' | ')}`,
    ...(pi.stoppedFor ? [`  stopped early   ${pi.stoppedFor}`] : []),
  ]
}

let failed = false
try {
  const seed = (await runLab(['--seed'], 300)).result!
  process.stderr.write(`host-load: home seeded in ${fixed(seed.seconds, 0)} s\n`)

  const measuring = [...passed, ...switches, ...(profile ? ['--profile', profile] : [])]
  const result = (await runLab(measuring, seconds + history / 20 + (realPi ? agents * 3 : 0) + 180)).result!
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  console.log(summary(result))
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
