import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '../../shared/review/types.ts'
import type { Verdict } from '../../shared/review/verdict.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { CONFIRM_MS, createVerdictChoices, heldDown, sendsComments, VERDICT_CHOICES, verdictChoices, verdictComments, verdictKind, type VerdictCommands } from '../src/features/review/verdict.ts'

const CHANGE = 'change:hobkin:7d02c9'
const PULL = 'pr:acme/shop/482'
const TOKEN: Record<Verdict, string> = { approve: 'a'.repeat(64), 'approve-merge': 'b'.repeat(64), 'request-changes': 'c'.repeat(64), comment: 'd'.repeat(64), discard: 'e'.repeat(64), 'discard-branch': 'f'.repeat(64) }
/** The commit of the review on screen, and a newer one its change has moved to since. */
const SHOWN = '7d02c99f8c61be4291e0c2046d29787cbc1c010a'
const NEWER = 'f'.repeat(40)

/** A fake host that shows each verdict and then does it, in its own words. Nothing is posted anywhere. */
const host = (name: string, args: any) => (name === 'review.preview' ? { verdict: args.verdict, lines: [`What ${args.verdict} does.`], confirm: TOKEN[args.verdict as Verdict] } : { message: `Done: ${args.verdict}` })

/** The review panel's verdict buttons over a fake host, and every call they made. */
function panel(id: string, answer: (name: string, args: any) => unknown, wiring: { comments?: () => string[]; markSent?: (ids: readonly string[]) => void; landed?: (verdict: Verdict, message: string) => void } = {}) {
  const calls: { name: string; args: unknown }[] = []
  const command = (async (name: string, args: unknown) => {
    calls.push({ name, args })
    return answer(name, args)
  }) as VerdictCommands
  const choices = createVerdictChoices({ id, head: SHOWN, command, saveNotes: async () => void calls.push({ name: 'save', args: null }), current: () => true, ...wiring })
  return { choices, calls }
}

test("approve and approve-and-merge reach the host's verdict", async () => {
  for (const verdict of ['approve', 'approve-merge'] as const) {
    const lines = verdict === 'approve' ? ['Push hobkin/7d02c9 at 7d02c99 to acme/hobkin on GitHub, as you.', 'Nothing is merged.'] : ['Merge it into main.', 'At commit 7d02c99.']
    const { choices, calls } = panel(CHANGE, (name, args) => (name === 'review.preview' ? { verdict: args.verdict, lines, confirm: TOKEN[verdict] } : { message: `Done: ${args.verdict}` }))

    // The first yes saves the notes and asks the host what the verdict will do. Nothing is done yet.
    await choices.choose(verdict)
    assert.deepEqual(calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id: CHANGE, verdict, summary: '', head: SHOWN } }])
    assert.deepEqual(choices.getState().preview?.lines, lines)

    // The second yes sends the token the host answered, and the host's own words come back.
    await choices.confirm()
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id: CHANGE, verdict, summary: '', confirm: TOKEN[verdict], head: SHOWN } })
    assert.equal(calls.filter(({ name }) => name === 'review.verdict').length, 1)
    assert.equal(choices.getState().message, `Done: ${verdict}`)
    assert.equal(choices.getState().preview, null)
  }

  // A verdict the host cannot do says why, and nothing is sent.
  const refused = panel(CHANGE, (name) => {
    if (name === 'review.preview') throw new Error('This change has no branch to push.')
    return { message: 'Should not happen' }
  })
  await refused.choices.choose('approve')
  await refused.choices.confirm()
  assert.equal(refused.choices.getState().error, 'This change has no branch to push.')
  assert.equal(refused.calls.some(({ name }) => name === 'review.verdict'), false)

  // So does one the host refuses at the last moment.
  const moved = panel(CHANGE, (name, args) => {
    if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown. Look at it again before sending.')
    return host(name, args)
  })
  await moved.choices.choose('approve-merge')
  await moved.choices.confirm()
  assert.match(moved.choices.getState().error ?? '', /changed since it was shown/)
})

