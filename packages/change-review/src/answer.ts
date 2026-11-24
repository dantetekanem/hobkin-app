/**
 * The one question a review answers for the reviewer: is this change risky or safe to deploy? (FOUNDATION section 5.)
 * The answer is for the whole change, never for a node. It is risky when a part of it is `high`, which the rules give
 * only to a break that is shown or named, an effect nothing undoes, or a changed contract nothing shows working.
 * Everything else is safe to deploy, and what no test showed is said beside the answer, not turned into a risk.
 */
import { heldModels } from './model-checks.ts'
import { modelCheckWords, modelsOf } from './tla.ts'
import type { ModelCheck, Unit } from './types.ts'

export type Deploy = 'risky' | 'safe'

export interface DeployAnswer {
  deploy: Deploy
  /** Why, in a sentence or two: what breaks, or what was and was not shown. */
  why: string
}

export const DEPLOY_WORDS: Record<Deploy, string> = { risky: 'Risky to deploy', safe: 'Safe to deploy' }

const sentence = (text: string) => {
  const said = text.trim()
  return /[.!?]$/.test(said) ? said : `${said}.`
}
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** The Reviewer's sentence without the answer it opens with, when that answer is the one the levels give. Null otherwise. */
function saidFor(deploy: Deploy, said: string | undefined): string | null {
  const opened = /^\s*(risky|safe)\s+to\s+deploy\b[\s:.,;—-]*/i.exec(said ?? '')
  if (!opened || opened[1]!.toLowerCase() !== deploy) return null
  const rest = said!.slice(opened[0].length).trim()
  return rest ? sentence(capital(rest)) : null
}

/**
 * A change of only TLA+ models and their configs: nothing of it runs in production, so it is safe to deploy whatever
 * the levels say. What it says is whether each model's check holds, fails and must pass, or was not run.
 */
function modelsAnswer(models: readonly string[], checks: readonly ModelCheck[]): DeployAnswer {
  const said = modelsOf(models).map((spec) => modelCheckWords(spec, checks.find((check) => check.spec === spec)))
  return { deploy: 'safe', why: ['It changes only TLA+ models, and nothing of it runs in production.', ...said].join(' ') }
}

/**
 * The answer for a change, from its units. `said` is the Reviewer's own answer in words: it is used as the reason when
 * it opens with the same answer the levels give, and dropped when it does not, since a model's sentence never decides.
 * A risky answer names the TLA+ models (`checks`) that hold at this commit, and says that holding lowers no break.
 * `only` is given for a change of only TLA+ models and their configs, which is never risky to deploy.
 */
export function deployAnswer(
  units: readonly (Pick<Unit, 'level' | 'title' | 'critical'> & Partial<Pick<Unit, 'nodes'>>)[],
  said?: string,
  checks: readonly ModelCheck[] = [],
  only?: { models: readonly string[] },
): DeployAnswer {
  if (only) return modelsAnswer(only.models, checks)
  const high = units.filter((unit) => unit.level === 'high')
  const deploy: Deploy = high.length ? 'risky' : 'safe'
  const held = high.length ? heldModels(checks) : null
  const own = saidFor(deploy, said)
  if (own) return { deploy, why: held ? `${own} ${held}` : own }
  if (high.length) {
    const first = high.find((unit) => unit.critical) ?? high[0]!
    const more = high.length - 1
    return { deploy, why: [`${sentence(first.title)}${more ? ` ${more} more part${more === 1 ? '' : 's'} can break.` : ''}`, held].filter(Boolean).join(' ') }
  }
  const look = units.filter((unit) => unit.level === 'mid')
  // One thing worth a look is named. Several are counted: files a test does not apply to are among them, so the
  // count says only that they are worth a look, and each says why in its own words.
  if (look.length === 1 && look[0]!.nodes?.length === 0) return { deploy, why: `Nothing found that breaks. Worth a look: ${sentence(look[0]!.title)}` }
  const untested = look.filter((unit) => unit.nodes === undefined || unit.nodes.length > 0).length
  const others = look.length - untested
  const worth = [
    untested ? `${untested} part${untested === 1 ? ' was' : 's were'} not shown working by a test that ran.` : '',
    others ? `${others} other change${others === 1 ? ' is' : 's are'} worth a look.` : '',
  ].filter(Boolean)
  if (look.length) return { deploy, why: `Nothing found that breaks. ${worth.join(' ')}` }
  return { deploy, why: units.length ? 'Every part is shown to work, or cannot break anything.' : 'Nothing that runs changed.' }
}
