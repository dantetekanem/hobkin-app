import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { blindActions, checkerRequest, readCheckerAnswer, runBlindCheck } from '../src/blind.ts'
import { applyRiskEvents } from '../src/risk.ts'
import type { BlindCheck, Level, ModelRunner, ReviewNode, Unit, Units } from '../src/types.ts'

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

/** A node whose floor is `level`: text changes are safe, load-time changes mid, untested changes high. */
function nodeAt(id: string, level: Level): ReviewNode {
  const facts = { safe: ['text', 'lifecycle', 'everyone'], mid: ['load', 'not-applicable', 'at-load'], high: ['behaviour', 'none', 'everyone'] }[level]
  const [effect, proof, exposure] = facts as [ReviewNode['facts']['effect']['value'], ReviewNode['facts']['proof']['value'], ReviewNode['facts']['exposure']['value']]
  return {
    id,
    kind: 'function',
    symbol: id,
    path: `app/${id}.rb`,
    lines: [1, 3],
    change: 'modified',
    changed_lines: [2],
    entries: [],
    facts: { effect: { value: effect, evidence: '' }, proof: { value: proof, evidence: '' }, exposure: { value: exposure, evidence: '' }, undo: { value: 'rollback', evidence: '' } },
    extras: {},
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: null,
    critical: false,
    findings: [],
    watch: null,
    questions: [],
  }
}

const unitOf = (id: string, level: Level, nodes: string[]): Unit => ({ ...units[0]!, id, level, critical: false, nodes })
const levelsOf = (nodes: ReviewNode[]) => Object.fromEntries(nodes.map((node) => [node.id, node.level?.current]))

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

  it('is null when the answer cannot be read, so the check counts as not run', () => {
    const unknownOnly = JSON.stringify({ units: [{ id: 'u99', agree: 'yes', understood: 'yes', context: 'about right' }], needs: [] })
    const halfAnswered = JSON.stringify({ units: [{ id: 'u1', understood: 'yes', context: 'about right' }], needs: [] })
    for (const text of ['I agree with every level.', '{"units": "all fine", "needs": []}', unknownOnly, halfAnswered, '{"units": [{"id": "u1", "agree": "yes"']) {
      assert.equal(readCheckerAnswer(text, ids), null)
    }
  })
})

describe('blindActions', () => {
  it('decides by rule what follows each unit that did not convince: raise one step, ask, or record it as told badly', () => {
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
      { unit: 'u4', answer: 'thin-evidence', did: 'raised to high: could not be shown simply' },
      { unit: 'u5', answer: 'unknown', did: 'asked the reviewer: something needed is unknown' },
      { unit: 'u6', answer: 'unknown', did: 'asked the reviewer, and raised to mid: something needed is unknown' },
    ])
    assert.deepEqual(outcome.events, [
      { node: 'n2', level: 'high', direction: 'up', aspect: 'behaviour', evidence: 'could not be shown simply: Nothing shows what Features.enabled? does when the store is down.', rule: 'could-not-be-shown-simply', by: 'blind-check' },
      { node: 'n4', level: 'mid', direction: 'up', aspect: 'behaviour', evidence: 'something needed is unknown: what else calls round_line_tax', rule: 'needed-unknown', by: 'blind-check' },
    ])
    const why = 'The blind check reads only the story and the units, and this was not in them.'
    assert.deepEqual(outcome.questions, [
      { unit: 'u5', question: { text: 'The blind check could not decide from the story alone: "I had to assume ReceiptJob is idempotent". Can you settle it?', why } },
      { unit: 'u6', question: { text: 'The blind check could not decide from the story alone: "what else calls round_line_tax". Can you settle it?', why, changes: 'It was raised from safe to mid only because this is unknown.' } },
    ])
    assert.deepEqual(outcome.openQuestions, ['app/jobs/receipt_job.rb'])
  })

  it('says when a unit has no node to carry a raise', () => {
    const bucket = unitOf('b1', 'mid', [])
    const outcome = blindActions({ units: [{ id: 'b1', agree: 'no', level_i_would_give: 'high', because: 'The locale check is not shown.', understood: 'yes', context: 'about right' }], needs: [] }, [bucket])
    assert.deepEqual(outcome.actions, [{ unit: 'b1', answer: 'thin-evidence', did: 'not raised: could not be shown simply, but the unit has no node to carry a level' }])
    assert.deepEqual(outcome.events, [])
  })
})

describe('runBlindCheck', () => {
  it('the blind check runs once and never lowers', async () => {
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
    assert.ok(result.events.every((event) => event.direction === 'up' && event.by === 'blind-check'))

    const nodes = [nodeAt('a', 'mid'), nodeAt('b', 'safe'), nodeAt('c', 'high'), nodeAt('d', 'safe')]
    const once = applyRiskEvents(nodes, result.events)
    assert.deepEqual(once.rejected, [])
    assert.deepEqual(levelsOf(once.nodes), { a: 'high', b: 'high', c: 'high', d: 'mid' })
    assert.deepEqual(applyRiskEvents(nodes, [...result.events, ...result.events]).nodes, once.nodes)

    const silent: ModelRunner = async (call) => {
      calls.push(call)
      return 'I could not read the story.'
    }
    const unread = await runBlindCheck(silent, { story: 'A story.', units: grouped }, new AbortController().signal)
    assert.equal(calls.length, 2)
    assert.deepEqual(unread, { answer: 'I could not read the story.', check: null, actions: [], events: [], questions: [], openQuestions: [] })
  })
})
