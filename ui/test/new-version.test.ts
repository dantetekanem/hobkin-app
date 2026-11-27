import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VersionStatus } from '#shared/protocol/version.ts'
import { watchNewVersion } from '../src/features/update/new-version.ts'

const UNCOMMITTED = 'This copy has uncommitted changes, so Update leaves it alone.'

function status(newest: string | null, change: Partial<VersionStatus> = {}): VersionStatus {
  return {
    current: '0.2.3',
    newest,
    available: newest !== null && newest !== '0.2.3',
    blocked: null,
    problem: null,
    checkedAt: '2026-11-27T12:00:00.000Z',
    ...change,
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

test('a new version is shown once for each version the host names, and reads stop with the window', async () => {
  const hostAnswers: (() => Promise<VersionStatus>)[] = [
    async () => status('0.2.3'),
    async () => status('0.2.4'),
    async () => status('0.2.4'),
    async () => Promise.reject(new Error('Disconnected from hobkin.')),
    async () => status('0.2.4', { blocked: UNCOMMITTED }),
    async () => status('0.2.5'),
  ]
  const shown: [string | null, string | null][] = []
  let askAgain = () => {}
  let stops = 0
  const stop = watchNewVersion({
    read: () => hostAnswers.shift()?.() ?? new Promise(() => {}),
    show: ({ newest, blocked }) => {
      shown.push([newest, blocked])
    },
    every: (look) => {
      askAgain = look
      return () => {
        stops += 1
      }
    },
  })

  await settle()
  assert.deepEqual(shown, [], 'nothing newer, nothing shown')

  const asksLeft = hostAnswers.length
  for (let ask = 0; ask < asksLeft; ask++) {
    askAgain()
    await settle()
  }
  assert.deepEqual(
    shown,
    [
      ['0.2.4', null],
      ['0.2.4', UNCOMMITTED],
      ['0.2.5', null],
    ],
    'each version once, again when what Update can do changes, and a failed read shows nothing',
  )

  let answerLate: (value: VersionStatus) => void = () => {}
  hostAnswers.push(() => new Promise((done) => (answerLate = done)))
  askAgain()
  stop()
  answerLate(status('0.2.6'))
  await settle()
  assert.equal(shown.length, 3, 'a read that answers after the window stopped shows nothing')
  assert.equal(stops, 1)
})
