import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { floor } from '../src/floor.ts'
import { applyRiskEvents, checkInvariants, nodeLevelOf } from '../src/risk.ts'
import type { Effect, Exposure, FloorExtras, Proof, ReviewNode, RiskEvent, Undo } from '../src/types.ts'

interface Spec extends FloorExtras {
  effect?: Effect
  proof?: Proof
  exposure?: Exposure
  undo?: Undo
}

const node = (id: string, spec: Spec = {}): ReviewNode => {
  const { effect = 'behaviour', proof = 'lifecycle', exposure = 'everyone', undo = 'rollback', ...extras } = spec
  return {
    id,
    kind: 'function',
    symbol: id,
    path: `app/${id}.rb`,
    lines: [1, 9],
    change: 'modified',
    changed_lines: [3],
    entries: [],
    facts: {
      effect: { value: effect, evidence: 'test' },
      proof: { value: proof, evidence: 'test' },
      exposure: { value: exposure, evidence: 'test' },
      undo: { value: undo, evidence: 'test' },
    },
    extras,
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: null,
    critical: false,
    findings: [],
    watch: null,
    questions: [],
  }
}

const event = (patch: Partial<RiskEvent> & { node: string }): RiskEvent => ({
  level: 'high',
  direction: 'up',
  aspect: 'behaviour',
  evidence: 'The retry loop calls charge twice when the first call times out.',
  ...patch,
})

const apply = (nodes: ReviewNode[], events: RiskEvent[]) => applyRiskEvents(nodes, events)
const levelOf = (nodes: ReviewNode[], id: string) => nodes.find((n) => n.id === id)?.level?.current

describe('nodeLevelOf', () => {
  it('starts at the floor with its reason', () => {
    const level = nodeLevelOf(floor({ effect: 'behaviour', proof: 'none', exposure: 'everyone', undo: 'rollback' }))
    assert.deepEqual([level.floor, level.current, level.if], ['high', 'high', []])
    assert.equal(level.why[0], 'No test that runs reaches these lines.')
  })
})

