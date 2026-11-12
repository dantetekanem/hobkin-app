import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONFIG, isEntryPath, isLifecycleTestPath, sensitiveOf } from '../src/config.ts'
import { deriveFacts, guardsPutOn } from '../src/facts.ts'
import type { FactsInput } from '../src/facts.ts'
import type { ScanAnchor } from '../src/types.ts'

const anchor = (patch: Partial<ScanAnchor>): ScanAnchor => ({
  id: 'n1',
  symbol: 'Checkout#total',
  kind: 'method',
  path: 'app/models/checkout.rb',
  startLine: 1,
  endLine: 1,
  changedLines: [],
  tests: [],
  ...patch,
})

/** Builds an input from head and base source, one string per file, anchor covering the whole head. */
const input = (head: string, base: string | null, patch: Partial<ScanAnchor> = {}, rest: Partial<FactsInput> = {}): FactsInput => {
  const headLines = head.split('\n')
  const a = anchor({ endLine: headLines.length, ...patch })
  return { anchor: a, path: a.path, head: headLines, base: base === null ? null : base.split('\n'), config: DEFAULT_CONFIG, ...rest }
}

describe('config helpers', () => {
  it('recognises entry points, life cycle tests and sensitive names', () => {
    assert.equal(isEntryPath('app/controllers/orders_controller.rb'), true)
    assert.equal(isEntryPath('src/routes/orders.ts'), true)
    assert.equal(isEntryPath('app/models/order.rb'), false)
    assert.equal(isLifecycleTestPath('spec/requests/orders_spec.rb'), true)
    assert.equal(isLifecycleTestPath('test/e2e/checkout.test.ts'), true)
    assert.equal(isLifecycleTestPath('test/models/order_test.rb'), false)
    assert.deepEqual(sensitiveOf('Payment#refund_amount', 'app/models/payment.rb'), ['amount', 'payment', 'refund'])
  })
})

