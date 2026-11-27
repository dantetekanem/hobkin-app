/**
 * One made-up finished change in the demo's atlas-api: its refund webhook records a refund once per idempotency key.
 * `before` is the project's code on main, `after` what the change's branch holds. All of it is invented.
 */

export const before: Record<string, string> = {
  'src/routes/refunds.ts': `import { Router } from 'express'
import { requireKey } from '../auth/keys.ts'
import { recordRefund } from '../refunds/record.ts'

export const refunds = Router()
refunds.use(requireKey)

refunds.post('/', async (request, response) => {
  const refund = await recordRefund(request.body)
  response.status(201).json(refund)
})
`,
  'src/refunds/record.ts': `import { db } from '../db.ts'

export interface RefundRequest {
  orderId: string
  amount: number
  reason: string
}

export async function recordRefund({ orderId, amount, reason }: RefundRequest) {
  const [refund] = await db.insert('refunds', { orderId, amount, reason, at: new Date() })
  await db.update('orders', orderId, { refunded: db.raw('refunded + ?', [amount]) })
  return refund
}
`,
}

export const after: Record<string, string> = {
  'src/routes/refunds.ts': `import { Router } from 'express'
import { requireKey } from '../auth/keys.ts'
import { recordRefund } from '../refunds/record.ts'
import { IDEMPOTENCY_HEADER, once } from '../refunds/idempotency.ts'

export const refunds = Router()
refunds.use(requireKey)

refunds.post('/', async (request, response) => {
  const key = request.get(IDEMPOTENCY_HEADER)
  if (!key) return response.status(400).json({ error: 'idempotency_key_required' })
  const { value, replayed } = await once(key, () => recordRefund(request.body))
  response.status(replayed ? 200 : 201).set('Idempotent-Replayed', String(replayed)).json(value)
})
`,
  'src/refunds/idempotency.ts': `import { db } from '../db.ts'

export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
/** How long a key holds its first answer: longer than the provider's longest retry. */
export const KEY_TTL_HOURS = 48

/**
 * Runs \`work\` once per key. A second call with the same key, a retry after a timeout, gets the first answer back
 * and runs nothing. Two calls at the same moment meet on the key's unique row, so only one of them runs.
 */
export async function once<Value>(key: string, work: () => Promise<Value>): Promise<{ value: Value; replayed: boolean }> {
  const kept = await db.first('idempotency_keys', { key })
  if (kept) return { value: JSON.parse(kept.answer) as Value, replayed: true }
  return db.transaction(async (tx) => {
    await tx.insert('idempotency_keys', { key, answer: null, expiresAt: hoursFromNow(KEY_TTL_HOURS) })
    const value = await work()
    await tx.update('idempotency_keys', { key }, { answer: JSON.stringify(value) })
    return { value, replayed: false }
  })
}

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000)
`,
  'src/db/migrations/0042_idempotency_keys.sql': `create table idempotency_keys (
  key text primary key,
  answer jsonb,
  expires_at timestamptz not null
);
create index idempotency_keys_expiry on idempotency_keys (expires_at);
`,
  'test/refunds/idempotency.test.ts': `import { describe, expect, it, vi } from 'vitest'
import { once } from '../../src/refunds/idempotency.ts'

describe('once', () => {
  it('runs the work once and replays its answer for the same key', async () => {
    const work = vi.fn(async () => ({ id: 'rf_1' }))
    expect(await once('k-1', work)).toEqual({ value: { id: 'rf_1' }, replayed: false })
    expect(await once('k-1', work)).toEqual({ value: { id: 'rf_1' }, replayed: true })
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('lets only one of two calls at the same moment run', async () => {
    const work = vi.fn(async () => ({ id: 'rf_2' }))
    await Promise.allSettled([once('k-2', work), once('k-2', work)])
    expect(work).toHaveBeenCalledTimes(1)
  })
})
`,
  'test/routes/refunds.test.ts': `import { expect, it } from 'vitest'
import { post } from '../http.ts'

it('records a refund once when the provider delivers it twice', async () => {
  const first = await post('/refunds', refund, { 'Idempotency-Key': 'evt_81' })
  const again = await post('/refunds', refund, { 'Idempotency-Key': 'evt_81' })
  expect(first.status).toBe(201)
  expect(again.status).toBe(200)
  expect(again.body).toEqual(first.body)
  expect(await refundsOf('ord_1')).toHaveLength(1)
})

it('refuses a refund without a key', async () => {
  expect((await post('/refunds', refund)).status).toBe(400)
})

const refund = { orderId: 'ord_1', amount: 1200, reason: 'damaged' }
`,
}
