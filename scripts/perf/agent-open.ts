/**
 * What opening an agent's page asks of the host and the wire, with long conversations (spec 077 lane SW-HOST): each
 * request and message a page open sends, its time in the host, its bytes and how many a page open makes, for a durable
 * hobkin's page and a busy run's page; and what the host sends while the page watches a busy run or a working turn.
 *
 * Run from the repo root: node scripts/perf/agent-open.ts
 *   --turns N        hobkin A's turns, each 5 to 30 tool calls and a long Markdown answer (300)
 *   --b-turns N      hobkin B's, the one switched to (40)
 *   --runs N         finished background runs with reports, as `host-load.ts` seeds (700)
 *   --work-calls N   tool calls the busy run has made when its page opens (2000)
 *   --seconds S      each streaming phase (15)
 *   --live-calls N   tool calls in the working turn sent to hobkin A (30)
 *   --dir DIR        where the run's folder goes (this session's scratchpad, else the system temp folder)
 *   --home DIR       reuse a home seeded before with --keep, and skip seeding
 *   --keep           keep the seeded home and print where it is
 *   --profile        also write CPU profiles of each measured block next to the home
 *   --json           print the whole result as JSON
 *
 * It seeds a home of its own (`host/open-lab.ts --seed`, through hobkin's own runtime), then starts the real host on it
 * (scripted, port 0) and a fake window in another process (`host/open-window.ts`). Every child runs under a timeout, and
 * at the end it checks that no process it started is left. It never touches `~/.hobkin` or the live host's port. The test
 * run does not include this folder.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { descendants, kill, leftOver, processes, type Running } from './host/processes.ts'

const argv = process.argv.slice(2)
const value = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1]! : fallback)
const SCRATCH = '/private/tmp/claude-501/-Users-leonardopereira-Poetry-hobkin-client/bc0eba63-6ebe-43a5-98a4-c784d84508d6/scratchpad/077'
const reuse = value('--home', '')
const keep = argv.includes('--keep')
const seconds = Number(value('--seconds', '15'))
const passedSeed = ['--turns', '--b-turns', '--runs'].flatMap((name) => (argv.includes(name) ? [name, value(name, '')] : []))
const passedRun = ['--work-calls', '--seconds', '--live-calls'].flatMap((name) => (argv.includes(name) ? [name, value(name, '')] : []))

const lab = fileURLToPath(new URL('./host/open-lab.ts', import.meta.url))
const base = value('--dir', existsSync(SCRATCH) ? SCRATCH : tmpdir())
mkdirSync(base, { recursive: true })
const run = reuse ? realpathSync(dirname(reuse)) : realpathSync(mkdtempSync(join(base, 'agent-open-')))
const home = reuse ? realpathSync(reuse) : join(run, 'home')
if (home.startsWith(join(homedir(), '.hobkin'))) throw Error('Never the real home.')
const backups = join(run, 'backups')
const piFolder = join(run, 'pi-agent')
const profiles = join(run, 'profiles')
mkdirSync(piFolder, { recursive: true })
if (argv.includes('--profile')) mkdirSync(profiles, { recursive: true })
const env = Object.fromEntries(Object.entries({ ...process.env, PI_CODING_AGENT_DIR: piFolder }).filter(([name]) => !name.startsWith('HERDR_')))

const seen: Running[] = []
let current: ChildProcess | null = null

function runLab(args: string[], limit: number): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', lab, '--home', home, '--backups', backups, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    current = child
    let out = ''
    let errors = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => {
      errors += chunk
      if (argv.includes('--verbose') || /\[agent-open/.test(String(chunk))) process.stderr.write(chunk)
    })
    const timer = setTimeout(() => {
      process.stderr.write(`agent-open: the lab ran past ${limit} s and is stopped\n`)
      stopTree(child)
    }, limit * 1000)
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      current = null
      const line = out.trim().split('\n').at(-1) ?? ''
      try {
        const said = JSON.parse(line) as { result?: Record<string, any>; started?: Running[] }
        seen.push(...(said.started ?? []))
        if (code === 0 && said.result) return resolve(said.result)
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

/** This process and those that started it, whose command lines may name the run's folder too. */
function ancestors(): Set<number> {
  const all = processes()
  const chain = new Set<number>()
  for (let pid: number | undefined = process.pid; pid && !chain.has(pid); pid = all.find((each) => each.pid === pid)?.ppid) chain.add(pid)
  return chain
}