test("Send fixes and a pull request's own choices are the host's verdict too, shown before they go", async () => {
  const choices: [string, Verdict][] = [[CHANGE, 'request-changes'], [PULL, 'approve'], [PULL, 'comment']]
  for (const [id, verdict] of choices) {
    const panelFor = panel(id, host)
    await panelFor.choices.choose(verdict)
    assert.deepEqual(panelFor.calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id, verdict, summary: '', head: SHOWN } }], `${id} ${verdict} is shown first`)
    await panelFor.choices.confirm()
    assert.deepEqual(panelFor.calls.at(-1), { name: 'review.verdict', args: { id, verdict, summary: '', confirm: TOKEN[verdict], head: SHOWN } })
    assert.equal(panelFor.choices.getState().message, `Done: ${verdict}`)
  }
})

test('a verdict is for the commit on screen: both yeses name it, and a host that holds a newer one refuses and says why', async () => {
  // A host that holds the review of `held`, and refuses a yes for any other commit, as the host does.
  const moved = 'This review is for commit 7d02c99; the change has moved to fffffff. Rebuild the review and look again.'
  let held = SHOWN
  const { choices, calls } = panel(CHANGE, (name, args) => {
    if ((args as { head?: string }).head !== held) throw new Error(moved)
    return host(name, args)
  })
  const heads = () => calls.flatMap(({ name, args }) => (name === 'save' ? [] : [[name, (args as { head?: string }).head]]))

  // Both yeses name the commit of the review on screen.
  await choices.choose('approve-merge')
  await choices.confirm()
  assert.deepEqual(heads(), [['review.preview', SHOWN], ['review.verdict', SHOWN]])
  assert.equal(choices.getState().message, 'Done: approve-merge')

  // The change moved on and the host prepared its review again: the first yes is refused, and the panel says why.
  held = NEWER
  await choices.choose('approve-merge')
  assert.deepEqual([choices.getState().error, choices.getState().preview], [moved, null])

  // It moves between the two yeses: the second is refused, and nothing is done.
  held = SHOWN
  await choices.choose('request-changes')
  assert.ok(choices.getState().preview)
  held = NEWER
  await choices.confirm()
  assert.equal(choices.getState().error, moved)
  assert.equal(choices.getState().preview, null)
  assert.deepEqual(heads().slice(2), [['review.preview', SHOWN], ['review.preview', SHOWN], ['review.verdict', SHOWN]], 'every ask names the commit on screen, never the newer one')
})

test('holding Enter never gives the second yes: a held key goes on as repeats, and only a key pressed anew presses the yes', () => {
  // Enter on a choice asks what it will do, and is still down when the yes takes the keyboard: it goes on as repeats.
  assert.equal(heldDown({ key: 'Enter', repeat: true }), true)
  // So is Space, held while the choice was clicked: with its repeats stopped, letting it go presses nothing.
  assert.equal(heldDown({ key: ' ', repeat: true }), true)
  // Let go and pressed again, either presses the yes, as it presses any button.
  assert.equal(heldDown({ key: 'Enter', repeat: false }), false)
  assert.equal(heldDown({ key: ' ', repeat: false }), false)
  // Every other key is left to the review, held or not: Escape steps back from the yes, A asks again.
  for (const key of ['Escape', 'a', 'x']) assert.equal(heldDown({ key, repeat: true }), false)
})

test('the comments a verdict takes are marked sent once the host has done it, so they never go twice', async () => {
  const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
  const review = { ...sample, id: CHANGE }
  const memory = createReviewMemory(memoryStorage())
  const step = review.story[1]!.id
  const comment = memory.getState().addNote(review, { step, target: { kind: 'step' }, intent: 'comment', text: 'Name it after what it holds.' })!
  const question = memory.getState().addNote(review, { step, target: { kind: 'step' }, intent: 'question', text: 'Why here?' })!
  const unsent = () => memory.getState().notesOf(review).filter((note) => note.intent === 'comment' && note.sent == null).map((note) => note.id)
  const wiring = { comments: unsent, markSent: (ids: readonly string[]) => memory.getState().markSent(review, ids, 50) }
  const sentAt = (id: string) => memory.getState().notesOf(review).find((note) => note.id === id)?.sent

  // Approving a finished change takes no comment with it: they wait for the fixes.
  const approve = panel(CHANGE, host, wiring)
  await approve.choices.choose('approve')
  await approve.choices.confirm()
  assert.equal(sentAt(comment.id), undefined)

  // A verdict the host refuses at the last moment sends nothing, so nothing is marked.
  const refused = panel(
    CHANGE,
    (name, args) => {
      if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown.')
      return host(name, args)
    },
    wiring,
  )
  await refused.choices.choose('request-changes')
  await refused.choices.confirm()
  assert.equal(sentAt(comment.id), undefined)

  // Sending the fixes marks the comment it carried, and not the question, which is hobkin's to answer.
  const fixes = panel(CHANGE, host, wiring)
  await fixes.choices.choose('request-changes')
  await fixes.choices.confirm()
  assert.deepEqual([sentAt(comment.id), sentAt(question.id)], [50, undefined])
  assert.deepEqual(unsent(), [])
})

