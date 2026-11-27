import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, test } from 'node:test'
import { createElement } from 'react'
import type { HobkinConversation, HobkinSummary, HobkinTurn, KeptNote } from '../../shared/protocol/hobkins.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const { hostStore } = await import('../src/lib/host/client.ts')
const { pageRows, pageTurns, waitsForTurn } = await import('../src/features/hobkins/conversation.ts')
const { refuse, useRefused, useSentNotes } = await import('../src/features/hobkins/sent-notes.ts')
type SentNotes = ReturnType<typeof useSentNotes>
type SentNote = SentNotes['sent'][string][number]
after(() => void Reflect.deleteProperty(globalThis, 'window'))

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [], reports: [] } })

const runOf = (id: string, n: number) => `hobkin:${id}:${n}`
const working = (id: string): HobkinSummary => ({
  id,
  title: 'Tidy the docs',
  cwd: '/Users/someone/code/site',
  engine: { kind: 'tier', tier: 'mid' },
  state: 'working',
  turns: 1,
  run: runOf(id, 1),
  last: null,
  waiting: null,
  createdAt: '2026-11-27T10:00:00.000Z',
})
const turnOf = (id: string, notes: KeptNote[] = []): HobkinTurn => ({
  n: 1,
  run: runOf(id, 1),
  asked: 'Tidy the docs',
  askedAt: '2026-11-27T10:00:00.000Z',
  status: 'running',
  reply: null,
  error: null,
  endedAt: null,
  ...(notes.length ? { notes } : {}),
})

/** The agent screen as it holds what the user sent: mounted, left for another screen, and opened again. */
async function openScreen() {
  const seen: { notes: SentNotes | null } = { notes: null }
  const Screen = () => {
    seen.notes = useSentNotes()
    return null
  }
  const mounted = await mountCounting(() => createElement(Screen))
  return { mounted, notes: () => seen.notes! }
}

/** The words the user sent that the page draws among a hobkin's turns, as its screen draws them. */
function wordsOnPage(read: HobkinConversation, hobkin: HobkinSummary, sent: readonly SentNote[]): string[] {
  const shown = sent.filter((note) => !waitsForTurn(note, hobkin))
  const rows = pageRows(pageTurns(read, hobkin, shown), { sending: null, activity: null })
  return rows.flatMap((row) => (row.kind === 'said' ? [row.text] : []))
}

test('what the user sent to a working hobkin is still on its page when the agent screen is left and opened again', async () => {
  const id = 'aaaa0001'
  const hobkin = working(id)
  // The conversation as the page read it when the turn began, before anything was added to it. It is not read again
  // until the turn ends, so it never has what the user adds meanwhile.
  const read: HobkinConversation = { hobkin, turns: [turnOf(id)] }
  const note: SentNote = { text: 'Also fix the README.', at: 2000, run: runOf(id, 1), started: false, noteId: '00000000-0000-4000-8000-000000000001', receivedAt: 2100 }
  const onItsWay = { text: 'And the changelog.', at: 3000 }

  const first = await openScreen()
  await first.mounted.change(() => {
    first.notes().add(id, note)
    first.notes().sendingTo(id, onItsWay)
  })
  assert.deepEqual(wordsOnPage(read, hobkin, first.notes().sent[id]!), ['Tidy the docs', 'Also fix the README.'])

  // Another screen, then back to the agent: the screen is drawn anew.
  await first.mounted.unmount()
  const again = await openScreen()

  assert.deepEqual(again.notes().sent[id], [note], "what was sent is the window's, not the screen's")
  assert.deepEqual(again.notes().sending[id], onItsWay, 'and so is the message on its way')
  assert.deepEqual(wordsOnPage(read, hobkin, again.notes().sent[id] ?? []), ['Tidy the docs', 'Also fix the README.'])
  await again.mounted.unmount()
})

test('a message whose send answers after the screen was left is kept, and no longer on its way', async () => {
  const id = 'aaaa0002'
  const note: SentNote = { text: 'Use the staging database.', at: 4000, run: runOf(id, 1), started: true, noteId: '00000000-0000-4000-8000-000000000002' }
  const first = await openScreen()
  await first.mounted.change(() => first.notes().sendingTo(id, { text: note.text, at: note.at }))

  // The box's send is still out when the screen goes. Its answer comes to the functions it was given.
  const { add, sendingTo } = first.notes()
  await first.mounted.unmount()
  add(id, note)
  sendingTo(id, null)

  const again = await openScreen()
  assert.deepEqual(again.notes().sent[id], [note])
  assert.equal(again.notes().sending[id] ?? null, null)
  await again.mounted.unmount()
})

