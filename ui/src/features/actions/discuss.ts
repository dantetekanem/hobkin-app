/**
 * Discuss: any action item goes with the user's next message to hobkin, by its own identity, so hobkin can find it with
 * its own tools and talk it over. It is added beside whatever the user is writing, the way a report is
 * (`../reports/reply.ts`), and it never sends, answers, approves or completes anything. Pure but for `discussItem`, so the
 * rules are tested without a window. Spec: 012-reports-actions.
 */
import { reviewIdOf } from '#shared/review/ids.ts'
import { useReportReply, type ReplyTo } from '../reports/reply.ts'
import type { AnswerTo, WaitingRow } from './items.ts'
import { KIND } from './kinds.ts'

/** What `conversation.send` takes for an item's title and words. */
const LONGEST_TITLE = 1000
const LONGEST_BODY = 24576

const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const clip = (text: string, most: number) => (text.length > most ? text.slice(0, most) : text)

/** Where a decision came from, read off what hobkin files it for: the routine, the project and work item, the review, the queue. */
function sourceOf(to: AnswerTo, branch: boolean): string[] {
  switch (to.kind) {
    case 'routine':
    case 'action':
      return named(to.id) ? [`Routine: ${to.id}`] : []
    case 'routines':
      return [
        ...(named(to.id) ? [`${to.subject === 'template' ? 'Template' : 'Routine'}: ${to.id}`] : []),
        ...(named(to.file) ? [`File: ${to.file}`] : []),
      ]
    case 'work':
    case 'yours':
    case 'merge':
      return [
        ...(named(to.slug) ? [`Project: ${to.slug}`] : []),
        ...(named(to.item) ? [`Work item: ${to.item}`] : []),
        ...(named(to.head) ? [`Branch head: ${to.head}`] : []),
        // A finished branch is read in Change Review under this name.
        ...(branch && named(to.slug) && named(to.item) ? [`Review: ${reviewIdOf({ kind: 'change', slug: to.slug, item: to.item })}`] : []),
      ]
    case 'pickup':
      return Array.isArray(to.keys) && to.keys.some(named) ? [`Queue: ${to.keys.filter(named).join(', ')}`] : []
    default:
      // Any other kind keeps hobkin's own record of where its answer goes, as it is.
      return Object.keys(to).length > 1 ? [`Filed for: ${JSON.stringify(to)}`] : []
  }
}

/** Which item it is, as hobkin holds it: a decision, a learning or project proposal, a work step, a report, or an entry in its waiting list. */
function identityOf(row: WaitingRow): string[] {
  const { item, answers, opens } = row
  if (item) {
    return [
      `Decision: ${item.id}${item.answerTo ? ` (${item.answerTo.kind})` : ''}`,
      ...(answers ? [] : ['Sample: this item is in this window only, and hobkin has no record of it.']),
      ...(item.answerTo ? sourceOf(item.answerTo, row.branch) : []),
    ]
  }
  if (answers?.by === 'learning') return [`Learning proposal: ${answers.id}`]
  if (answers?.by === 'proposal') return [`Project proposal: ${answers.slug}`]
  if (answers?.by === 'work') return [`Project: ${answers.slug}`, `Work item: ${answers.item}`]
  if (opens?.screen === 'reports') return [`Report: ${opens.report}`]
  if (opens) return [`Waiting entry: ${row.id}, handled in Work`]
  return [`Question put off from the question sheet: ${row.id}`]
}

/**
 * What goes with the next message for an item: its id and title, and words for hobkin that name it exactly and say all
 * its card says. The first line tells hobkin that talking about it answers nothing.
 */
export function discussionOf(row: WaitingRow): ReplyTo {
  const asked = (row.item?.question ?? row.question.question).trim()
  const detail = row.item ? '' : (row.question.tldr?.trim() ?? '')
  const { recommended: pick, sure, reversible, defaultsAt } = row.question
  const why = (row.question.why ?? row.item?.why ?? '').trim()
  const pickNote = sure ? `hobkin's pick, sure: ${sure}` : "hobkin's pick"
  const choices = row.question.choices.map((choice) => (choice.value === pick ? `${choice.label} (${pickNote})` : choice.label))
  const body = [
    'The user wants to talk about this action item. Talking about it answers nothing: leave it open unless they ask you to answer it.',
    `Kind: ${KIND[row.kind].label}`,
    `From: ${row.from}`,
    ...identityOf(row),
    ...(row.putOff ? ['Put off from the question sheet.'] : []),
    ...(asked ? [`Question: ${asked}`] : []),
    ...(detail && detail !== asked ? [`Detail: ${detail}`] : []),
    ...(choices.length ? [`Choices: ${choices.join('; ')}`] : []),
    ...(reversible === undefined ? [] : [`Can be undone: ${reversible ? 'yes' : 'no'}`]),
    ...(defaultsAt ? [`Takes hobkin's pick by itself at: ${defaultsAt}`] : []),
    ...(why ? [`Why: ${why}`] : []),
    ...(row.changed ? [`Changed: ${row.changed}`] : []),
    ...(row.at ? [`Filed: ${row.at}`] : []),
    ...row.links.map((link) => `${link.label}: ${link.url}`),
  ].join('\n')
  return { id: row.id, title: clip(row.summary.trim() || KIND[row.kind].label, LONGEST_TITLE), kind: 'item', body: clip(body, LONGEST_BODY) }
}

/** Puts the item on the next message. The words being written stay as they are, and nothing goes until the user sends. */
export function discussItem(row: WaitingRow): void {
  useReportReply.getState().attach(discussionOf(row))
}

/** `r`, or `m` as on Reports, discusses the item that has the keyboard. Never while typing, and never with a modifier. */
export function discussesKey(press: { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }, typing: boolean): boolean {
  return (press.key === 'r' || press.key === 'm') && !press.meta && !press.ctrl && !press.alt && !press.shift && !typing
}