test('a verdict is confirmed in place: the first click shows what it does, a second within ten seconds does it, and after ten it goes back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const landed: [Verdict, string][] = []
  const { choices, calls } = panel(CHANGE, host, { landed: (verdict, message) => void landed.push([verdict, message]) })
  const asked = (name: string) => calls.filter((call) => call.name === name).length

  // The first click asks the host what it will do, and the button waits for the second.
  await choices.press('approve-merge')
  assert.equal(choices.armed(), 'approve-merge')
  assert.deepEqual(choices.getState().preview?.lines, ['What approve-merge does.'])
  assert.equal(CONFIRM_MS, 10_000)
  t.mock.timers.tick(CONFIRM_MS - 1)
  assert.equal(choices.armed(), 'approve-merge')
  // Ten seconds without it, and the button goes back. A click then asks again; it never merges.
  t.mock.timers.tick(1)
  assert.deepEqual([choices.armed(), choices.getState().preview], [null, null])
  await choices.press('approve-merge')
  assert.deepEqual([asked('review.preview'), asked('review.verdict')], [2, 0])

  // Escape, or the keyboard leaving the buttons, takes it back the same way.
  choices.cancel()
  assert.equal(choices.armed(), null)

  // A click on another choice while one waits shows that one instead.
  await choices.press('approve-merge')
  await choices.press('approve')
  assert.equal(choices.armed(), 'approve')
  assert.equal(asked('review.verdict'), 0)

  // The second click within ten seconds sends the token the host gave, for the commit on screen, and the review hears it landed.
  t.mock.timers.tick(CONFIRM_MS - 1)
  await choices.press('approve')
  assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id: CHANGE, verdict: 'approve', summary: '', confirm: TOKEN.approve, head: SHOWN } })
  assert.deepEqual(landed, [['approve', 'Done: approve']])
  assert.equal(choices.armed(), null)
  t.mock.timers.tick(CONFIRM_MS)
  assert.equal(asked('review.verdict'), 1)

  // A verdict the host refuses at the last moment never lands.
  const refused = panel(CHANGE, (name, args) => {
    if (name === 'review.verdict') throw new Error('What would be sent has changed since it was shown.')
    return host(name, args)
  }, { landed: (verdict, message) => void landed.push([verdict, message]) })
  await refused.choices.press('approve-merge')
  await refused.choices.press('approve-merge')
  assert.match(refused.choices.getState().error ?? '', /changed since it was shown/)
  assert.equal(landed.length, 1)
})

test('a pull request is approved, approved and merged, or commented on, never sent back; a finished change approved, merged or sent its fixes', () => {
  assert.deepEqual(VERDICT_CHOICES.pull.map(({ verdict }) => verdict), ['approve', 'approve-merge', 'comment', 'discard', 'discard-branch'])
  assert.deepEqual(VERDICT_CHOICES.change.map(({ verdict }) => verdict), ['approve', 'approve-merge', 'request-changes', 'discard', 'discard-branch'])
  // Its key is the click on it: A and M, wherever the reviewer is in the review. Comment and the two discards have none.
  assert.deepEqual(VERDICT_CHOICES.pull.map(({ keys }) => keys ?? null), ['A', 'M', null, null, null])
  assert.deepEqual([verdictKind(PULL), verdictKind(CHANGE)], ['pull', 'change'])
})

