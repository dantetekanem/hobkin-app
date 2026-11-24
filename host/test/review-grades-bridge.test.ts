import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { ReviewNeeds } from '#shared/review/needs.ts'
import { GradesBridge, gradesOf } from '../src/review/grades.ts'

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const target = { kind: 'change', slug: 'shop', item: 'c1' } as const
const score = (value: number) => ({ score: value, evidence: `Because of ${value}.` })

/** A finished review's five ratings as the engine's graph holds them, with the rate and floors hobkin's formula adds. */
const rated = (over: Partial<ReviewNeeds> = {}): ReviewNeeds => ({
  kind: 'bug-fix',
  scores: { coverage: score(8), proof: score(7), safety: score(9), visibility: { ...score(3), byRule: true } as never, rollback: score(8) },
  rate: 7.0,
  floors: [{ name: 'visibility', score: 3, needs: 7 }],
  head: HEAD,
  by: 'change-review',
  monitoring: 'unknown',
  at: '2026-11-24T10:00:00.000Z',
  ...over,
})

/** A runtime that keeps what it is given, and refuses what it is told to, as hobkin's own does with an incomplete record. */
function fakeRuntime(refuse?: string) {
  const calls: unknown[][] = []
  return { calls, recordGrades: (...args: unknown[]) => (calls.push(args), refuse ? Promise.reject(new Error(refuse)) : { ok: true }) }
}

const bridge = (runtime: ReturnType<typeof fakeRuntime> | null, log: string[] = []) =>
  new GradesBridge({ root: () => '/home/none', runtime: async () => (runtime ? { recordGrades: runtime.recordGrades as never } : {}), log: (line) => log.push(line) })

test('a finished review at the commit the change is at is recorded once, as the five scores and a kind only', async () => {
  const runtime = fakeRuntime()
  const grades = bridge(runtime)
  assert.deepEqual(await grades.send(target, rated(), HEAD), { state: 'recorded' })
  assert.equal(runtime.calls.length, 1)
  const [root, slug, item, sent] = runtime.calls[0]!
  assert.deepEqual([root, slug, item], ['/home/none', 'shop', 'c1'])
  // No rate, no floors, no marks of the engine: hobkin works the rate out from the five.
  assert.deepEqual(Object.keys(sent as object).sort(), ['head', 'kind', 'scores'])
  assert.deepEqual((sent as { scores: Record<string, unknown> }).scores.visibility, score(3))
  assert.equal((sent as { head: string }).head, HEAD)

  // Looked at again at every refresh, it is told once.
  assert.deepEqual(await grades.send(target, rated(), HEAD), { state: 'recorded' })
  assert.equal(runtime.calls.length, 1)
})

test('only ratings the host itself built, complete, for the commit the change is at, and for a change, go to the runtime', async () => {
  const runtime = fakeRuntime()
  const grades = bridge(runtime)
  const noKind = rated()
  delete noKind.kind
  const four = rated()
  delete four.scores.rollback

  const refused: [string, ReviewNeeds | null, string | null, typeof target | { kind: 'pull'; owner: string; repo: string; number: number }][] = [
    ['no kind', noKind, HEAD, target],
    ['four scores', four, HEAD, target],
    ['hobkin\'s own scored run', rated({ by: 'hobkin' }), HEAD, target],
    ['made at another commit', rated({ head: OTHER }), HEAD, target],
    ['the change is at no known commit', rated(), null, target],
    ['no ratings', null, HEAD, target],
    ['a pull request that is not a change', rated(), HEAD, { kind: 'pull', owner: 'acme', repo: 'api', number: 4 }],
  ]
  for (const [why, needs, head, aim] of refused) {
    const outcome = await grades.send(aim as never, needs, head)
    assert.equal(outcome.state, 'skipped', why)
  }
  assert.deepEqual(runtime.calls, [], 'nothing reached the runtime')

  // A change that moved is rated again at its new commit, and that goes.
  assert.deepEqual(await grades.send(target, rated({ head: OTHER }), OTHER), { state: 'recorded' })
  assert.equal(runtime.calls.length, 1)
})

test("the runtime's refusal is kept in its words and not asked again for that commit, and a hobkin without the door says so and goes on", async () => {
  const log: string[] = []
  const runtime = fakeRuntime('The item is not finished work.')
  const grades = bridge(runtime, log)
  assert.deepEqual(await grades.send(target, rated(), HEAD), { state: 'refused', why: 'The item is not finished work.' })
  assert.deepEqual(await grades.send(target, rated(), HEAD), { state: 'refused', why: 'The item is not finished work.' })
  assert.equal(runtime.calls.length, 1)
  assert.match(log.join('\n'), /The item is not finished work\./)

  const older = bridge(null)
  assert.deepEqual(await older.send(target, rated(), HEAD), { state: 'unavailable' })
  // Once hobkin has it, the same review goes, with nothing built again.
  const later = fakeRuntime()
  let have: ReturnType<typeof fakeRuntime> | null = null
  const grown = new GradesBridge({ root: () => '/h', runtime: async () => (have ? { recordGrades: have.recordGrades as never } : {}) })
  assert.equal((await grown.send(target, rated(), HEAD)).state, 'unavailable')
  have = later
  assert.equal((await grown.send(target, rated(), HEAD)).state, 'recorded')
  assert.equal(later.calls.length, 1)
})

test("an agent's run cannot write grades: no command, tool or channel of the app carries them to the runtime", () => {
  const names = Object.keys(COMMANDS)
  assert.deepEqual(names.filter((name) => /grade/i.test(name) || /grade/i.test(COMMANDS[name as keyof typeof COMMANDS].description)), [])
  assert.equal(gradesOf(rated({ by: 'hobkin' }), HEAD), null)
})
