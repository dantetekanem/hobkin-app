/**
 * A sample pull request, so the Review screen can be seen with a change review and no host: shaped like the user's #78.
 * One changed helper (`link_user_tags`) on the path of every post page, twenty tests (seven for the helper, one of them
 * there before the change and one it removed, thirteen for a new script) and a test helper, a README change, a CI
 * change, the unchanged callers and callees for the life cycle with the helper's way in named and the script's reason
 * for having none, two nodes nothing wires, and a change review of four units: one high with a question and a watch, one
 * mid and two safe. Every node is rated as the host rates a review. Built from the file texts in `pull-files.ts`, so
 * every anchor and hash always matches its lines, and checked by the same validator as any review.
 */
import { LEVEL_WORDS, type ChangeAssessment, type Level, type Unit } from '#shared/review/assessment.ts'
import { attentionOf, pathBucket, rankAttention, type RatedFacts } from '#shared/review/attention.ts'
import { alignRows } from '#shared/review/diff.ts'
import { layoutReview } from '#shared/review/layout.ts'
import { hashLines, splitLines } from '#shared/review/lines.ts'
import { sha256 } from '#shared/review/sha256.ts'
import { connectingEdge } from '#shared/review/story.ts'
import { NO_SPEC_NOTICE, type AnchorSide, type EdgeKind, type Review, type ReviewAnchor, type ReviewEdge, type ReviewFile, type ReviewFileContents, type ReviewNode, type StoryStep } from '#shared/review/types.ts'
import { PULL_FILES, type SampleFile } from './pull-files.ts'

const BASE = 'b4c1d0e2f3a4958677a8b9c0d1e2f3a4b5c6d7e8'
const HEAD = '78e2a9f1c3b5d7e9f1a3c5e7d9b1f3a5c7e9d1b3'
const RATED_AT = '2026-11-12T09:40:00.000Z'

const fileOf = new Map(PULL_FILES.map((file) => [file.path, file]))
const sideText = (file: SampleFile, side: AnchorSide) => (side === 'added' ? file.head : file.base) ?? ''

interface Range {
  side: AnchorSide
  startLine: number
  endLine: number
}

/** The first line, from 1, that starts with these words once its indentation is set aside. */
function lineOf(text: string, start: string): number {
  const index = splitLines(text).findIndex((line) => line.trimStart().startsWith(start))
  if (index < 0) throw new Error(`The sample has no line starting "${start}".`)
  return index + 1
}

/** One line, the first that starts with these words. */
function line(path: string, start: string): Range {
  const at = lineOf(sideText(fileOf.get(path)!, 'added'), start)
  return { side: 'added', startLine: at, endLine: at }
}

/** A Ruby block from the line that opens it to the `end` at its indentation, with the comment lines right above it. */
function block(path: string, side: AnchorSide, opener: string): Range {
  const rows = splitLines(sideText(fileOf.get(path)!, side))
  const open = lineOf(rows.join('\n'), opener)
  const indent = rows[open - 1]!.length - rows[open - 1]!.trimStart().length
  let end = open
  while (end < rows.length && rows[end - 1] !== `${' '.repeat(indent)}end`) end += 1
  let start = open
  while (start > 1 && rows[start - 2]!.trimStart().startsWith('#') && rows[start - 2]!.length - rows[start - 2]!.trimStart().length === indent) start -= 1
  return { side, startLine: start, endLine: end }
}

/** From the line that starts with these words to the last line of the file. */
function tail(path: string, start: string): Range {
  const text = sideText(fileOf.get(path)!, 'added')
  return { side: 'added', startLine: lineOf(text, start), endLine: splitLines(text).length }
}

function anchorOf(path: string, range: Range): ReviewAnchor {
  return { fileId: path, side: range.side, startLine: range.startLine, endLine: range.endLine, hash: hashLines(sideText(fileOf.get(path)!, range.side), range.startLine, range.endLine) }
}

/** The lines of a file this change added and removed, as GitHub counts them. */
function changedLines(file: SampleFile): { added: Set<number>; removed: Set<number> } {
  const added = new Set<number>()
  const removed = new Set<number>()
  for (const row of alignRows(file.base ?? '', file.head ?? '')) {
    if (row.kind === 'equal') continue
    if (row.newLine != null) added.add(row.newLine)
    if (row.oldLine != null) removed.add(row.oldLine)
  }
  return { added, removed }
}
const changes = new Map(PULL_FILES.map((file) => [file.path, changedLines(file)]))

