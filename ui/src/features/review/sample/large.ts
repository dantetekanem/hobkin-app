/**
 * A made-up change of 200 files and over 10,000 changed lines (spec 053), built in code from a fixed seed: a billing
 * change with a few parts that need the reviewer, some worth a look, and the rest safe: generated files, lockfiles,
 * locale files, moved files, formatting, docs, tests that pass and small code. Its nodes carry `attention` and
 * `bucket` as a host that rated the change lays them on, so Focus, its groups and the outline can be seen with no
 * host. Pure: every call builds the same review, and it passes the same checks a review from the host does.
 */
import { layoutRequest } from '#shared/review/layout.ts'
import { hashLines, splitLines } from '#shared/review/lines.ts'
import { sha256 } from '#shared/review/sha256.ts'
import type { AttentionTier, NodeBucket, Review, ReviewEdge, ReviewFile, ReviewFileContents, ReviewNode, StoryStep } from '#shared/review/types.ts'

export const LARGE_REVIEW_ID = 'large'
const SEED = 53

/** A small, fixed random source (mulberry32), so the same seed always makes the same change. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
const camel = (name: string) => name.split('_').map((part, index) => (index === 0 ? part : capital(part))).join('')
const VERBS = ['build', 'check', 'apply', 'load', 'save', 'round', 'split', 'merge', 'close'] as const

/** The code that keeps its detail, by folder. Layers call down: controllers, jobs and screens call services, services call models and pricing. */
const CODE: { folder: string; layer: number; files: string[] }[] = [
  { folder: 'app/controllers', layer: 0, files: ['invoices_controller', 'subscriptions_controller', 'webhooks_controller', 'refunds_controller', 'coupons_controller'] },
  { folder: 'app/jobs', layer: 0, files: ['retry_charge_job', 'send_invoice_job', 'close_period_job', 'sync_tax_job'] },
  { folder: 'app/ui/billing', layer: 0, files: ['invoice_table', 'plan_picker', 'payment_form', 'usage_meter', 'receipt', 'credit_badge', 'tax_note'] },
  { folder: 'app/services/billing', layer: 1, files: ['charge', 'refund', 'invoice_total', 'proration', 'dunning', 'tax_lines'] },
  { folder: 'app/serializers', layer: 1, files: ['invoice_serializer', 'plan_serializer', 'payment_serializer', 'coupon_serializer', 'customer_serializer'] },
  { folder: 'app/models', layer: 2, files: ['invoice', 'subscription', 'plan', 'customer', 'coupon', 'payment', 'ledger_entry', 'credit_note'] },
  { folder: 'lib/pricing', layer: 3, files: ['money', 'rounding', 'currency', 'tiers', 'discounts'] },
]

/** Which units need the reviewer, by file and place, in the order they rank. */
const NEEDS_YOU: [file: string, unit: number, reason: string][] = [
  ['charge', 0, 'Moves money: a charge can now run twice when the gateway times out'],
  ['charge', 1, 'Changes what a retry does after a declined card'],
  ['refund', 0, 'A refund larger than the charge is no longer refused'],
  ['invoice_total', 0, 'Totals are rounded once per invoice instead of per line'],
  ['proration', 0, 'Proration now counts days in the customer time zone'],
  ['rounding', 0, 'Rounding of half cents changed for every currency'],
  ['webhooks_controller', 0, 'Accepts a payment event before its signature is checked'],
]
/** Units worth a look, after those. */
const WORTH: [file: string, reason: string][] = [
  ['dunning', 'Sends one more reminder before a subscription stops'],
  ['tax_lines', 'Tax lines are ordered by rate, not by name'],
  ['invoice', 'A new column the totals read'],
  ['subscription', 'Renewal reads the plan at the moment of renewal'],
  ['payment', 'Keeps the gateway answer for a failed payment'],
  ['refunds_controller', 'A new route parameter for partial refunds'],
  ['retry_charge_job', 'Waits longer between retries'],
  ['money', 'Adds a currency to every amount'],
  ['currency', 'Three new currencies'],
]
const SAFE_REASON: Record<NodeBucket, string> = {
  code: 'A small change no other part depends on',
  test: 'Passes, and only adds cases',
  generated: 'Written by the GraphQL code generator',
  lockfile: 'Follows from the manifest',
  locale: 'Words in another language',
  moved: 'Moved with nothing changed inside',
  format: 'Only spacing changed',
  docs: 'Words for people to read',
}