test("on someone else's pull request only Approve and Comment are offered, with why; on the user's own every choice", () => {
  const verdicts = (id: string, owner?: { author: string | null; mine: boolean }) => verdictChoices(id, owner).choices.map(({ verdict }) => verdict)
  assert.deepEqual(verdicts(PULL, { author: 'dev', mine: true }), ['approve', 'approve-merge', 'comment', 'discard', 'discard-branch'])
  assert.deepEqual(verdicts(PULL, { author: 'dev', mine: false }), ['approve', 'comment'])
  assert.deepEqual(verdicts(PULL), ['approve', 'comment'], 'a review from before it was recorded reads as someone else’s')
  assert.equal(verdictChoices(PULL, { author: 'dev', mine: false }).why, 'This pull request is by dev: merging or closing it is left to them.')
  assert.equal(verdictChoices(PULL).why, 'Merging or closing this pull request is left to its author.')
  assert.equal(verdictChoices(PULL, { author: 'dev', mine: true }).why, null)
  assert.deepEqual(verdicts(CHANGE), ['approve', 'approve-merge', 'request-changes', 'discard', 'discard-branch'])
  assert.equal(verdictChoices(CHANGE).why, null)
})

test("a pull request's verdict takes only the user's own comments, and a finished change's fixes take hobkin's too", () => {
  const base = { step: 's1', target: { kind: 'step' as const }, at: 1 }
  const notes = [
    { ...base, id: 'mine', intent: 'comment' as const, author: 'user' as const, text: 'Mine.' },
    { ...base, id: 'hobkins', intent: 'comment' as const, author: 'hobkin' as const, text: "hobkin's." },
    { ...base, id: 'asked', intent: 'question' as const, author: 'user' as const, text: 'Why?' },
    { ...base, id: 'gone', intent: 'comment' as const, author: 'user' as const, text: 'Sent.', sent: 5 },
  ]
  assert.deepEqual(verdictComments(PULL, notes), ['mine'])
  assert.deepEqual(verdictComments(CHANGE, notes), ['mine', 'hobkins'])
})

test('Discard comes after every yes for a finished change and for a pull request, shown before it goes, and takes no comments with it', async () => {
  for (const [id, kind] of [[CHANGE, 'change'], [PULL, 'pull']] as const) {
    const no = VERDICT_CHOICES[kind].at(-2)!
    assert.deepEqual([no.verdict, no.label, no.keys], ['discard', 'Discard', undefined], `${kind}: it comes after the yeses and no single key gives it`)

    const sent: string[][] = []
    const { choices, calls } = panel(id, host, { comments: () => ['n1'], markSent: (ids) => sent.push([...ids]) })
    // The first click only shows what the no will do.
    await choices.press('discard')
    assert.deepEqual(calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id, verdict: 'discard', summary: '', head: SHOWN } }])
    assert.equal(choices.armed(), 'discard')
    // The second does it, with the token the host answered.
    await choices.press('discard')
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id, verdict: 'discard', summary: '', confirm: TOKEN.discard, head: SHOWN } })
    assert.equal(choices.getState().message, 'Done: discard')
    // A no posts no review, so the comments written on it are not marked as sent.
    assert.equal(sendsComments(id, 'discard'), false)
    assert.deepEqual(sent, [])
  }
})

test('Discard and delete branch is the last choice for both kinds, with no key of its own, shown before it goes, and takes no comments with it', async () => {
  for (const [id, kind] of [[CHANGE, 'change'], [PULL, 'pull']] as const) {
    const last = VERDICT_CHOICES[kind].at(-1)!
    assert.deepEqual([last.verdict, last.label, last.keys], ['discard-branch', 'Discard and delete branch', undefined], `${kind}: it is last and no single key gives it`)

    const { choices, calls } = panel(id, host, { comments: () => ['n1'] })
    await choices.press('discard-branch')
    assert.deepEqual(calls, [{ name: 'save', args: null }, { name: 'review.preview', args: { id, verdict: 'discard-branch', summary: '', head: SHOWN } }], 'the first click only shows what it deletes')
    await choices.press('discard-branch')
    assert.deepEqual(calls.at(-1), { name: 'review.verdict', args: { id, verdict: 'discard-branch', summary: '', confirm: TOKEN['discard-branch'], head: SHOWN } })
    assert.equal(sendsComments(id, 'discard-branch'), false)
  }
})