/** The changed lines inside a node's ranges. */
function statsOf(path: string, ranges: readonly Range[]): { additions: number; deletions: number } {
  const changed = changes.get(path)!
  let additions = 0
  let deletions = 0
  for (const range of ranges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      if (range.side === 'added' && changed.added.has(line)) additions += 1
      if (range.side === 'deleted' && changed.removed.has(line)) deletions += 1
    }
  }
  return { additions, deletions }
}

type Draft = Omit<ReviewNode, 'anchors' | 'position' | 'stats'> & { path: string; ranges: Range[] }

function nodeOf({ path, ranges, ...node }: Draft): ReviewNode {
  return {
    ...node,
    subtitle: path,
    ...(node.change === 'unchanged' ? {} : { stats: statsOf(path, ranges) }),
    anchors: ranges.map((range) => anchorOf(path, range)),
    position: { x: 0, y: 0 },
  }
}

const HELPER = 'app/helpers/posts_helper.rb'
const SCRIPT = 'script/production_errors.rb'
const HELPER_TEST = 'test/helpers/posts_helper_test.rb'
const SCRIPT_TEST = 'test/scripts/production_errors_test.rb'

/** A definition changed on both sides: its lines at head and at base. */
const both = (path: string, opener: string, baseOpener = opener) => [block(path, 'added', opener), block(path, 'deleted', baseOpener)]

const CODE: Draft[] = [
  {
    id: 'u1', kind: 'code', path: HELPER, title: 'link_user_tags', change: 'modified', level: 'high', unit: 'u1',
    lifecycle: {
      role: 'changed',
      hops: 3,
      path: 'GET /posts/:id → PostsController#show → render_body → link_user_tags',
      origin: { kind: 'route', label: 'GET /posts/:id', exact: true, chain: ['c5', 'c2', 'c1'], more: 2 },
    },
    ranges: both(HELPER, 'def link_user_tags'),
    summary: 'Links every @handle in a post body, dots and dashes too, after one lookup for all the users it names.',
    io: { in: 'a post body as HTML', out: 'the HTML with user tags linked' },
  },
  {
    id: 'u2', kind: 'code', path: SCRIPT, title: 'fetch_errors', change: 'added', level: 'mid', unit: 'u2',
    lifecycle: { role: 'changed', hops: 0, path: 'No route reaches it within 4 calls: a script someone runs by hand', none: 'no-callers' },
    ranges: [block(SCRIPT, 'added', 'def fetch_errors')],
    summary: 'Asks the production monitor for the errors since a time, with the token in ERRORS_TOKEN.',
    io: { in: 'a time', out: 'the errors, read from JSON' },
  },
  {
    id: 'u3', kind: 'code', path: SCRIPT, title: 'report', change: 'added', level: 'safe', unit: 'u4',
    ranges: [{ ...block(SCRIPT, 'added', 'def report'), endLine: block(SCRIPT, 'added', 'def truncate').endLine }],
    summary: 'One line per error message: how often it was raised, when last, and the message cut to 72 characters.',
    io: { in: 'the errors', out: 'the report, as text' },
  },
]

interface SampleTest {
  name: string
  covers: string
  status: NonNullable<ReviewNode['status']>
  change: ReviewNode['change']
  baseName?: string
}

/** The five tests of the helper. Two changed, three are new, and those three fail with the change undone: they prove it. */
const HELPER_TESTS: SampleTest[] = [
  { name: "links a tag to the user's profile", covers: 'Renders "Thanks @mira" and expects a link to her profile, marked user-tag.', status: 'passed', change: 'modified', baseName: 'links a tag to the user' },
  { name: 'links a handle with dots and dashes', covers: 'Renders @dev-ops and @j.doe and expects both to link.', status: 'proves-change', change: 'added' },
  { name: 'leaves a tag inside a code span as written', covers: 'Renders @mira inside a code span and expects no link.', status: 'proves-change', change: 'added' },
  { name: 'leaves a tag to an unknown user as text', covers: 'Renders @nobody, a handle no user has, and expects the words unchanged.', status: 'passed', change: 'modified' },
  { name: 'looks every named user up in one query', covers: 'Counts the queries while three tags render and expects one.', status: 'proves-change', change: 'added' },
]

