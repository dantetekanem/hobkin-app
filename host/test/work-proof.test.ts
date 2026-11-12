import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workFrom } from '../src/work.ts'

/** hobkin's work status as its snapshot carries it, with nothing in it. */
const status = { enabled: true, folder: null, autoPick: false, agents: 2, agentsAllowed: 2, paused: false, pause: null, waitingOn: null, queued: 0, plan: [], projects: [], forecast: null }

/** The one card a finished change makes, with what a test gives it. */
function card(rest: Record<string, unknown>) {
  const branch = { slug: 'api', project: 'api', item: 'abc123', title: 'Charge once', grade: 'P1', branch: 'hobkin/abc123-charge-once', head: 'f'.repeat(40), conflict: false, behind: 0, gap: 'land', ...rest }
  return workFrom({ work: status, waiting: { branches: [branch] } })!.finished.flatMap(({ changes }) => changes)[0]!
}

/** A line the card cut: at most `most` characters, the start of what was written, ended at a whole word with an ellipsis. */
function cutAtAWord(shown: string, written: string, most: number) {
  assert.ok(shown.length <= most && shown.endsWith('…'), shown)
  assert.ok(written.startsWith(shown.slice(0, -1)), 'the start of it')
  assert.match(written.slice(shown.length - 1), /^\W/, 'it ends at a whole word')
}

test('a card gets the whole proof hobkin sends, up to 2000 characters, and a longer one ends at its last whole word', () => {
  const sentence = 'The retry spec failed before the change and passes after it, with 14 cases in 3 files. '
  const whole = sentence.repeat(20).trim()
  const long = sentence.repeat(40).trim()

  assert.equal(card({ proof: whole.replace(' and passes', '\n\nand passes') }).proof, whole, 'all of it, on one line')
  const shown = card({ proof: long }).proof!
  assert.ok(shown.length > 1900, `${shown.length} characters`)
  cutAtAWord(shown, long, 2000)
})

test('what a change did stays a few lines on its card, and a longer one ends at its last whole word too', () => {
  const about = 'Retries no longer charge a customer twice. '.repeat(10).trim()

  cutAtAWord(card({ about }).about!, about, 280)
})
