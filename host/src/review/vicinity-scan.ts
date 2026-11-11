/**
 * The vicinity of a change, from agentic-search: a static call-graph scan of the change at its commits, read from git
 * at those commits, never from the checkout. The review shows what the changed code calls, as the checker proved
 * it, and what calls the changed code outside the tests. A scan that cannot run leaves a notice and nothing else, so
 * a review is never held up by it.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Vicinity, VicinityLink } from '#shared/review/vicinity.ts'

/** Runs agentic-search with these arguments: what it wrote, or why it could not. */
export type ScanRun = (args: readonly string[]) => Promise<{ ok: true; stdout: string } | { ok: false; reason: string }>

export const SCAN_TIMEOUT_MS = 60_000
const MAX_OUTPUT = 32 * 1024 * 1024

/** Where agentic-search is found when the app's PATH does not have it: pnpm's and Homebrew's folders. */
const PLACES = [join(homedir(), 'Library', 'pnpm', 'bin'), join(homedir(), '.local', 'share', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin']

export function findAgenticSearch({ path = process.env.PATH ?? '', places = PLACES }: { path?: string; places?: readonly string[] } = {}): string | null {
  for (const folder of [...path.split(delimiter), ...places]) {
    if (!folder) continue
    const file = join(folder, 'agentic-search')
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}

/** agentic-search as a program of its own, never through a shell, stopped when it takes too long. */
export function spawnScan({ file, timeoutMs = SCAN_TIMEOUT_MS }: { file?: string | null; timeoutMs?: number } = {}): ScanRun {
  return (args) =>
    new Promise((resolve) => {
      const program = file === undefined ? findAgenticSearch() : file
      if (!program) return resolve({ ok: false, reason: 'agentic-search is not installed.' })
      const child = spawn(program, [...args], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (outcome: Awaited<ReturnType<ScanRun>>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      }
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ ok: false, reason: `the scan took longer than ${Math.round(timeoutMs / 1000)} seconds.` })
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_OUTPUT) {
          child.kill('SIGTERM')
          return finish({ ok: false, reason: 'the scan wrote more than expected.' })
        }
        out.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (error) => finish({ ok: false, reason: error.message }))
      child.on('close', (code) => {
        if (code === 0) return finish({ ok: true, stdout: Buffer.concat(out).toString('utf8') })
        const said = Buffer.concat(err).toString('utf8').trim().split('\n')[0]?.replace(/^agentic-search:\s*/, '')
        finish({ ok: false, reason: said || `it stopped with code ${code}.` })
      })
    })
}

interface ScanNode {
  id: string
  path: string
  symbol: string
  startLine: number
  endLine: number
}

interface ScanEdge {
  from: string
  to?: string
  relationship: string
  resolution: string
  line?: number
  note?: string
}

/** Calls the checker resolved to a definition in the repository. Unresolved and external calls are left out. */
const PROVED = new Set(['exact', 'local'])

/** A scan's links: what each changed definition calls, and what outside the tests calls it. */
export function vicinityOf(details: { nodes?: unknown; edges?: unknown; coverage?: { truncatedBy?: unknown } }): Vicinity {
  const nodes = new Map((Array.isArray(details.nodes) ? (details.nodes as ScanNode[]) : []).map((node) => [node.id, node]))
  const definition = (node: ScanNode) => ({ path: node.path, symbol: node.symbol, startLine: node.startLine, endLine: node.endLine })
  const links: VicinityLink[] = []
  for (const edge of Array.isArray(details.edges) ? (details.edges as ScanEdge[]) : []) {
    const from = nodes.get(edge.from)
    const to = edge.to ? nodes.get(edge.to) : undefined
    if (!from || !to) continue
    if (edge.relationship === 'calls' && PROVED.has(edge.resolution)) {
      links.push({ changed: { path: from.path, line: edge.line ?? from.startLine }, other: definition(to), direction: 'callee' })
    } else if (edge.relationship === 'called_by' && edge.note !== 'test') {
      links.push({ changed: { path: to.path, line: to.startLine }, other: definition(from), direction: 'caller' })
    }
  }
  // The scan says `none` when nothing cut it short.
  const stopped = details.coverage?.truncatedBy
  return { links, ...(stopped && stopped !== 'none' ? { notice: `The call-graph scan stopped early (${String(stopped)}), so some callers and callees may be missing.` } : {}) }
}

/** Scans the change from `base` to `head` in `repo`. Its pack holds source, so it is written to a folder of its own and removed. */
export async function scanVicinity({ repo, base, head, run = spawnScan() }: { repo: string; base: string; head: string; run?: ScanRun }): Promise<Vicinity> {
  const notShown = (why: string): Vicinity => ({ links: [], notice: `Callers and callees are not shown: ${why}` })
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-review-scan-'))
  try {
    const answer = await run([
      'scan',
      '--diff', `${base}..${head}`,
      '--cwd', repo,
      '--json',
      // One hop around the change: what it calls and what calls it.
      '--max-depth', '1',
      '--max-anchors', '60',
      '--max-nodes', '120',
      '--budget-ms', '30000',
      '--output-dir', join(folder, 'pack'),
    ])
    if (!answer.ok) return notShown(answer.reason)
    const parsed = JSON.parse(answer.stdout) as { details?: Parameters<typeof vicinityOf>[0] }
    if (!parsed.details) return notShown('the scan answered without its details.')
    return vicinityOf(parsed.details)
  } catch {
    return notShown('the scan answered with something other than its report.')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
