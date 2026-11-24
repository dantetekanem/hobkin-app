import { readYoloNames, readYoloRules, type YoloChange, type YoloProject, type YoloRules, type YoloState } from '#shared/protocol/work.ts'

/** What the window asks of the runtime's setter (`setYoloRules` in hobkin's `yolo-rules.mjs`): the rules to set, and on one project, in `same`, the ones to hand back to the rest. */
export type YoloRulesChange = Record<string, unknown> & { same?: string[] }

/** hobkin's setter of YOLO rules, when it has one. Looked up on the module, since an older hobkin has none. */
export interface YoloRulesRuntime {
  setYoloRules?: (root: string, slug: string | null, change: YoloRulesChange) => unknown
}

export const NO_YOLO_RULES = 'This hobkin has no YOLO rules to set yet. Update hobkin.'

/** The rules in force as the runtime answered a change: bare, as `setYoloRules` does, or under `rules`. Empty when it sent none. */
export function rulesAnswered(answer: unknown): YoloRules {
  const inside = (answer as { rules?: unknown } | null | undefined)?.rules
  return readYoloRules(inside) ?? readYoloRules(answer) ?? {}
}

const changeOf = (change: YoloChange): YoloChange => {
  const { holdBy, ...rest } = change
  return typeof holdBy === 'string' || holdBy === null ? { ...rest, holdBy } : rest
}

const projectOf = (project: YoloProject): YoloProject => {
  const { rules, overrides, changes, ...rest } = project
  const own = readYoloRules(rules)
  const names = readYoloNames(overrides)
  return {
    ...rest,
    ...(own ? { rules: own } : {}),
    ...(names ? { overrides: names } : {}),
    ...(Array.isArray(changes) ? { changes: changes.map(changeOf) } : {}),
  }
}

/**
 * YOLO mode as the window reads it. A runtime older than rules sends none, and then the window gets none: what it sent
 * of rules, of a project's own rules and of the setting that holds a change is kept only when it is in the shape the page shows.
 */
export function yoloFrom(sent: YoloState | null | undefined): YoloState | null {
  if (!sent) return null
  const { rules, projects, ...rest } = sent
  const all = readYoloRules(rules)
  return { ...rest, ...(all ? { rules: all } : {}), projects: Array.isArray(projects) ? projects.map(projectOf) : projects }
}
