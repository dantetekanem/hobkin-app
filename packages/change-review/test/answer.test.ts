import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deployAnswer } from '../src/answer.ts'
import type { Unit } from '../src/types.ts'

const unit = (level: Unit['level'], title: string, more: Partial<Unit> = {}): Pick<Unit, 'level' | 'title' | 'critical'> => ({ level, title, critical: false, ...more })

test('a review answers one question for the whole change: is it risky or safe to deploy', () => {
  // Risky only when a part is high, and the answer names it: what breaks is the reason.
  assert.deepEqual(deployAnswer([unit('safe', 'A'), unit('high', '`charge` breaks a test that passes without this change'), unit('mid', 'B')]), {
    deploy: 'risky',
    why: '`charge` breaks a test that passes without this change.',
  })
  assert.deepEqual(deployAnswer([unit('high', 'First break'), unit('high', 'Second break')]), { deploy: 'risky', why: 'First break. 1 more part can break.' })
  // The critical one is the reason, wherever it sits.
  assert.equal(deployAnswer([unit('high', 'A look'), unit('high', 'A fix', { critical: true })]).why, 'A fix. 1 more part can break.')

  // What no test showed does not make a change risky: it is said, and the answer stays safe.
  assert.deepEqual(deployAnswer([unit('mid', 'A'), unit('mid', 'B'), unit('safe', 'C')]), {
    deploy: 'safe',
    why: 'Nothing found that breaks. 2 parts were not shown working by a test that ran.',
  })
  assert.equal(deployAnswer([unit('mid', 'A')]).why, 'Nothing found that breaks. 1 part was not shown working by a test that ran.')
  assert.deepEqual(deployAnswer([unit('safe', 'A')]), { deploy: 'safe', why: 'Every part is shown to work, or cannot break anything.' })
  assert.deepEqual(deployAnswer([]), { deploy: 'safe', why: 'Nothing that runs changed.' }, 'no unit: only comments, blank lines or files nothing runs changed')
})

test("the Reviewer's own sentence is the reason only when it gives the same answer", () => {
  const units = [unit('mid', 'A')]
  assert.equal(deployAnswer(units, 'Safe to deploy: the scroll fix only runs while history loads, and its tests were not run here.').why, 'The scroll fix only runs while history loads, and its tests were not run here.')
  // It says risky where no part is high: its words are not the answer.
  assert.equal(deployAnswer(units, 'Risky to deploy: it changes behaviour.').why, 'Nothing found that breaks. 1 part was not shown working by a test that ran.')
  assert.equal(deployAnswer([unit('high', 'A break')], 'Risky to deploy: an order of 2.675 is now charged 2.67.').why, 'An order of 2.675 is now charged 2.67.')
})
