import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanTitle, Titles, titleHobkins } from '../src/titles.ts'
import { afterTest, temporaryDirectory } from './support.ts'

type Question = { system: string; prompt: string; signal: AbortSignal }
const settled = async (titles: Titles) => {
  for (let tries = 0; titles.pending() > 0 && tries < 500; tries++) await new Promise((done) => setTimeout(done, 2))
  assert.equal(titles.pending(), 0)
}

test('a conversation is titled once by the quick model, from its first words, and the title is kept across a restart', async (t) => {
  const file = join(temporaryDirectory(t), 'nested', 'titles.json')
  const questions: Question[] = []
  const titled: string[] = []
  const make = () =>
    new Titles({
      ask: async (question) => {
        questions.push(question)
        return '"Plan the Lisbon trip."\nbecause it is about a trip'
      },
      file: () => file,
      onTitled: (key) => titled.push(key),
    })
  const words = ['Help me plan a trip to Lisbon in March', 'Sure, here is a plan. '.repeat(100)]
  const titles = make()
  afterTest(t, () => titles.close())

  assert.equal(titles.get('a', words), null)
  titles.want('a', words)
  titles.want('a', words)
  assert.equal(titles.pending(), 1)
  await settled(titles)
  assert.equal(titles.get('a', words), 'Plan the Lisbon trip')
  assert.deepEqual(titled, ['a'])
  assert.equal(questions.length, 1)
  assert.match(questions[0]!.system, /2 to 6 words/)
  assert.match(questions[0]!.system, /48 characters/)
  assert.match(questions[0]!.prompt, /Lisbon in March/)
  assert.ok(questions[0]!.prompt.length < 2000, 'each message is cut at 800 characters')

  // Asking again for the same words costs nothing. Other words are another question.
  titles.want('a', words)
  assert.equal(titles.pending(), 0)
  assert.equal(titles.get('a', ['Something else']), null)

  const stored = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(stored.version, 1)
  assert.equal(stored.titles.a.title, 'Plan the Lisbon trip')
  assert.equal(statSync(file).mode & 0o777, 0o600)

  const restarted = make()
  afterTest(t, () => restarted.close())
  assert.equal(restarted.get('a', words), 'Plan the Lisbon trip')
  restarted.want('a', words)
  assert.equal(restarted.pending(), 0)
  assert.equal(questions.length, 1)
})

test('a model that fails is not asked again for five minutes, and an answer with no title in it is never asked for again', async (t) => {
  let clock = 1_000_000
  let calls = 0
  let answer: () => Promise<string | null> = async () => {
    throw new Error('sign-in ran out')
  }
  const titles = new Titles({ ask: () => (calls++, answer()), file: () => join(temporaryDirectory(t), 'titles.json'), now: () => clock, log: () => {} })
  afterTest(t, () => titles.close())

  titles.want('a', ['one'])
  titles.want('b', ['two'])
  await settled(titles)
  assert.equal(calls, 1)
  clock += 4 * 60_000
  titles.want('c', ['three'])
  assert.equal(titles.pending(), 0)
  assert.equal(calls, 1)

  // After five minutes the model is tried again, and a null answer counts as a failure too.
  clock += 61_000
  answer = async () => null
  titles.want('a', ['one'])
  await settled(titles)
  assert.equal(calls, 2)
  titles.want('b', ['two'])
  assert.equal(titles.pending(), 0)

  clock += 5 * 60_000
  answer = async () => '  "`**`"  \n'
  titles.want('d', ['four'])
  await settled(titles)
  assert.equal(calls, 3)
  assert.equal(titles.get('d', ['four']), null)
  clock += 60 * 60_000
  titles.want('d', ['four'])
  assert.equal(titles.pending(), 0)
  assert.equal(calls, 3)
})

test('a title is one short line whatever the model writes', () => {
  assert.equal(cleanTitle('Fix the login bug'), 'Fix the login bug')
  assert.equal(cleanTitle('\n\n  "Fix   the login bug."  \nA second line'), 'Fix the login bug')
  assert.equal(cleanTitle('`Fix the login bug`'), 'Fix the login bug')
  assert.equal(cleanTitle('## **Fix the login bug**'), 'Fix the login bug')
  assert.equal(cleanTitle('Title: Fix it'), 'Title: Fix it')
  assert.equal(cleanTitle(''), null)
  assert.equal(cleanTitle(' \n \n'), null)
  assert.equal(cleanTitle('""'), null)
  const long = cleanTitle('Rework the whole onboarding flow so new people land on the right page')!
  assert.ok(long.length <= 48)
  assert.equal(long, 'Rework the whole onboarding flow so new people')
  assert.equal(cleanTitle('x'.repeat(100))!.length, 48)
})

test('a hobkin named from its first message takes the title made for it', async (t) => {
  const retitled: [string, string][] = []
  const hobkins = {
    toTitle: async () => [{ id: 'h1', words: ['Watch my budget'] }, { id: 'h2', words: ['Summarise the news'] }],
    retitle: async (id: string, title: string) => {
      retitled.push([id, title])
      return {} as never
    },
  }
  const titles = new Titles({ ask: async () => (await new Promise((done) => setTimeout(done, 10)), 'Budget watcher'), file: () => join(temporaryDirectory(t), 'titles.json') })
  afterTest(t, () => titles.close())

  await titleHobkins(hobkins, titles)
  assert.deepEqual(retitled, [])
  assert.equal(titles.pending(), 2)
  await settled(titles)

  await titleHobkins(hobkins, titles)
  assert.deepEqual(retitled, [['h1', 'Budget watcher'], ['h2', 'Budget watcher']])

  // A failing runtime is logged and swallowed.
  const logged: string[] = []
  await titleHobkins({ toTitle: async () => Promise.reject(new Error('down')), retitle: hobkins.retitle }, titles, (message) => logged.push(message))
  assert.equal(logged.length, 1)
})
