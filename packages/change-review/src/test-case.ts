type Receipt = { path: string; name: string; status: 'passed' | 'failed' | 'skipped' }

/** Scan symbols use `describe "suite".case`; Bun prints `suite > case`. Never match just the leaf of a suite or expand a parameterized template. */
export function caseOutcome(run: { cases?: readonly Receipt[]; not_run?: string }, path: string, symbol?: string): Receipt['status'] | undefined {
  if (!symbol || run.not_run || !run.cases?.length) return undefined
  let name = symbol
  const suites: string[] = []
  for (let suite; (suite = /^describe "([^"\n]+)"\./.exec(name));) {
    suites.push(suite[1]!)
    name = name.slice(suite[0].length)
  }
  const fullName = [...suites, name].join(' > ')
  const matches = run.cases.filter((receipt) => receipt.path === path && receipt.name === fullName)
  return matches.length === 1 ? matches[0]!.status : undefined
}
