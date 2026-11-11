/**
 * An action item read here, the way a report is read. An item that is handled in Work is read here while work mode is
 * off, since Work would have nothing to do with it, and the user replies to it in chat the way they reply to a report:
 * the item goes with their next message to the main agent, with everything its card says.
 */
import { useReportReply } from '../reports/reply.ts'
import type { WaitingRow } from './items.ts'
import { KIND } from './kinds.ts'

/** Whether a row that would open in Work is read here instead: while work mode is off. */
export function readsHere(row: WaitingRow, workOn: boolean): boolean {
  return row.opens?.screen === 'work' && !workOn
}

/** Everything the item's card says, as words for the main agent. */
export function itemBody(row: WaitingRow): string {
  const kind = KIND[row.kind].label
  const asked = row.item?.question.trim() || row.question.question.trim()
  const detail = row.question.tldr?.trim() ?? ''
  const lines = [
    `${kind} · ${row.from}`,
    asked,
    ...(detail && detail !== asked ? [detail] : []),
    ...(row.changed ? [`Changed: ${row.changed}`] : []),
    ...(row.at ? [`Filed ${row.at}`] : []),
    ...row.links.map((link) => `${link.label}: ${link.url}`),
  ]
  return lines.join('\n')
}

/** Puts the item on the next message to the main agent, as a reply to a report does. */
export function replyToItem(row: WaitingRow): void {
  useReportReply.getState().attach({ id: row.id, title: row.summary, kind: 'item', body: itemBody(row) })
}
