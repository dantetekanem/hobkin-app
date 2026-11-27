/**
 * hobkin's routine templates as the Routines screen offers them (010-routines): hobkin's own and the user's own, one
 * per name, the user's winning, as `listTemplates` in hobkin's `src/cli/routine-templates.mjs` reads them. Where a
 * template lives on this Mac stays in the host.
 */

export interface RoutineTemplateRow {
  id: string
  version: number
  /** hobkin's own, or one in the user's routines/templates folder. */
  source: 'hobkin' | 'yours'
  title: string
  summary: string
  recurrence: string
  /** The goals it serves, the best first (044-goal-first-setup). Empty when it names none. */
  goals: string[]
  /** Who it fits. */
  fits: string
  needs: string[]
  effort: 'low' | 'medium' | 'high'
  /** The template's own question, for what it needs to know. */
  asks: string | null
}

export interface RoutineTemplatesList {
  templates: RoutineTemplateRow[]
}