/** The thirteen tests of the script: six of fetch_errors, seven of report. One fails, one is skipped. */
const FETCH_TESTS: SampleTest[] = [
  { name: 'asks the monitor for the errors since the given time', covers: 'Expects the request to ask for errors since 09:00 UTC.', status: 'passed', change: 'added' },
  { name: 'sends the token from ERRORS_TOKEN', covers: 'Expects the request to carry the token as a bearer.', status: 'passed', change: 'added' },
  { name: "stops with the monitor's status when it does not answer 200", covers: 'Has the monitor answer 503 and expects the script to stop and say so.', status: 'passed', change: 'added' },
  { name: 'stops when ERRORS_URL is not set', covers: 'Leaves ERRORS_URL out and expects the script to stop.', status: 'passed', change: 'added' },
  { name: 'reads an empty answer as no errors', covers: 'Has the monitor answer nothing and expects an empty list.', status: 'passed', change: 'added' },
  { name: 'tries once more when the monitor times out', covers: 'Has the monitor time out once and expects a second try. The code never tries again, so this fails.', status: 'failed', change: 'added' },
]
const REPORT_TESTS: SampleTest[] = [
  { name: 'says so when production raised nothing', covers: 'Expects "No errors in production." for an empty list.', status: 'passed', change: 'added' },
  { name: 'puts the most frequent message first', covers: 'Expects the message raised three times above the one raised once.', status: 'passed', change: 'added' },
  { name: 'breaks a tie by the latest time', covers: 'Skipped: the order of a tie is not settled yet.', status: 'not-run', change: 'added' },
  { name: 'shows when each message was last raised', covers: 'Expects the later of two times beside a message.', status: 'passed', change: 'added' },
  { name: 'cuts a long message to 72 characters', covers: 'Expects a 90 character message cut to 72, with an ellipsis.', status: 'passed', change: 'added' },
  { name: 'keeps a message of exactly 72 characters whole', covers: 'Expects a 72 character message as it is.', status: 'passed', change: 'added' },
  { name: 'prints one line per message', covers: 'Expects two lines for two messages.', status: 'passed', change: 'added' },
]

const quoted = (name: string) => (name.includes("'") ? `test "${name}" do` : `test '${name}' do`)
let nextTest = 4
const testDrafts = (path: string, tests: readonly SampleTest[]): Draft[] =>
  tests.map((test) => ({
    id: `u${nextTest++}`,
    kind: 'test',
    path,
    title: test.name,
    change: test.change,
    status: test.status,
    summary: test.covers,
    ranges: test.change === 'modified' ? both(path, quoted(test.name), quoted(test.baseName ?? test.name)) : [block(path, 'added', quoted(test.name))],
  }))

const helperTests = testDrafts(HELPER_TEST, HELPER_TESTS)
const fetchTests = testDrafts(SCRIPT_TEST, FETCH_TESTS)
const reportTests = testDrafts(SCRIPT_TEST, REPORT_TESTS)

const SUPPORT: Draft = {
  id: `u${nextTest++}`, kind: 'test', path: 'test/support/monitor_stub.rb', title: 'stub_monitor', change: 'added',
  ranges: [block('test/support/monitor_stub.rb', 'added', 'def stub_monitor')],
  summary: 'A test helper, used by the six fetch_errors tests: answers like the monitor, with the errors or the status given.',
  supports: fetchTests.map((test) => test.id),
}

const FILES_ALONE: Draft[] = [
  {
    id: `u${nextTest++}`, kind: 'file', path: 'README.md', title: 'README.md', change: 'modified', level: 'safe', unit: 'u3',
    ranges: [tail('README.md', '## Production errors')],
    summary: 'A new section on running production_errors.rb and the two settings it needs.',
    unwired: 'Documentation: no code reads it.',
  },
  {
    id: `u${nextTest++}`, kind: 'file', path: '.github/workflows/ci.yml', title: 'ci.yml', change: 'modified',
    ranges: [tail('.github/workflows/ci.yml', '- run: bin/rails test test/scripts')],
    summary: "CI runs the script's tests as a step of their own.",
    unwired: 'CI settings: no code calls a workflow.',
  },
]

/**
 * Two more tests of the helper, as a host that knows what tested the code before shows them: one there before the
 * change that still passes, wired to the helper, and one the change removed, which only says what it covered.
 */
