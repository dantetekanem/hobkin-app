import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { reviewFolder, reviewIdOf, targetOfReviewId } from '../review/ids.ts'
import { hashLines } from '../review/lines.ts'
import type { Note } from '../review/notes.ts'
import type { Review } from '../review/types.ts'
import { askForChanges, pullReviewPost } from '../review/verdict.ts'

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

test('approving or asking for changes on a pull request posts one GitHub review, with line comments where notes have lines', () => {
  const text = 'a\nb\nc\nd\n'
  const notes = [
    note('n1', { target: { kind: 'lines', fileId: 'src/cli/runtime.mjs', side: 'added', startLine: 176, endLine: 178, hash: hashLines(text, 1, 3) }, text: 'These three lines read as one.' }),
    note('n2', { target: { kind: 'lines', fileId: 'src/cli/ui.mjs', side: 'deleted', startLine: 9, endLine: 9, hash: hashLines(text, 1, 1) }, text: 'Was this line used elsewhere?' }),
    note('n3', { target: { kind: 'node', node: idOf('send') }, text: 'Name the field after what it holds.' }),
    // A question is for hobkin, never for the pull request.
    note('n4', { intent: 'question', text: 'Why here and not in connectMain?' }),
  ]

  const post = pullReviewPost(sample, notes, 'request-changes', 'Two small things before this lands.')
  assert.equal(post.event, 'REQUEST_CHANGES')
  assert.equal(post.commit_id, sample.change.head)
  assert.deepEqual(post.comments, [
    { path: 'src/cli/runtime.mjs', side: 'RIGHT', start_line: 176, start_side: 'RIGHT', line: 178, body: 'These three lines read as one.' },
    { path: 'src/cli/ui.mjs', side: 'LEFT', line: 9, body: 'Was this line used elsewhere?' },
  ])
  // A note with no lines goes in the body, with where it was taken written out.
  assert.equal(
    post.body,
    ['Two small things before this lands.', '', `- About send, code in src/cli/runtime.mjs: Name the field after what it holds.`].join('\n'),
  )
  assert.equal(post.body.includes('Why here'), false)

  // An approval with nothing to say still says something, as GitHub asks of a review with a body.
  assert.deepEqual(pullReviewPost(sample, [], 'approve', ''), { event: 'APPROVE', commit_id: sample.change.head, body: 'Approved.', comments: [] })
  assert.equal(pullReviewPost(sample, [], 'comment', '').event, 'COMMENT')
  // A note that was handed over already, or detached from its lines, is not posted again or posted on the wrong lines.
  const handed = pullReviewPost(sample, [{ ...notes[0]!, sent: 5 }], 'comment', 'Looks fine.', new Set())
  assert.deepEqual(handed.comments, [])
  const loose = pullReviewPost(sample, [notes[0]!], 'comment', '', new Set(['n1']))
  assert.deepEqual(loose.comments, [])
  assert.equal(loose.body, '- About src/cli/runtime.mjs, lines 176 to 178, as changed: These three lines read as one.')
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
