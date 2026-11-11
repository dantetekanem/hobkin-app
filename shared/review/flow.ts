/**
 * The tests' paths: how each piece of functionality goes through the code, starting from its test. A path follows
 * the wires that lead inward, depth first, the way a request travels: the test, the code it exercises, what that
 * code calls, and so on. It stops at a node already on it. Reviews open on these, tests first.
 */
import type { EdgeKind, ReviewEdge, ReviewNode, ReviewPath } from './types.ts'

/** Wires a request travels along. `proves` and `implements` come from the spec, and `called-by` leads back out. */
const INWARD: ReadonlySet<EdgeKind> = new Set(['exercises', 'calls', 'uses', 'renders', 'imports', 'configures', 'replaces'])

/** The most hops one path takes, so a large change keeps its paths readable. */
export const MAX_HOPS = 24

export function testPaths(nodes: readonly Pick<ReviewNode, 'id' | 'kind'>[], edges: readonly Pick<ReviewEdge, 'from' | 'to' | 'kind'>[]): ReviewPath[] {
  const leaving = new Map<string, string[]>()
  for (const edge of edges) {
    if (!INWARD.has(edge.kind)) continue
    leaving.set(edge.from, [...(leaving.get(edge.from) ?? []), edge.to])
  }
  return nodes
    .filter((node) => node.kind === 'test')
    .map((test, index) => {
      const hops: string[] = []
      const visit = (id: string) => {
        if (hops.length >= MAX_HOPS || hops.includes(id)) return
        hops.push(id)
        for (const next of leaving.get(id) ?? []) visit(next)
      }
      visit(test.id)
      return { id: `p${index + 1}`, test: test.id, hops }
    })
}
