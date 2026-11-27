declare module 'hobkin/src/cli/routine-templates.mjs' {
  type Goal = 'job' | 'business' | 'project' | 'life' | 'code'
  type Gift = 'report' | 'action' | 'critical' | 'follow-up'

  /** One template as hobkin reads it. A part the template leaves out is null or empty. */
  export interface Template {
    id: string
    title: string
    summary: string
    recurrence: string
    goals: Goal[]
    needs: string[]
    effort: 'low' | 'medium' | 'high'
    fits: string
    tells: string | null
    skips: string | null
    gives: Gift[]
    closes: string | null
    private: boolean
    asks: string | null
    version: number
    file: string
    source: 'hobkin' | 'yours'
  }

  export type TemplateCard = Omit<Template, 'goals' | 'fits' | 'file'>

  export const TEMPLATE_GOALS: readonly Goal[]
  export const TEMPLATE_GIVES: readonly Gift[]
  export function listTemplates(root: string): { rules: string; templates: Template[]; errors: { file: string; message: string }[] }
  export function goalCards(root: string, goals: readonly string[]): { goal: Goal; starters: TemplateCard[]; more: TemplateCard[] }[]
}
