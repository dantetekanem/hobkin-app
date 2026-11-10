import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { triageOf } from '../ui/src/features/reports/report.ts'

const original = execFileSync('git', ['show', '7ae51c6:ui/src/features/reports/report.ts'], { encoding: 'utf8' })
const { triageOf: before } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(original)).toString('base64')}`)
const reports = []
for (const size of [0, 20, 200, 2000]) {
  for (const opening of ['Useful: Found a change.\n\nNext: Read the diff.', '**Nothing new.**', '## Details\n\nUseful: Not a triage marker.', 'Blocked: Sign in first.\r\n \t\r\nNext: Sign in.', 'Useful: Found it.\nContext first.\nNext: Too late.']) {
    for (const outcome of ['completed', 'failed']) {
      reports.push({ id: `case:${reports.length}`, title: 'Report', outcome, body: opening + '\n\n' + Array.from({ length: size }, (_, index) => `Detail ${index}: inspected a different part of the change.\n`).join('') })
    }
  }
}
for (const report of reports) assert.deepEqual(triageOf(report), before(report))
const measure = (parse) => {
  let checksum = 0
  const started = performance.now()
  for (let repetition = 0; repetition < 100; repetition++) for (const report of reports) checksum += parse(report)?.message?.length ?? 0
  return { ms: performance.now() - started, checksum }
}
measure(before)
measure(triageOf)
const baseline = []
const current = []
for (let sample = 0; sample < 5; sample++) {
  const order = sample % 2 ? [[triageOf, current], [before, baseline]] : [[before, baseline], [triageOf, current]]
  for (const [parse, results] of order) results.push(measure(parse))
}
assert.equal(baseline[0].checksum, current[0].checksum)
const median = (results) => results.map(({ ms }) => ms).sort((a, b) => a - b)[2]
console.log(JSON.stringify({ workload: 'triage only, not browser rendering', cases: reports.length, sizes: [0, 20, 200, 2000], baseline_ms: median(baseline), current_ms: median(current), equivalent: true }))