test('words a send could not get to a hobkin go back into its box once: at once while it is there, or when it is back', async () => {
  const id = 'aaaa0006'
  const tooLong = { text: 'A long message for a working turn.', why: 'While it works, a message is at most 4096 characters.' }
  const betweenTurns = { text: 'And one more thing.', why: 'That hobkin is between turns. Send the message again.' }
  /** A hobkin's box, as it takes back what a send could not get there. */
  const openBox = async (hobkin: string) => {
    const back: { text: string; why: string }[] = []
    const Box = () => {
      useRefused(hobkin, (refused) => void back.push(...refused))
      return null
    }
    return { mounted: await mountCounting(() => createElement(Box)), back }
  }

  // hobkin refuses the words while their box is there: they are back in it at once.
  const box = await openBox(id)
  await box.mounted.change(() => refuse(id, tooLong))
  assert.deepEqual(box.back, [tooLong])

  // The user moves to another agent while a send is out, and hobkin refuses it once the box is gone.
  await box.mounted.unmount()
  const other = await openBox('aaaa0007')
  await other.mounted.change(() => refuse(id, betweenTurns))
  assert.deepEqual(other.back, [], "another hobkin's box takes nothing of it")
  await other.mounted.unmount()

  // Back on the hobkin, its box takes the words, once.
  const again = await openBox(id)
  assert.deepEqual(again.back, [betweenTurns])
  await again.mounted.change(() => {})
  assert.deepEqual(again.back, [betweenTurns])
  await again.mounted.unmount()
  const later = await openBox(id)
  assert.deepEqual(later.back, [], 'nothing waits once it was given back')
  await later.mounted.unmount()
})

test('a receipt that comes while the agent screen is away marks the note read', async () => {
  const id = 'aaaa0003'
  const noteId = '00000000-0000-4000-8000-000000000003'
  const waiting: SentNote = { text: 'Skip the migration.', at: 5000, run: runOf(id, 1), started: false, noteId, queue: 'steer' }
  const first = await openScreen()
  await first.mounted.change(() => first.notes().add(id, waiting))
  assert.equal(first.notes().sent[id]![0]!.receivedAt, undefined)
  await first.mounted.unmount()

  send({ type: 'state', rev: rev++, set: { steeringReceipts: { [runOf(id, 1)]: [{ noteId, at: 5200 }] } } })
  // hobkin keeps only its newest receipts: by the time the screen is back, this one is gone.
  send({ type: 'state', rev: rev++, set: { steeringReceipts: {} } })

  const again = await openScreen()
  assert.equal(again.notes().sent[id]![0]!.receivedAt, 5200)
  await again.mounted.unmount()
})

test('a note taken back into the box stays off the page, whatever a conversation read before then still holds', async () => {
  const id = 'aaaa0004'
  const noteId = '00000000-0000-4000-8000-000000000004'
  // The note as hobkin keeps it with the turn, and as this window sent it.
  const kept: KeptNote = { noteId, text: 'Rename the folder.', at: 6000, queue: 'follow-up' }
  const own: SentNote = { text: kept.text, at: 5990, run: runOf(id, 1), started: false, noteId, queue: 'follow-up' }
  const screen = await openScreen()
  await screen.mounted.change(() => screen.notes().add(id, own))

  await screen.mounted.change(() => screen.notes().drop(id, [noteId]))
  assert.deepEqual(screen.notes().sent[id], [])

  // The page shows again with the conversation it kept, read while the note still waited.
  await screen.mounted.change(() => screen.notes().recall(id, [turnOf(id, [kept])]))
  assert.deepEqual(screen.notes().sent[id], [])

  // What hobkin kept of a note this window never had still comes back.
  const other: KeptNote = { noteId: '00000000-0000-4000-8000-000000000005', text: 'Keep the old name.', at: 6100, queue: 'steer' }
  await screen.mounted.change(() => screen.notes().recall(id, [turnOf(id, [kept, other])]))
  assert.deepEqual(screen.notes().sent[id]?.map((note) => note.text), ['Keep the old name.'])
  await screen.mounted.unmount()
})