const HELPER_BEFORE: Draft[] = [
  {
    id: `u${nextTest++}`, kind: 'test', path: HELPER_TEST, title: 'links a tag at the start of a paragraph', change: 'unchanged', status: 'passed', covers: ['u1'],
    ranges: [block(HELPER_TEST, 'added', quoted('links a tag at the start of a paragraph'))],
    summary: 'Renders "@mira wrote this" and expects the paragraph to open with her link. It was there before the change.',
  },
  {
    id: `u${nextTest++}`, kind: 'test', path: HELPER_TEST, title: 'looks each tag up by its handle', change: 'deleted', status: 'not-run', covers: ['u1'],
    ranges: [block(HELPER_TEST, 'deleted', quoted('looks each tag up by its handle'))],
    summary: 'Expected one lookup for each tag. The change finds every user a post names in one query, so it was removed.',
  },
]

const CONTEXT: Draft[] = [
  {
    id: 'c1', kind: 'context', path: HELPER, title: 'render_body', change: 'unchanged', lifecycle: { role: 'caller', hops: 1 },
    ranges: [block(HELPER, 'added', 'def render_body')],
    summary: 'Renders a post body as HTML: Markdown, then the user tags, then only the tags a post may use.',
  },
  {
    id: 'c2', kind: 'context', path: 'app/controllers/posts_controller.rb', title: 'PostsController#show', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 2 }, entry: { kind: 'controller', exact: true },
    ranges: [block('app/controllers/posts_controller.rb', 'added', 'def show')],
    summary: 'Every post page: finds the post and renders its body with render_body.',
  },
  {
    id: 'c3', kind: 'context', path: 'app/controllers/feeds_controller.rb', title: 'FeedsController#index', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 2 }, entry: { kind: 'controller', exact: true },
    ranges: [block('app/controllers/feeds_controller.rb', 'added', 'def index')],
    summary: 'The RSS feed: renders the bodies of the latest twenty posts.',
  },
  {
    id: 'c4', kind: 'context', path: 'app/models/user.rb', title: 'User.find_by_handles', change: 'unchanged', lifecycle: { role: 'callee', hops: 1 },
    ranges: [block('app/models/user.rb', 'added', 'def self.find_by_handles')],
    summary: 'Every user with one of the given handles, in one query.',
  },
  {
    id: 'c5', kind: 'context', path: 'config/routes.rb', title: 'GET /posts/:id', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 3 }, entry: { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/posts/:id' } },
    ranges: [line('config/routes.rb', "get '/posts/:id'")],
    summary: 'A request for a post: the route to PostsController#show.',
  },
  {
    id: 'c6', kind: 'context', path: 'config/routes.rb', title: 'GET /feed', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 3 }, entry: { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/feed' } },
    ranges: [line('config/routes.rb', "get '/feed'")],
    summary: 'A request for the RSS feed: the route to FeedsController#index.',
  },
  {
    id: 'c7', kind: 'context', path: 'app/controllers/errors_controller.rb', title: 'ErrorsController#show', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 2 }, entry: { kind: 'controller', exact: true },
    ranges: [block('app/controllers/errors_controller.rb', 'added', 'def show')],
    summary: 'Every error page: a post the editors write, rendered with render_body.',
  },
  {
    id: 'c8', kind: 'context', path: 'config/application.rb', title: 'config.exceptions_app', change: 'unchanged',
    lifecycle: { role: 'caller', hops: 3, path: 'A failing request → config.exceptions_app → ErrorsController#show' },
    entry: { kind: 'exceptions-app', exact: true },
    ranges: [line('config/application.rb', 'config.exceptions_app')],
    summary: 'A request that fails anywhere is answered by ErrorsController#show.',
  },
]

const DRAFTS = [...CODE, ...helperTests, ...HELPER_BEFORE, ...fetchTests, ...reportTests, SUPPORT, ...FILES_ALONE, ...CONTEXT]
const NODES = DRAFTS.map(nodeOf)

