/**
 * Reads a `.cpuprofile` from `host-load.ts --profile`: self time by area (host/src, shared, the hobkin runtime, node,
 * GC), the top functions by self and by total time, and on request who calls a function or the total time of every
 * function that matches a pattern (for awaited code whose stacks split).
 * Usage: node scripts/perf/host/analyze.ts <file.cpuprofile> [top=15] [--callers <function> [depth=4]] [--total <regex>]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

interface Frame { functionName: string; url: string; lineNumber: number }
interface Node { id: number; callFrame: Frame; children?: number[] }
interface Profile { nodes: Node[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] }

const CLIENT = pathToFileURL(fileURLToPath(new URL('../../../', import.meta.url))).href
const RUNTIME = pathToFileURL(realpathSync(fileURLToPath(new URL('../../../node_modules/hobkin/', import.meta.url))) + '/').href

const short = (url: string) => url.replace(CLIENT, 'client/').replace(RUNTIME, 'hobkin/').replace(/^file:\/\/.*\/node_modules\/(\.pnpm\/)?/, 'nm/')
const name = ({ callFrame: frame }: Node) => `${frame.functionName || '(anonymous)'} ${short(frame.url)}:${frame.lineNumber + 1}`
const area = ({ callFrame: { url, functionName } }: Node) => {
  if (!url) return ['(garbage collector)', '(idle)', '(program)', '(root)'].includes(functionName) ? functionName : '(native/builtin)'
  if (url.startsWith(`${CLIENT}host/`)) return 'host/src'
  if (url.startsWith(`${CLIENT}shared/`)) return 'shared'
  if (url.startsWith(`${CLIENT}scripts/perf/`)) return 'lab driver'
  if (url.includes('/node_modules/ws/')) return 'ws'
  if (url.startsWith(`${RUNTIME}src/`)) return 'hobkin runtime'
  if (url.startsWith(RUNTIME)) return 'runtime deps'
  if (url.startsWith('node:')) return 'node internals'
  return `other: ${short(url).split('/').slice(0, 3).join('/')}`
}

export function analyze(file: string, top = 15): string {
  const { profile, selfUs, parent, wallUs } = read(file)
  const self = new Map<string, number>()
  const areas = new Map<string, number>()
  const total = new Map<string, number>()
  for (const [id, us] of selfUs) {
    const node = profile.byId.get(id)!
    add(self, name(node), us)
    add(areas, area(node), us)
    // Each sample counts once for every distinct function on its stack.
    const seen = new Set<string>()
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const above = profile.byId.get(at)!
      if (seen.has(name(above)) || ['(root)', '(program)', '(idle)'].includes(above.callFrame.functionName)) continue
      seen.add(name(above))
      add(total, name(above), us)
    }
  }
  const busy = [...areas].filter(([key]) => key !== '(idle)').reduce((sum, [, us]) => sum + us, 0)
  const table = (title: string, rows: Map<string, number>, count: number) => [
    '', title, '| ms per s | share | function |', '| ---: | ---: | --- |',
    ...[...rows].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key, us]) => `| ${(us / 1000 / (wallUs / 1e6)).toFixed(2)} | ${((us / wallUs) * 100).toFixed(2)}% | \`${key}\` |`),
  ]
  return [
    `profile ${file}: ${(wallUs / 1e6).toFixed(1)} s, busy ${(busy / 1000 / (wallUs / 1e6)).toFixed(1)} ms per s (${((busy / wallUs) * 100).toFixed(1)}% of a core on the main thread)`,
    ...table('Self time by area', areas, 20),
    ...table(`Top ${top} by self time`, new Map([...self].filter(([key]) => !key.startsWith('(idle)'))), top),
    ...table(`Top ${top + 10} by total time`, new Map([...total].filter(([key]) => !/^\(anonymous\) :0|^\(garbage/.test(key))), top + 10),
  ].join('\n')
}

/** The self time of `wanted`, grouped by the chain of callers above it. */
export function callers(file: string, wanted: string, depth = 4): string {
  const { profile, selfUs, parent, wallUs } = read(file)
  const chains = new Map<string, number>()
  for (const [id, us] of selfUs) {
    if (profile.byId.get(id)!.callFrame.functionName !== wanted) continue
    const chain: string[] = []
    for (let at = parent.get(id); at !== undefined && chain.length < depth; at = parent.get(at)) chain.push(name(profile.byId.get(at)!))
    add(chains, chain.join(' < '), us)
  }
  return [...chains].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([chain, us]) => `${(us / 1000 / (wallUs / 1e6)).toFixed(2)} ms/s  ${chain}`).join('\n')
}

/** The total time of every function whose name and place match `pattern`. */
export function totals(file: string, pattern: string): string {
  const { profile, selfUs, parent, wallUs } = read(file)
  const matches = new RegExp(pattern)
  const found = new Map<string, number>()
  for (const [id, us] of selfUs) {
    const seen = new Set<string>()
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const key = name(profile.byId.get(at)!)
      if (matches.test(key) && !seen.has(key)) {
        seen.add(key)
        add(found, key, us)
      }
    }
  }
  return [...found].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, us]) => `${(us / 1000 / (wallUs / 1e6)).toFixed(2)} ms/s  ${key}`).join('\n')
}

function read(file: string) {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Profile
  const profile = { ...raw, byId: new Map(raw.nodes.map((node) => [node.id, node])) }
  const parent = new Map<number, number>()
  for (const node of raw.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  // Each sample's time is the delta that follows it.
  const selfUs = new Map<number, number>()
  raw.samples.forEach((id, index) => add(selfUs, id, raw.timeDeltas[index + 1] ?? raw.timeDeltas[index] ?? 0))
  return { profile, selfUs, parent, wallUs: raw.endTime - raw.startTime }
}

function add<Key>(map: Map<Key, number>, key: Key, us: number) {
  map.set(key, (map.get(key) ?? 0) + us)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, ...rest] = process.argv.slice(2)
  if (!file) throw Error('Usage: node scripts/perf/host/analyze.ts <file.cpuprofile> [top] [--callers <function> [depth]] [--total <regex>]')
  const option = (flag: string) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined)
  const wanted = option('--callers')
  const pattern = option('--total')
  if (wanted) console.log(callers(file, wanted, Number(rest[rest.indexOf('--callers') + 2] ?? 4)))
  else if (pattern) console.log(totals(file, pattern))
  else console.log(analyze(file, Number(rest[0] ?? 15)))
}
