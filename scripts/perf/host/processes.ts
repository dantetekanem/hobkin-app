/** The processes a load run starts, found by their parents while they run and by their pid and command afterwards. */
import { execFileSync } from 'node:child_process'

export interface Running {
  pid: number
  ppid: number
  command: string
}

/** Every process of this user's session, as `ps` lists them. */
export function processes(): Running[] {
  const listed = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 2 ** 20 })
  return listed.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }] : []
  })
}

/** The children of `root`, theirs, and so on, while they run. A detached child still has its parent. */
export function descendants(root: number, all: readonly Running[] = processes()): Running[] {
  const parents = new Set([root])
  const found: Running[] = []
  for (let grew = true; grew;) {
    grew = false
    for (const child of all) {
      if (!parents.has(child.ppid) || parents.has(child.pid)) continue
      parents.add(child.pid)
      found.push(child)
      grew = true
    }
  }
  return found
}

/** Of the processes seen before, those still running (the same pid with the same command), and any whose command names `mark`. */
export function leftOver(seen: readonly Running[], mark: string): Running[] {
  return processes().filter((running) =>
    running.pid !== process.pid &&
    (seen.some(({ pid, command }) => pid === running.pid && command === running.command) || running.command.includes(mark)))
}

/** What the whole machine is doing: every process's CPU share as ps reports it, summed, 100 for one core. */
export function machineCpu(): number {
  const listed = execFileSync('ps', ['-A', '-o', '%cpu='], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 2 ** 20 })
  return listed.split('\n').reduce((sum, line) => sum + (Number(line.trim()) || 0), 0)
}

/** What macOS says of the machine's heat and its CPU's speed limit (`pmset -g therm`), which needs no sudo. */
export function therm(): string[] {
  try {
    return execFileSync('pmset', ['-g', 'therm'], { encoding: 'utf8', timeout: 5000 }).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Stops each one at once. One already gone is fine. */
export function kill(running: readonly Running[]): void {
  for (const { pid } of running) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}
