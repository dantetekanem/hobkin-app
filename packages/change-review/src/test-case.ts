type Receipt = { path: string; name: string; status: 'passed' | 'failed' | 'skipped'; line?: number }

/** A suite the scan names around a case: `describe "cart" ` or `describe "cart".`, each suite of a nest in turn. */
const SUITE = /^(?:describe|context|suite) "([^"\n]+)"([ .])/
/** A Rails test as the scan names it: its class, then `test "words"`. */
const RAILS_TEST = /^([A-Z]\w*(?:::[A-Z]\w*)*) test "(.*)"$/

/** The name a script runner prints for a case the scan names in suites: `cart > empty > case`. Undefined for a suite with no case. */
function suitedName(symbol: string): string | undefined {
  let name = symbol
  let nested = false
  const suites: string[] = []
  for (let suite; (suite = SUITE.exec(name)); ) {
    suites.push(suite[1]!)
    name = name.slice(suite[0].length)
    nested = suite[2] === ' '
  }
  return nested ? undefined : [...suites, name].join(' > ')
}

/** The name Minitest prints for a Rails test: Rails defines `test "has no total"` as `test_has_no_total`, each run of spaces one `_`. */
function minitestName(symbol: string): string | undefined {
  const test = RAILS_TEST.exec(symbol)
  return test ? `${test[1]}#test_${test[2]!.replace(/[ \t\r\n\f\v]+/g, '_')}` : undefined
}

/**
 * The case's result in a run, when the runner gave it its own: by its file and its name, and inside the test's lines
 * when the runner says where the case is. Scan symbols use `describe "cart" describe "empty".case` and
 * `CartTest test "words"`; runners print `cart > empty > case` and `CartTest#test_words`, and a `def test_words` is
 * named as Minitest names it. Never match just the leaf of a suite or expand a parameterized template.
 */
export function caseOutcome(run: { cases?: readonly Receipt[]; not_run?: string }, path: string, symbol?: string, lines?: readonly [number, number]): Receipt['status'] | undefined {
  if (!symbol || run.not_run || !run.cases?.length) return undefined
  const name = minitestName(symbol) ?? suitedName(symbol)
  if (name === undefined) return undefined
  const placed = (receipt: Receipt) => receipt.line === undefined || !lines || (lines[0] <= receipt.line && receipt.line <= lines[1])
  const matches = run.cases.filter((receipt) => receipt.path === path && receipt.name === name && placed(receipt))
  return matches.length === 1 ? matches[0]!.status : undefined
}
