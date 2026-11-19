import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { peopleFinder, pullPeople } from '../src/review/people.ts'
import { temporaryDirectory } from './support.ts'

const LOOKUP = { command: ['corp-people', '--email', '{email}'], profile: 'https://people.example.invalid/u/{id}' }
const DAY = 24 * 60 * 60_000

/** A lookup that answers from a table, writing down every email it was asked for. */
function finder(t: Parameters<typeof temporaryDirectory>[0], table: Record<string, unknown>, { fails = false, lookup = LOOKUP as typeof LOOKUP | null } = {}) {
  const asked: string[] = []
  let clock = Date.parse('2026-11-19T12:00:00Z')
  const run = async (_file: string, args: readonly string[]) => {
    const email = args.at(-1)!
    asked.push(email)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const out = Buffer.from(email in table ? JSON.stringify(table[email]) : 'null')
    return fails ? { started: false as const, reason: 'corp-people is not installed' } : { started: true as const, code: 0, signal: null, timedOut: false, aborted: false, overflow: false, stdout: out, stderr: Buffer.from(''), tail: '', seconds: 0 }
  }
  const file = join(temporaryDirectory(t), 'people.json')
  const find = peopleFinder({ file: () => file, lookup: () => lookup ?? undefined, run, now: () => clock })
  return { find, asked, later: (ms: number) => (clock += ms) }
}

test('a person is looked up by email once and kept; two asks at once make one lookup; someone not found is asked again the next day', async (t) => {
  const { find, asked, later } = finder(t, { 'ana@example.invalid': { id: 'ana.souza', name: 'Ana Souza' } })
  const [first, second] = await Promise.all([find('Ana@Example.invalid'), find('ana@example.invalid')])
  assert.deepEqual(first, { name: 'Ana Souza', url: 'https://people.example.invalid/u/ana.souza' })
  assert.deepEqual(second, first)
  assert.deepEqual(await find('ana@example.invalid'), first)
  assert.deepEqual(asked, ['ana@example.invalid'], 'one lookup')

  assert.equal(await find('bo@example.invalid'), null)
  assert.equal(await find('bo@example.invalid'), null)
  assert.equal(asked.length, 2, 'not found is kept for a day')
  later(DAY + 1)
  await find('bo@example.invalid')
  assert.equal(asked.length, 3)
})

test('a lookup that cannot run keeps nothing; none is made without a finder or for a malformed email; an id that is not plain gives no link', async (t) => {
  const failing = finder(t, {}, { fails: true })
  assert.equal(await failing.find('ana@example.invalid'), null)
  await failing.find('ana@example.invalid')
  assert.equal(failing.asked.length, 2, 'asked again, since nothing was kept')

  const none = finder(t, {}, { lookup: null })
  assert.equal(await none.find('ana@example.invalid'), null)
  const plain = finder(t, { 'odd@example.invalid': { id: 'a/../b', name: 'Odd' } })
  assert.equal(await plain.find('not an email'), null)
  assert.deepEqual([none.asked, plain.asked], [[], []])
  assert.deepEqual(await plain.find('odd@example.invalid'), { name: 'Odd' })
})

test('who a pull request is from: its author, or the agent that opened it and the first person its requested-by line names, never one after modified by', async () => {
  const known: Record<string, { name: string; url?: string }> = { 'ana@example.invalid': { name: 'Ana Souza', url: 'https://people.example.invalid/u/ana' } }
  const find = async (email: string) => known[email] ?? null
  const agents = [{ host: 'github', login: 'helper-bot[bot]', name: 'Helper' }, { host: 'corp', login: 'corp-bot', name: 'Corp Helper' }]
  const github = { kind: 'pull' as const, owner: 'acme', repo: 'shop', number: 1 }
  const corp = { ...github, host: 'corp' }
  assert.deepEqual(await pullPeople({ target: github, author: 'dev', description: '', agents, find }), { author: { name: 'dev', url: 'https://github.com/dev' } })
  assert.deepEqual(await pullPeople({ target: github, author: 'renovate[bot]', description: '', agents, find }), { author: { name: 'renovate[bot]', url: 'https://github.com/apps/renovate' } })
  assert.deepEqual(await pullPeople({ target: github, author: 'helper-bot[bot]', description: 'Requested by: Ana <ana@example.invalid>, modified by bo@example.invalid', agents, find }), {
    author: { name: 'Helper', url: 'https://github.com/apps/helper-bot' },
    for: { name: 'Ana Souza', url: 'https://people.example.invalid/u/ana' },
  })
  assert.deepEqual(await pullPeople({ target: corp, author: 'ana@example.invalid', description: '', agents, find }), { author: { name: 'Ana Souza', url: 'https://people.example.invalid/u/ana' } })
  assert.deepEqual(await pullPeople({ target: corp, author: 'corp-bot', description: 'Requested by someone else, modified by ana@example.invalid', agents, find }), { author: { name: 'Corp Helper' } }, 'no link off GitHub, and nobody after modified by')
  assert.deepEqual(await pullPeople({ target: corp, author: 'cy@example.invalid', description: '', agents, find }), { author: { name: 'cy@example.invalid' } }, 'one who cannot be looked up shows as they are')
  assert.deepEqual(await pullPeople({ target: corp, author: null, description: '', agents, find }), { author: null })
})
