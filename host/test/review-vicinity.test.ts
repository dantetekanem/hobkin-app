import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanVicinity, vicinityOf, type ScanRun } from '../src/review/vicinity-scan.ts'

/** The parts of an agentic-search scan the review reads, as `scan --json` writes them under `details`. */
const details = {
  nodes: [
    { id: 'n1', path: 'src/doing.ts', symbol: 'toolDoing', startLine: 3, endLine: 5, depth: 0 },
    { id: 'n2', path: 'src/runtime.ts', symbol: 'listen', startLine: 2, endLine: 5, depth: 0 },
    { id: 'n9', path: 'src/mood.ts', symbol: 'searchingTool', startLine: 1, endLine: 3, depth: 1 },
    { id: 'n10', path: 'src/app.ts', symbol: 'start', startLine: 2, endLine: 4, depth: 1 },
    { id: 'n11', path: 'test/app.test.ts', symbol: 'starts', startLine: 1, endLine: 3, depth: 1 },
  ],
  edges: [
    { from: 'n1', to: 'n9', name: 'searchingTool', relationship: 'calls', resolution: 'exact', via: 'checker', line: 4 },
    { from: 'n1', name: 'event.name', relationship: 'calls', resolution: 'unresolved', line: 4 },
    { from: 'n1', name: 'readFileSync', relationship: 'calls', resolution: 'external', line: 4 },
    { from: 'n10', to: 'n2', name: 'listen', relationship: 'called_by', resolution: 'static_candidate', line: 3 },
    { from: 'n11', to: 'n2', name: 'listen', relationship: 'called_by', resolution: 'static_candidate', line: 2, note: 'test' },
  ],
  coverage: { truncatedBy: null },
}

test('a scan becomes the calls the checker proved and the callers outside the tests', () => {
  assert.deepEqual(vicinityOf(details), {
    links: [
      { changed: { path: 'src/doing.ts', line: 4 }, other: { path: 'src/mood.ts', symbol: 'searchingTool', startLine: 1, endLine: 3 }, direction: 'callee' },
      { changed: { path: 'src/runtime.ts', line: 2 }, other: { path: 'src/app.ts', symbol: 'start', startLine: 2, endLine: 4 }, direction: 'caller' },
    ],
  })
  assert.match(vicinityOf({ ...details, coverage: { truncatedBy: 'max_nodes' } }).notice ?? '', /stopped early/)
  assert.equal(vicinityOf({ ...details, coverage: { truncatedBy: 'none' } }).notice, undefined, 'a scan that reached everything says nothing')
})

test('the scan runs on the change at its commits, and a scan that cannot run says why instead of stopping the review', async () => {
  const calls: string[][] = []
  const run: ScanRun = async (args) => {
    calls.push([...args])
    return { ok: true, stdout: JSON.stringify({ text: '', details }) }
  }
  const found = await scanVicinity({ repo: '/repo.invalid', base: 'aaa1111', head: 'bbb2222', run })
  assert.equal(found.links.length, 2)
  assert.deepEqual(calls[0]!.slice(0, 6), ['scan', '--diff', 'aaa1111..bbb2222', '--cwd', '/repo.invalid', '--json'])

  const missing = await scanVicinity({ repo: '/repo.invalid', base: 'a', head: 'b', run: async () => ({ ok: false, reason: 'agentic-search is not installed.' }) })
  assert.deepEqual(missing.links, [])
  assert.match(missing.notice ?? '', /not shown.*agentic-search is not installed/)

  const garbled = await scanVicinity({ repo: '/repo.invalid', base: 'a', head: 'b', run: async () => ({ ok: true, stdout: 'not json' }) })
  assert.deepEqual(garbled.links, [])
  assert.match(garbled.notice ?? '', /not shown/)
})
