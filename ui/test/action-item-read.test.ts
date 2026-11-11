import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itemBody, readsHere, replyToItem } from '../src/features/actions/read.ts'
import type { WaitingRow } from '../src/features/actions/items.ts'
import { useReportReply } from '../src/features/reports/reply.ts'

/** An approval work mode filed, as Action Items lists it: it opens in Work, and has nothing to answer here. */
function approval(opens: WaitingRow['opens']): WaitingRow {
  return {
    id: 'waiting:yours:approval-1',
    kind: 'approval',
    from: 'rpsleague',
    summary: 'Fix what "Keep model registry refresh on file storage" broke',
    at: '2026-11-06T10:00:00Z',
    question: {
      id: 'waiting:yours:approval-1',
      from: 'rpsleague',
      question: 'Fix what "Keep model registry refresh on file storage" broke',
      choices: [],
      tldr: "Return HTTP 400 for conflicting client-IP headers before Rails' request logger.",
    },
    putOff: false,
    branch: false,
    pick: null,
    changed: null,
    links: [{ label: 'PR 78', url: 'https://github.com/acme/shop/pull/78' }],
    item: null,
    ...(opens ? { opens } : {}),
  }
}

test('with work mode off, an item that opens in Work is read here instead, and anything else keeps its place', () => {
  assert.equal(readsHere(approval({ screen: 'work' }), false), true)
  assert.equal(readsHere(approval({ screen: 'work' }), true), false)
  assert.equal(readsHere(approval({ screen: 'reports', report: 'r1' }), false), false)
  assert.equal(readsHere(approval(undefined), false), false)
})

test("a reply to an item puts it on the next message, with everything its card says", () => {
  const row = approval({ screen: 'work' })

  replyToItem(row)

  const attached = useReportReply.getState().report
  assert.deepEqual([attached?.id, attached?.title, attached?.kind], [row.id, row.summary, 'item'])
  assert.equal(attached?.body, itemBody(row))
  assert.match(itemBody(row), /^Shipping approval · rpsleague/)
  assert.match(itemBody(row), /Return HTTP 400 for conflicting client-IP headers/)
  assert.match(itemBody(row), /Filed 2026-11-06T10:00:00Z/)
  assert.match(itemBody(row), /PR 78: https:\/\/github\.com\/acme\/shop\/pull\/78/)
  useReportReply.getState().clear()
})
