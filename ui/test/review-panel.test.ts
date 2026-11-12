import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { Review } from '#shared/review/types.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { mergeHostNotes } from '../src/features/review/notes/merge.ts'
import type { Note, NoteEntry } from '../src/features/review/notes/notes.ts'
import { reviewThread } from '../src/features/review/panel/thread.ts'
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
  assert.deepEqual(reviewThread(messages, sample.change.title).map((entry) => [entry.id, entry.who, entry.text]), [
    ['m3', 'you', 'Why is the word cleared here?'],
    ['m4', 'hobkin', 'Because the turn ended.'],
    ['m5', 'hobkin', 'And the next turn starts empty.'],
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

