/**
 * The vicinity of a change: the unchanged code around it, found by a static call-graph scan (agentic-search). What
 * the changed code calls becomes a context node wired with `calls`, and what calls the changed code one wired with
 * `called-by`. The host runs the scan and hands its links here as data. Each link is checked against the files at
 * head, and anything the change itself touched, or that is not there, is left out.
 */
import type { Capture } from './capture.ts'
import { hashLines, splitLines } from './lines.ts'
import { cleanProse, isSafePath } from './prose.ts'
import { TITLE_LIMIT, type EdgeKind, type ReviewFile, type ReviewNode } from './types.ts'

/** A definition, as 1-based first and last line in a file at head. */
export interface VicinityDefinition {
  path: string
  symbol: string
  startLine: number
  endLine: number
}

export interface VicinityLink {
  /** A line inside the changed definition, at head. */
  changed: { path: string; line: number }
  /** The definition on the other end. */
  other: VicinityDefinition
  /** `callee`: the changed code calls it. `caller`: it calls the changed code. */
  direction: 'callee' | 'caller'
}

export interface Vicinity {
  links: VicinityLink[]
  /** What the review should say about the scan: that it could not run, or how far it reached. */
  notice?: string
}

/** The most unchanged definitions a review shows around its change. Callees come first, in the scan's order. */
export const VICINITY_LIMIT = 16

export interface VicinityGraph {
  capture: Capture
  nodes: ReviewNode[]
  files: ReviewFile[]
  headFiles: Map<string, string>
  readHead(path: string): Promise<string | null>
  wire(kind: EdgeKind, from: string, to: string): void
}

/** Adds the scan's context nodes and wires to a draft. */
export async function addVicinity(vicinity: Vicinity, graph: VicinityGraph): Promise<void> {
  const { capture, nodes } = graph
  const fileByPath = new Map(capture.files.map((file) => [file.path, file]))
  const touches = (path: string, startLine: number, endLine: number) => {
    const file = fileByPath.get(path)
    return file != null && capture.changes.some((change) => change.fileId === file.id && change.side === 'added' && change.startLine <= endLine && startLine <= change.endLine)
  }
  /** The changed node that holds a line at head. */
  const holder = (path: string, line: number) => {
    const file = fileByPath.get(path)
    if (!file) return undefined
    return nodes.find((node) => node.kind === 'code' && node.anchors.some((anchor) => anchor.fileId === file.id && anchor.side === 'added' && anchor.startLine <= line && line <= anchor.endLine))
  }

  const made = new Map<string, string>()
  const ordered = [...vicinity.links.filter((link) => link.direction === 'callee'), ...vicinity.links.filter((link) => link.direction === 'caller')]
  for (const { changed, other, direction } of ordered) {
    const from = holder(changed.path, changed.line)
    if (!from || !isSafePath(other.path) || !(other.startLine >= 1 && other.endLine >= other.startLine)) continue
    if (touches(other.path, other.startLine, other.endLine)) continue

    const key = `${other.path}:${other.startLine}`
    let id = made.get(key)
    if (!id) {
      if (made.size >= VICINITY_LIMIT) continue
      const captured = fileByPath.get(other.path)
      const text = captured ? captured.head : (graph.headFiles.get(other.path) ?? (await graph.readHead(other.path)))
      if (text == null || splitLines(text).length < other.endLine) continue
      if (!captured && !graph.headFiles.has(other.path)) {
        graph.headFiles.set(other.path, text)
        graph.files.push({ id: other.path, path: other.path, status: 'unchanged', binary: false, additions: 0, deletions: 0, summarized: false })
      }
      id = `v${made.size + 1}`
      made.set(key, id)
      nodes.push({
        id,
        kind: 'context',
        title: cleanProse(other.symbol, TITLE_LIMIT) || other.path,
        subtitle: other.path,
        change: 'unchanged',
        summary: direction === 'callee' ? 'Unchanged. The change calls it.' : 'Unchanged. It calls the change.',
        anchors: [{ fileId: captured?.id ?? other.path, side: 'added', startLine: other.startLine, endLine: other.endLine, hash: hashLines(text, other.startLine, other.endLine) }],
        position: { x: 0, y: 0 },
      })
    }
    graph.wire(direction === 'callee' ? 'calls' : 'called-by', from.id, id)
  }
}
