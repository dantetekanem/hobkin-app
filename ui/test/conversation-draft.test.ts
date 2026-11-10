import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { draftAge, draftReducer, emptyDraft, storedDraft, type Attachment, type DraftAction, type DraftState } from '../src/features/chat/draft.ts'
import { draftAfterStop, emptyOutbox, settleOutbox, type Outbox } from '../src/features/chat/outbox.ts'

const after = (state: DraftState, ...actions: DraftAction[]) => actions.reduce(draftReducer, state)
const picture: Attachment = { id: 'p1', name: 'chart.png', mimeType: 'image/png', preview: 'blob:chart' }

test('the draft and attachments move into the prompt editor and back', () => {
  const small = after(emptyDraft, { type: 'typed', text: 'Plan the release' }, { type: 'attached', attachment: picture })
  assert.equal(small.place, 'input')

  // Ctrl+Option+P: the editor opens on the same draft.
  const editor = after(small, { type: 'editor-toggled' })
  assert.equal(editor.place, 'editor')
  assert.equal(editor.text, 'Plan the release')
  assert.deepEqual(editor.attachments, [picture])

  // What is written and attached there is the same draft, so pressing it again leaves the small input holding it.
  const more: Attachment = { id: 'p2', name: 'notes.webp', mimeType: 'image/webp', preview: 'blob:notes' }
  const back = after(editor, { type: 'typed', text: 'Plan the release\n\n## Steps\n\n1. Tag it' }, { type: 'attached', attachment: more }, { type: 'detached', id: 'p1' }, { type: 'editor-toggled' })
  assert.equal(back.place, 'input')
  assert.equal(back.text, 'Plan the release\n\n## Steps\n\n1. Tag it')
  assert.deepEqual(back.attachments, [more])

  // Escape asks before anything is lost. Going back to the text changes nothing.
  const asked = after(editor, { type: 'editor-escaped', at: 1000, id: 'k1' })
  assert.equal(asked.place, 'editor')
  assert.equal(asked.leaving, true)
  assert.deepEqual(after(asked, { type: 'leave-cancelled' }), editor)

  // Keeping sets the draft aside with its images, so the input is free for the next thing.
  const kept = after(asked, { type: 'leave-kept', at: 1000, id: 'k1' })
  assert.deepEqual([kept.place, kept.leaving, kept.text, kept.attachments.length], ['input', false, '', 0])
  assert.deepEqual(kept.kept, [{ id: 'k1', text: 'Plan the release', at: 1000, attachments: [picture] }])
  // Escape asked twice keeps it: an unfinished prompt never stands in the way.
  assert.deepEqual(after(asked, { type: 'editor-escaped', at: 1000, id: 'k1' }), kept)
  const discarded = after(asked, { type: 'leave-discarded' })
  assert.deepEqual([discarded.place, discarded.leaving, discarded.text, discarded.attachments.length, discarded.kept.length], ['input', false, '', 0, 0])

  // With nothing written there is nothing to ask about, or to keep.
  const empty = after(emptyDraft, { type: 'editor-toggled' }, { type: 'editor-escaped', at: 1, id: 'k' })
  assert.deepEqual([empty.place, empty.leaving, empty.kept.length], ['input', false, 0])

  // Sending from the editor sends the draft and closes it.
  const sent = after(editor, { type: 'sent' })
  assert.deepEqual([sent.place, sent.text, sent.attachments.length], ['input', '', 0])
  assert.deepEqual(sent.sent, ['Plan the release'])
})

