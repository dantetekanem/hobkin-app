import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterFailure, failedIn, RECOVERY } from '../src/app/screen-recovery.ts'

test('a screen that fails to draw is drawn afresh by itself, and only one that fails again at once shows what went wrong', () => {
  const first = afterFailure([], 1_000)
  assert.equal(first.again, true, 'the first failure is tried again')

  const second = afterFailure(first.failedAt, 1_200)
  assert.equal(second.again, false, 'a second failure right after it is shown')

  const third = afterFailure(second.failedAt, 1_300)
  assert.equal(third.again, false, 'and it stays shown while it keeps failing')
})

test('a screen that drew well for a while is given its try again', () => {
  const first = afterFailure([], 1_000)
  const later = afterFailure(first.failedAt, 1_000 + RECOVERY.withinMs)
  assert.equal(later.again, true)
  assert.deepEqual(later.failedAt, [1_000 + RECOVERY.withinMs], 'old failures are forgotten')
})

test('the failure names the parts it came through, innermost first, in this window and in a browser', () => {
  const webkit = '\nChangeRow@http://localhost:5187/src/features/agent-activity/StepView.tsx:482:20\ndiv\nStepView@http://localhost:5187/src/features/agent-activity/StepView.tsx:60:3\nAgentScreen@http://localhost:5187/src/features/work/AgentScreen.tsx:70:1\nScreenBoundary@http://localhost:5187/src/app/ScreenBoundary.tsx:12:5'
  assert.deepEqual(failedIn(webkit), ['ChangeRow', 'StepView', 'AgentScreen'])

  const chromium = '\n    at ChangeRow (http://localhost:5187/src/features/agent-activity/StepView.tsx:482:20)\n    at div\n    at StepView (http://localhost:5187/src/features/agent-activity/StepView.tsx:60:3)\n    at ScreenBoundary (http://localhost:5187/src/app/ScreenBoundary.tsx:12:5)\n    at Canvas'
  assert.deepEqual(failedIn(chromium), ['ChangeRow', 'StepView'], 'nothing from the net itself or above it')

  assert.deepEqual(failedIn(webkit, 1), ['ChangeRow'])
  assert.deepEqual(failedIn(undefined), [])
  assert.deepEqual(failedIn(''), [])
})