describe('effect', () => {
  it('text: only comments and blank lines changed', () => {
    const f = deriveFacts(input('def total\n  # why\n\n  1\nend', 'def total\n  1\nend', { changedLines: [2, 3] }))
    assert.equal(f.facts.effect.value, 'text')
    assert.deepEqual(f.effects, ['text'])
  })
  it('text: the anchor reports every changed line as whitespace only', () => {
    const f = deriveFacts(input('def total\n    1\nend', 'def total\n  1\nend', { changedLines: [2], whitespaceOnly: [2], removed: [{ oldStart: 2, lines: ['  1'] }] }))
    assert.equal(f.facts.effect.value, 'text')
    assert.match(f.facts.effect.evidence, /search tool/)
  })
  it('a changed string literal is behaviour', () => {
    const f = deriveFacts(input("def key\n  'order:v2'\nend", "def key\n  'order:v1'\nend", { changedLines: [2], removed: [{ oldStart: 2, lines: ["  'order:v1'"] }] }))
    assert.equal(f.facts.effect.value, 'behaviour')
  })
  it('behaviour: lines that only look like comments, read the way their language reads them', () => {
    // Ruby: `**opts` is a double splat.
    const splat = deriveFacts(input('def call(**opts)\n  run(\n    **opts.merge(capture: false)\n  )\nend', 'def call(**opts)\n  run(\n    **opts\n  )\nend', { changedLines: [3], removed: [{ oldStart: 3, lines: ['    **opts'] }] }))
    // TypeScript: an expression continued on a line that starts with `*`.
    const product = deriveFacts(input('function total(price: number, qty: number) {\n  return price\n    * qty * 1.2\n}', 'function total(price: number, qty: number) {\n  return price\n    * qty\n}', { path: 'src/total.ts', changedLines: [3], removed: [{ oldStart: 3, lines: ['    * qty'] }] }))
    // A URL inside a template string.
    const url = deriveFacts(input('function endpoint() {\n  return `\n    //api.example.com/v2\n  `\n}', 'function endpoint() {\n  return `\n    //api.example.com/v1\n  `\n}', { path: 'src/endpoint.ts', changedLines: [3], removed: [{ oldStart: 3, lines: ['    //api.example.com/v1'] }] }))
    assert.deepEqual([splat, product, url].map((f) => f.facts.effect.value), ['behaviour', 'behaviour', 'behaviour'])
  })
  it('text: comments as TypeScript and Ruby write them, the `*` lines of a block comment included', () => {
    const ts = deriveFacts(input('/**\n * Sums the items.\n * Rounded to cents.\n */\nfunction total() {\n  // why\n  return 1\n}', '/**\n * Sums the items.\n */\nfunction total() {\n  return 1\n}', { path: 'src/total.ts', changedLines: [3, 6] }))
    const ruby = deriveFacts(input('=begin\nWhy total is one.\n=end\ndef total\n  1\nend', 'def total\n  1\nend', { changedLines: [1, 2, 3] }))
    assert.deepEqual([ts.facts.effect.value, ruby.facts.effect.value], ['text', 'text'])
  })
  it('a removed line is read where it was at base: a comment there is text, a line not found there is behaviour', () => {
    const base = 'def total\n  # old note\n  1\nend'
    const found = deriveFacts(input('def total\n  1\nend', base, { changedLines: [], removed: [{ oldStart: 2, lines: ['  # old note'] }] }))
    const lost = deriveFacts(input('def total\n  1\nend', base, { changedLines: [], removed: [{ oldStart: 3, lines: ['  # old note'] }] }))
    assert.deepEqual([found.facts.effect.value, lost.facts.effect.value], ['text', 'behaviour'])
  })
  it('behaviour: lines deleted inside a definition that is still there', () => {
    const f = deriveFacts(input('def total\n  1\nend', 'def total\n  log\n  1\nend', { changedLines: [], removed: [{ oldStart: 2, lines: ['  log'] }] }))
    assert.equal(f.facts.effect.value, 'behaviour')
    assert.match(f.facts.effect.evidence, /deleted inside/)
    // Its name need not be on its first line: a decorator can come before it.
    const decorated = deriveFacts(input('@memo\ntotal() {\n  return 1\n}', '@memo\ntotal() {\n  log()\n  return 1\n}', { path: 'src/cart.ts', symbol: 'Cart.total', changedLines: [], removed: [{ oldStart: 3, lines: ['  log()'] }] }))
    assert.equal(decorated.facts.effect.value, 'behaviour')
  })
  it('interface: signature changed, reported or seen', () => {
    const reported = deriveFacts(input('def total(tax)\n  1\nend', 'def total\n  1\nend', { changedLines: [1], signatureChanged: true }))
    assert.equal(reported.facts.effect.value, 'interface')
    const seen = deriveFacts(input('def total(tax)\n  1\nend', 'def total\n  1\nend', { changedLines: [1], removed: [{ oldStart: 1, lines: ['def total'] }] }))
    assert.equal(seen.facts.effect.value, 'interface')
    assert.match(seen.facts.effect.evidence, /patterns/)
  })
  it('interface: a removed definition', () => {
    const f = deriveFacts(input('', 'def total\n  1\nend', { startLine: 1, endLine: 1, changedLines: [], removed: [{ oldStart: 1, lines: ['def total', '  1', 'end'] }] }))
    assert.equal(f.facts.effect.value, 'interface')
    assert.equal(f.facts.undo.value, 'rollback')
  })
  it('data: writes, enqueues, cache keys and serializers on changed lines; most severe wins and the list is kept', () => {
    const write = deriveFacts(input('def pay\n  order.update!(paid: true)\nend', 'def pay\nend', { changedLines: [2] }))
    assert.equal(write.facts.effect.value, 'data')
    assert.deepEqual(write.effects, ['data', 'behaviour'])
    const enq = deriveFacts(input('def pay\n  ReceiptJob.perform_later(id)\nend', 'def pay\nend', { changedLines: [2] }))
    assert.equal(enq.facts.effect.value, 'data')
    const anchored = deriveFacts(input('def pay\n  x\nend', 'def pay\nend', { changedLines: [2], effects: [{ kind: 'cache', line: 2, text: 'x' }] }))
    assert.equal(anchored.facts.effect.value, 'data')
    assert.match(anchored.facts.effect.evidence, /search tool/)
    const ts = deriveFacts(input('function pay() {\n  await db.query(row)\n}', null, { changedLines: [2], path: 'src/pay.ts', language: 'typescript' }))
    assert.equal(ts.facts.effect.value, 'behaviour')
    const tsWrite = deriveFacts(input('function pay() {\n  queue.enqueue(job)\n}', null, { changedLines: [2], path: 'src/pay.ts' }))
    assert.equal(tsWrite.facts.effect.value, 'data')
  })
  it('data: a migration or schema file', () => {
    const f = deriveFacts(input('def change\n  add_column :orders, :note, :string\nend', null, { path: 'db/migrate/20260101_add_note.rb', changedLines: [1, 2, 3], status: 'added' }))
    assert.equal(f.facts.effect.value, 'data')
  })
  it('load: constants, class-body statements, config and dependencies', () => {
    const constant = deriveFacts(input('RATE = 5', 'RATE = 4', { kind: 'constant', symbol: 'RATE', changedLines: [1], removed: [{ oldStart: 1, lines: ['RATE = 4'] }] }))
    assert.equal(constant.facts.effect.value, 'load')
    assert.equal(constant.facts.exposure.value, 'at-load')
    const cfg = deriveFacts(input('timeout: 5', 'timeout: 4', { kind: 'statement', path: 'config/settings.yml', changedLines: [1] }))
    assert.equal(cfg.facts.effect.value, 'load')
    const dep = deriveFacts(input('"left-pad": "2.0.0"', null, { kind: 'statement', path: 'package.json', changedLines: [1] }))
    assert.equal(dep.facts.exposure.value, 'at-load')
    const loadTime = deriveFacts(input('before_action :x', null, { kind: 'statement', loadTime: true, changedLines: [1] }))
    assert.equal(loadTime.facts.effect.value, 'load')
  })
})