test('kept drafts wait in a list, newest first, and one opened again is the one being written', () => {
  const keep = (state: DraftState, at: number, id: string) => after(state, { type: 'editor-escaped', at, id }, { type: 'editor-escaped', at, id })
  const write = (state: DraftState, text: string) => after(state, { type: 'editor-toggled' }, { type: 'typed', text })
  const listed = (state: DraftState) => state.kept.map(({ id, text }) => [id, text])

  let draft = keep(write(emptyDraft, 'First idea'), 100, 'a')
  draft = keep(write(draft, 'Second idea'), 200, 'b')
  assert.deepEqual(listed(draft), [['b', 'Second idea'], ['a', 'First idea']])

  // Opening one while another is being written sets that one aside first, so nothing is lost.
  draft = after(write(draft, 'Half a third'), { type: 'draft-opened', id: 'a', at: 300, keepAs: 'c' })
  assert.deepEqual([draft.text, draft.from, draft.place], ['First idea', 'a', 'editor'])
  assert.deepEqual(listed(draft), [['c', 'Half a third'], ['b', 'Second idea']])

  // Kept again, it goes back to the top under its own name, with what was added.
  draft = keep(after(draft, { type: 'typed', text: 'First idea, grown' }), 400, 'unused')
  assert.deepEqual(draft.kept.map(({ id, text, at }) => [id, text, at]), [['a', 'First idea, grown', 400], ['c', 'Half a third', 300], ['b', 'Second idea', 200]])

  // Sent, it is gone for good. Deleted, too.
  draft = after(draft, { type: 'editor-toggled' }, { type: 'draft-opened', id: 'c', at: 500, keepAs: 'd' }, { type: 'sent' })
  assert.deepEqual([draft.kept.map(({ id }) => id), draft.from], [['a', 'b'], null])
  draft = after(draft, { type: 'editor-toggled' }, { type: 'draft-opened', id: 'b', at: 600, keepAs: 'e' }, { type: 'editor-escaped', at: 600, id: 'e' }, { type: 'leave-discarded' })
  assert.deepEqual(draft.kept.map(({ id }) => id), ['a'])
  assert.equal(after(draft, { type: 'draft-opened', id: 'gone', at: 700, keepAs: 'f' }), draft, 'a draft that is not there opens nothing')

  // Only the words survive a reload: images are files hobkin holds for this session.
  const withPicture = { ...draft, kept: [{ id: 'x', text: 'With a picture', at: 1, attachments: [picture] }] }
  assert.deepEqual(storedDraft(withPicture).kept, [{ id: 'x', text: 'With a picture', at: 1, attachments: [] }])

  // Each one says when it was set aside.
  const noon = new Date(2026, 10, 10, 12, 0).getTime()
  assert.deepEqual(
    [noon - 20000, noon - 5 * 60000, noon - 3 * 3600000, new Date(2026, 10, 9, 23, 0).getTime(), new Date(2026, 10, 6, 9, 0).getTime(), new Date(2026, 9, 3, 9, 0).getTime()].map((at) => draftAge(at, noon)),
    ['now', '5 min', '3 h', 'yesterday', 'Fri', 'Oct 3'],
  )
})

test('up in an empty message walks back through what the user sent', () => {
  const write = (text: string): DraftAction[] => [{ type: 'typed', text }, { type: 'sent' }]
  let draft = after(emptyDraft, ...write('First'), ...write('Second'), ...write('Third'))
  assert.equal(draft.text, '')

  draft = after(draft, { type: 'recalled', direction: 'older' })
  assert.equal(draft.text, 'Third', 'newest first')
  draft = after(draft, { type: 'recalled', direction: 'older' }, { type: 'recalled', direction: 'older' })
  assert.equal(draft.text, 'First')
  assert.equal(after(draft, { type: 'recalled', direction: 'older' }).text, 'First', 'the oldest is where it stops')

  draft = after(draft, { type: 'recalled', direction: 'newer' })
  assert.equal(draft.text, 'Second')
  draft = after(draft, { type: 'recalled', direction: 'newer' }, { type: 'recalled', direction: 'newer' })
  assert.deepEqual([draft.text, draft.recalled], ['', null], 'past the newest the input is empty again')

  // Once the user changes what came back it is their draft, and Up no longer replaces it.
  const edited = after(draft, { type: 'recalled', direction: 'older' }, { type: 'typed', text: 'Third, but different' })
  assert.equal(edited.recalled, null)
  assert.equal(after(edited, { type: 'recalled', direction: 'older' }).text, 'Third, but different')

  // The same message sent twice in a row is kept once.
  assert.deepEqual(after(emptyDraft, ...write('Again'), ...write('Again')).sent, ['Again'])
})

