/**
 * The review file: one finished change described as a graph and a story.
 * See _specs/005-review-model/spec.md.
 *
 * Who owns what:
 * - The host owns every code range. Nodes, anchors, hashes, files and positions come from the bytes of the change.
 * - The model only arranges prepared ids and writes prose: summaries, step texts, extra wires and context it found.
 *   Everything it returns is checked, and a wire it proposed is marked `certainty: 'model'`.
 *
 * File contents are not stored here. The UI asks a `ReviewSource` for a file's two sides,
 * and each anchor carries a hash of its lines so stale bytes are refused on load.
 */
import type { ChangeAssessment } from './assessment.ts'

/** Columns of the graph, left to right: spec, tests, code (with files), context. */
export type NodeKind = 'criterion' | 'test' | 'code' | 'file' | 'context'

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'unchanged'

/**
 * `proven` and `unproven` belong to acceptance lines. The rest belong to tests: `proves-change` passed at head and failed
 * with the change undone, so it proves the change itself and not only that the code still runs.
 */
export type NodeStatus = 'proven' | 'unproven' | 'passed' | 'failed' | 'not-run' | 'proves-change'

/** How much a part of the change needs a reviewer, as the change review rates it (`packages/change-review`). */
export type ReviewLevel = 'safe' | 'mid' | 'high'

/**
 * How two nodes connect.
 *
 * A wire is stored in reading order, the order the columns run: `from` is the node on the left, whose right pin
 * the wire leaves, and `to` is the node on the right, whose left pin it enters. Read left to right, the graph says:
 * an acceptance line, the test that proves it, the code that test exercises, the code that code calls.
 * For `proves` and `implements` the verb belongs to the node on the right: the test proves the line,
 * and the code implements it. `called-by` reads the same way: changed code on the left is called by unchanged code
 * on the right, so a caller sits in the context column, and what calls that caller sits one further right, on the
 * way out to where a request enters. `WIRE_PHRASE` gives each kind in reading order.
 */
export type EdgeKind = 'proves' | 'exercises' | 'implements' | 'calls' | 'called-by' | 'uses' | 'renders' | 'imports' | 'configures' | 'replaces'

/** Which side of a file an anchor reads: `added` is the file at head, `deleted` the file at base. */
export type AnchorSide = 'added' | 'deleted'

/** A run of lines the host extracted. Lines are 1-based and inclusive. `hash` is the SHA-256 of their exact characters. */
export interface ReviewAnchor {
  fileId: string
  side: AnchorSide
  startLine: number
  endLine: number
  hash: string
}

/** How much of the reviewer's attention a node asks for (spec 053). `safe` nodes fold into groups on a large change. */
export type AttentionTier = 'needs-you' | 'worth-a-look' | 'safe'

/** What the reviewer is asked to do with a node, from what the change review found, once it has rated the change. */
export interface NodeAttention {
  tier: AttentionTier
  /** Its place among the review's nodes, from 1: the node to read first is 1. */
  rank: number
  /** Why, in plain words, the strongest first. At most three. Empty for a safe node with nothing to say. */
  reasons: string[]
}

/** What kind of change a node is, for folding the safe ones into groups: real code, or something read at a glance. */
export type NodeBucket = 'code' | 'test' | 'generated' | 'lockfile' | 'locale' | 'moved' | 'format' | 'docs'

export interface ReviewNode {
  /** `A1` for an acceptance line, `u1` for a unit of the change, `f1` for a file shown whole, `c1` for context. */
  id: string
  kind: NodeKind
  /** A symbol, a test name, an acceptance id or a file name. */
  title: string
  /** Where it lives: a repository path. */
  subtitle?: string
  change: ChangeKind
  /** Changed lines inside this node's anchors. */
  stats?: { additions: number; deletions: number }
  /** One line on what this node is or what changed in it. For an acceptance line, the line itself. */
  summary: string
  /**
   * What goes into this node and what comes out of it. The host reads the parameters and the return type from the
   * declaration, and the model's plain words replace them when it has some.
   */
  io?: NodeIO
  status?: NodeStatus
  /** For an acceptance line: its Proof line, as written. */
  proof?: string
  /** Why the node needs a second look: a missing Proof line, a Proof naming a test that does not exist. */
  warning?: string
  /** The change review's level for this node, once it has rated it. The card shows it. */
  level?: ReviewLevel
  /** The unit of the change review's story that tells this node, such as `u2`, once it has rated it. */
  unit?: string
  /** How much attention it asks for and why (spec 053). A review from an older host has none, and shows every node. */
  attention?: NodeAttention
  /** What kind of change it is (spec 053). Missing on a review from an older host. */
  bucket?: NodeBucket
  /**
   * Where it sits in the request's life cycle: for unchanged context the call-graph scan found, a caller or a callee; for
   * changed code, how far its entry is and the way a request takes to it.
   */
  lifecycle?: ReviewLifecycle
  /** Where a request enters the code, when this code or context node is such a place. */
  entry?: ReviewEntry
  /**
   * For a node nothing wires to the rest of the change: why, in a few words. The graph sets such nodes apart, in a
   * cluster of their own, with this reason.
   */
  unwired?: string
  /**
   * For a test helper: the ids of the tests that use it. A helper stays a test node, and no wire joins a test to a test,
   * so this is what ties it to them. The graph folds it in with those tests.
   */
  supports?: string[]
  anchors: ReviewAnchor[]
  /** Top left corner on the graph. A node's size comes from its kind, see `NODE_SIZE` in layout.ts. */
  position: { x: number; y: number }
}