/** Files shown whole: their kind, how many, and how they are named and changed. */
const LANGUAGES = ['de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'sv', 'tr', 'uk', 'zh', 'da', 'fi', 'nb', 'cs', 'he']
const WHOLE: { bucket: NodeBucket; count: number; path: (index: number) => string; oldPath?: (index: number) => string }[] = [
  { bucket: 'generated', count: 50, path: (index) => `app/graphql/generated/type_${String(index + 1).padStart(2, '0')}.ts` },
  { bucket: 'lockfile', count: 2, path: (index) => ['pnpm-lock.yaml', 'Gemfile.lock'][index]! },
  { bucket: 'locale', count: 18, path: (index) => `config/locales/${LANGUAGES[index]}/billing.yml` },
  { bucket: 'moved', count: 40, path: (index) => `app/billing/legacy/part_${index + 1}.ts`, oldPath: (index) => `app/legacy/billing/part_${index + 1}.ts` },
  { bucket: 'format', count: 20, path: (index) => `app/ui/shared/layout_${index + 1}.tsx` },
  { bucket: 'docs', count: 12, path: (index) => `docs/billing/page_${index + 1}.md` },
  { bucket: 'code', count: 6, path: (index) => `app/models/concerns/concern_${index + 1}.ts` },
]
const TESTED = ['charge', 'refund', 'invoice_total', 'proration', 'dunning', 'tax_lines', 'invoice', 'subscription', 'money', 'rounding', 'webhooks_controller', 'retry_charge_job']

interface Unit {
  id: string
  name: string
  file: string
  folder: string
  layer: number
  start: number
  end: number
  change: 'added' | 'modified'
  additions: number
  deletions: number
}

/** One function: its doc line, signature, body, return and brace. The body differs between the two sides of a modified one. */
function unitLines(name: string, verb: string, noun: string, body: number, side: 'base' | 'head'): string[] {
  const lines = [`/** ${capital(verb)}s the ${noun} for one invoice. */`, `export function ${name}(amount: number): number {`]
  for (let index = 0; index < body; index += 1) {
    const from = index === 0 ? 'amount' : `step${index}`
    const factor = side === 'head' ? index + 3 : index + 2
    lines.push(`  const step${index + 1} = ${from} * ${factor}`)
  }
  lines.push(`  return step${body}`, '}')
  return lines
}

/** One line of a file shown whole, in the way its kind reads: a locale key, a line of docs, a lockfile entry, or code. */
function wholeLine(bucket: NodeBucket, path: string, at: number, side: string): string {
  switch (bucket) {
    case 'locale':
      return `  key_${side}_${at}: "${side} text ${at}"`
    case 'docs':
      return `${side === 'new' ? 'A' : 'An older'} line about billing, number ${at}.`
    case 'lockfile':
      return `  /package-${side}-${at}@1.${at % 9}.0: { resolution: sha-${at} }`
    default:
      return `export const ${side}${at} = ${at} // ${path}`
  }
}

interface Built {
  review: Review
  files: ReviewFileContents[]
}

let built: Built | null = null

/** The large sample: the review and both sides of each of its files. Built once, then kept. */
export function largeReview(): Built {
  return (built ??= build())
}

function build(): Built {
  const random = randomFrom(SEED)
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  const contents: ReviewFileContents[] = []
  const files: ReviewFile[] = []
  const nodes: ReviewNode[] = []
  const edges: ReviewEdge[] = []
  const joined = new Set<string>()
  const wire = (kind: ReviewEdge['kind'], from: string, to: string, label?: string) => {
    if (from === to || joined.has(`${from}>${to}`)) return
    joined.add(`${from}>${to}`)
    edges.push({ id: `${kind}:${from}>${to}`, from, to, kind, certainty: 'host', ...(label ? { label } : {}) })
  }
  const anchor = (fileId: string, text: string, startLine: number, endLine: number) => ({ fileId, side: 'added' as const, startLine, endLine, hash: hashLines(text, startLine, endLine) })
  const position = { x: 0, y: 0 }
  let unitCount = 0
  const nextUnit = () => `u${(unitCount += 1)}`

  // The code that keeps its detail: one to three functions in each file, some new and some changed.
  const units: Unit[] = []
  const unitsOf = new Map<string, Unit[]>()
  for (const { folder, layer, files: names } of CODE) {
    for (const name of names) {
      const path = `${folder}/${name}.ts`
      const needed = Math.max(0, ...NEEDS_YOU.filter(([file]) => file === name).map(([, unit]) => unit + 1))
      const count = Math.max(between(1, 3), needed)
      const head: string[] = []
      const base: string[] = []
      const mine: Unit[] = []
      for (let index = 0; index < count; index += 1) {
        const verb = VERBS[between(0, VERBS.length - 1)]!
        const fn = `${verb}${capital(camel(name))}${index > 0 ? index + 1 : ''}`
        const body = between(4, 16)
        const change = random() < 0.55 ? 'modified' : 'added'
        if (head.length > 0) head.push('')
        const start = head.length + 1
        head.push(...unitLines(fn, verb, name.replaceAll('_', ' '), body, 'head'))
        if (change === 'modified') {
          if (base.length > 0) base.push('')
          base.push(...unitLines(fn, verb, name.replaceAll('_', ' '), body, 'base'))
        }
        mine.push({
          id: nextUnit(),
          name: fn,
          file: name,
          folder,
          layer,
          start,
          end: head.length,
          change,
          additions: change === 'added' ? body + 4 : body,
          deletions: change === 'added' ? 0 : body,
        })
      }
      const headText = `${head.join('\n')}\n`
      const baseText = base.length > 0 ? `${base.join('\n')}\n` : null
      const additions = mine.reduce((sum, unit) => sum + unit.additions, 0)
      const deletions = mine.reduce((sum, unit) => sum + unit.deletions, 0)
      files.push({ id: path, path, status: baseText == null ? 'added' : 'modified', binary: false, additions, deletions, summarized: false })
      contents.push({ fileId: path, path, base: baseText, head: headText, binary: false })
      for (const unit of mine) {
        nodes.push({
          id: unit.id,
          kind: 'code',
          title: unit.name,
          subtitle: path,
          change: unit.change,
          stats: { additions: unit.additions, deletions: unit.deletions },
          summary: unit.change === 'added' ? `New: ${unit.name} works out one step of the bill.` : `${unit.name} multiplies by one more at each step.`,
          io: { in: 'an amount in cents', out: 'the amount after this step' },
          anchors: [anchor(path, headText, unit.start, unit.end)],
          position,
        })
      }
      units.push(...mine)
      unitsOf.set(name, mine)
    }
  }

  // Each function calls one or two in the layers under it, and the one after it in its own file.
  for (const unit of units) {
    const below = units.filter((other) => other.layer > unit.layer)
    for (let call = between(0, 2); call > 0 && below.length > 0; call -= 1) {
      const callee = below[between(0, below.length - 1)]!
      wire('calls', unit.id, callee.id)
    }
    const sibling = unitsOf.get(unit.file)!
    const after = sibling[sibling.indexOf(unit) + 1]
    if (after) wire('calls', unit.id, after.id)
  }

  // The tests, one file for each tested part, each test exercising the functions of its file.
  const tests: ReviewNode[] = []
  for (const name of TESTED) {
    const path = `test/billing/${name}.test.ts`
    const subjects = unitsOf.get(name)!
    const lines = [
      "import assert from 'node:assert/strict'",
      "import { test } from 'node:test'",
      `import { ${subjects.map((unit) => unit.name).join(', ')} } from '../../${subjects[0]!.folder}/${name}.ts'`,
    ]
    const mine: { id: string; title: string; start: number; end: number; subject: Unit }[] = []
    for (let index = 0, count = between(2, 4); index < count; index += 1) {
      const subject = subjects[index % subjects.length]!
      const title = `${subject.name} gives the same amount twice for the same invoice${index > 0 ? ` (case ${index + 1})` : ''}`
      lines.push('', `test('${title}', () => {`, `  assert.equal(${subject.name}(${index + 1}), ${subject.name}(${index + 1}))`, '})')
      mine.push({ id: nextUnit(), title, start: lines.length - 2, end: lines.length, subject })
    }
    const head = `${lines.join('\n')}\n`
    files.push({ id: path, path, status: 'added', binary: false, additions: lines.length, deletions: 0, summarized: false })
    contents.push({ fileId: path, path, base: null, head, binary: false })
    for (const [index, test] of mine.entries()) {
      const node: ReviewNode = {
        id: test.id,
        kind: 'test',
        title: test.title,
        subtitle: path,
        change: 'added',
        stats: { additions: 3, deletions: 0 },
        summary: `Calls ${test.subject.name} twice and compares.`,
        status: index === 0 && NEEDS_YOU.some(([file]) => file === name) ? 'proves-change' : 'passed',
        anchors: [anchor(path, head, test.start, test.end)],
        position,
      }
      nodes.push(node)
      tests.push(node)
      wire('exercises', test.id, test.subject.id)
    }
  }

  // The files shown whole: generated, lockfiles, locale files, moved, formatted, docs and small code.
  const wholes: { node: ReviewNode; bucket: NodeBucket }[] = []
  let fileCount = 0
  for (const { bucket, count, path: pathOf, oldPath: oldPathOf } of WHOLE) {
    for (let index = 0; index < count; index += 1) {
      const path = pathOf(index)
      const oldPath = oldPathOf?.(index)
      const line = (at: number, side: string) => wholeLine(bucket, path, at, side)
      let base: string | null
      let head: string
      let additions: number
      let deletions: number
      if (bucket === 'moved') {
        const kept = Array.from({ length: between(20, 40) }, (_, at) => line(at, 'kept'))
        const touched = between(0, 2)
        base = `${kept.join('\n')}\n`
        head = `${kept.map((text, at) => (at < touched ? `${text} // moved` : text)).join('\n')}\n`
        ;[additions, deletions] = [touched, touched]
      } else if (bucket === 'format') {
        const lines = Array.from({ length: between(12, 30) }, (_, at) => `{ value${at}: ${at} }`)
        base = `${lines.map((text) => `\t${text}`).join('\n')}\n`
        head = `${lines.map((text) => `  ${text}`).join('\n')}\n`
        ;[additions, deletions] = [lines.length, lines.length]
      } else {
        // How many lines a file of each kind adds, at the least and the most, then how many it removes.
        const sizes: Record<string, [number, number, number, number]> = {
          generated: [84, 118, 0, 60],
          lockfile: index === 0 ? [700, 700, 300, 300] : [40, 40, 28, 28],
          locale: [28, 44, 6, 12],
          docs: [12, 40, 0, 0],
          code: [4, 10, 0, 4],
        }
        const [low, high, removedLow, removedHigh] = sizes[bucket]!
        const added = between(low, high)
        const removed = bucket === 'generated' && index < 30 ? 0 : between(removedLow, removedHigh)
        const kept = removed > 0 ? Array.from({ length: 6 }, (_, at) => line(at, 'same')) : []
        const old = Array.from({ length: removed }, (_, at) => line(at, 'old'))
        base = removed > 0 ? `${[...kept, ...old].join('\n')}\n` : null
        const banner = bucket === 'generated' ? ['// Generated by graphql-codegen. Do not edit.'] : []
        const fresh = Array.from({ length: added - banner.length }, (_, at) => line(at, 'new'))
        head = `${[...banner, ...kept, ...fresh].join('\n')}\n`
        ;[additions, deletions] = [added, removed]
      }
      const status = oldPath ? 'renamed' : base == null ? 'added' : 'modified'
      files.push({ id: path, path, ...(oldPath ? { oldPath } : {}), status, binary: false, additions, deletions, summarized: true })
      contents.push({ fileId: path, path, ...(oldPath ? { oldPath } : {}), base, head, binary: false })
      const node: ReviewNode = {
        id: `f${(fileCount += 1)}`,
        kind: 'file',
        title: path.split('/').at(-1)!,
        subtitle: path,
        change: status === 'added' ? 'added' : 'modified',
        stats: { additions, deletions },
        summary: 'Shown whole: this change is over the size limits.',
        anchors: [anchor(path, head, 1, splitLines(head).length)],
        position,
      }
      nodes.push(node)
      wholes.push({ node, bucket })
    }
  }
  // The services read some generated types.
  const generated = wholes.filter((entry) => entry.bucket === 'generated')
  for (const unit of units.filter((entry) => entry.folder === 'app/services/billing')) {
    const type = generated[between(0, generated.length - 1)]!
    wire('imports', unit.id, type.node.id)
  }

  // Where requests enter: two routes the change did not touch, each calling a controller of the change.
  const routes: [string, string, string][] = [
    ['POST', '/webhooks/payments', 'webhooks_controller'],
    ['GET', '/invoices/:id', 'invoices_controller'],
  ]
  for (const [index, [verb, route, controller]] of routes.entries()) {
    const id = `c${index + 1}`
    nodes.push({
      id,
      kind: 'context',
      title: `${verb} ${route}`,
      subtitle: 'config/routes.rb',
      change: 'unchanged',
      summary: `Sends ${verb} ${route} to the ${controller.replaceAll('_', ' ')}.`,
      entry: { kind: 'route', exact: true, route: { verbs: [verb], path: route } },
      lifecycle: { role: 'caller', hops: 1 },
      anchors: [],
      position,
    })
    wire('called-by', unitsOf.get(controller)![0]!.id, id)
  }

  // The spec's acceptance lines, each carried by a part that needs the reviewer and proven by its first test.
  const needsYou = NEEDS_YOU.map(([file, index, reason]) => ({ unit: unitsOf.get(file)![index]!, reason }))
  const criteria: [string, string, string | null][] = [
    ['A1', 'A charge that times out at the gateway is never taken twice.', 'charge'],
    ['A2', 'A refund is never larger than what was charged.', 'refund'],
    ['A3', 'An invoice total is rounded once, after every line.', 'invoice_total'],
    ['A4', "Proration counts days in the customer's time zone.", 'proration'],
    ['A5', 'Half cents round the same way in every currency.', 'rounding'],
    ['A6', 'A payment event is checked before it is believed.', null],
  ]
  for (const [id, line, file] of criteria) {
    const test = file ? tests.find((entry) => entry.subtitle === `test/billing/${file}.test.ts`) : undefined
    nodes.push({
      id,
      kind: 'criterion',
      title: id,
      change: 'added',
      summary: line,
      status: test ? 'proven' : 'unproven',
      ...(test ? { proof: `test/billing/${file}.test.ts › ${test.title}` } : { warning: 'No Proof line names a test or a check.' }),
      anchors: [],
      position,
    })
    if (file) wire('implements', id, unitsOf.get(file)![0]!.id)
    if (test) wire('proves', id, test.id)
  }

  // How much each node asks of the reviewer, the way a host that rated the change says it.
  const worth = WORTH.map(([file, reason]) => ({ unit: unitsOf.get(file)![0]!, reason }))
  const worthTests = ['charge', 'refund'].map((file) => tests.find((entry) => entry.subtitle === `test/billing/${file}.test.ts`)!)
  let rank = 0
  const rate = (node: ReviewNode, tier: AttentionTier, bucket: NodeBucket, reasons: string[]) => {
    node.attention = { tier, rank: (rank += 1), reasons }
    node.bucket = bucket
  }
  const nodeOf = new Map(nodes.map((node) => [node.id, node]))
  for (const { unit, reason } of needsYou) {
    rate(nodeOf.get(unit.id)!, 'needs-you', 'code', [reason])
    nodeOf.get(unit.id)!.level = 'high'
  }
  for (const { unit, reason } of worth) {
    rate(nodeOf.get(unit.id)!, 'worth-a-look', 'code', [reason])
    nodeOf.get(unit.id)!.level = 'mid'
  }
  for (const test of worthTests) rate(test, 'worth-a-look', 'test', ['It is the one test that proves the retry'])
  for (const node of nodes.filter((entry) => entry.kind === 'code' && !entry.attention)) {
    rate(node, 'safe', 'code', [SAFE_REASON.code])
    node.level = 'safe'
  }
  for (const test of tests.filter((entry) => !entry.attention)) rate(test, 'safe', 'test', [SAFE_REASON.test])
  // The host finds nothing to say of the code around the change, so it rates the routes safe, with no reason.
  for (const route of nodes.filter((entry) => entry.kind === 'context')) rate(route, 'safe', 'code', [])
  // The larger a safe file, the earlier it is read.
  const linesOf = ({ node }: { node: ReviewNode }) => node.stats!.additions + node.stats!.deletions
  for (const { node, bucket } of [...wholes].sort((a, b) => linesOf(b) - linesOf(a))) rate(node, 'safe', bucket, [SAFE_REASON[bucket]])

  // The story: what the change does, the parts that need the reviewer, two worth a look, then what is left open.
  const story: StoryStep[] = [
    { id: 'outcome', kind: 'outcome', title: 'Charge each invoice once', text: 'Every invoice is charged once, with its tax and proration worked out the same way in every currency, and a payment event is believed only after it is checked.', focus: [], criteria: [] },
    ...needsYou.map(({ unit, reason }, index) => ({
      id: `s${index + 1}`,
      kind: 'walk' as const,
      title: `${unit.name}: ${reason.split(':')[0]!.toLowerCase()}`.slice(0, 80),
      text: `${reason}. Read ${unit.name} in ${unit.folder}/${unit.file}.ts first.`,
      focus: [unit.id],
      criteria: criteria.filter(([, , file]) => file === unit.file).map(([id]) => id),
      level: 'high' as const,
    })),
    ...worth.slice(0, 2).map(({ unit, reason }, index) => ({
      id: `s${needsYou.length + index + 1}`,
      kind: 'walk' as const,
      title: `${unit.name}, worth a look`,
      text: `${reason}.`,
      focus: [unit.id],
      criteria: [],
      level: 'mid' as const,
    })),
    { id: 'closing', kind: 'closing', title: 'What is left open', text: 'Out of scope: changing the gateway. The risk: a retry that charges twice.', focus: [], criteria: [] },
  ]

  // Laid out the way the host lays a review out, so no two nodes overlap.
  const placed = layoutRequest(nodes, edges)
  for (const node of nodes) node.position = placed[node.id] ?? position

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const summarized = files.filter((file) => file.summarized).length
  const review: Review = {
    version: 1,
    id: LARGE_REVIEW_ID,
    change: {
      project: 'storefront',
      item: 'b200',
      title: 'Charge each invoice once, with tax and proration, in every currency',
      branch: 'hobkin/b200-charge-once',
      base: sha256('base').slice(0, 40),
      head: sha256('head').slice(0, 40),
      additions,
      deletions,
      files: files.length,
      risk: 'A retry that charges a card twice.',
    },
    snapshot: sha256(contents.map((file) => `${file.fileId}\n${file.base ?? ''}\n${file.head ?? ''}`).join('\n')),
    spec: { path: '_specs/b200-charge-once/spec.md', outcome: story[0]!.text, outOfScope: ['Changing the payment gateway.'], openQuestions: ['Should a refund of a refund be allowed?'] },
    files,
    nodes,
    edges,
    story,
    summary: 'Billing charges each invoice once: retries, refunds, totals, proration and rounding change, with generated types, locale files and moved files around them.',
    notices: [`${summarized} files are summarized without their parts, because this change is over 60 files or 4,000 changed lines.`],
  }
  return { review, files: contents }
}
