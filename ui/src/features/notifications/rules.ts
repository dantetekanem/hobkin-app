import type { HobkinSummary } from '#shared/protocol/hobkins.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { headingOf, type WaitingRow } from '../actions/items.ts'
import { levelOf, readDigest } from '../chat/digest.ts'

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
  /** Chat, where the line is: the window's left side, beside every screen. */
  | { to: 'chat' }

export type NeedKind = 'question' | 'item' | 'hobkin' | 'review' | 'notice' | 'digest'

/**
 * How a need reaches the user, by the level hobkin's desk gave it (075-chief-of-staff S5): `chime`, a notification with
 * hobkin's chime, as every need had before levels; `soft`, one notification with the softer nudge, for a digest; `cue`,
 * the nudge alone with no notification, for a line for today that came at a pause.
 */
export type Reach = 'chime' | 'soft' | 'cue'

export interface Need {
  /** The thing's own identity in its home: a filed question and its item share it. */
  id: string
  kind: NeedKind
  title: string
  /** One line. */
  body: string
  opens: Destination
  reach: Reach
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

/** A review, or a line by its level, is news while it is this fresh. An older line in the chat is history, not something to tell. */
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
    reach: 'chime',
  }
}

const itemNeed = (row: WaitingRow): Need => ({
  id: row.id,
  kind: 'item',
  title: 'New action item',
  body: line(row.summary),
  opens: { to: 'item', id: row.id },
  reach: 'chime',
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
  reach: 'chime',
})

/**
 * What a Chat line tells while it is fresh. A digest is one soft notification. A line hobkin's desk let through by
 * itself goes by its level: P0 with the chime, a P1 as the nudge alone, P2 and P3 not at all. A line without a level,
 * from a hobkin before the desk, tells only that a review is ready, as before.
 */
function lineNeed(message: ChatMessage, now: number): Need | null {
  if (message.role !== 'notice') return null
  const at = timeOf(message.at)
  if (at === null || now - at > REVIEW_FRESH_MS) return null
  const digest = readDigest(message)
  if (digest) return { id: message.id, kind: 'digest', title: 'Digest', body: line(digest.point.replace(/^Digest:\s*/, '')), opens: { to: 'chat' }, reach: 'soft' }
  const level = levelOf(message.level)
  const reach: Reach | null = level === null || level === 'P0' ? 'chime' : level === 'P1' ? 'cue' : null
  if (reach === null) return null
  const review = (message as { review?: unknown }).review
  if (typeof review === 'string' && review) return { id: message.id, kind: 'review', title: 'Review ready', body: line(message.content), opens: { to: 'review', id: review }, reach }
  if (level === null) return null
  return { id: message.id, kind: 'notice', title: level === 'P0' ? 'Needs you now' : 'For today', body: line(message.content), opens: { to: 'chat' }, reach }
}

/**
 * Everything that needs the user now, each once: the question on the sheet, each new action item, each durable
 * hobkin that waits and has not been looked at, and each Chat line that tells (`lineNeed`). A question hobkin filed keeps
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
    const need = lineNeed(message, now)
    if (need) needs.push(need)
  }
  return needs
}

/** What the Mac allows: asked and allowed, refused, not asked yet, unknown, or no notifications in this window at all. */
export type NoticePermission = 'granted' | 'denied' | 'prompt' | 'unknown' | 'unavailable'

/** The line Settings shows: only after a refusal, with how to turn notifications on. */
export function permissionLine(state: NoticePermission): string | null {
  return state === 'denied' ? 'Notifications are off for hobkin. To have them, turn them on in System Settings › Notifications › hobkin.' : null
}