/** How a node stands in the request's life cycle. */
export interface ReviewLifecycle {
  /**
   * For unchanged context, `caller`: it leads to the changed code, `hops` calls away; `callee`: the changed lines call it,
   * one call away. For changed code, `changed`: `hops` calls from the change out to its entry, 0 when the node is itself
   * the entry, such as a controller action its route reaches.
   */
  role: 'caller' | 'callee' | 'changed'
  hops: number
  /**
   * The way a request takes, in a line, such as "GET /users/:id → UsersController#show → full_name", or why none was
   * found, such as "No route reaches it within 4 calls". Optional for context.
   */
  path?: string
}

/**
 * Where a request enters, as the scan knows it: a route that sends requests on (`route`, with its verbs and path), the
 * app's answer to a request that failed (`exceptions-app`), what the framework calls (`controller`, a public action;
 * `job`, a job's perform; `command`, a command's run), or a statement that runs as its file loads (`load`). `exact` when
 * a route or a declaration says so.
 */
export interface ReviewEntry {
  /** `route`, `exceptions-app`, `controller`, `job`, `command`, `load`, or another kind the scan names. */
  kind: string
  exact: boolean
  /** For a `route`: the verbs it answers and its path, as the routes file says them, such as GET and `/users/:id`. */
  route?: { verbs: string[]; path: string }
}

/** What goes in and what comes out, in a few words each. Either may be empty. */
export interface NodeIO {
  in: string
  out: string
}

export interface ReviewEdge {
  id: string
  /** The node on the left. */
  from: string
  /** The node on the right. */
  to: string
  kind: EdgeKind
  /** A few words on this one connection, such as "reads snapshot.doing". */
  label?: string
  /** `host` when derived from the code, `model` when proposed. A proposed wire is drawn dashed until confirmed. */
  certainty: 'host' | 'model'
}

/** `outcome` opens the story and `closing` ends it. Both frame the whole graph. `walk` steps focus nodes. */
export type StepKind = 'outcome' | 'walk' | 'closing'

export interface StoryStep {
  id: string
  kind: StepKind
  title: string
  /** The teaching text. For `outcome` this is the spec's outcome. */
  text: string
  /** One to three node ids for a `walk` step. Empty for `outcome` and `closing`. */
  focus: string[]
  /** The wire the camera rides in on, when this step's focus connects to the previous step's. */
  travel?: string
  /** Acceptance ids this step serves, such as `A1`. */
  criteria: string[]
  /** The spec step this one belongs to, such as `S2`. */
  specStep?: string
  /** The path this step walks, such as `p1`. */
  path?: string
  /** The change review's level for what this step shows, once it has rated it. */
  level?: ReviewLevel
  /**
   * The change review's unit this step tells (`u1`, `u2`...), once a change review is ready. Its claim, what changed,
   * why it is rated as it is, its questions and what to watch are in the assessment's units, under this id.
   */
  unit?: string
}

/**
 * How one piece of functionality goes through the code, starting from the test that proves it: the test, then each
 * node it reaches along the wires, depth first, the way a request travels. Every hop after the first is wired to an
 * earlier one. Computed by the host from the wires, never written by the model.
 */