const flagged = `def total
  if Features.enabled?(:new_total)
    new_total
  else
    old_total
  end
end`
const flaggedBase = `def total
  old_total
end`

describe('conditions and exposure', () => {
  it('nobody-yet: new code on the on branch, old code on the off branch', () => {
    const f = deriveFacts(input(flagged, flaggedBase, { changedLines: [2, 3, 4, 6] }))
    assert.equal(f.facts.exposure.value, 'nobody-yet')
    assert.equal(f.facts.undo.value, 'flag')
    assert.equal(f.hosts_condition, true)
    const [cond] = f.conditions
    assert.deepEqual([cond?.name, cond?.line, cond?.added], ['new_total', 2, true])
    assert.deepEqual(cond?.dominates, [{ line: 3, state: 'on' }])
    assert.match(f.facts.exposure.evidence, /indent/)
  })
  it('everyone: the off branch differs from the old code', () => {
    const f = deriveFacts(input(flagged.replace('old_total', 'older_total'), flaggedBase, { changedLines: [2, 3, 4, 5, 6] }))
    assert.equal(f.facts.exposure.value, 'everyone')
    assert.match(f.facts.exposure.evidence, /off/)
  })
  it('everyone: a guard that returns something new when the flag is off', () => {
    const head = 'def total\n  return legacy_total unless Features.enabled?(:x)\n  new_total\nend'
    const f = deriveFacts(input(head, 'def total\n  old_total\nend', { changedLines: [2, 3], removed: [{ oldStart: 2, lines: ['  old_total'] }] }))
    assert.equal(f.facts.exposure.value, 'everyone')
    assert.equal(f.hosts_condition, true)
  })
  it('a negated check swaps the branches', () => {
    const head = 'def total\n  if !Features.enabled?(:x)\n    old_total\n  else\n    new_total\n  end\nend'
    const f = deriveFacts(input(head, 'def total\n  old_total\nend', { changedLines: [2, 3, 4, 5, 6], whitespaceOnly: [3], removed: [{ oldStart: 2, lines: ['  old_total'] }] }))
    assert.equal(f.facts.exposure.value, 'nobody-yet')
  })
  it('JS and TS checks and branches', () => {
    const head = "function total() {\n  if (isEnabled('new-total')) {\n    return next()\n  } else {\n    return prev()\n  }\n}"
    const f = deriveFacts(input(head, 'function total() {\n  return prev()\n}', { path: 'src/total.ts', changedLines: [2, 3, 4, 6] }))
    assert.equal(f.facts.exposure.value, 'nobody-yet')
    assert.equal(f.conditions[0]?.name, 'new-total')
  })
  it('uses the anchor guards when present, and says so', () => {
    const head = 'def total\n  new_total\nend'
    const guards = [{ line: 2, guards: [{ line: 0, text: 'Features.enabled?(:new_total)', branch: 'then' as const }] }]
    const f = deriveFacts(input('def total\n  if Features.enabled?(:new_total)\n    new_total\n  end\nend', 'def total\nend', { changedLines: [2, 3, 4], guards: [{ line: 3, guards: [{ line: 2, text: 'Features.enabled?(:new_total)', branch: 'then' }] }] }))
    assert.equal(f.facts.exposure.value, 'nobody-yet')
    assert.match(f.facts.exposure.evidence, /search tool/)
    const outside = deriveFacts(input(head, 'def total\nend', { changedLines: [2], guards }))
    assert.equal(outside.facts.exposure.value, 'everyone')
  })
  it('everyone: an unguarded changed line', () => {
    const head = 'def total\n  if Features.enabled?(:x)\n    a\n  end\n  b\nend'
    const f = deriveFacts(input(head, 'def total\nend', { changedLines: [2, 3, 4, 5] }))
    assert.equal(f.facts.exposure.value, 'everyone')
  })
  it('flag check not added by the diff does not host a condition', () => {
    const f = deriveFacts(input(flagged, flagged.replace('new_total', 'new_total2'), { changedLines: [3] }))
    assert.equal(f.hosts_condition, false)
    assert.equal(f.conditions[0]?.added, false)
    assert.equal(f.facts.exposure.value, 'nobody-yet')
  })
  it('subset: a configured tenant check', () => {
    const config = { ...DEFAULT_CONFIG, flags: { ...DEFAULT_CONFIG.flags, subset: ['tenant\\.(?<flag>beta)\\?'] } }
    const head = 'def total\n  if tenant.beta?\n    new_total\n  else\n    old_total\n  end\nend'
    const f = deriveFacts(input(head, flaggedBase, { changedLines: [2, 3, 4, 6] }, { config }))
    assert.equal(f.facts.exposure.value, 'subset')
  })
  it('nobody-yet by callers: complete list, every caller guarded on', () => {
    const callers = [{ path: 'app/a.rb', line: 3, guardedOn: true }, { path: 'app/b.rb', line: 9, guardedOn: true }]
    const f = deriveFacts(input('def total\n  new_total\nend', 'def total\n  old_total\nend', { changedLines: [2] }, { callers, callersComplete: true }))
    assert.equal(f.facts.exposure.value, 'nobody-yet')
    assert.match(f.facts.exposure.evidence, /dominance proven/)
    const partial = deriveFacts(input('def total\n  new_total\nend', 'def total\n  old_total\nend', { changedLines: [2] }, { callers, callersComplete: false }))
    assert.equal(partial.facts.exposure.value, 'everyone')
    const one = deriveFacts(input('def total\n  new_total\nend', 'def total\n  old_total\nend', { changedLines: [2] }, { callers: [...callers, { path: 'app/c.rb', line: 1, guardedOn: false }], callersComplete: true }))
    assert.equal(one.facts.exposure.value, 'everyone')
  })
  it('everyone by default, with the reason', () => {
    const f = deriveFacts(input('def total\n  new_total\nend', 'def total\n  old_total\nend', { changedLines: [2] }))
    assert.equal(f.facts.exposure.value, 'everyone')
    assert.equal(f.facts.exposure.evidence.length > 10, true)
  })
})

