import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import type { AssessmentStatus, AssessmentSummary, ChangeAssessment, Deploy, Unit } from '#shared/review/assessment.ts'
import { targetOfReviewId, type ReviewTarget } from '#shared/review/ids.ts'
import type { Review, ReviewFileContents } from '#shared/review/types.ts'
import { Reviews } from '../src/review/reviews.ts'
import type { RiskWork } from '../src/review/risk-fix.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const SAMPLE = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const FILES = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/files.json', import.meta.url), 'utf8')) as ReviewFileContents[]
const [H1, H2, H3] = [SAMPLE.change.head, '2'.repeat(40), '3'.repeat(40)]
const id = 'change:hobkin:7d02c9'
const START = Date.parse('2026-11-21T12:00:00Z')

const BREAK: Unit = {
  id: 'u1',
  title: '`total` rounds 2.675 down to 2.67',
  level: 'high',
  critical: false,
  nodes: ['n1'],
  grouping: 'single',
  story_order: 0,
  where: 'on the path, called by `POST /orders`',
  what: 'It rounds the total before it is charged.',
  code: [{ path: 'src/total.js', lines: [12, 18], why: 'the changed lines', diff: '' }],
  facts: { effect: { value: 'data', evidence: 'writes `orders.total`' }, proof: { value: 'none', evidence: 'no test reaches it' }, exposure: { value: 'everyone', evidence: 'every checkout' }, undo: { value: 'rollback', evidence: 'a deploy' } },
  why_level: ['It changes data it writes, sends or keeps, everyone runs it, and no test goes through a request to it.'],
  would_change: [],
  watch: 'not assessed',
  questions: [],
  reading_minutes: 2,
}

const summaryOf = (deploy: Deploy): AssessmentSummary => ({ level: deploy === 'risky' ? 'high' : 'mid', critical: false, needsYou: deploy === 'risky' ? 1 : 0, worthALook: 0, safe: 0, storyBy: 'model', at: '2026-11-21T12:00:00.000Z', deploy, why: 'It can break.' })

/**
 * Reviews of one finished hobkin change, with change reviews whose answers a test sets for each commit, hobkin's own
 * work on the change as the test moves it, and a hobkin that writes down each work action it is asked.
 */
