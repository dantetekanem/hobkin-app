import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LAYER_LINES, readLines, stackPlan } from '../review/stack-plan.ts'
import type { NodeBucket, Review, ReviewFile, ReviewNode, ReviewZone } from '../review/types.ts'

const zone = (id: string, label: string, layer = 'model', subject = 'x'): ReviewZone => ({ id, label, layer, subject })

/** A changed file with its sizes, and the node a review holds for it: its bucket, its zone and what it asks of the reviewer. */
function made(path: string, lines: number, more: { bucket?: NodeBucket; zone?: string; needs?: boolean; covers?: string[]; kind?: ReviewNode['kind'] } = {}): { file: ReviewFile; node: ReviewNode } {
  const id = `n:${path}`
  return {
    file: { id: `f:${path}`, path, status: 'modified', binary: false, additions: lines, deletions: 0, summarized: false },
    node: {
      id,
      kind: more.kind ?? (more.bucket === 'test' ? 'test' : 'code'),
      title: path,
      subtitle: path,
      change: 'modified',
      summary: '',
      anchors: [],
      position: { x: 0, y: 0 },
      ...(more.bucket ? { bucket: more.bucket } : {}),
      ...(more.zone ? { zone: more.zone } : {}),
      ...(more.covers ? { covers: more.covers } : {}),
      ...(more.needs ? { attention: { tier: 'needs-you' as const, rank: 1, reasons: [] } } : {}),
    },
  }
}

function review(parts: ReturnType<typeof made>[], zones?: ReviewZone[], spec?: string): Review {
  return {
    version: 1,
    id: 'r',
    change: { project: 'p', item: 'i', title: 't', branch: 'b', base: 'a'.repeat(40), head: 'b'.repeat(40), additions: 0, deletions: 0, files: parts.length },
    snapshot: 's',
    spec: spec ? { path: spec, outcome: '', outOfScope: [], openQuestions: [] } : null,
    files: parts.map((part) => part.file),
    nodes: parts.map((part) => part.node),
    edges: [],
    story: [],
    ...(zones ? { zones } : {}),
    summary: '',
    notices: [],
  }
}

const everyFileOnce = (plan: ReturnType<typeof stackPlan>, review: Review) =>
  assert.deepEqual(plan.layers.flatMap((layer) => layer.files).sort(), review.files.map((file) => file.path).sort())

test('a plan puts lockfiles, generated files and moves first, then zones deepest first with their tests, every file once', () => {
  // The window lists zones in the order a request passes them: the controller first, the model last.
  const zones = [zone('web/controller/orders', 'Controllers · Orders', 'controller'), zone('web/model/orders', 'Models · Orders', 'model'), zone('web/test:model/orders', 'Model tests · Orders', 'test:model')]
  const parts = [
    made('app/controllers/orders_controller.rb', 120, { bucket: 'code', zone: 'web/controller/orders', needs: true }),
    made('app/models/order.rb', 90, { bucket: 'code', zone: 'web/model/orders', needs: true }),
    made('test/models/order_test.rb', 40, { bucket: 'test', zone: 'web/test:model/orders', covers: ['n:app/models/order.rb'] }),
    made('pnpm-lock.yaml', 900, { bucket: 'lockfile' }),
    made('src/generated/catalog.ts', 5000, { bucket: 'generated' }),
    made('lib/old.rb', 10, { bucket: 'moved' }),
    made('_specs/001-orders/spec.md', 30, { bucket: 'docs' }),
  ]
  const r = review(parts, zones, '_specs/001-orders/spec.md')
  const plan = stackPlan(r)

  assert.deepEqual(
    plan.layers.map((layer) => [layer.number, layer.kind, layer.files]),
    [
      [1, 'mechanical', ['pnpm-lock.yaml', 'src/generated/catalog.ts', 'lib/old.rb']],
      // What is called comes before what calls it, the tests with the code, and the spec in the first layer that is not mechanical.
      [2, 'behaviour', ['_specs/001-orders/spec.md', 'app/models/order.rb', 'test/models/order_test.rb', 'app/controllers/orders_controller.rb']],
    ],
  )
  assert.equal(plan.layers[0]!.lines, 5910)
  assert.equal(plan.layers[1]!.lines, 280)
  assert.equal(plan.layers[1]!.needsYou, 2)
  assert.equal(plan.layers[0]!.needsYou, 0)
  assert.equal(plan.layers[1]!.title, 'Models · Orders and 1 more')
  everyFileOnce(plan, r)
  assert.equal(readLines(r), 290, 'lockfiles and generated files are not read; a move and the rest are')
})