describe('undo and extras', () => {
  it('flag-with-residue: flagged and writing', () => {
    const head = 'def pay\n  if Features.enabled?(:x)\n    order.update!(paid: true)\n  end\nend'
    const f = deriveFacts(input(head, 'def pay\nend', { changedLines: [2, 3, 4] }))
    assert.deepEqual([f.facts.exposure.value, f.facts.effect.value, f.facts.undo.value], ['nobody-yet', 'data', 'flag-with-residue'])
  })
  it('none: a destructive migration; additive migration is additiveSchema', () => {
    const drop = deriveFacts(input('def change\n  remove_column :orders, :note\nend', null, { path: 'db/migrate/1_drop.rb', changedLines: [1, 2, 3], status: 'added' }))
    assert.deepEqual([drop.facts.undo.value, drop.facts.exposure.value, drop.extras.additiveSchema], ['none', 'at-load', undefined])
    const exec = deriveFacts(input('def up\n  execute "update orders set a = 1"\nend', null, { path: 'db/migrate/2_x.rb', changedLines: [1, 2, 3], status: 'added' }))
    assert.equal(exec.facts.undo.value, 'none')
    const add = deriveFacts(input('def change\n  add_column :orders, :note, :string\nend', null, { path: 'db/migrate/3_add.rb', changedLines: [1, 2, 3], status: 'added' }))
    assert.deepEqual([add.facts.undo.value, add.extras.additiveSchema], ['rollback', true])
    const notNull = deriveFacts(input('def change\n  add_column :orders, :note, :string, null: false\nend', null, { path: 'db/migrate/4_add.rb', changedLines: [1, 2, 3], status: 'added' }))
    assert.deepEqual([notNull.facts.undo.value, notNull.extras.additiveSchema], ['none', undefined])
  })
  it('runsInRequest is false for test helpers and scripts; sensitive names are listed', () => {
    const helper = deriveFacts(input('def helper\n  1\nend', null, { path: 'test/support/helper.rb', changedLines: [2] }))
    assert.equal(helper.extras.runsInRequest, false)
    const pay = deriveFacts(input('def charge\n  1\nend', null, { symbol: 'Payment#charge', changedLines: [2] }))
    assert.equal(pay.extras.runsInRequest, undefined)
    assert.deepEqual(pay.sensitive, ['charge', 'payment'])
  })
  it('missing source lines are the worse case, not a crash', () => {
    const f = deriveFacts({ anchor: anchor({ changedLines: [1] }), path: 'a.rb', head: null, base: null, config: DEFAULT_CONFIG })
    assert.equal(f.facts.effect.value, 'behaviour')
    assert.equal(f.facts.exposure.value, 'everyone')
  })
})

describe('guardsPutOn: a call site on the on branch of a flag check', () => {
  const on = (text: string, branch: 'then' | 'else' | 'after-return') => guardsPutOn([{ line: 4, text, branch }, { line: 6, text: 'if order.paid?', branch: 'then' }], DEFAULT_CONFIG)
  it('reads the keyword and the branch the way a node own guards are read', () => {
    assert.equal(on('if Features.enabled?(:checkout)', 'then'), true)
    assert.equal(on('unless Features.enabled?(:checkout)', 'after-return'), true)
    assert.equal(on('unless Features.enabled?(:checkout)', 'then'), false)
    assert.equal(on('if Features.enabled?(:checkout)', 'else'), false)
    assert.equal(on('if !Features.enabled?(:checkout)', 'else'), true)
  })
  it('needs a flag check among the guards', () => {
    assert.equal(guardsPutOn([], DEFAULT_CONFIG), false)
    assert.equal(guardsPutOn([{ line: 6, text: 'if order.paid?', branch: 'then' }], DEFAULT_CONFIG), false)
  })
})