function seated(t: TestContext) {
  const store = reviewStore(temporaryDirectory(t))
  const target = targetOfReviewId(id)!
  store.write(target, SAMPLE, FILES)
  const answers = new Map<string, Deploy>()
  const work: RiskWork = { at: 'finished', head: H1, left: null, held: null }
  const actions: unknown[][] = []
  const asked: ReviewTarget[] = []
  const hobkin = { refuse: null as string | null }
  let clock = START
  // A finished review at each commit the test answered, with its one unit: the part that can break.
  const finished = (head: string): ChangeAssessment => ({
    head,
    summary: summaryOf(answers.get(head)!),
    story: '',
    units: { schema: 'review-units/1', map: 'node-level', attention: { units: 1, reading_minutes: 2 }, units: [BREAK] },
    triage: null,
    blind: null,
    progress: null,
    nodes: [],
  })
  const assessments = {
    status: (_target: ReviewTarget, head: string | null): AssessmentStatus => (head && answers.has(head) ? { state: 'ready', head, summary: summaryOf(answers.get(head)!) } : { state: 'idle', head }),
    read: (_target: ReviewTarget, head: string): ChangeAssessment | null => (answers.has(head) ? finished(head) : null),
    start: () => ({ state: 'queued', head: null }),
    stop: () => false,
    pending: () => [],
    present: () => null,
    busy: () => false,
    forget: () => {},
    close: () => {},
  }
  const reviews = new Reviews({
    store,
    sources: { change: { head: async () => work.head, read: async () => Promise.reject(new Error('Nothing is read here.')) }, pull: { head: async () => null, read: async () => Promise.reject(new Error('No pull requests here.')) } },
    work: () => ({
      workAction: async (...args: unknown[]) => {
        if (hobkin.refuse) throw new Error(hobkin.refuse)
        actions.push(args)
        return args[0] === 'riskStays' ? { message: 'It waits in Action Items.', action: 'action-1' } : { message: `hobkin did ${String(args[0])}.` }
      },
    }),
    card: () => (work.at === 'finished' ? { landing: 'merge', yes: 'Merge it here.', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', pr: null } : null),
    head: () => (work.at === 'finished' ? work.head : null),
    ownWork: (change) => {
      asked.push(change)
      return { ...work }
    },
    assessments: assessments as never,
    now: () => clock,
  })
  t.after(() => reviews.close())
  /** What the window is told hobkin does about the answer at the change's commit now. */
  const fixNow = () => reviews.status(id).assessment?.fix
  /** The same for the review of the first commit, as its opened page reads it, wherever the change is now. */
  const fixOfFirstReview = () => reviews.get(id).status.assessment?.fix
  return { reviews, answers, work, actions, asked, hobkin, fixNow, fixOfFirstReview, later: (ms: number) => (clock += ms) }
}

test("a finished change whose AI review says risky gets hobkin's agent back with what was found, once for its commit, twice at most, then it is the user's", async (t) => {
  const { reviews, answers, work, actions, fixNow, fixOfFirstReview } = seated(t)
  answers.set(H1, 'risky')

  await reviews.settleRisk(id)
  assert.equal(actions.length, 1)
  const [action, slug, item, sent] = actions[0] as [string, string, string, { head: string; findings: string }]
  assert.deepEqual([action, slug, item, sent.head], ['fixRisk', 'hobkin', '7d02c9', H1])
  assert.match(sent.findings, /^1 part can break\.\n\n1\. `total` rounds 2\.675 down to 2\.67\./)
  assert.match(sent.findings, /Why it is high: It changes data it writes, sends or keeps, everyone runs it, and no test goes through a request to it\./)

  // hobkin put it back in the queue: the window says an agent is on it, and nothing goes twice for this commit.
  work.at = 'working'
  assert.deepEqual(fixOfFirstReview(), { state: 'fixing', round: 1, rounds: 2 })
  await reviews.settleRisk(id)
  assert.equal(actions.length, 1)

  // The agent moved it on, and the new commit's review is risky too: the second round, the last.
  Object.assign(work, { at: 'finished', head: H2 })
  answers.set(H2, 'risky')
  assert.deepEqual(fixOfFirstReview(), { state: 'fixed', round: 1, rounds: 2 }, 'the older review says its fix is in a newer commit')
  await reviews.settleRisk(id)
  assert.deepEqual(actions.map(([name, , , value]) => [name, (value as { head: string }).head]), [['fixRisk', H1], ['fixRisk', H2]])

  // Still risky after two rounds: no third agent, one Action Item with what remains.
  Object.assign(work, { at: 'finished', head: H3 })
  answers.set(H3, 'risky')
  await reviews.settleRisk(id)
  assert.equal(actions.length, 3)
  const [stays, , , left] = actions[2] as [string, string, string, { head: string; rounds: number; why: string; findings: string }]
  assert.deepEqual([stays, left.head, left.rounds, left.why], ['riskStays', H3, 2, 'rounds'])
  assert.match(left.findings, /`total` rounds 2\.675 down to 2\.67/)
  assert.deepEqual(fixNow(), { state: 'waiting', round: 2, rounds: 2, why: 'rounds', action: 'action-1' })
  await reviews.settleRisk(id)
  assert.equal(actions.length, 3, 'it is filed once')
})

test("a round that comes back at the commit it went for changed nothing, so the change is the user's", async (t) => {
  const { reviews, answers, actions, fixNow } = seated(t)
  answers.set(H1, 'risky')
  await reviews.settleRisk(id)
  // Its run ended, and the change is back on Work at the same commit.
  assert.deepEqual(fixNow(), { state: 'waiting', round: 1, rounds: 2, why: 'unchanged' })

  await reviews.settleRisk(id)
  assert.deepEqual(actions.map(([name]) => name), ['fixRisk', 'riskStays'])
  assert.deepEqual(actions[1]!.slice(1, 3), ['hobkin', '7d02c9'])
  assert.deepEqual({ ...(actions[1]![3] as object), findings: undefined }, { head: H1, rounds: 1, why: 'unchanged', findings: undefined })
  assert.deepEqual(fixNow(), { state: 'waiting', round: 1, rounds: 2, why: 'unchanged', action: 'action-1' })
})

test('nothing is sent for a safe answer, a pull request, a step left for the user, a commit the user gave a verdict on, or while work mode starts nothing', async (t) => {
  const { reviews, answers, work, actions, asked, fixNow } = seated(t)
  answers.set(H1, 'safe')
  await reviews.settleRisk(id)
  assert.equal(fixNow(), undefined)

  // Someone else's pull request is theirs to fix: hobkin's own work is not even asked.
  await reviews.settleRisk('pr:acme/shop/482')
  assert.ok(!asked.some((target) => target.kind === 'pull'))

  answers.set(H1, 'risky')
  work.left = 'It needs the payment provider key, which only you have.'
  await reviews.settleRisk(id)
  assert.deepEqual(fixNow(), { state: 'waiting', round: 0, rounds: 2, why: 'left' })
  work.left = null

  work.held = 'work mode is off'
  await reviews.settleRisk(id)
  assert.deepEqual(fixNow(), { state: 'fixing', round: 1, rounds: 2, held: 'work mode is off' })
  assert.equal(actions.length, 0)

  // The user asks for changes on this very commit from its review: hobkin sends nothing of its own for it.
  work.held = null
  const preview = await reviews.preview(id, 'request-changes', 'Round half up.')
  await reviews.verdict(id, 'request-changes', 'Round half up.', preview.confirm)
  assert.deepEqual(actions.map(([name]) => name), ['ask'])
  await reviews.settleRisk(id)
  assert.deepEqual(actions.map(([name]) => name), ['ask'])
  assert.equal(fixNow(), undefined, 'the user decided: hobkin says nothing over them')
})

test('the background sends what waited: once hobkin is open again, and once work mode runs again', async (t) => {
  const { reviews, answers, work, actions, hobkin, later } = seated(t)
  answers.set(H1, 'risky')
  hobkin.refuse = 'hobkin is not open in this host yet.'
  reviews.watch([{ id, head: H1 }])
  await reviews.settledRisk()
  assert.equal(actions.length, 0)

  // hobkin opens. The host publishes often, and it is asked again no sooner than a minute later.
  hobkin.refuse = null
  reviews.watch([{ id, head: H1 }])
  await reviews.settledRisk()
  assert.equal(actions.length, 0)
  later(61_000)
  work.held = 'work mode is paused'
  reviews.watch([{ id, head: H1 }])
  await reviews.settledRisk()
  assert.equal(actions.length, 0, 'nothing goes while work mode is paused')
  work.held = null
  later(61_000)
  reviews.watch([{ id, head: H1 }])
  await reviews.settledRisk()
  assert.deepEqual(actions.map(([name, , , value]) => [name, (value as { head: string }).head]), [['fixRisk', H1]])

  // Sent: later publishes send nothing more.
  later(61_000)
  reviews.watch([{ id, head: H1 }])
  await reviews.settledRisk()
  assert.equal(actions.length, 1)
})