const wire = (kind: EdgeKind, from: string, to: string, label?: string): ReviewEdge => ({ id: `${kind}:${from}>${to}`, from, to, kind, ...(label ? { label } : {}), certainty: 'host' })
const EDGES: ReviewEdge[] = [
  ...helperTests.map((test) => wire('exercises', test.id, 'u1')),
  wire('exercises', HELPER_BEFORE[0]!.id, 'u1'),
  ...fetchTests.map((test) => wire('exercises', test.id, 'u2')),
  ...reportTests.map((test) => wire('exercises', test.id, 'u3')),
  wire('called-by', 'u1', 'c1', 'html = link_user_tags(html)'),
  wire('called-by', 'c1', 'c2', 'helpers.render_body(@post)'),
  wire('called-by', 'c1', 'c3', 'helpers.render_body(post)'),
  wire('calls', 'u1', 'c4', 'User.find_by_handles(handles)'),
  wire('called-by', 'c2', 'c5', "to: 'posts#show'"),
  wire('called-by', 'c3', 'c6', "to: 'feeds#index'"),
  wire('called-by', 'c1', 'c7', 'helpers.render_body(@post)'),
  wire('called-by', 'c7', 'c8', 'ErrorsController.action(:show)'),
]

const TITLE = 'Link user tags with dots and dashes, and add a production errors script'
const DOES = 'Links user tags that hold dots and dashes, with one lookup for each post, and adds a script that prints the errors production raised.'

/**
 * The story as the host tells it once the change review is ready (lane A's `unitStory`): an opening with the change's
 * claim, then one step per unit in the order its story walks, each focused on the nodes that hold the unit's code.
 * Tests and the code around the change are never steps: they show on the graph around a unit's nodes.
 */
function storyOf(nodes: readonly ReviewNode[]): StoryStep[] {
  const steps: StoryStep[] = [
    { id: 'outcome', kind: 'outcome', title: TITLE, text: DOES, focus: [], criteria: [] },
    ...[...UNITS]
      .sort((a, b) => a.story_order - b.story_order)
      .map((unit): StoryStep => ({
        id: `unit-${unit.id}`,
        kind: 'walk',
        title: unit.title,
        text: unit.what,
        focus: nodes.filter((node) => node.unit === unit.id).map((node) => node.id),
        criteria: [],
        level: unit.level,
        unit: unit.id,
      })),
  ]
  for (let index = 1; index < steps.length; index += 1) {
    const ride = connectingEdge(EDGES, steps[index - 1]!.focus, steps[index]!.focus)
    if (ride) steps[index]!.travel = ride.edge.id
  }
  return steps
}

function filesOf(): ReviewFile[] {
  return PULL_FILES.map((file) => {
    const changed = changes.get(file.path)!
    return { id: file.path, path: file.path, status: file.status, binary: false, additions: changed.added.size, deletions: changed.removed.size, summarized: false }
  })
}

/**
 * Each node with how much it asks of the reviewer, as the host lays it on once the change review is ready
 * (`withAttention` in the host): a unit's facts on the code it holds, a test's run, a file's kind. The code around the
 * change has none of these, so it is safe, as in every review the host rates.
 */
function rated(nodes: readonly ReviewNode[]): ReviewNode[] {
  const unitOf = new Map(UNITS.map((unit) => [unit.id, unit]))
  const weighed = nodes.map((node) => {
    const unit = node.unit ? unitOf.get(node.unit) : undefined
    const facts: RatedFacts[] = unit
      ? [{ level: unit.level, critical: unit.critical, effect: unit.facts.effect.value, proof: unit.facts.proof.value, exposure: unit.facts.exposure.value, undo: unit.facts.undo.value, questions: unit.questions.length }]
      : []
    const bucket = node.kind === 'test' ? 'test' : pathBucket(node.subtitle ?? '')
    const size = (node.stats?.additions ?? 0) + (node.stats?.deletions ?? 0)
    const weight = attentionOf({ kind: node.kind, bucket, change: node.change, size, ...(node.status ? { status: node.status } : {}), rated: facts })
    return { node, bucket, size, ...weight }
  })
  const ranks = rankAttention(weighed.map(({ node, tier, strength, size }) => ({ id: node.id, tier, strength, size })))
  return weighed.map(({ node, bucket, tier, reasons }) => ({ ...node, bucket, attention: { tier, rank: ranks.get(node.id)!, reasons } }))
}

