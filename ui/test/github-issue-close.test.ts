import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IssueWork } from '#shared/protocol/github.ts'
import { CLOSE_CONFIRM_MS, closeIssueAs, closeWarning, createIssueClose, SAMPLE_CLOSE, type CloseCommand, type CloseReason } from '../src/features/github/issue-close.ts'

// Close issue on the GitHub page: the same two clicks as a verdict in Review, the first arming it for ten seconds and the second closing it,
// with Completed or Not planned as the reason. A stand-in plays the host here, so nothing reaches GitHub.

/** The button over a stand-in for the host that answers as told, and every reason it was asked to close with. */
function button(answer: (reason: CloseReason) => Promise<string> = async (reason) => `Closed as ${reason}.`) {
  const asked: CloseReason[] = []
  const flow = createIssueClose({
    close: (reason) => {
      asked.push(reason)
      return answer(reason)
    },
  })
  return { flow, asked }
}

test('one click only arms Close issue; a second within ten seconds closes it, as completed unless the user chose otherwise', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  assert.deepEqual([flow.getState().armed, asked], [true, []])
  t.mock.timers.tick(CLOSE_CONFIRM_MS - 1)
  await flow.press()

  assert.equal(CLOSE_CONFIRM_MS, 10_000)
  assert.deepEqual(asked, ['completed'])
  assert.deepEqual(flow.getState(), { armed: false, reason: 'completed', busy: false, said: { tone: 'done', text: 'Closed as completed.' } })
})

test('left alone it goes back after ten seconds, and the next click only arms it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  t.mock.timers.tick(CLOSE_CONFIRM_MS)
  assert.equal(flow.getState().armed, false)
  await flow.press()

  assert.deepEqual([flow.getState().armed, asked], [true, []])
})

test('choosing Not planned while it waits gives it ten seconds again, and closes it as not planned', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  t.mock.timers.tick(CLOSE_CONFIRM_MS - 1000)
  flow.choose('not-planned')
  t.mock.timers.tick(CLOSE_CONFIRM_MS - 1000)
  assert.equal(flow.getState().armed, true, 'the choice started the ten seconds again')
  await flow.press()

  assert.deepEqual(asked, ['not-planned'])
})

test('Escape or leaving the button takes the first click back, so the next click only arms it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { flow, asked } = button()

  await flow.press()
  flow.cancel()
  const afterCancel = flow.getState().armed
  await flow.press()

  assert.equal(afterCancel, false)
  assert.deepEqual([flow.getState().armed, asked], [true, []])
})

test('a click while the issue closes does nothing, so it closes once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish: (text: string) => void = () => {}
  const { flow, asked } = button(() => new Promise((resolve) => (finish = resolve)))

  await flow.press()
  const closing = flow.press()
  const busyWhileClosing = flow.getState().busy
  await flow.press()
  finish('Closed.')
  await closing

  assert.equal(busyWhileClosing, true)
  assert.deepEqual(asked, ['completed'])
})

test('a refusal says why, and the button is ready to arm again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const why = 'gh said: GraphQL: Resource not accessible by integration (closeIssue)'
  const { flow } = button(async () => {
    throw new Error(why)
  })

  await flow.press()
  await flow.press()

  assert.deepEqual(flow.getState(), { armed: false, reason: 'completed', busy: false, said: { tone: 'refused', text: why } })
})

test('with no host it answers that it is sample data and asks nothing; with one it asks the host to close that issue', async () => {
  const sent: unknown[] = []
  const command: CloseCommand = async (args) => {
    sent.push(args)
    return { message: 'Closed acme/web#12 on GitHub as not planned.' }
  }
  const issue = { repo: 'acme/web', number: 12 }

  const withoutHost = await closeIssueAs('completed', { live: false, issue, command })
  const sentBeforeHost = [...sent]
  const withHost = await closeIssueAs('not-planned', { live: true, issue, command })

  assert.equal(withoutHost, SAMPLE_CLOSE)
  assert.deepEqual(sentBeforeHost, [])
  assert.equal(withHost, 'Closed acme/web#12 on GitHub as not planned.')
  assert.deepEqual(sent, [{ repo: 'acme/web', number: 12, reason: 'not-planned' }])
})

test("the confirm says what becomes of hobkin's work for the issue: declined while it is not finished, and nothing once it is over", () => {
  const work = (state: string): IssueWork => ({ slug: 'web', project: 'web', item: 'caa304', state, pr: null })
  const said = Object.fromEntries(['open', 'stuck', 'doing', 'waiting', 'branch', 'pr', 'merged', 'done', 'declined', 'dropped'].map((state) => [state, closeWarning(work(state))]))

  assert.deepEqual(said, {
    open: "hobkin's item for it is in the queue; it will be declined.",
    stuck: "hobkin's item for it is in the queue; it will be declined.",
    doing: 'hobkin is working on it now; the run stops and its item will be declined.',
    waiting: "hobkin's item for it waits for you; it will be declined.",
    branch: "hobkin's finished work for it waits for your yes; it will be declined, and its branch stays.",
    pr: "hobkin's finished work for it waits for your yes; it will be declined, and its branch and PR stay.",
    merged: null,
    done: null,
    declined: null,
    dropped: null,
  })
  assert.equal(closeWarning(null), null)
  assert.equal(closeWarning(undefined), null)
})