export interface ReviewPath {
  id: string
  test: string
  hops: string[]
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged'

/** A file the review refers to. Its contents come from the `ReviewSource`. */
export interface ReviewFile {
  id: string
  /** Path at head, or at base for a deleted file. */
  path: string
  /** Path at base, when the file was renamed. */
  oldPath?: string
  /** `unchanged` files are here because a context node or a pre-existing test points into them. */
  status: FileStatus
  binary: boolean
  additions: number
  deletions: number
  /** Over the size limits: shown as one `file` node without units. */
  summarized: boolean
}

export interface ReviewChange {
  project: string
  item: string
  title: string
  branch: string
  base: string
  head: string
  additions: number
  deletions: number
  files: number
  /** The risk the item named, if any. Shown in the closing step. */
  risk?: string
  /** A pull request's description, as its author wrote it on GitHub. Empty when it has none, missing for a hobkin change. */
  description?: string
}

export interface ReviewSpec {
  path: string
  outcome: string
  outOfScope: string[]
  openQuestions: string[]
}

export interface Review {
  version: 1
  id: string
  change: ReviewChange
  /** Fingerprint of the captured bytes of every changed file. */
  snapshot: string
  /** Null when the change has no spec. `notices` then says so. */
  spec: ReviewSpec | null
  files: ReviewFile[]
  nodes: ReviewNode[]
  edges: ReviewEdge[]
  story: StoryStep[]
  /** The tests' paths, test first. Missing in reviews prepared before paths existed. */
  paths?: ReviewPath[]
  summary: string
  /** Plain statements about the review itself: "This change has no spec.", "12 files are summarized." */
  notices: string[]
}

/** Both sides of one file, as the code panel needs them. A side is null when the file does not exist there. */
export interface ReviewFileContents {
  fileId: string
  path: string
  oldPath?: string
  base: string | null
  head: string | null
  binary: boolean
}

/** Where the UI gets a review and its files. A sample implementation now, the host later. */
export interface ReviewSource {
  getReview(id: string): Promise<Review>
  getFile(reviewId: string, fileId: string): Promise<ReviewFileContents>
  /** The finished change review a sample comes with, so a window with no host shows its units too. Null when it has none. */
  getAssessment?(id: string): Promise<ChangeAssessment | null>
}

export const NODE_KINDS = ['criterion', 'test', 'code', 'file', 'context'] as const satisfies readonly NodeKind[]

export const EDGE_KINDS = [
  'proves',
  'exercises',
  'implements',
  'calls',
  'called-by',
  'uses',
  'renders',
  'imports',
  'configures',
  'replaces',
] as const satisfies readonly EdgeKind[]

/** Each wire kind in reading order, from the node on the left to the node on the right. */
export const WIRE_PHRASE: Record<EdgeKind, string> = {
  proves: 'is proven by',
  exercises: 'exercises',
  implements: 'is carried by',
  calls: 'calls',
  'called-by': 'is called by',
  uses: 'uses',
  renders: 'renders',
  imports: 'imports',
  configures: 'configures',
  replaces: 'replaces',
}

/**
 * Which kinds a wire may join, left to right. A wire outside this table is impossible:
 * a test wired to a test, context that calls changed code, an acceptance line proven by code.
 */
export const WIRE_RULES: Record<EdgeKind, { from: readonly NodeKind[]; to: readonly NodeKind[] }> = {
  proves: { from: ['criterion'], to: ['test'] },
  implements: { from: ['criterion'], to: ['code', 'file'] },
  exercises: { from: ['test'], to: ['code', 'file', 'context'] },
  calls: { from: ['code'], to: ['code', 'context'] },
  // A caller further out calls a caller nearer the change, so context can be called by context.
  'called-by': { from: ['code', 'context'], to: ['context'] },
  uses: { from: ['code', 'file'], to: ['code', 'file', 'context'] },
  renders: { from: ['code'], to: ['code', 'context'] },
  imports: { from: ['code', 'file'], to: ['code', 'file', 'context'] },
  configures: { from: ['file'], to: ['code', 'file', 'context'] },
  replaces: { from: ['code', 'file'], to: ['code', 'file', 'context'] },
}

/** Model prose is display text. These are the most characters each kind may have. */
export const PROSE_LIMIT = { title: 80, stepText: 600, summary: 200, label: 60, io: 160 } as const

/** A change larger than this keeps its first files in detail and summarizes the rest as `file` nodes. */
export const SIZE_LIMIT = { files: 60, changedLines: 4000 } as const

/** Text taken from a spec or written by the host is kept within reason, not capped like model prose. */
export const HOST_TEXT_LIMIT = 2000

/** A node's title is a symbol or a test name the host read from the code, so it has room to be long. */
export const TITLE_LIMIT = 300

/** The most nodes one walk step may focus. */
export const MAX_FOCUS = 3

/** What a review says when its change has no spec. */
export const NO_SPEC_NOTICE = 'This change has no spec.'