/** The review the host would have prepared, under the id it was opened by. */
export function pullReview(id: string): Review {
  const positions = layoutReview(NODES, EDGES)
  const nodes = rated(NODES).map((node) => ({ ...node, position: positions[node.id]! }))
  const files = filesOf()
  const changed = files.filter((file) => file.status !== 'unchanged')
  return {
    version: 1,
    id,
    change: {
      project: 'hobkin-sample/storefront',
      item: '#482',
      title: TITLE,
      branch: 'mira/user-tags-and-errors',
      base: BASE,
      head: HEAD,
      additions: changed.reduce((sum, file) => sum + file.additions, 0),
      deletions: changed.reduce((sum, file) => sum + file.deletions, 0),
      files: changed.length,
      description: 'Handles like @dev-ops and @j.doe did not link. Now they do, with one query for all of a post\'s tags.\n\nAlso adds script/production_errors.rb, which prints the errors production raised in the last day.',
    },
    snapshot: sha256(PULL_FILES.map((file) => `${file.path}\n${file.head ?? ''}`).join('\n')),
    spec: null,
    files,
    nodes,
    edges: EDGES,
    story: storyOf(nodes),
    summary: 'Post bodies link @handles with dots and dashes, after one lookup for each post. A new script prints the errors production raised, most frequent first.',
    notices: [NO_SPEC_NOTICE],
  }
}

/** Both sides of every file, as the code panel reads them. */
export function pullFiles(): ReviewFileContents[] {
  return PULL_FILES.map((file) => ({ fileId: file.path, path: file.path, base: file.base, head: file.head, binary: false }))
}

const fact = <Value extends string>(value: Value, evidence: string) => ({ value, evidence })
const linesOf = (draft: Draft): [number, number] => {
  const head = draft.ranges.find((range) => range.side === 'added')!
  return [head.startLine, head.endLine]
}
const codeShown = (draft: Draft, why: string) => {
  const head = draft.ranges.find((range) => range.side === 'added')!
  const text = splitLines(sideText(fileOf.get(draft.path)!, 'added')).slice(head.startLine - 1, head.endLine)
  return { path: draft.path, lines: linesOf(draft), why, diff: text.map((line) => `+${line}`).join('\n') }
}

