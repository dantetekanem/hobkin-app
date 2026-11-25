type Receipt = { path: string; name: string; status: 'passed' | 'failed' | 'skipped'; line?: number }

/** A suite the scan names around a case: `describe "cart" ` or `describe "cart".`, each suite of a nest in turn. */
const SUITE = /^(?:describe|context|suite) "([^"\n]+)"([ .])/

/**
 * The case's result in a run, when the runner gave it its own: by its file and its name, and inside the test's lines
 * when the runner says where the case is. Scan symbols use `describe "cart" describe "empty".case`; runners print
 * `cart > empty > case`. Never match just the leaf of a suite or expand a parameterized template.
 */
export function caseOutcome(run: { cases?: readonly Receipt[]; not_run?: string }, path: string, symbol?: string, lines?: readonly [number, number]): Receipt['status'] | undefined {
  if (!symbol || run.not_run || !run.cases?.length) return undefined
  let name = symbol
  let nested = false
  const suites: string[] = []
  for (let suite; (suite = SUITE.exec(name)); ) {
    suites.push(suite[1]!)
    name = name.slice(suite[0].length)
    nested = suite[2] === ' '
  }
  // A suite named with no case after it is not a case.
  if (nested) return undefined
  const fullName = [...suites, name].join(' > ')
  const placed = (receipt: Receipt) => receipt.line === undefined || !lines || (lines[0] <= receipt.line && receipt.line <= lines[1])
  const matches = run.cases.filter((receipt) => receipt.path === path && receipt.name === fullName && placed(receipt))
  return matches.length === 1 ? matches[0]!.status : undefined
}
