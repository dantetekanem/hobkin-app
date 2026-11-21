/**
 * The lab's real Pi agents (`host-load.ts --pi real`): Pi's folder pointed at the fake model on this machine, hobkin's
 * own Pi harness for the agents' runs, and what their processes and the machine cost, read with ps and pmset.
 */
import { execFileSync, fork } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { namingExtensions, runHarness } from 'hobkin/src/cli/harnesses.mjs'
import { readingUsage } from 'hobkin/src/cli/work/usage.mjs'

/** The model the agents ask for: DeepSeek's, which Pi's folder moves to the fake model. */
export const REAL_MODEL = 'deepseek/deepseek-flash'

/** Pi's own folder for the run: a default model, DeepSeek moved to `baseUrl`, and a made-up key. */
export function writePiFolder(folder: string, baseUrl: string): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(join(folder, 'settings.json'), JSON.stringify({ defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', defaultThinkingLevel: 'high' }))
  writeFileSync(join(folder, 'models.json'), JSON.stringify({ providers: { deepseek: { baseUrl } } }))
  writeFileSync(join(folder, 'auth.json'), JSON.stringify({ deepseek: { type: 'api_key', key: 'not-a-real-key' } }), { mode: 0o600 })
}

/** hobkin's own harness for a Pi run, as a live host gives it work (`agentHarness` in `host/src/claude-code/agents.ts`). */
export const piHarness = namingExtensions(readingUsage(runHarness))

/** The fake model (`model.ts`), in a process of its own, with how many answers it began and how to tell it to end. */
export function startModel(live: number, run: string) {
  const child = fork(fileURLToPath(new URL('./model.ts', import.meta.url)), [String(live), run], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const ready = new Promise<number>((resolve, reject) => {
    child.on('message', (message: { type?: string; port?: number }) => message?.type === 'ready' && resolve(message.port!))
    child.once('exit', (code) => reject(Error(`The fake model stopped (exit ${code}).`)))
  })
  const answers = () => new Promise<number>((resolve) => {
    const take = (message: { type?: string; requests?: number }) => {
      if (message?.type !== 'count') return
      child.off('message', take)
      resolve(message.requests!)
    }
    child.on('message', take)
    child.send({ type: 'count' })
  })
  return {
    pid: child.pid,
    ready,
    answers,
    end: () => child.send({ type: 'end' }),
    close: () => child.kill('SIGKILL'),
  }
}

export interface Usage {
  pid: number
  /** The scheduling priority ps reads: 31 is the normal one on macOS, 20 what `taskpolicy -c utility` gives. */
  priority: number
  rssKB: number
  cpuSeconds: number
}

/** ps's CPU time, `[[dd-]hh:]mm:ss.ss`, in seconds. */
function secondsOf(time: string): number {
  const [days, clock] = time.includes('-') ? time.split('-') : ['0', time]
  return Number(days) * 86400 + clock!.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
}

/** Each process's priority, resident memory and CPU time so far, as ps says them. One gone is left out. */
export function usageOf(pids: readonly number[]): Usage[] {
  if (!pids.length) return []
  let listed = ''
  try {
    listed = execFileSync('ps', ['-o', 'pid=,pri=,rss=,time=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 5000 })
  } catch (error) {
    // ps exits 1 when some of them are gone, and still lists the rest.
    listed = String((error as { stdout?: string }).stdout ?? '')
  }
  return listed.trim().split('\n').flatMap((line) => {
    const [pid, priority, rss, time] = line.trim().split(/\s+/)
    return pid ? [{ pid: Number(pid), priority: Number(priority), rssKB: Number(rss), cpuSeconds: secondsOf(time!) }] : []
  })
}

/** The cores the processes in both readings used between them, summed: CPU seconds over wall seconds. */
export function cpuShare(before: readonly Usage[], after: readonly Usage[], seconds: number): number {
  const spent = after.reduce((sum, now) => {
    const then = before.find(({ pid }) => pid === now.pid)
    return then ? sum + now.cpuSeconds - then.cpuSeconds : sum
  }, 0)
  return seconds > 0 ? spent / seconds : 0
}