test('one zone and nothing mechanical is one layer, and a zone past 300 lines is a layer of its own', () => {
  const one = review([made('app/models/a.rb', 50, { bucket: 'code', zone: 'z/model/a' }), made('app/models/b.rb', 60, { bucket: 'code', zone: 'z/model/a' })], [zone('z/model/a', 'Models · A')])
  const single = stackPlan(one)
  assert.equal(single.layers.length, 1)
  assert.deepEqual([single.layers[0]!.number, single.layers[0]!.kind, single.layers[0]!.title, single.layers[0]!.lines, single.layers[0]!.splitFurther], [1, 'behaviour', 'Models · A', 110, false])

  const zones = [zone('z/job/a', 'Jobs · A'), zone('z/model/big', 'Models · Big'), zone('z/lib/c', 'Lib · C'), zone('z/lib/d', 'Lib · D')]
  const big = review(
    [
      made('app/jobs/a.rb', 100, { bucket: 'code', zone: 'z/job/a' }),
      made('app/models/big.rb', 200, { bucket: 'code', zone: 'z/model/big' }),
      made('app/models/big_more.rb', 150, { bucket: 'code', zone: 'z/model/big' }),
      made('lib/c.rb', 150, { bucket: 'code', zone: 'z/lib/c' }),
      made('lib/d.rb', 150, { bucket: 'code', zone: 'z/lib/d' }),
    ],
    zones,
  )
  const plan = stackPlan(big)

  // Deepest first: d and c share a layer at 300, the big zone stands alone and is marked, the job comes last.
  assert.deepEqual(plan.layers.map((layer) => [layer.title, layer.lines, layer.splitFurther]), [
    ['Lib · D and 1 more', 300, false],
    ['Models · Big', 350, true],
    ['Jobs · A', 100, false],
  ])
  assert.equal(LAYER_LINES, 300)
  everyFileOnce(plan, big)
})

test('a review with no zones or buckets is planned from its paths: lockfiles first, tests with their code', () => {
  const parts = [made('src/orchard/harvest.ts', 30), made('test/harvest.test.ts', 20, { kind: 'test' }), made('pnpm-lock.yaml', 40), made('package.json', 3)]
  const r = review(parts)
  const plan = stackPlan(r)

  assert.equal(plan.layers[0]!.kind, 'mechanical')
  assert.deepEqual(plan.layers[0]!.files.sort(), ['package.json', 'pnpm-lock.yaml'])
  assert.equal(plan.layers.length, 2)
  everyFileOnce(plan, r)
  assert.equal(readLines(r), 53)
})

test('only mechanical files make one mechanical layer, and files the change did not touch are in no layer', () => {
  const lock = made('pnpm-lock.yaml', 10, { bucket: 'lockfile' })
  const idle = made('src/lib/soil.ts', 0)
  idle.file.status = 'unchanged'
  const plan = stackPlan(review([lock, idle]))

  assert.deepEqual(plan.layers.map((layer) => [layer.kind, layer.files]), [['mechanical', ['pnpm-lock.yaml']]])
})

test('a review with no changed files has no layers', () => {
  assert.deepEqual(stackPlan(review([])).layers, [])
})