const UNITS: Unit[] = [
  {
    id: 'u1',
    title: 'link_user_tags now links handles with dots and dashes, on every post page',
    level: 'high',
    critical: false,
    nodes: ['n1'],
    grouping: 'single',
    story_order: 1,
    where: 'On the way of every post page and the RSS feed: PostsController#show and FeedsController#index call render_body, which calls it.',
    what: 'The tag pattern now takes dots and dashes, so @dev-ops and @j.doe link. Every user a post names is found with one query instead of one for each tag. A tag inside a code span is left as written.',
    code: [codeShown(CODE[0]!, 'the changed method')],
    facts: {
      effect: fact('behaviour', 'the tag pattern and the user lookup changed'),
      proof: fact('isolated', 'five helper tests call link_user_tags directly, and three fail with the change undone; no request test renders a post'),
      exposure: fact('everyone', 'every post page and the RSS feed render bodies through it'),
      undo: fact('rollback', 'no flag guards it'),
    },
    why_level: ['It runs for every reader of every post, and for the feed.', 'Only helper tests prove it. No request renders a post with tags.', 'Undoing it takes a rollback.'],
    would_change: [{ text: 'A request test that renders a post with tags in its text and inside code', level: 'mid' }],
    watch: {
      signals: [{ kind: 'error-report', name: 'ActionView::Template::Error', at: 'app/views/posts/show.html.erb:12' }],
      gaps: ['Nothing counts tags that fail to link, so a pattern that stopped matching would go unseen.'],
      undo: 'Revert the merge and deploy.',
    },
    questions: [
      {
        text: 'A tag that ends a sentence, like "Thanks @mira.", now takes the period into the handle and does not link. Is that wanted?',
        why: 'The pattern [\\w.-]+ ends on any dot, and no test puts a tag at the end of a sentence.',
        changes: 'If not, the pattern should end on a letter or a digit, and a test should cover it.',
      },
    ],
    reading_minutes: 4,
  },
  {
    id: 'u2',
    title: 'The new script reads the production monitor with a token from the environment',
    level: 'mid',
    critical: false,
    nodes: ['n2'],
    grouping: 'single',
    story_order: 2,
    where: 'A script a developer runs by hand. Nothing in the app calls it.',
    what: 'fetch_errors asks the monitor for the errors since a time, with the token in ERRORS_TOKEN. It stops with the monitor\'s status when the answer is not 200, and never tries again after a timeout.',
    code: [codeShown(CODE[1]!, 'the new request')],
    facts: {
      effect: fact('behaviour', 'a new request to ERRORS_URL with a production token'),
      proof: fact('mocked', 'six tests stub the monitor with stub_monitor; one of them fails'),
      exposure: fact('nobody-yet', 'only someone who runs the script'),
      undo: fact('rollback', 'remove the script'),
    },
    why_level: ['It holds a production token.', 'Its tests stub the monitor, and the timeout test fails.'],
    would_change: [{ text: 'The timeout test passing, with a recorded answer from the real monitor', level: 'safe' }],
    watch: { signals: [], gaps: ['The script says nothing when the monitor refuses the token, past its status.'] },
    questions: [],
    reading_minutes: 2,
  },
  {
    id: 'u3',
    title: 'The README says how to run production_errors.rb',
    level: 'safe',
    critical: false,
    nodes: ['n4'],
    grouping: 'single',
    story_order: 3,
    where: 'Documentation, read by developers.',
    what: 'A new section names the two settings the script needs and shows two runs.',
    code: [codeShown(FILES_ALONE[0]!, 'the new section')],
    facts: {
      effect: fact('text', 'prose only'),
      proof: fact('not-applicable', 'nothing runs a README'),
      exposure: fact('everyone', 'anyone who reads the README'),
      undo: fact('rollback', 'a text change'),
    },
    why_level: ['Text only: nothing runs it.'],
    would_change: [],
    watch: 'not assessed',
    questions: [],
    reading_minutes: 1,
  },
  {
    id: 'u4',
    title: 'The report prints one line per error message, most frequent first',
    level: 'safe',
    critical: false,
    nodes: ['n3', 'n5'],
    grouping: 'definition-with-helpers',
    story_order: 4,
    where: 'The end of the script: what it prints.',
    what: 'report groups the errors by message and prints how often each was raised and when last. truncate cuts a message longer than 72 characters, with an ellipsis.',
    code: [codeShown(CODE[2]!, 'the report and its helper')],
    facts: {
      effect: fact('behaviour', 'text the script prints'),
      proof: fact('isolated', 'seven tests call report; one is skipped'),
      exposure: fact('nobody-yet', 'only someone who runs the script'),
      undo: fact('rollback', 'remove the script'),
    },
    why_level: ['It only formats what the script prints.', 'Seven tests cover an empty log, the order and long messages.'],
    would_change: [],
    watch: 'not assessed',
    questions: [],
    members: [
      { node: 'n3', name: 'report', what: 'groups the errors by message and prints count, last time and message' },
      { name: 'truncate', what: 'cuts a message longer than 72 characters, with an ellipsis' },
    ],
    reading_minutes: 2,
  },
]

/** The change review that came with the sample: its summary, its story and its four units. */
export function pullAssessment(): ChangeAssessment {
  const count = (level: Level) => UNITS.filter((unit) => unit.level === level).length
  return {
    head: HEAD,
    summary: { level: 'high', critical: false, needsYou: count('high'), worthALook: count('mid'), safe: count('safe'), storyBy: 'model', at: RATED_AT },
    story: [
      `# ${TITLE}`,
      '',
      `**Does:** ${DOES}`,
      '',
      ...UNITS.map((unit) => `- **${LEVEL_WORDS[unit.level]}**: ${unit.title}`),
    ].join('\n'),
    units: { schema: 'review-units/1', map: 'node-level', attention: { units: UNITS.length, reading_minutes: UNITS.reduce((sum, unit) => sum + unit.reading_minutes, 0) }, units: UNITS },
    triage: null,
    blind: null,
    progress: null,
    nodes: [
      { id: 'n1', symbol: 'link_user_tags', path: HELPER, lines: linesOf(CODE[0]!), level: 'high', critical: false, unit: 'u1' },
      { id: 'n2', symbol: 'fetch_errors', path: SCRIPT, lines: linesOf(CODE[1]!), level: 'mid', critical: false, unit: 'u2' },
      { id: 'n3', symbol: 'report', path: SCRIPT, lines: linesOf(CODE[2]!), level: 'safe', critical: false, unit: 'u4' },
      { id: 'n4', symbol: 'README.md', path: 'README.md', lines: linesOf(FILES_ALONE[0]!), level: 'safe', critical: false, unit: 'u3' },
    ],
  }
}
