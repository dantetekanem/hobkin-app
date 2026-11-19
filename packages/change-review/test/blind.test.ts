import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { blindActions, checkerRequest, readCheckerAnswer, runBlindCheck } from '../src/blind.ts'
import type { BlindCheck, Level, ModelRunner, Unit, Units } from '../src/types.ts'

const example = (name: string) => readFileSync(new URL(`../skills/change-review/examples/${name}`, import.meta.url), 'utf8')
const units = (JSON.parse(example('units.json')) as Units).units
const story = example('story.md')
const ids = units.map((unit) => unit.id)

type Answer = BlindCheck['units'][number]
/** A unit the checker was convinced by. */
const convinced = (id: string): Answer => ({ id, agree: 'yes', level_i_would_give: null, understood: 'yes', context: 'about right' })

/** The fenced documents of a prompt, and the text around them. */
function documents(prompt: string): { blocks: string[]; around: string } {
  const blocks: string[] = []
  const around: string[] = []
  let fence = ''
  let block: string[] = []
  for (const line of prompt.split('\n')) {
    const open = /^(`{3,})[\w-]*$/.exec(line)
    if (!fence && open) {
      fence = open[1]!
      block = []
    } else if (!fence) around.push(line)
    else if (line === fence) {
      blocks.push(block.join('\n'))
      fence = ''
    } else block.push(line)
  }
  return { blocks, around: around.join('\n') }
}

const unitOf = (id: string, level: Level, nodes: string[]): Unit => ({ ...units[0]!, id, level, critical: false, nodes })

describe('checkerRequest', () => {
  it('gives the checker the story and the units with their code, and nothing else', () => {
    const request = checkerRequest({ story, units })
    assert.equal(request.system, readFileSync(new URL('../prompts/checker.md', import.meta.url), 'utf8'))
    const { blocks, around } = documents(request.prompt)
    assert.equal(blocks.length, 2)
    assert.equal(blocks[0], story.trimEnd())
    assert.deepEqual(JSON.parse(blocks[1]!), units)
    assert.equal(around, documents(checkerRequest({ story: 'A one-line story.', units: [] }).prompt).around)
  })
})

describe('readCheckerAnswer', () => {
  it('reads the answer in a fence or among stray text, in any case, and drops units it does not know', () => {
    const body = {
      units: [
        { id: 'u4', agree: 'No', level_i_would_give: 'HIGH', because: 'Store.fetch\u0007 has no rescue.', understood: true, context: 'Too_Little', note: 'I had to assume the flag store fails closed.' },
        { id: 'u99', agree: 'yes', understood: 'yes', context: 'about right' },
        { id: 'u2', agree: 'yes', understood: 'yes', context: 'about right', missing: '' },
      ],
      needs: ['app/jobs/receipt_job.rb', '  Who reads the totals/ cache key?\n'],
    }
    const expected: BlindCheck = {
      units: [
        { id: 'u4', agree: 'no', level_i_would_give: 'high', because: 'Store.fetch has no rescue.', understood: 'yes', context: 'too little', note: 'I had to assume the flag store fails closed.' },
        convinced('u2'),
      ],
      needs: ['app/jobs/receipt_job.rb', 'Who reads the totals/ cache key?'],
    }
    assert.deepEqual(readCheckerAnswer(`Here you go:\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``, ids), expected)
    assert.deepEqual(readCheckerAnswer(`My answer: ${JSON.stringify(body)} Thanks.`, ids), expected)
  })

  it('reads a choice that goes on to explain itself as the choice it starts with, and the context\'s why as the note when there is none', () => {
    const body = {
      units: [
        { id: 'u4', agree: 'No, the rescue is gone.', level_i_would_give: 'high: nothing catches it', understood: 'yes - mostly', context: 'too little. The story says the store fails closed but never shows it.' },
        { id: 'u2', agree: 'yes', understood: 'yes', context: 'Too much: three callers say the same', note: 'Fine as it is.' },
      ],
      needs: [],
    }
    assert.deepEqual(readCheckerAnswer(JSON.stringify(body), ids)!.units, [
      { id: 'u4', agree: 'no', level_i_would_give: 'high', understood: 'yes', context: 'too little', note: 'The story says the store fails closed but never shows it.' },
      { id: 'u2', agree: 'yes', level_i_would_give: null, understood: 'yes', context: 'too much', note: 'Fine as it is.' },
    ])
    // A word that only starts like a choice is none: "not sure" is no "no", and "midway" no "mid".
    const unsure = JSON.stringify({ units: [{ id: 'u1', agree: 'not sure', understood: 'yes', context: 'about right' }], needs: [] })
    assert.equal(readCheckerAnswer(unsure, ids), null)
    const midway = JSON.stringify({ units: [{ id: 'u1', agree: 'no', level_i_would_give: 'midway', understood: 'yes', context: 'about right' }], needs: [] })
    assert.equal(readCheckerAnswer(midway, ids)!.units[0]!.level_i_would_give, null)
  })

  it('is null when the answer cannot be read, so the check counts as not run', () => {
    const unknownOnly = JSON.stringify({ units: [{ id: 'u99', agree: 'yes', understood: 'yes', context: 'about right' }], needs: [] })
    const halfAnswered = JSON.stringify({ units: [{ id: 'u1', understood: 'yes', context: 'about right' }], needs: [] })
    for (const text of ['I agree with every level.', '{"units": "all fine", "needs": []}', unknownOnly, halfAnswered, '{"units": [{"id": "u1", "agree": "yes"']) {
      assert.equal(readCheckerAnswer(text, ids), null)
    }
  })
})

