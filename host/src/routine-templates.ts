import { listTemplates } from 'hobkin/src/cli/routine-templates.mjs'
import type { RoutineTemplateRow } from '#shared/protocol/routine-templates.ts'
import type { HostHandlers } from './commands.ts'

/**
 * The templates the Routines screen offers (010-routines), read by hobkin's own `listTemplates`: hobkin's and the
 * user's own, one per name. A template that cannot be read is left out, as setup leaves it out. It only reads.
 */
export function routineTemplateHandlers({ root }: { root: () => string }): Pick<HostHandlers, 'routine.templates'> {
  return {
    'routine.templates': () => {
      const { templates } = listTemplates(root())
      return {
        templates: templates.map(
          ({ id, version, source, title, summary, recurrence, goals, fits, needs, effort, asks }): RoutineTemplateRow => ({
            id,
            version,
            source,
            title,
            summary,
            recurrence,
            goals,
            fits,
            needs,
            effort,
            asks,
          }),
        ),
      }
    },
  }
}
