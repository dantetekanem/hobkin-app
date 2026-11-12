import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { progressFiles, trackProgress } from '../src/progress.ts'
import type { PlanStep, Progress } from '../src/types.ts'

const BASE = Date.UTC(2026, 10, 12, 3, 14, 2)

const plan: PlanStep[] = [
  { id: 'triage', estimate_seconds: 10 },
  { id: 'risk-model', estimate_seconds: 20, units: 4 },
  { id: 'story', estimate_seconds: 30 },
]

/** A tracker on a clock the test moves by hand, and every progress it wrote. */
function setup(write?: (progress: Progress) => void) {
  let at = BASE
  const written: Progress[] = []
  const tracker = trackProgress({
    review: 'a8042955db4b',
    mode: 'flagged-change',
    plan: { steps: plan },
    clock: () => new Date(at),
    write: write ?? ((progress) => written.push(progress)),
  })
  return { tracker, written, advance: (seconds: number) => (at += seconds * 1000) }
}

const summary = (progress: Progress) => [progress.percent, progress.eta_seconds, progress.remaining]

describe('trackProgress', () => {
  it('starts every step pending from the plan, writes a copy on every change, and reads times only from the clock', () => {
    const { tracker, written, advance } = setup()
    assert.equal(written.length, 0)

    const first = tracker.start('triage', 1, 'triage: sorting 4 files into buckets')
    assert.deepEqual(written, [first])
    assert.deepEqual([first.schema, first.review, first.mode, first.started_at, first.updated_at], ['review-progress/1', 'a8042955db4b', 'flagged-change', '2026-11-12T03:14:02Z', '2026-11-12T03:14:02Z'])
    assert.deepEqual(first.steps.map((step) => [step.id, step.status, step.done, step.total]), [['triage', 'running', 0, 1], ['risk-model', 'pending', 0, 4], ['story', 'pending', 0, 1]])
    assert.equal(first.now, 'triage: sorting 4 files into buckets')

    advance(3)
    assert.equal(tracker.say('triage: reading the description').now, 'triage: reading the description')
    const ended = tracker.end('triage')
    assert.equal(written.length, 3)
    assert.equal(ended.updated_at, '2026-11-12T03:14:05Z')
    assert.deepEqual(ended.steps[0], { id: 'triage', status: 'done', started_at: '2026-11-12T03:14:02Z', ended_at: '2026-11-12T03:14:05Z', seconds: 3, estimate_seconds: 10, done: 1, total: 1 })

    written[2]!.steps[0]!.status = 'failed'
    assert.equal(tracker.progress().steps[0]!.status, 'done')
  })

  it('weighs percent by estimates, scales the eta by measured time, and keeps skipped and failed steps with their note', () => {
    const { tracker, advance } = setup()
    assert.deepEqual(summary(tracker.progress()), [0, 60, { steps: 3, units: 4 }])

    tracker.start('triage', 1, 'triage: sorting files')
    advance(30)
    // Triage took 30 s against 10 estimated: three times slower, kept at twice.
    assert.deepEqual(summary(tracker.end('triage')), [16, 100, { steps: 2, units: 4 }])

    tracker.start('risk-model', 4, 'risk-model: node 1 of 4, round_money')
    assert.deepEqual(summary(tracker.tick('risk-model', 1, 'risk-model: node 2 of 4, totals_cache_key')), [25, 90, { steps: 2, units: 3 }])

    const skipped = tracker.skip('story', 'no model to ask')
    assert.deepEqual(summary(skipped), [75, 30, { steps: 1, units: 3 }])
    assert.deepEqual(skipped.steps[2], { id: 'story', status: 'skipped', started_at: null, ended_at: '2026-11-12T03:14:32Z', seconds: null, estimate_seconds: 30, done: 0, total: 1, note: 'no model to ask' })
    assert.equal(skipped.now, 'story: skipped, no model to ask')

    advance(30)
    const failed = tracker.fail('risk-model', 'the model did not answer')
    assert.deepEqual(summary(failed), [100, 0, { steps: 0, units: 0 }])
    assert.deepEqual([failed.steps[1]!.status, failed.steps[1]!.seconds, failed.steps[1]!.done, failed.steps[1]!.note], ['failed', 30, 1, 'the model did not answer'])
    assert.deepEqual(failed.steps.map((step) => step.id), ['triage', 'risk-model', 'story'])
  })

  it('refuses a step the plan does not hold', () => {
    const { tracker, written } = setup()
    assert.throws(() => tracker.start('blind-check', 1, 'blind-check: asking the checker'), /blind-check/)
    assert.equal(written.length, 0)
  })
})

describe('progressFiles', () => {
  it('rewrites progress.json whole and appends each progress as one line of progress.jsonl', () => {
    const root = mkdtempSync(join(tmpdir(), 'change-review-progress-'))
    try {
      const folder = join(root, '.review')
      const { tracker } = setup(progressFiles(folder))
      tracker.start('triage', 1, 'triage: sorting files')
      tracker.end('triage')

      const file = JSON.parse(readFileSync(join(folder, 'progress.json'), 'utf8')) as Progress
      assert.deepEqual(file, tracker.progress())
      const lines = readFileSync(join(folder, 'progress.jsonl'), 'utf8').trimEnd().split('\n').map((line) => JSON.parse(line) as Progress)
      assert.deepEqual(lines.map((line) => line.steps[0]!.status), ['running', 'done'])
      assert.deepEqual(lines[1], file)
      assert.deepEqual(readdirSync(folder).sort(), ['progress.json', 'progress.jsonl'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