describe('blindActions', () => {
  it('decides by rule what follows each unit that did not convince: ask the reviewer, or record it as told badly, and never change a level', () => {
    const check: BlindCheck = {
      units: [
        convinced('u1'),
        { id: 'u2', agree: 'yes', level_i_would_give: null, understood: 'yes', context: 'too much', note: 'I skipped the cache key history.' },
        { id: 'u3', agree: 'no', level_i_would_give: 'mid', because: 'The caller is migrated soon.', understood: 'yes', context: 'about right' },
        { id: 'u4', agree: 'no', level_i_would_give: 'high', because: 'Nothing shows what Features.enabled? does when the store is down.', understood: 'yes', context: 'about right' },
        { id: 'u5', agree: 'yes', level_i_would_give: null, understood: 'yes', context: 'too little', note: 'I had to assume ReceiptJob is idempotent.' },
        { id: 'u6', agree: 'yes', level_i_would_give: null, understood: 'no', missing: 'what else calls round_line_tax', context: 'about right' },
      ],
      needs: ['app/jobs/receipt_job.rb'],
    }
    const outcome = blindActions(check, units)
    assert.deepEqual(outcome.actions, [
      { unit: 'u2', answer: 'told-badly', did: 'kept as it is: told badly, and no second pass rewrites it' },
      { unit: 'u3', answer: 'told-badly', did: 'kept as it is: told badly, and no second pass rewrites it' },
      { unit: 'u4', answer: 'thin-evidence', did: 'asked the reviewer: the blind check would rate it high' },
      { unit: 'u5', answer: 'unknown', did: 'asked the reviewer: something needed is unknown' },
      { unit: 'u6', answer: 'unknown', did: 'asked the reviewer: something needed is unknown' },
    ])
    const why = 'The blind check reads only the story and the units, and this was not in them.'
    assert.deepEqual(outcome.questions, [
      {
        unit: 'u4',
        question: {
          text: `The blind check would rate this high, not ${units.find((unit) => unit.id === 'u4')!.level}: "Nothing shows what Features.enabled? does when the store is down". Does that name something that breaks?`,
          why,
          changes: 'If it names a break, this unit is rated too low.',
        },
      },
      { unit: 'u5', question: { text: 'The blind check could not decide from the story alone: "I had to assume ReceiptJob is idempotent". Can you settle it?', why } },
      { unit: 'u6', question: { text: 'The blind check could not decide from the story alone: "what else calls round_line_tax". Can you settle it?', why } },
    ])
    assert.deepEqual(outcome.openQuestions, ['app/jobs/receipt_job.rb'])
  })
})

describe('runBlindCheck', () => {
  it('the blind check runs once and changes no level: a reader who was not convinced is a question, not a sign of a break', async () => {
    const grouped = [unitOf('g1', 'mid', ['a', 'b']), unitOf('g2', 'high', ['c']), unitOf('g3', 'safe', ['d'])]
    const answer = {
      units: [
        { id: 'g1', agree: 'no', level_i_would_give: 'high', because: 'Only one of the two callers is shown.', understood: 'yes', context: 'about right' },
        { id: 'g2', agree: 'no', level_i_would_give: 'safe', because: 'It looks harmless.', understood: 'no', missing: 'why it is high', context: 'too much' },
        { id: 'g3', agree: 'no', level_i_would_give: 'safe', because: 'Fine as it is.', understood: 'no', missing: 'which test runs it', context: 'too little' },
      ],
      needs: [],
    }
    const calls: Parameters<ModelRunner>[0][] = []
    const run: ModelRunner = async (call) => {
      calls.push(call)
      return JSON.stringify(answer)
    }
    const result = await runBlindCheck(run, { story: 'A story.', units: grouped }, new AbortController().signal)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.pass, 'checker')
    assert.deepEqual(result.actions.map((action) => [action.unit, action.answer]), [['g1', 'thin-evidence'], ['g2', 'unknown'], ['g3', 'unknown']])
    assert.deepEqual(result.questions.map((entry) => entry.unit), ['g1', 'g2', 'g3'])
    assert.equal('events' in result, false, 'nothing it says becomes a level')

    const silent: ModelRunner = async (call) => {
      calls.push(call)
      return 'I could not read the story.'
    }
    const unread = await runBlindCheck(silent, { story: 'A story.', units: grouped }, new AbortController().signal)
    assert.equal(calls.length, 2)
    assert.deepEqual(unread, { answer: 'I could not read the story.', check: null, actions: [], questions: [], openQuestions: [] })
  })
})