function cleanUp(): Running[] {
  if (current) stopTree(current)
  const spared = ancestors()
  const left = leftOver(seen, run).filter(({ pid }) => !spared.has(pid))
  kill(left)
  if (!keep && !reuse) rmSync(run, { recursive: true, force: true })
  return left
}

setTimeout(() => {
  process.stderr.write('agent-open: the run went past its ceiling and is stopped\n')
  cleanUp()
  process.exit(1)
}, (1500 + seconds * 4) * 1000).unref()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanUp()
    process.exit(130)
  })
}

// ---------- the report ----------
const ms = (number: number | null | undefined) => (number == null ? '-' : number < 10 ? number.toFixed(1) : number.toFixed(0))
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 2 ** 20 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 2 ** 20).toFixed(2)} MB`)
const median = (list: number[]) => {
  const sorted = [...list].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0
}
interface Asked { name: string; hostMs: number | null; rtMs: number; bytes: number; ok: boolean; error?: string }

/** One line per request name: how many, host ms median (min to max), round trip, bytes each and in all. */
function requestLines(requests: Asked[]): string[] {
  const names = [...new Set(requests.map(({ name }) => name))]
  return names.map((name) => {
    const of = requests.filter((asked) => asked.name === name)
    const host = of.map(({ hostMs }) => hostMs ?? 0)
    const failed = of.filter(({ ok }) => !ok)
    const bytes = of.map(({ bytes }) => bytes)
    return `    ${name.padEnd(16)} x${String(of.length).padEnd(3)} host ${ms(median(host)).padStart(5)} ms (${ms(Math.min(...host))}-${ms(Math.max(...host))})  rt ${ms(median(of.map(({ rtMs }) => rtMs))).padStart(5)} ms  ${kb(median(bytes)).padStart(9)} each, ${kb(bytes.reduce((sum, each) => sum + each, 0))} in all${failed.length ? `  ${failed.length} failed: ${failed[0]!.error}` : ''}`
  })
}

/** Each kind of activity step: how many, and their bytes. */
const opsOf = ({ ops, opSizes }: { ops: Record<string, number>; opSizes: Record<string, number> }) =>
  Object.entries(ops).filter(([, count]) => count > 0).map(([op, count]) => `${op} x${count} ${kb(opSizes[op] ?? 0)}`).join(', ')

function summary(result: Record<string, any>): string {
  const { sizes, direct } = result
  const lines = [
    `agent-open: runtime ${result.runtimePath}`,
    `  home: ${sizes.runs} runs, runtime document ${kb(sizes.runtimeDocumentBytes)}; hobkin A ${sizes.aTurns} turns, conversation ${kb(sizes.aSessionBytes)}; B ${sizes.bTurns} turns, ${kb(sizes.bSessionBytes)}`,
    `  busy run: ${sizes.busyCalls} tool calls, session ${kb(sizes.busySessionBytes)}, feed ${sizes.busyFeedSteps} steps; first state to the window ${kb(result.firstState)}`,
    '',
  ]
  for (const page of result.pages) {
    lines.push(`  page ${page.label}: all answered in ${ms(page.pageMs)} ms (read ${ms(page.readMs)} ms), host stalled up to ${ms(page.loopMaxMs)} ms, ${page.drawn} turns drawn`)
    lines.push(...requestLines(page.requests))
    lines.push(`    watch            x${page.hostWatch.messages} host ${ms(page.hostWatch.ms.median)} ms (${ms(page.hostWatch.ms.min)}-${ms(page.hostWatch.ms.max)}), ${kb(page.watch.bytes)} up, ${kb(page.hostWatch.bytesSent)} back`)
    if (page.profile) lines.push(`    profile ${page.profile}`)
  }
  const runPage = result.runPage
  lines.push(`  run page: watched feed ${runPage.feed} steps (${kb(runPage.feedBytes)} as JSON) in ${ms(runPage.pageMs)} ms; host watch ${runPage.hostWatch.map((watch: any) => `${ms(watch.ms)} ms, ${kb(watch.bytes)} in ${watch.messages} message(s)`).join('; ')}`)
  lines.push(...requestLines(runPage.requests))
  lines.push(...requestLines(runPage.older).map((line: string) => line.replace('activity.before ', 'older steps     ')))
  for (const stream of [result.watchedStream, result.tailStream]) {
    const received = stream.received
    lines.push(`  ${stream.label} (${stream.seconds} s): ${stream.publishes.count} publishes, host ${ms(stream.publishes.ms.median)} ms each (p90 ${ms(stream.publishes.ms.p90)}, max ${ms(stream.publishes.ms.max)}), loop stall up to ${ms(stream.loopMaxMs)} ms`)
    lines.push(`    window got ${received.messages} state messages, ${kb(received.bytes)} (${kb(received.bytes / stream.seconds)}/s), largest ${kb(received.largest)}; ops ${opsOf(received)}`)
    if (stream.follows.length) lines.push(...requestLines(stream.follows).map((line: string) => line.replace('activity.before ', 'follow reads    ')))
  }
  const turn = result.workingTurn
  lines.push(`  working turn on A (${turn.turnMs.toFixed(0)} ms, ${turn.heldAfter} of its steps still held 3 s after): ${turn.rereads} re-reads of hobkin.read, ${turn.publishes.count} publishes at ${ms(turn.publishes.ms.median)} ms (max ${ms(turn.publishes.ms.max)}); window got ${turn.state.messages} state messages, ${kb(turn.state.bytes)}; ops ${opsOf(turn.state)}`)
  lines.push(...requestLines(turn.requests))
  lines.push(
    '  one at a time in the host process:',
    `    runtime.state()            ${ms(direct.stateMs.median)} ms (${ms(direct.stateMs.min)}-${ms(direct.stateMs.max)}), ${kb(direct.stateBytes)} parsed`,
    `    hobkins.read(A)            ${ms(direct.hobkinReadMs.median)} ms (${ms(direct.hobkinReadMs.min)}-${ms(direct.hobkinReadMs.max)}), ${kb(direct.hobkinReadBytes)} as JSON, stringify ${ms(direct.hobkinReadStringifyMs.median)} ms`,
    `    activity.before, cold      ${ms(direct.turnStepsCold.ms.median)} ms (${ms(direct.turnStepsCold.ms.min)}-${ms(direct.turnStepsCold.ms.max)}), ${kb(direct.turnStepsCold.bytes.median)} a turn`,
    `    activity.before, warm      ${ms(direct.turnStepsWarm.ms.median)} ms (${ms(direct.turnStepsWarm.ms.min)}-${ms(direct.turnStepsWarm.ms.max)})`,
    `    same, state parsed once    cold ${ms(direct.turnStepsColdWithoutState.ms.median)} ms, warm ${ms(direct.turnStepsWarmWithoutState.ms.median)} ms`,
    `    busy run's newest 200 after a write  ${ms(direct.busyOlderAfterWriteMs.median)} ms (${ms(direct.busyOlderAfterWriteMs.min)}-${ms(direct.busyOlderAfterWriteMs.max)})`,
  )
  return lines.join('\n')
}

let failed = false
try {
  if (!reuse) {
    const seeded = await runLab(['--seed', ...passedSeed], 1200)
    process.stderr.write(`agent-open: home seeded in ${seeded.seconds.toFixed(0)} s\n`)
  }
  const result = await runLab([...passedRun, ...(argv.includes('--profile') ? ['--profile', profiles] : [])], seconds * 4 + 600)
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  console.log(summary(result))
} catch (error) {
  failed = true
  process.stderr.write(`agent-open: ${error instanceof Error ? error.message : String(error)}\n`)
} finally {
  const left = cleanUp()
  if (keep || reuse) console.log(`  home kept at ${home}`)
  if (left.length) {
    failed = true
    console.log(`  left running and stopped now: ${left.map(({ pid, command }) => `${pid} ${command.slice(0, 120)}`).join('; ')}`)
  } else console.log('  no process left')
  process.exitCode = failed ? 1 : 0
}
