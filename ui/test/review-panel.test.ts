import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { mergeHostNotes } from '../src/features/review/notes/merge.ts'
import type { Note, NoteEntry } from '../src/features/review/notes/notes.ts'
import { reviewThread, reviewTrack } from '../src/features/review/panel/thread.ts'
import { verdictRequest } from '../src/features/review/panel/request.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const about = `Review "${sample.change.title}", step 3 of ${sample.story.length}`
const message = (id: string, role: ChatMessage['role'], content: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, content, at, ...extra })

test("the panel's discussion is what the user asked about this review and hobkin's answers to it, and nothing else", () => {
  const messages = [
    message('m1', 'user', 'Unrelated.', 1),
    message('m2', 'assistant', 'Unrelated answer.', 2),
    message('m3', 'user', 'Why is the word cleared here?', 3, { about }),
    message('m4', 'assistant', 'Because the turn ended.', 4),
    message('m5', 'assistant', 'And the next turn starts empty.', 5),
    message('m6', 'user', 'Thanks, something else.', 6),
    message('m7', 'assistant', 'Sure.', 7),
    message('m8', 'user', 'Another review.', 8, { about: 'Review "Something else", step 1 of 4' }),
  ]
  assert.deepEqual(reviewThread(messages, sample.change.title).map((entry) => entry.id), ['m3', 'm4', 'm5'])
})

test("the track lays the notes and the discussion out in the order they happened, each saying who wrote it", () => {
  const notes: Note[] = [
    { id: 'n2', step: 's1', target: { kind: 'step' }, intent: 'comment', text: 'Later note.', author: 'hobkin', at: 50 },
    { id: 'n1', step: 's1', target: { kind: 'step' }, intent: 'question', text: 'Early note.', author: 'user', at: 10 },
  ]
  const thread = [message('m3', 'user', 'Asked.', 20, { about }), message('m4', 'assistant', 'Answered.', 30)]
  assert.deepEqual(reviewTrack(notes, thread).map((entry) => [entry.kind, entry.id, entry.who]), [
    ['note', 'n1', 'you'],
    ['message', 'm3', 'you'],
    ['message', 'm4', 'hobkin'],
    ['note', 'n2', 'hobkin'],
  ])
})

test("a note hobkin left on the host joins the window's notes, unless the window already has it or removed it", () => {
  const note = (id: string, text: string): Note => ({ id, step: 's1', target: { kind: 'step' }, intent: 'comment', text, author: 'hobkin', at: 1 })
  const local: NoteEntry[] = [{ op: 'put', note: note('n1', 'Changed here.') }, { op: 'remove', id: 'n2' }]
  const host: NoteEntry[] = [{ op: 'put', note: note('n1', 'As the host had it.') }, { op: 'put', note: note('n2', 'Removed here.') }, { op: 'put', note: note('n3', 'New from hobkin.') }]
  const merged = mergeHostNotes(local, host)
  assert.deepEqual(merged, [...local, { op: 'put', note: note('n3', 'New from hobkin.') }])
  assert.equal(mergeHostNotes(merged, host), merged, 'nothing new leaves the log as it is')
})

test('A approves, M approves and merges, X sends the fixes, and H goes to hobkin', () => {
  const session = createSession(sample, createReviewMemory(memoryStorage()))
  const asked: string[] = []
  const effects = { panelKey: () => false, toggleSteps: () => {}, talk: () => asked.push('talk'), verdict: (kind: string) => asked.push(kind) }
  for (const key of ['a', 'M', 'x', 'h']) assert.equal(pressKey(session.getState(), { key, shift: false, alt: false }, effects), true)
  assert.deepEqual(asked, ['approve', 'approve-merge', 'request-changes', 'talk'])
})

test('a verdict is a request to hobkin in the main conversation, saying exactly what to do and which comments go with it', () => {
  const comment = (id: string, text: string, rest: Partial<Note> = {}): Note => ({ id, step: sample.story[3]!.id, target: { kind: 'step' }, intent: 'comment', text, author: 'user', at: 1, ...rest })
  const notes: Note[] = [
    comment('n1', 'Clear the word when the turn ends.'),
    comment('n2', 'Name it after what it holds.', { author: 'hobkin' }),
    comment('n3', 'Already sent.', { sent: 5 }),
    { ...comment('n4', 'Only a question.'), intent: 'question' },
  ]
  const change = { ...sample, id: 'change:hobkin:7d02c9' }

  const approve = verdictRequest(change, notes, 'approve')!
  assert.match(approve.text, /approve it\. Open its pull request/)
  // hobkin's own work action opens it, pinned to the commit that was reviewed, so the change's card then waits on that PR.
  assert.match(approve.text, new RegExp(`hobkin work publish hobkin 7d02c9 ${sample.change.head}`))
  assert.match(approve.text, new RegExp(`at commit ${sample.change.head.slice(0, 7)}`))
  assert.deepEqual(approve.sends, [])
  assert.match(verdictRequest(change, notes, 'approve-merge')!.text, /approve it\. Merge it\./)

  // The fixes are the comments not sent yet, the reviewer's and hobkin's, written out with what each is about.
  const fixes = verdictRequest(change, notes, 'request-changes')!
  assert.match(fixes.text, /Send these fixes to an agent/)
  assert.match(fixes.text, /Clear the word when the turn ends\.[\s\S]*Name it after what it holds\./)
  assert.equal(fixes.text.includes('Already sent'), false)
  assert.equal(fixes.text.includes('Only a question'), false)
  assert.deepEqual(fixes.sends, ['n1', 'n2'])
  assert.equal(verdictRequest(change, [], 'request-changes'), null, 'no fixes without a comment')

  const pull = { ...sample, id: 'pr:acme/shop/482' }
  assert.match(verdictRequest(pull, notes, 'approve')!.text, /Approve acme\/shop#482 on GitHub/)
  assert.match(verdictRequest(pull, notes, 'request-changes')!.text, /Request changes on acme\/shop#482 on GitHub/)
  assert.equal(verdictRequest(pull, notes, 'approve-merge'), null, 'a pull request from GitHub is merged on GitHub')
})