test('what hobkin never read returns to the input, and what it stored leaves the outbox', () => {
  assert.equal(draftAfterStop(['Only weekdays', 'And skip Friday'], 'half a thought'), 'Only weekdays\n\nAnd skip Friday\n\nhalf a thought')
  assert.equal(draftAfterStop([], 'half a thought'), 'half a thought')

  const stopped = after({ ...emptyDraft, text: 'half a thought' }, { type: 'stopped', unsent: ['Only weekdays'] })
  assert.equal(stopped.text, 'Only weekdays\n\nhalf a thought')

  const sentAt = Date.parse('2026-11-09T14:00:00Z')
  const stored = (id: string, at: string): ChatMessage => ({ id, role: 'user', content: 'whatever hobkin kept of it', at })
  const waiting: Outbox = {
    entries: [
      { id: 1, text: 'One', at: sentAt, accepted: true },
      { id: 2, text: 'Two', at: sentAt + 1000, accepted: false },
    ],
    delivered: [],
  }

  // An older stored message is not a copy of anything just sent.
  assert.equal(settleOutbox(waiting, [stored('old', '2026-11-09T13:00:00Z')], true), waiting)

  // The first stored message from after the send is the first entry's copy, and only that one's.
  const one = settleOutbox(waiting, [stored('old', '2026-11-09T13:00:00Z'), stored('u1', '2026-11-09T14:00:02Z')], true)
  assert.deepEqual(one.entries.map(({ text }) => text), ['Two'])
  assert.deepEqual(one.delivered, ['u1'])

  // A message hobkin took that never showed leaves when the turn ends. One it has not taken yet stays.
  const ended = settleOutbox({ entries: waiting.entries, delivered: [] }, [], false)
  assert.deepEqual(ended.entries.map(({ text }) => text), ['Two'])
  assert.equal(settleOutbox(emptyOutbox, [stored('u1', '2026-11-09T14:00:02Z')], false), emptyOutbox)
})

test('a file hobkin would not take is refused before it is sent anywhere, with the limit in the message', async () => {
  const { attachmentRefusal } = await import('../src/features/chat/attachments.ts')
  const limits = { images: 4, imageBytes: 64 * 1024 * 1024 }
  const file = (name: string, type: string, size = 1000) => ({ name, type, size })

  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) assert.equal(attachmentRefusal(file('picture', type), 0, limits), null)
  assert.match(attachmentRefusal(file('huge.png', 'image/png', limits.imageBytes + 1), 0, limits) ?? '', /huge\.png is over 64 MB/)
  assert.match(attachmentRefusal(file('notes.pdf', 'application/pdf'), 0, limits) ?? '', /PNG, JPEG, GIF and WebP/)
  assert.match(attachmentRefusal(file('vector.svg', 'image/svg+xml'), 0, limits) ?? '', /PNG, JPEG, GIF and WebP/)
  assert.match(attachmentRefusal(file('fifth.png', 'image/png'), 4, limits) ?? '', /4 images/)
  // Without a live hobkin there are no limits to go by, and nothing to attach to.
  assert.match(attachmentRefusal(file('picture.png', 'image/png'), 0, null) ?? '', /hobkin/)
})

test('an image is part of the draft from the moment it is chosen, and can go once hobkin holds it', () => {
  const chosen: Attachment = { id: 'local:1', name: 'chart.png', mimeType: 'image/png', preview: 'blob:chart' }
  let draft = after(emptyDraft, { type: 'attached', attachment: chosen })
  assert.equal(draft.attachments[0]?.handle, undefined, 'still on its way to hobkin')

  draft = after(draft, { type: 'uploaded', id: 'local:1', handle: 'host-7' })
  assert.deepEqual(draft.attachments, [{ ...chosen, handle: 'host-7' }])
  // An upload that finishes after the image was removed changes nothing.
  assert.deepEqual(after(draft, { type: 'detached', id: 'local:1' }, { type: 'uploaded', id: 'local:1', handle: 'host-7' }).attachments, [])
})
