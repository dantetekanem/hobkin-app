import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentOfQuestion, agentQuestionId, answeredAgents, nextAsking, waitingFirst } from '../src/app/asking.ts'

const agents = [{ id: 'a1' }, { id: 'a2', asks: 'Take the update?' }, { id: 'a3' }, { id: 'a4', asks: 'Remove the older test?' }]

test('the jump goes to the first agent that is waiting', () => {
  assert.equal(nextAsking(agents, null), 'a2')
  assert.equal(nextAsking(agents, 'a1'), 'a2', 'from an agent that is not waiting')
  assert.equal(nextAsking(agents, 'gone'), 'a2', 'from an agent that is no longer running')
})

test('from a waiting agent the jump moves on to the next one, and wraps', () => {
  assert.equal(nextAsking(agents, 'a2'), 'a4')
  assert.equal(nextAsking(agents, 'a4'), 'a2')
})

test('with one agent waiting the jump stays on it, and with none there is nowhere to go', () => {
  assert.equal(nextAsking([{ id: 'a1', asks: 'Go on?' }, { id: 'a2' }], 'a1'), 'a1')
  assert.equal(nextAsking([{ id: 'a1' }, { id: 'a2' }], null), null)
  assert.equal(nextAsking([], null), null)
})

test('agents waiting for the user come first, and the rest keep their order', () => {
  assert.deepEqual(waitingFirst(agents).map((agent) => agent.id), ['a2', 'a4', 'a1', 'a3'])
  assert.deepEqual(waitingFirst([{ id: 'a1' }, { id: 'a2' }]).map((agent) => agent.id), ['a1', 'a2'])
})

test('an agent\'s question in the sheet carries the agent in its id, and other questions do not', () => {
  assert.equal(agentOfQuestion(agentQuestionId('a2')), 'a2')
  assert.equal(agentOfQuestion('sample-1'), null)
  assert.equal(agentOfQuestion('item-7'), null)
})

test('a new answer to an agent\'s question resolves that agent, said in words', () => {
  const labels: Record<string, Record<string, string>> = { a2: { take: 'Take it now', hold: 'Hold it for a review' } }
  const labelOf = (agentId: string, value: string) => labels[agentId]?.[value]
  const before = [{ id: 'sample-1', answer: { value: 'home' } }]
  const after = [
    ...before,
    { id: agentQuestionId('a2'), answer: { value: 'hold' } },
    { id: agentQuestionId('a5'), answer: { typed: 'Add it, then grade' } },
    { id: 'sample-2', answer: { value: 'return' } },
  ]

  assert.deepEqual(answeredAgents(before, after, labelOf), [
    { agentId: 'a2', text: 'Hold it for a review' },
    { agentId: 'a5', text: 'Add it, then grade' },
  ])
})

test('answers already seen are not counted again', () => {
  const answered = [{ id: agentQuestionId('a2'), answer: { value: 'hold' } }]
  assert.deepEqual(answeredAgents(answered, answered, () => 'Hold it for a review'), [])
})

test('a choice without a label is said by its value', () => {
  const after = [{ id: agentQuestionId('a2'), answer: { value: 'hold' } }]
  assert.deepEqual(answeredAgents([], after, () => undefined), [{ agentId: 'a2', text: 'hold' }])
})
