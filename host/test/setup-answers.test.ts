import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { readSetupFacts, SETUP_FACTS_MAX, SETUP_TEXT_MAX } from 'hobkin/src/cli/setup-facts.mjs'
import type { SetupAnswers, SetupCardPick, SetupSaved } from '#shared/protocol/setup.ts'
import { runCommand } from '../src/commands.ts'
import { factsOf, oneLine, readSetupSaved, setupAnswerHandlers } from '../src/setup-answers.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

const VALIDATION = 'Should I set up validation for them? That is what I run before I call work done.'

const answered: SetupAnswers = {
  computer: 'personal',
  answers: [
    { id: 'projects-folder', ask: 'Where do your projects live? Give me the folder.', answer: '~/Code' },
    { id: 'projects', ask: 'Which ones should I run? Pick as many as you like.', answer: 'storefront, notes' },
    { id: 'validation', ask: VALIDATION, answer: 'Set it up' },
  ],
  projects: [
    { name: 'storefront', path: '/Users/someone/Code/storefront', git: true },
    { name: 'notes', path: '/Users/someone/Code/notes', git: false },
  ],
}

function saveOn(root: string) {
  const handlers = setupAnswerHandlers({ root: () => root })
  return async (answers: SetupAnswers): Promise<SetupSaved> => {
    const outcome = await runCommand(handlers, 'setup.save', answers)
    if (!outcome.ok) throw Error(outcome.error.message)
    return outcome.value as SetupSaved
  }
}

test("the setup's answers are kept twice: whole in the app's own file, and as hobkin's facts", async (t) => {
  const root = temporaryDirectory(t)
  const save = saveOn(root)

  const saved = await save(answered)

  const file = join(root, 'client', 'setup.json')
  assert.equal(statSync(file).mode & 0o777, 0o600, 'only the user can read it')
  assert.deepEqual(readSetupSaved(root), saved)
  assert.deepEqual({ ...saved, savedAt: 'now' }, { computer: 'personal', answers: answered.answers, projects: answered.projects, goals: [], cards: [], savedAt: 'now' }, 'the paths and git marks of the projects are kept')
  assert.ok(Date.parse(saved.savedAt) > 0)

  // hobkin's own copy, which it puts in front of its directions: each question in its own words, and the answer.
  assert.deepEqual(readSetupFacts(root).facts, [
    { about: 'Where do your projects live? Give me the folder.', said: '~/Code' },
    { about: 'Which ones should I run? Pick as many as you like.', said: 'storefront, notes' },
    { about: VALIDATION, said: 'Set it up' },
  ])
})

test('each save replaces the one before, in both copies', async (t) => {
  const root = temporaryDirectory(t)
  const save = saveOn(root)
  await save(answered)

  const second = await save({ computer: 'work', answers: [{ id: 'board', ask: 'Is there a board I should follow?', answer: 'Linear' }], projects: [] })

  assert.deepEqual(readSetupSaved(root), second)
  assert.equal(second.computer, 'work')
  assert.deepEqual(second.projects, [])
  assert.deepEqual(readSetupFacts(root).facts, [{ about: 'Is there a board I should follow?', said: 'Linear' }])

  // Nothing answered yet is a save too: whose computer this is, and no facts for hobkin.
  const empty = await save({ answers: [], projects: [] })
  assert.equal(empty.computer, null)
  assert.deepEqual(readSetupFacts(root).facts, [])
})

test('a long answer is cut on a word to fit what hobkin keeps, and the app keeps it whole', async (t) => {
  const root = temporaryDirectory(t)
  const long = `${'storefront, billing-api, design-kit, '.repeat(20)}the very last one`
  const typed = 'Mail\nand the calendar\u2028and bills'
  const saved = await saveOn(root)({
    answers: [
      { id: 'projects', ask: 'Which ones should I run?', answer: long },
      { id: 'check', ask: 'What should I check for you?', answer: typed },
    ],
    projects: [],
  })

  const [cut, flat] = readSetupFacts(root).facts
  assert.ok(cut!.said.length <= SETUP_TEXT_MAX)
  assert.ok(cut!.said.endsWith('…'))
  assert.ok(long.startsWith(cut!.said.slice(0, -1)), 'cut, not changed')
  assert.match(cut!.said.slice(0, -1), /[a-z]$/, 'on the end of a whole word')
  assert.equal(flat!.said, 'Mail and the calendar and bills', 'a pasted line break becomes a space, since a fact is one line')
  assert.equal(saved.answers[0]!.answer, long)
})

