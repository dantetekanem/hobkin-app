import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentsForKey, clampAgents, hoodRow } from '../src/features/work/agents-at-once.ts'

const press = (key: string, shiftKey = false) => ({ key, shiftKey })

test('agents at once step by one with the arrows, by ten with Shift, and Home and End go to one and the most', () => {
  assert.equal(agentsForKey(2, press('ArrowRight'), 100), 3)
  assert.equal(agentsForKey(2, press('ArrowLeft'), 100), 1)
  assert.equal(agentsForKey(2, press('ArrowRight', true), 100), 12)
  assert.equal(agentsForKey(12, press('ArrowLeft', true), 100), 2)
  assert.equal(agentsForKey(40, press('Home'), 100), 1)
  assert.equal(agentsForKey(4, press('End'), 100), 100)
  assert.equal(agentsForKey(4, press('+', true), 100), 5, '+ is typed with Shift and still adds one')
  assert.equal(agentsForKey(4, press('='), 100), 5)
  assert.equal(agentsForKey(4, press('-'), 100), 3)
  assert.equal(agentsForKey(4, press('ArrowUp'), 100), null, 'up and down are left to the screen')
  assert.equal(agentsForKey(4, press('a'), 100), null)
})

test('agents at once stop at one and at hobkin\'s most, and a number from outside is brought into range', () => {
  assert.equal(agentsForKey(1, press('ArrowLeft'), 100), 1)
  assert.equal(agentsForKey(5, press('ArrowLeft', true), 100), 1)
  assert.equal(agentsForKey(100, press('ArrowRight'), 100), 100)
  assert.equal(agentsForKey(95, press('ArrowRight', true), 100), 100)
  assert.equal(agentsForKey(8, press('ArrowRight'), 8), 8, 'a host that allows eight stops at eight')
  assert.equal(clampAgents(101, 100), 100)
  assert.equal(clampAgents(0, 100), 1)
  assert.equal(clampAgents(2.6, 100), 3)
  assert.equal(clampAgents(3, 0), 1, 'a most below one is one')
})

test('the row of hoods draws one for each agent up to eight, and past eight seven and the count of the rest', () => {
  assert.deepEqual(hoodRow(1), { hoods: 1, more: 0 })
  assert.deepEqual(hoodRow(8), { hoods: 8, more: 0 })
  assert.deepEqual(hoodRow(9), { hoods: 7, more: 2 })
  assert.deepEqual(hoodRow(100), { hoods: 7, more: 93 })
  for (const agents of [1, 8, 9, 100]) {
    const { hoods, more } = hoodRow(agents)
    assert.ok(hoods + (more ? 1 : 0) <= 8, `${agents} agents take at most eight places`)
    assert.equal(hoods + more, agents)
  }
})
