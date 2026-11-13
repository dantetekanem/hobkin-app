import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createVerdict, handOver, type VerdictCommands } from '../src/features/review/verdict.ts'
import { finishedReviewId, escapeReview, reviewTakesEscape } from '../src/features/review/entry.ts'

const token = 'aB  exact token\n'
/** The commit of the review on screen. */
const head = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
function fixture() {
  const calls: { name: string; args: any }[] = []
  let fail = ''
  let valid = true
  const command = (async (name: string, args: any) => {
    calls.push({ name, args })
    if (fail === name) throw new Error('Try again')
    return name === 'review.preview' ? { verdict: args.verdict, lines: ['Exact host action'], confirm: token } : { ok: true, message: 'Done' }
  }) as VerdictCommands
  const verdict = createVerdict({ id: 'change:project:item', head, command, saveNotes: async () => { calls.push({ name: 'save', args: null }); if (fail === 'save') throw new Error('Keep these words') }, current: () => valid })
  return { verdict, calls, fail: (name: string) => { fail = name }, leave: () => { valid = false } }
}

test('preview saves visible notes first and only explicit confirmation sends the exact host token', async () => {
  for (const choice of ['comment', 'approve', 'request-changes'] as const) {
    const { verdict, calls } = fixture()
    await verdict.preview(choice)
    assert.deepEqual(calls.map(({ name }) => name), ['save', 'review.preview'])
    assert.deepEqual(calls.at(-1)?.args, { id: 'change:project:item', verdict: choice, summary: '', head })
    assert.deepEqual(verdict.getState().preview?.lines, ['Exact host action'])
    await verdict.confirm()
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id: 'change:project:item', verdict: choice, summary: '', confirm: token, head } })
    await verdict.confirm()
    assert.equal(calls.filter(({ name }) => name === 'review.verdict').length, 1)
  }
})

test('failed saves/previews preserve retry and never submit; failed sends require a fresh preview', async () => {
  for (const failure of ['save', 'review.preview', 'review.verdict']) {
    const f = fixture()
    f.fail(failure)
    await f.verdict.preview('request-changes')
    await f.verdict.confirm()
    assert.ok(f.verdict.getState().error)
    assert.equal(f.verdict.getState().preview, null)
    const sent = f.calls.filter(({ name }) => name === 'review.verdict').length
    assert.equal(sent, failure === 'review.verdict' ? 1 : 0)
    f.fail('')
    await f.verdict.preview('comment')
    assert.ok(f.verdict.getState().preview)
  }
})

test('cancel, changed source, and disposed requests cannot submit', async () => {
  for (const action of ['cancel', 'leave', 'dispose'] as const) {
    const f = fixture()
    await f.verdict.preview('approve')
    if (action === 'leave') f.leave()
    else f.verdict[action]()
    await f.verdict.confirm()
    assert.equal(f.calls.some(({ name }) => name === 'review.verdict'), false)
  }
  let saved!: () => void
  const verdict = createVerdict({ id: 'change:p:i', head, command: (async () => { throw new Error('Cancelled preview ran') }) as VerdictCommands, saveNotes: () => new Promise<void>((resolve) => { saved = resolve }), current: () => true })
  const pending = verdict.preview('approve')
  verdict.cancel()
  saved()
  await pending
  assert.equal(verdict.getState().preview, null)
})

test('late preview replies stay cancelled, and effect reconnect allows a fresh explicit preview', async () => {
  let reply!: (value: any) => void
  const flow = createVerdict({ id: 'change:p:i', head, command: (() => new Promise((resolve) => { reply = resolve })) as VerdictCommands, saveNotes: async () => {}, current: () => true })
  const pending = flow.preview('approve')
  await Promise.resolve()
  flow.cancel()
  reply({ verdict: 'approve', lines: ['Late'], confirm: token })
  await pending
  assert.equal(flow.getState().preview, null)
  const f = fixture()
  f.verdict.connect()()
  f.verdict.connect()
  await f.verdict.preview('comment')
  assert.ok(f.verdict.getState().preview)
})

test('Escape dismisses a child editor, popover, line selection or open code first, otherwise exits without walking graph levels', () => {
  const calls: string[] = []
  const session = {
    editor: null as unknown, finder: false, wire: null as string | null, code: null as string | null, selection: null as unknown,
    closeEditor: () => calls.push('editor'), closeFinder: () => calls.push('finder'), openWire: () => calls.push('wire'),
    selectLines: () => calls.push('selection'), closeCode: () => calls.push('code'),
  }
  const close = () => calls.push('exit')
  escapeReview(session, close)
  session.editor = {}
  escapeReview(session, close)
  session.editor = null; session.finder = true
  escapeReview(session, close)
  session.finder = false; session.wire = 'wire'
  escapeReview(session, close)
  session.wire = null; session.code = 'u1'; session.selection = {}
  escapeReview(session, close)
  session.selection = null
  escapeReview(session, close)
  assert.deepEqual(calls, ['exit', 'editor', 'finder', 'wire', 'selection', 'code'])
})