test('the facts are one line each, never empty, and no more than hobkin keeps', () => {
  assert.equal(oneLine('  a \t b\n\nc  ', 300), 'a b c')
  assert.equal(oneLine('word '.repeat(100), 20), 'word word word word…')
  assert.equal(oneLine('x'.repeat(40), 20), `${'x'.repeat(19)}…`, 'one long word is cut where it has to be')

  const many: SetupAnswers = { answers: Array.from({ length: SETUP_FACTS_MAX + 3 }, (_, index) => ({ id: `q${index}`, ask: `Question ${index}?`, answer: `Answer ${index}` })), projects: [] }
  assert.equal(factsOf(many).length, SETUP_FACTS_MAX)
  assert.deepEqual(factsOf({ answers: [{ id: 'q', ask: 'Q?', answer: ' \n ' }] }), [], 'an answer that is only space is no fact')
})

test('the goals and the kept and dropped cards are kept whole in the app\'s file and as three of hobkin\'s facts', async (t) => {
  const root = temporaryDirectory(t)
  const cards: SetupCardPick[] = [
    { id: 'job-openings', version: 1, title: 'Roles that fit', mark: 'kept', changes: { recurrence: 'Every weekday morning', skips: '' } },
    { id: 'deadlines-ahead', version: 2, title: 'Deadlines ahead', mark: 'kept', changes: {} },
    { id: 'interviews', version: 1, title: 'Interviews', mark: 'dropped', changes: {} },
  ]
  const many = Array.from({ length: SETUP_FACTS_MAX }, (_, index) => ({ id: `q${index}`, ask: `Question ${index}?`, answer: `Answer ${index}` }))

  const saved = await saveOn(root)({ answers: many, projects: [], goals: ['job', 'project'], cards })

  assert.deepEqual(readSetupSaved(root), saved)
  assert.deepEqual(saved.goals, ['job', 'project'])
  assert.deepEqual(saved.cards, cards, 'whole, with the changes')

  const facts = readSetupFacts(root).facts
  assert.equal(facts.length, SETUP_FACTS_MAX, 'the answers make room for the three')
  const said = (about: RegExp) => facts.find((fact) => about.test(fact.about))?.said ?? ''
  assert.match(said(/working toward/), /job.*project/)
  assert.match(said(/kept/), /job-openings@1.*deadlines-ahead@2/)
  assert.doesNotMatch(said(/kept/), /interviews/)
  assert.match(said(/turned down/), /interviews@1/)

  // Without goals or cards, only the answers are facts.
  await saveOn(root)(answered)
  assert.equal(readSetupFacts(root).facts.length, answered.answers.length)
})

test('what was saved reads back, and a file that is missing or broken reads as nothing saved', (t) => {
  const root = temporaryDirectory(t)
  assert.equal(readSetupSaved(root), null)

  mkdirSync(join(root, 'client'))
  for (const broken of ['not json', '[]', '{"version":1,"answers":"none"}', '{"version":2,"computer":null,"answers":[],"projects":[],"savedAt":"x"}']) {
    writeFileSync(join(root, 'client', 'setup.json'), broken)
    assert.equal(readSetupSaved(root), null, broken)
  }

  // A file from before goals and cards reads with none of them.
  writeFileSync(join(root, 'client', 'setup.json'), '{"version":1,"computer":null,"answers":[],"projects":[],"savedAt":"2026-11-14T00:00:00.000Z"}')
  assert.deepEqual(readSetupSaved(root), { computer: null, answers: [], projects: [], goals: [], cards: [], savedAt: '2026-11-14T00:00:00.000Z' })
})

test('through the host: the setup saves and reads back its answers', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  assert.equal(await client.run('setup.saved'), null)
  const saved = await client.run<SetupSaved>('setup.save', answered)
  assert.deepEqual(await client.run('setup.saved'), saved)
  assert.equal(JSON.parse(readFileSync(join(host.root, 'client', 'setup.json'), 'utf8')).computer, 'personal')

  const refused = await client.command('setup.save', { answers: [{ id: 'Bad Id', ask: 'Q?', answer: 'A' }], projects: [] })
  assert.equal(!refused.ok && refused.error.code, 'invalid-arguments')
})
