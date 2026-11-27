import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { HobkinTurn } from '#shared/protocol/hobkins.ts'
import { hostStore } from '@/lib/host/client.ts'
import { withKept, withReceipts, type SendingNote, type SentNote } from './conversation.ts'

/**
 * What the user sent from durable hobkins' pages, by hobkin, the message on its way to each now, and the words a send
 * could not get to one (`034-durable-hobkins`). It is the window's, not the agent screen's: a page reads its
 * conversation again only when a turn begins or ends (`use-conversation.ts`), so what the user adds to a working turn
 * is nowhere else in the window until then, and it must still be on the page when the screen comes back from another
 * one, or is drawn afresh. A send that answers after its screen or its box is gone lands here too. It lives on
 * globalThis, so a hot update keeps it. A reload of the window empties it, and each page then reads back what hobkin
 * keeps with its turns (`withKept`).
 */

/** Words a send could not get to a hobkin, and why. They go back into its box. */
export interface Refused {
  text: string
  why: string
}

interface Notes {
  sent: Readonly<Record<string, readonly SentNote[]>>
  sending: Readonly<Record<string, SendingNote | null>>
  /** What waits for each hobkin's box to take it back, oldest first. */
  refused: Readonly<Record<string, readonly Refused[]>>
}

interface Keeper {
  notes: Notes
  /** The ids of the notes the user took back into the box. None comes back from a conversation read before then. */
  takenBack: Set<string>
  readers: Set<() => void>
  /** Stops the copy of this file that listens for hobkin's receipts, so the next copy a hot update runs takes over. */
  stopReceipts: (() => void) | null
}

const EMPTY: Notes = { sent: {}, sending: {}, refused: {} }
const NO_NOTES: readonly SentNote[] = []
const NONE_REFUSED: readonly Refused[] = []

const slot = globalThis as { __hobkinSentNotes?: Keeper }
const keeper = (slot.__hobkinSentNotes ??= {
  notes: EMPTY,
  takenBack: new Set(),
  readers: new Set(),
  stopReceipts: null,
})
// A copy of this file from before a hot update may have kept less: what it did not keep starts empty.
keeper.notes = { ...EMPTY, ...keeper.notes }

const read = () => keeper.notes

const subscribe = (reader: () => void) => {
  keeper.readers.add(reader)
  return () => void keeper.readers.delete(reader)
}

/** Keeps what changed, and tells what reads the notes. The same values tell no one. */
function change(next: Partial<Notes>): void {
  const before = keeper.notes
  const notes: Notes = { ...before, ...next }
  const same = notes.sent === before.sent && notes.sending === before.sending && notes.refused === before.refused
  if (same) return

  keeper.notes = notes
  for (const reader of [...keeper.readers]) reader()
}

const receipts = () => hostStore.getState().snapshot.steeringReceipts

/** hobkin answered for a message: it is the hobkin's note from now on. */
function add(id: string, note: SentNote): void {
  const { sent } = keeper.notes
  // A read can bring hobkin's copy back before the say answers: this window's own, with its images, takes its place.
  const isHobkinsCopy = (each: SentNote) => note.noteId !== undefined && each.noteId === note.noteId
  const others = (sent[id] ?? NO_NOTES).filter((each) => !isHobkinsCopy(each))
  const withNote = { ...sent, [id]: [...others, note] }

  // A receipt that came before the say answered counts too.
  change({ sent: withReceipts(withNote, receipts()) })
}

/** Takes what hobkin kept of the notes the user added to these turns, for those the window no longer has. */
function recall(id: string, turns: readonly HobkinTurn[]): void {
  const { sent } = keeper.notes
  const held = sent[id] ?? NO_NOTES
  const recalled = withKept(held, turns, keeper.takenBack)
  if (recalled === held) return

  change({ sent: withReceipts({ ...sent, [id]: recalled }, receipts()) })
}

/** The message on its way to a hobkin now, or null once its send has answered. */
function sendingTo(id: string, note: SendingNote | null): void {
  change({ sending: { ...keeper.notes.sending, [id]: note } })
}

/** Notes the user took back into the box leave the page, and stay off it. */
function drop(id: string, noteIds: readonly string[]): void {
  if (!noteIds.length) return

  for (const noteId of noteIds) keeper.takenBack.add(noteId)

  const { sent } = keeper.notes
  const stays = (note: SentNote) => !note.noteId || !noteIds.includes(note.noteId)
  change({ sent: { ...sent, [id]: (sent[id] ?? NO_NOTES).filter(stays) } })
}

/** A send did not get these words to the hobkin: they wait for its box, which may be gone just now (`useRefused`). */
export function refuse(id: string, refusal: Refused): void {
  const { refused } = keeper.notes
  const waiting = refused[id] ?? NONE_REFUSED
  change({ refused: { ...refused, [id]: [...waiting, refusal] } })
}

/** The hobkin's box takes back what waited for it, oldest first. They are the box's from now on, so each is given once. */
function takeRefused(id: string): readonly Refused[] {
  const { refused } = keeper.notes
  const waiting = refused[id] ?? NONE_REFUSED
  if (waiting.length) change({ refused: { ...refused, [id]: NONE_REFUSED } })
  return waiting
}

// hobkin's receipts mark what each turn read in as they come, with the agent screen there or not.
keeper.stopReceipts?.()
keeper.stopReceipts = hostStore.subscribe(({ snapshot }, { snapshot: before }) => {
  if (snapshot.steeringReceipts === before.steeringReceipts) return

  change({ sent: withReceipts(keeper.notes.sent, snapshot.steeringReceipts) })
})

/** What the user sent from the pages and the message on its way to each hobkin, and the ways a page and its box change them. */
export function useSentNotes() {
  const { sent, sending } = useSyncExternalStore(subscribe, read, read)
  return { sent, sending, add, recall, sendingTo, drop }
}

/**
 * Gives a hobkin's box back the words a send could not get to the hobkin (`refuse`), oldest first and each once: at
 * once while the box is there, and when it is back if the user left it for another agent or screen while the send was
 * out. Only that hobkin's box takes them.
 */
export function useRefused(id: string, giveBack: (refused: readonly Refused[]) => void): void {
  const waiting = useSyncExternalStore(
    subscribe,
    () => keeper.notes.refused[id] ?? NONE_REFUSED,
    () => NONE_REFUSED,
  )
  // The box's function is new on every draw: the one drawn last is called, and a new one alone takes nothing.
  const giveBackNow = useRef(giveBack)
  giveBackNow.current = giveBack

  useEffect(() => {
    const back = takeRefused(id)
    if (back.length) giveBackNow.current(back)
  }, [id, waiting])
}
