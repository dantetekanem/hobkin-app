/**
 * The TLC checks a change review is given (050-tla-proofs in Change Review): hobkin's own runs, at the reviewed head, of
 * each TLA+ model the change adds, edits or touches a file of. They are matched as work mode matches them (hobkin's
 * `modelFacts`): that commit, the spec as committed there, and a run that broke before one that held. A run belongs to
 * a project, so only a hobkin change has them. The host only reads the runs; it starts none.
 */
import { modelFacts, modelsAt, readRuns, type StoredProofRun } from 'hobkin/src/cli/work/proofs.mjs'
import type { ModelCheck } from '../../../packages/change-review/src/types.ts'
import { gitIn, type AssessRequest, type GitRun } from './assessment.ts'

const RESULTS: Partial<Record<StoredProofRun['outcome'], ModelCheck['result']>> = { holds: 'holds', broken: 'violated', error: 'error' }

/** A run as the review reads it. Null for one that says nothing, such as a check that was stopped. */
function checkOf(run: StoredProofRun, models: string[]): ModelCheck | null {
  const result = RESULTS[run.outcome]
  if (!result) return null
  const steps = run.traceLength ? run.traceLength - 1 : undefined
  return {
    spec: run.spec,
    run: run.id,
    result,
    states: run.stats?.distinct ?? 0,
    rules: (run.rules ?? []).map(({ name, kind, status, words }) => ({ name, kind, held: status === 'holds', ...(words ? { words } : {}) })),
    unfired: (run.actions ?? []).filter((action) => !((action.count ?? 0) > 0)).map((action) => action.name),
    models,
    ...(result === 'violated' ? { broken: run.broken ?? 'a rule', ...(steps ? { steps } : {}) } : {}),
    ...(result === 'error' && run.message ? { message: run.message } : {}),
  }
}

/** What hobkin's runs say at `head` of the models the change from `base` adds, edits or touches a file of. */
export async function modelChecksAt({ data, slug, repo, base, head, git = gitIn }: { data: string; slug: string; repo: string; base: string; head: string; git?: GitRun }): Promise<ModelCheck[]> {
  // A run records the whole commit it checked.
  const at = await git(repo, 'rev-parse', '--verify', `${head}^{commit}`)
  const changed = (await git(repo, 'diff', '--name-only', base, at)).split('\n').filter(Boolean)
  const specs = await modelsAt(repo, at, changed)
  if (!specs.length) return []
  const runs = readRuns(data)
  return modelFacts(runs, { slug, head: at, specs }).flatMap((fact) => {
    const run = fact.run ? runs.find((entry) => entry.id === fact.run) : undefined
    const check = run ? checkOf(run, specs.find((spec) => spec.spec === fact.spec)?.covers ?? []) : null
    return check ? [check] : []
  })
}

/**
 * The checks one review is given: a hobkin change's, read from hobkin's home. None for a pull request, and none when
 * they cannot be read, which is logged: the review then goes on as a review of a change with no TLA+ model does.
 */
export async function reviewModelChecks(
  { target, cwd, base, head }: Pick<AssessRequest, 'target' | 'cwd' | 'base' | 'head'>,
  { data, log }: { data: () => string; log?: (line: string) => void },
): Promise<ModelCheck[]> {
  if (target.kind !== 'change') return []
  try {
    return await modelChecksAt({ data: data(), slug: target.slug, repo: cwd, base, head })
  } catch (error) {
    log?.(`Change review at ${head.slice(0, 7)}: its model checks could not be read, so the Reviewer goes without them: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}
