import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AssessmentSummary } from '#shared/review/assessment.ts'
import { chatTeller, readyLine, type ReadyReview } from '../src/review/notify.ts'
import { temporaryDirectory } from './support.ts'

const summary: AssessmentSummary = { level: 'high', critical: true, needsYou: 2, worthALook: 1, safe: 3, storyBy: 'model', at: '2026-11-12T15:00:05.000Z' }
const change: ReadyReview = { id: 'change:shop:4c9e21', kind: 'change', title: 'Round the total', project: 'shop', head: '4c9e21aa4c9e21aa4c9e21aa', at: summary.at, summary }
const pull: ReadyReview = { id: 'pr:acme/web/12', kind: 'pull', title: 'Tighten the login form', project: 'acme/web', head: 'def5678def5678def5678', at: '2026-11-12T15:01:00.000Z' }

test('the chat line says which review is ready, its level when it has one, and how to open it', () => {
  assert.equal(
    readyLine(change),
    'The change review of "Round the total" in shop is ready: high risk, with something critical. 2 parts need you and 1 is worth a look. Open it from its card in Work, or from Work › AI Reviews.',
  )
  assert.equal(
    readyLine({ ...change, summary: { ...summary, level: 'mid', critical: false, needsYou: 0, worthALook: 1 } }),
    'The change review of "Round the total" in shop is ready: mid risk. 1 part is worth a look. Open it from its card in Work, or from Work › AI Reviews.',
  )
  assert.equal(
    readyLine({ ...change, summary: { ...summary, level: 'safe', critical: false, needsYou: 0, worthALook: 0 } }),
    'The change review of "Round the total" in shop is ready: safe. Open it from its card in Work, or from Work › AI Reviews.',
  )
  assert.equal(readyLine(pull), 'The AI review of acme/web#12 "Tighten the login form" is ready. Open it from Work › AI Reviews.')
})

test('hobkin is told in its chat once, as its own notice naming the review, and asked to show it', async (t) => {
  const home = temporaryDirectory(t)
  let shown = 0
  const tell = chatTeller({ data: () => home, refresh: () => (shown += 1) })
  await tell(change)
  await tell(change)
  const saved = readFileSync(join(home, 'runtime', 'client-notices.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(saved.map(({ key, tone, review }) => [key, tone, review]), [['review-ready:change:shop:4c9e21@4c9e21aa4c9e:2026-11-12T15:00:05.000Z', 'useful', 'change:shop:4c9e21']])
  assert.equal(saved[0]!.line, readyLine(change))
  assert.equal(shown, 1, 'the same news a second time adds nothing')

  // While hobkin is not open nothing is told, and nothing is held up.
  const logged: string[] = []
  const quiet = chatTeller({
    data: () => {
      throw new Error('hobkin is still starting.')
    },
    refresh: () => (shown += 1),
    log: (line) => logged.push(line),
  })
  await quiet(pull)
  assert.equal(shown, 1)
  assert.match(logged[0] ?? '', /pr:acme\/web\/12.*hobkin is still starting/)

  // A hobkin checkout from before its client notices runs the host all the same: the review is only not told.
  const older = chatTeller({
    data: () => home,
    refresh: () => (shown += 1),
    log: (line) => logged.push(line),
    notices: async () => Promise.reject(new Error("Cannot find module 'hobkin/src/cli/client-notices.mjs'")),
  })
  await older(pull)
  assert.equal(shown, 1)
  assert.match(logged[1] ?? '', /Cannot find module/)
})
