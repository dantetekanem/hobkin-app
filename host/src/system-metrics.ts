import { execFile } from 'node:child_process'
import { arch, cpus, freemem, loadavg, release, totalmem, type, uptime } from 'node:os'
import { promisify } from 'node:util'
import type { Battery, Pool, SystemMetrics } from '#shared/protocol/system.ts'

const run = promisify(execFile)

/** Milliseconds a core has spent idle and in total, as `os.cpus()` counts them since boot. */
export interface CpuTimes {
  idle: number
  total: number
}

export function sampleCpu(): CpuTimes {
  let idle = 0
  let total = 0
  for (const { times } of cpus()) {
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

/** Busy share of all cores between two samples, 0 to 100. Null when no time passed between them. */
export function cpuPercent(before: CpuTimes, after: CpuTimes): number | null {
  const total = after.total - before.total
  if (total <= 0) return null
  const busy = 1 - (after.idle - before.idle) / total
  return Math.round(Math.min(1, Math.max(0, busy)) * 1000) / 10
}

/** `df -k` for one path: total and used-by-everything kilobytes, as bytes. Occupied is total less what is free to use. */
export function parseDf(output: string): Pool | null {
  const row = output.trim().split('\n')[1]?.trim().split(/\s+/)
  if (!row || row.length < 4) return null
  const total = Number(row[1])
  const available = Number(row[3])
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0) return null
  return { usedBytes: (total - available) * 1024, totalBytes: total * 1024 }
}

/**
 * macOS `vm_stat`: memory in use the way Activity Monitor counts it (active, wired, compressed), not the total less
 * the free pages, which counts the file cache as used.
 */
export function parseVmStat(output: string): number | null {
  const size = /page size of (\d+) bytes/.exec(output)?.[1]
  if (!size) return null
  const pages = (label: string): number => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(output)?.[1] ?? NaN)
  const used = pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')
  return Number.isFinite(used) ? used * Number(size) : null
}

/** `pmset -g batt`: " -InternalBattery-0 (id=1)  87%; charging; 1:02 remaining". Null without a battery. */
export function parseBattery(output: string): Battery | null {
  const percent = /(\d+)%;\s*([^;]+)/.exec(output)
  if (!percent) return null
  return { percent: Number(percent[1]), charging: !/discharging|not charging/i.test(percent[2] ?? '') }
}

/** `sysctl vm.swapusage`: "vm.swapusage: total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)". */
export function parseSwap(output: string): Pool | null {
  const read = (label: string): number | null => {
    const found = new RegExp(`${label} = ([\\d.]+)([KMG])`).exec(output)
    return found ? Number(found[1]) * 1024 ** ({ K: 1, M: 2, G: 3 }[found[2] as 'K' | 'M' | 'G']) : null
  }
  const total = read('total')
  const used = read('used')
  return total === null || used === null ? null : { usedBytes: Math.round(used), totalBytes: Math.round(total) }
}

async function memoryUsed(): Promise<number> {
  if (process.platform === 'darwin') {
    const used = parseVmStat((await run('vm_stat').catch(() => ({ stdout: '' }))).stdout)
    if (used !== null) return used
  }
  return totalmem() - freemem()
}

/** The previous reading, so the next call compares over the time between them rather than waiting. */
let previous: { at: number; times: CpuTimes } | null = null
const FRESH_MS = 10_000
const WAIT_MS = 250

async function cpuNow(): Promise<number | null> {
  const now = Date.now()
  let before = previous && now - previous.at < FRESH_MS && now - previous.at >= WAIT_MS ? previous : null
  if (!before) {
    before = { at: now, times: sampleCpu() }
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
  }
  const after = { at: Date.now(), times: sampleCpu() }
  previous = after
  return cpuPercent(before.times, after.times)
}

/** Current CPU, memory and disk use of the machine the host runs on. `path` picks the volume to measure. */
export async function systemMetrics(path: string): Promise<SystemMetrics> {
  const mac = process.platform === 'darwin'
  const out = (command: string, args: string[]) => run(command, args).then(({ stdout }) => stdout, () => '')
  const [cpu, used, disk, swap, battery, version] = await Promise.all([
    cpuNow(),
    memoryUsed(),
    run('df', ['-k', path]).then(({ stdout }) => parseDf(stdout), () => null),
    mac ? out('sysctl', ['vm.swapusage']).then(parseSwap) : null,
    mac ? out('pmset', ['-g', 'batt']).then(parseBattery) : null,
    mac ? out('sw_vers', ['-productVersion']) : '',
  ])
  const [first, second, third] = loadavg()
  return {
    cpuPercent: cpu,
    cpu: { model: cpus()[0]?.model ?? 'unknown', cores: cpus().length, arch: arch() },
    os: version.trim() ? `macOS ${version.trim()} (${type()} ${release()})` : `${type()} ${release()}`,
    uptimeSeconds: Math.round(uptime()),
    loadAverage: [first ?? 0, second ?? 0, third ?? 0],
    memory: { usedBytes: used, totalBytes: totalmem() },
    swap,
    battery,
    disk,
    host: { node: process.version, pid: process.pid, rssBytes: process.memoryUsage.rss(), uptimeSeconds: Math.round(process.uptime()) },
  }
}