describe('applyRiskEvents', () => {
  it('raises freely, lowers only with evidence, never below high for missing proof, and replays the same', () => {
    const nodes = [node('a'), node('b', { proof: 'none' }), node('c', { effect: 'data' })]
    const events: RiskEvent[] = [
      event({ node: 'a', level: 'high' }),
      event({ node: 'a', level: 'mid', direction: 'down' }),
      event({ node: 'a', level: 'mid', direction: 'down', evidence_kind: 'equivalent' }),
      event({ node: 'b', level: 'safe', direction: 'down', evidence_kind: 'equivalent' }),
      event({ node: 'b', level: 'mid', direction: 'down', evidence_kind: 'off-path-identical' }),
      event({ node: 'c', level: 'mid', direction: 'down', evidence_kind: 'additive-schema' }),
    ]
    const first = apply(nodes, events)
    assert.equal(levelOf(first.nodes, 'a'), 'mid')
    assert.equal(levelOf(first.nodes, 'b'), 'high')
    assert.equal(levelOf(first.nodes, 'c'), 'mid')
    assert.deepEqual(first.rejected.map((r) => events.indexOf(r.event)), [1, 3, 4])
    const second = apply(first.nodes, events)
    assert.deepEqual(second.nodes, first.nodes)
    assert.deepEqual(apply(nodes, events).nodes, first.nodes)
    assert.deepEqual(checkInvariants(first.nodes), [])
  })

  it('a node that direct tests alone prove holds its floor: mid stays mid, and high stays high', () => {
    const lower = (id: string, level: 'safe' | 'mid') => event({ node: id, level, direction: 'down', evidence_kind: 'equivalent', evidence: 'The existing request tests run the changed lines and pass.' })
    const nodes = [node('inPlace', { proof: 'isolated', changedInPlace: true }), node('added', { proof: 'isolated' })]
    const { nodes: after, rejected } = apply(nodes, [lower('inPlace', 'safe'), lower('added', 'mid'), event({ node: 'inPlace', level: 'high' }), lower('inPlace', 'mid')])
    assert.deepEqual([after[0]?.level?.floor, after[0]?.level?.current, after[1]?.level?.current], ['mid', 'mid', 'high'])
    assert.equal(rejected.length, 2)
    assert.match(rejected[0]?.reason ?? '', /only a test that runs lowers it/)
    assert.deepEqual(after[0]?.findings[0], { rule: 'direct-tests-only', text: 'direct tests fail without the change; no request test goes through it', by: 'floor' })
    assert.deepEqual(checkInvariants(after), [])
  })

  it('does not change its input', () => {
    const nodes = [node('a')]
    const copy = structuredClone(nodes)
    apply(nodes, [event({ node: 'a' })])
    assert.deepEqual(nodes, copy)
  })

  it('rejects an unknown node, short evidence and bad enums', () => {
    const { nodes, rejected } = apply([node('a')], [
      event({ node: 'zzz' }),
      event({ node: 'a', evidence: 'too short' }),
      event({ node: 'a', level: 'urgent' as never }),
      event({ node: 'a', aspect: 'vibes' as never }),
      event({ node: 'a', evidence_kind: 'trust-me' as never }),
      event({ node: 'a', level: 'mid', critical: true }),
    ])
    assert.equal(rejected.length, 6)
    assert.match(rejected[0]?.reason ?? '', /unknown node/)
    assert.equal(levelOf(nodes, 'a'), 'mid')
  })

  it('keeps critical only on high, and a node lowered from high loses it', () => {
    const marked = apply([node('a')], [event({ node: 'a', critical: true })])
    assert.equal(marked.nodes[0]?.critical, true)
    const lowered = apply([node('a')], [
      event({ node: 'a', critical: true }),
      event({ node: 'a', level: 'mid', direction: 'down', evidence_kind: 'equivalent' }),
    ])
    assert.deepEqual([lowered.nodes[0]?.level?.current, lowered.nodes[0]?.critical], ['mid', false])
  })

  it('an event at the same level adds its evidence, questions, watch and suggestion only', () => {
    const q = { text: 'Is retry idempotent?', why: 'Not visible in the code.' }
    const watch = { signals: [{ kind: 'metric' as const, name: 'charge.retries', at: 'app/a.rb:3' }], gaps: ['no count on failure'] }
    const e = event({ node: 'a', level: 'mid', direction: 'sideways', questions: [q], watch, suggest: { kind: 'add-test', text: 'Add a request test.', to: 'safe' }, rule: 'retry' })
    const { nodes } = apply([node('a')], [e, e])
    const a = nodes[0]
    assert.equal(a?.level?.current, 'mid')
    assert.deepEqual(a?.level?.why.length, 2)
    assert.deepEqual(a?.level?.if, [{ text: 'Add a request test.', level: 'safe' }])
    assert.equal(a?.questions.length, 1)
    assert.equal(a?.watch?.signals.length, 1)
    assert.deepEqual(a?.findings.map((f) => [f.rule, f.by]), [['behaviour-changed-no-test-changed', 'floor'], ['retry', 'model']])
  })

  it('a level a failing test set is a floor: no later event lowers it, whatever evidence it names', () => {
    const failing = event({ node: 'a', level: 'high', aspect: 'failure', rule: 'failing-test', by: 'proof', evidence: 'test/flow/checkout.test.ts fails at head, before anything is changed.' })
    const hung = event({ node: 'b', level: 'high', aspect: 'failure', rule: 'test-timeout', evidence: 'test/flow/cart.test.ts did not finish within 180 seconds at head.' })
    const lower = (id: string) => event({ node: id, level: 'mid', direction: 'down', evidence_kind: 'equivalent', evidence: 'The existing request tests run the changed lines and pass.' })
    const { nodes, rejected } = apply([node('a'), node('b')], [failing, lower('a'), hung, lower('b')])
    assert.deepEqual([levelOf(nodes, 'a'), levelOf(nodes, 'b')], ['high', 'high'])
    assert.equal(rejected.length, 2)
    assert.match(rejected[0]?.reason ?? '', /fails or hangs at head/)
  })

  it('uses by when set', () => {
    const { nodes } = apply([node('a')], [event({ node: 'a', by: 'blind-check' })])
    assert.equal(nodes[0]?.findings.at(-1)?.by, 'blind-check')
  })
})

describe('checkInvariants', () => {
  it('lists critical without high and safe without a running test', () => {
    const [a, b] = [node('a'), node('b', { exposure: 'nobody-yet', undo: 'flag', proof: 'isolated', conditionOnProven: true, offPathProven: true })]
    assert(a && b)
    a.level = { floor: 'mid', rule: 7, current: 'mid', why: [], if: [] }
    a.critical = true
    b.level = { floor: 'safe', rule: 11, current: 'safe', why: [], if: [] }
    const found = checkInvariants([a, b])
    assert.deepEqual(found.map((v) => v.node), ['a', 'b'])
  })
  it('lets a rule 2 safe node stand without proof', () => {
    const t = node('t', { effect: 'text', proof: 'none' })
    t.level = { floor: 'safe', rule: 2, current: 'safe', why: [], if: [] }
    assert.deepEqual(checkInvariants([t]), [])
  })
})

describe('a broken reference', () => {
  it('stays high and critical whatever evidence an event names: search found it, so only search changes it', () => {
    const broken = node('legacy_discount', { effect: 'interface', proof: 'not-applicable', broken: 'Cart#discounted_subtotal still calls legacy_discount, which this diff removes.' })
    const { nodes, rejected } = apply([broken], [event({ node: 'legacy_discount', level: 'safe', direction: 'down', evidence_kind: 'unreferenced', evidence: 'The model says nothing calls legacy_discount any more.' })])
    assert.equal(levelOf(nodes, 'legacy_discount'), 'high')
    assert.equal(nodes[0]!.critical, true)
    assert.match(rejected[0]?.reason ?? '', /rule 1/)
  })
})
