import type { HobkinSummary } from '#shared/protocol/hobkins.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { headingOf, type WaitingRow } from '../actions/items.ts'

/**
 * What needs the user, as the Mac's notifications tell it (_specs/037-notifications). Pure, so the rules can be tested
 * without a window: what notifies, the identity each thing keeps, its words, and where a click on it goes.
 */

/** Where a click on a notification goes. Only these places, through the app's own navigation. */
export type Destination =
  /** The question sheet, which shows the question over every screen. */
  | { to: 'question' }
  /** Action Items, with this item open. */
  | { to: 'item'; id: string }
  /** Action Items, where a question that left the sheet waits. */
  | { to: 'actions' }
  /** A durable hobkin's page. */
  | { to: 'hobkin'; id: string }
  /** A review, by its id. */
  | { to: 'review'; id: string }

export type NeedKind = 'question' | 'item' | 'hobkin' | 'review'

export interface Need {
  /** The thing's own identity in its home: a filed question and its item share it. */
  id: string
  kind: NeedKind
  title: string
  /** One line. */
  body: string
  opens: Destination
}

export interface NeedSources {
  /** The question on the sheet now. */
  question: PendingQuestion | null
  /** The action items as Action Items lists them. */
  items: readonly WaitingRow[]
  hobkins: readonly HobkinSummary[] | undefined
  messages: readonly ChatMessage[]
  /** Milliseconds since the epoch. */
  now: number
}

/** A review is news while it is this fresh. An older "ready" line in the chat is history, not something to tell. */
export const REVIEW_FRESH_MS = 10 * 60_000
const LONGEST_LINE = 140
const LONGEST_TITLE = 60

/** One line of at most `most` characters. */
function line(text: string, most = LONGEST_LINE): string {
  const first = text.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  return first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first
}

const timeOf = (at: ChatMessage['at']): number | null => {
  const ms = typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

function questionNeed(question: PendingQuestion): Need {
  const asker = question.from.trim()
  return {
    id: question.id,
    kind: 'question',
    title: line(!asker || asker === 'hobkin' ? 'hobkin asks' : `${asker} asks`, LONGEST_TITLE),
    body: line(headingOf(question.question, question.tldr).question),
    opens: { to: 'question' },
  }
}

const itemNeed = (row: WaitingRow): Need => ({
  id: row.id,
  kind: 'item',
  title: 'New action item',
  body: line(row.summary),
  opens: { to: 'item', id: row.id },
})

const ENDED: Record<NonNullable<HobkinSummary['last']>['status'], string> = {
  completed: 'It finished its turn and waits for you.',
  failed: 'Its turn failed, and it waits for you.',
  interrupted: 'Its turn was stopped, and it waits for you.',
}

const hobkinNeed = (hobkin: HobkinSummary, since: string): Need => ({
  id: `hobkin:${hobkin.id}:${since}`,
  kind: 'hobkin',
  title: line(hobkin.title || 'A hobkin', LONGEST_TITLE),
  body: hobkin.last ? ENDED[hobkin.last.status] : 'It waits for you.',
  opens: { to: 'hobkin', id: hobkin.id },
})

/**
 * Everything that needs the user now, each once: the question on the sheet, each new action item, each durable
 * hobkin that waits and has not been looked at, and each review that just became ready. A question hobkin filed keeps
 * its id on the sheet and under Action Items, so it is one need wherever it is. The main agent's own question that the
 * user put off is filed anew under Action Items; it was told as the question, so its item is not told again.
 */
export function needsOf({ question, items, hobkins, messages, now }: NeedSources): Need[] {
  const needs: Need[] = question ? [questionNeed(question)] : []
  for (const row of items) {
    if (row.id === question?.id || row.item?.answerTo?.kind === 'chat') continue
    needs.push(itemNeed(row))
  }
  for (const hobkin of hobkins ?? []) {
    if (hobkin.state === 'waiting' && hobkin.waiting && !hobkin.waiting.seen) needs.push(hobkinNeed(hobkin, hobkin.waiting.since))
  }
  for (const message of messages) {
    const review = (message as { review?: unknown }).review
    if (message.role !== 'notice' || typeof review !== 'string' || !review) continue
    const at = timeOf(message.at)
    if (at === null || now - at > REVIEW_FRESH_MS) continue
    needs.push({ id: message.id, kind: 'review', title: 'Review ready', body: line(message.content), opens: { to: 'review', id: review } })
  }
  return needs
}

/** What the Mac allows: asked and allowed, refused, not asked yet, unknown, or no notifications in this window at all. */
export type NoticePermission = 'granted' | 'denied' | 'prompt' | 'unknown' | 'unavailable'

/** The line Settings shows: only after a refusal, with how to turn notifications on. */
export function permissionLine(state: NoticePermission): string | null {
  return state === 'denied' ? 'Notifications are off for hobkin. To have them, turn them on in System Settings › Notifications › hobkin.' : null
}