test('Escape in a field leaves the field with its words, and never reaches the review to close it', () => {
  /** Where a key was pressed: inside the elements these selectors name. */
  const within = (...inside: string[]) => ({ closest: (selector: string) => (selector.split(',').some((part) => inside.includes(part.trim())) ? {} : null) })
  assert.equal(reviewTakesEscape(within('textarea')), false, "the review's input")
  assert.equal(reviewTakesEscape(within('input')), false, 'the finder')
  assert.equal(reviewTakesEscape(within('[role="dialog"]')), false, 'the keys sheet')
  assert.equal(reviewTakesEscape(within('button')), true)
  assert.equal(reviewTakesEscape(within()), true)
})

test('finished identity names the actual change; explicit sample stays sample-only', () => {
  assert.equal(finishedReviewId({ slug: 'project', item: 'item' }, true), 'change:project:item')
  assert.equal(finishedReviewId({ slug: 'project', item: 'other' }, true), 'change:project:other')
  assert.equal(finishedReviewId({ slug: 'project', item: 'item' }, false), 'sample')
  assert.equal(finishedReviewId({ slug: '../bad', item: 'item' }, true), null)
})

test('a verdict the host could not do is handed to hobkin to sort out, with the host\'s reason, and the panel says so', async () => {
  const asked: [string, string][] = []
  const command = (async (name: string) => {
    if (name === 'review.preview') return { verdict: 'approve-merge', lines: ['Merge it.'], confirm: 'a'.repeat(64) }
    throw new Error('"Round the total" moved since it was offered, so nothing merged. It needs reading again.')
  }) as VerdictCommands
  const flow = createVerdict({
    id: 'change:shop:4c9e21',
    head: 'c'.repeat(40),
    command,
    saveNotes: async () => {},
    current: () => true,
    failed: async (verdict, reason) => {
      asked.push([verdict, reason])
      return true
    },
  })
  await flow.preview('approve-merge')
  await flow.confirm()
  assert.deepEqual(asked, [['approve-merge', '"Round the total" moved since it was offered, so nothing merged. It needs reading again.']])
  const { error, message } = flow.getState()
  assert.equal(error, null, 'it is not left as a dead end')
  assert.equal(message, 'It could not be done by itself, so hobkin was asked to sort it out: "Round the total" moved since it was offered, so nothing merged. It needs reading again.')

  // With nobody to hand it to, or when the message did not go, the reason stays as the error it is.
  const alone = createVerdict({ id: 'change:shop:4c9e21', head: 'c'.repeat(40), command, saveNotes: async () => {}, current: () => true, failed: async () => false })
  await alone.preview('approve-merge')
  await alone.confirm()
  assert.match(alone.getState().error ?? '', /moved since it was offered/)
})

test('the words that hand a failed verdict to hobkin say what was tried, why it failed, and what is wanted', () => {
  assert.equal(
    handOver('change', 'approve-merge', 'It moved since it was offered, so nothing merged.'),
    'I chose "Approve and merge" on this change and it could not be done: It moved since it was offered, so nothing merged. Fix what stops it and do it, or tell me exactly what you need from me first.',
  )
})

test('a discard the host refuses after the yes is never handed to hobkin: the user sees why, and nothing more is asked', async () => {
  for (const verdict of ['discard', 'discard-branch'] as const) {
    const asked: string[] = []
    const reason = 'What deleting hobkin/7d02c9-say-what-hobkin-is-doing takes has changed since it was shown, so nothing was deleted.'
    const command = (async (name: string) => {
      if (name === 'review.preview') return { verdict, lines: ['Close it.'], confirm: 'a'.repeat(64) }
      throw new Error(reason)
    }) as VerdictCommands
    const failed = async (_verdict: string, why: string) => {
      asked.push(why)
      return true
    }
    const flow = createVerdict({ id: 'change:shop:4c9e21', head: 'c'.repeat(40), command, saveNotes: async () => {}, current: () => true, failed })
    await flow.preview(verdict)
    await flow.confirm()
    assert.deepEqual(asked, [], `${verdict}: an agent never gets a no to carry out by other means`)
    assert.deepEqual([flow.getState().error, flow.getState().message], [reason, null])
  }
})
