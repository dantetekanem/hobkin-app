import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { reviewFolder, reviewIdOf, targetOfReviewId } from '../review/ids.ts'
import { hashLines } from '../review/lines.ts'
import type { Note } from '../review/notes.ts'
import type { Review } from '../review/types.ts'
import { askForChanges, closingComment, pullReviewPost, saysNothing } from '../review/verdict.ts'

const sample = JSON.parse(readFileSync(new URL('../../ui/src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const step = (title: string) => sample.story.find((entry) => entry.title === title)!
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const note = (id: string, rest: Partial<Note>): Note => ({ id, step: step('The runtime keeps the word for one turn').id, target: { kind: 'step' }, intent: 'comment', text: 'x', author: 'user', at: Number(id.slice(1)), ...rest })

test('a review is named by what it reviews, and the name comes back as the same target', () => {
  const change = { kind: 'change', slug: 'hobkin', item: '7d02c9' } as const
  const pull = { kind: 'pull', owner: 'hobkin-sample', repo: 'storefront', number: 482 } as const

  assert.equal(reviewIdOf(change), 'change:hobkin:7d02c9')
  assert.equal(reviewIdOf(pull), 'pr:hobkin-sample/storefront/482')
  assert.deepEqual(targetOfReviewId('change:hobkin:7d02c9'), change)
  assert.deepEqual(targetOfReviewId('pr:hobkin-sample/storefront/482'), pull)
  assert.deepEqual(targetOfReviewId('https://github.com/hobkin-sample/storefront/pull/482'), pull, 'a pull request page reads as its review')
  for (const broken of ['sample', 'pr:a/b', 'change:x', 'pr:../etc/1', 'change:a:b:c', 'https://example.com/a/b/pull/1']) assert.equal(targetOfReviewId(broken), null, broken)

  // GitHub's names do not care about case, so neither does the review's.
  assert.deepEqual(targetOfReviewId('pr:Hobkin-Sample/StoreFront/482'), pull)

  // Each review has a folder of its own in the home, safe as a file name, and two reviews never share one.
  assert.equal(reviewFolder(change), 'change+hobkin+7d02c9')
  assert.equal(reviewFolder(pull), 'pr+hobkin-sample+storefront+482')
  assert.notEqual(reviewFolder({ kind: 'change', slug: 'a--b', item: 'c' }), reviewFolder({ kind: 'change', slug: 'a', item: 'b--c' }))
})

test("every review of a pull request carries exactly what the user wrote, and nothing of hobkin's", () => {
  const text = 'a\nb\nc\nd\n'
  const notes = [
    note('n1', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, hash: hashLines(text, 1, 3) }, text: 'These three lines read as one.' }),
    note('n2', { target: { kind: 'lines', fileId: 'src/cli/ui.mjs', side: 'deleted', startLine: 9, endLine: 9, hash: hashLines(text, 1, 1) }, text: 'Was this line used elsewhere?' }),
    note('n3', { target: { kind: 'node', node: idOf('send') }, text: 'Name the field after what it holds.' }),
    note('n4', { text: 'A note on the step.' }),
    // A question is for hobkin, never for the pull request.
    note('n5', { intent: 'question', text: 'Why here and not in connectMain?' }),
    // hobkin's own notes stay with hobkin, on lines or not.
    note('n6', { author: 'hobkin', target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 176, hash: hashLines(text, 1, 1) }, text: 'hobkin thinks this is risky.' }),
    note('n7', { author: 'hobkin', text: 'hobkin found nothing else.' }),
  ]
  const EVENTS = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' } as const
  for (const verdict of ['comment', 'approve', 'request-changes'] as const) {
    const post = pullReviewPost(sample, notes, verdict, 'Two small things before this lands.')
    assert.equal(post.event, EVENTS[verdict])
    assert.equal(post.commit_id, sample.change.head)
    assert.deepEqual(post.comments, [
      { path: 'src/cli/runtime.mjs', side: 'RIGHT', start_line: 176, start_side: 'RIGHT', line: 178, body: 'These three lines read as one.' },
      { path: 'src/cli/ui.mjs', side: 'LEFT', line: 9, body: 'Was this line used elsewhere?' },
    ])
    // The summary, then each note with no lines, with what it is about, as written: no line of hobkin's, no filler.
    assert.equal(post.body, ['Two small things before this lands.', 'About send, code in src/cli/runtime.mjs: Name the field after what it holds.', 'A note on the step.'].join('\n\n'))
    assert.equal(JSON.stringify(post).includes('hobkin'), false, verdict)
    assert.equal(post.body!.includes('Why here'), false)
  }

  // A long summary goes as it was written, unfolded.
  const long = 'The retry\nloop is fine.\n\nOne thing to look at later:\nthe log line.'
  assert.equal(pullReviewPost(sample, [], 'comment', long).body, long)

  // With nothing written, an approval has no words, and a review says nothing.
  assert.deepEqual(pullReviewPost(sample, [], 'approve', ''), { event: 'APPROVE', commit_id: sample.change.head, comments: [] })
  assert.equal(saysNothing(pullReviewPost(sample, [], 'approve', '')), true)
  assert.equal(saysNothing(pullReviewPost(sample, [], 'comment', '  ')), true)
  assert.equal(saysNothing(pullReviewPost(sample, [notes[5]!, notes[6]!], 'comment', '')), true, "hobkin's notes are no words of the user's")
  assert.equal(saysNothing(pullReviewPost(sample, [], 'comment', 'Fine.')), false)
  // Only line comments: they go, and the review has no body.
  const lines = pullReviewPost(sample, [notes[0]!], 'comment', '')
  assert.equal('body' in lines, false)
  assert.equal(saysNothing(lines), false)

  // A note that was handed over already, or detached from its lines, is not posted again or posted on the wrong lines.
  assert.deepEqual(pullReviewPost(sample, [{ ...notes[0]!, sent: 5 }], 'comment', 'Looks fine.').comments, [])
  const loose = pullReviewPost(sample, [notes[0]!], 'comment', '', new Set(['n1']))
  assert.deepEqual(loose, { event: 'COMMENT', commit_id: sample.change.head, body: 'About src/cli/runtime.mjs, lines 176 to 178, as changed: These three lines read as one.', comments: [] })
})

test('the words a pull request gets before it is closed unmerged go as the user wrote them', () => {
  assert.equal(closingComment('  Superseded by the new checkout.\n\nThanks for it.  '), 'Superseded by the new checkout.\n\nThanks for it.')
  assert.equal(closingComment('  '), null)
})

test('ask for changes sends selected notes with their targets', () => {
  const notes = [
    note('n1', { target: { kind: 'node', node: idOf('send') }, text: 'Name the field after what it holds.' }),
    note('n2', { step: step('The row').id, text: 'The row should say which agent.' }),
    note('n3', { intent: 'question', text: 'A question stays with hobkin.' }),
  ]

  assert.equal(
    askForChanges(sample, notes, 'Please change these two things.'),
    [
      'Please change these two things.',
      '',
      `1. Step ${sample.story.indexOf(step('The runtime keeps the word for one turn')) + 1} of ${sample.story.length}, "The runtime keeps the word for one turn". About send, code in src/cli/runtime.mjs.`,
      '   Name the field after what it holds.',
      '',
      `2. Step ${sample.story.indexOf(step('The row')) + 1} of ${sample.story.length}, "The row".`,
      '   The row should say which agent.',
    ].join('\n'),
  )
  // With nothing to ask for, there is nothing to send.
  assert.equal(askForChanges(sample, [notes[2]!], ''), null)
})
