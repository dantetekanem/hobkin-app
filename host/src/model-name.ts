import type { ModelChoice } from '#shared/protocol/models.ts'

/** How many matches are named when a short model name fits several. */
const LISTED = 5

/**
 * The one model Pi can use now that a name stands for: a full `provider/id` first, then an exact id, then a part of an
 * id or name. When several fit, up to five are listed back so the user can say which.
 */
export function resolveModel(models: readonly ModelChoice[], asked: string): { model: string } | { problem: string } {
  const name = asked.trim().toLowerCase()
  const full = (choice: ModelChoice) => `${choice.provider}/${choice.id}`
  const stages: ((choice: ModelChoice) => boolean)[] = [
    (choice) => full(choice).toLowerCase() === name,
    (choice) => choice.id.toLowerCase() === name,
    (choice) => choice.id.toLowerCase().includes(name) || choice.name.toLowerCase().includes(name),
  ]
  for (const matches of stages) {
    const found = models.filter(matches)
    if (found.length === 1) return { model: full(found[0]!) }
    if (found.length > 1) {
      const listed = found.slice(0, LISTED).map(full).join(', ')
      const more = found.length > LISTED ? ` and ${found.length - LISTED} more` : ''
      return { problem: `Several models match "${asked.trim()}": ${listed}${more}. Say which, as provider/model.` }
    }
  }
  return { problem: `Pi can use no model that matches "${asked.trim()}".` }
}

/**
 * What a change from the message box asks of Pi, checked against the models Pi can use now: a short model name made
 * full, and the level one the model offers, the model's being the one named or else the one it works on now (`current`).
 */
export function changeFrom(
  models: { models: readonly ModelChoice[] } | null,
  asked: { model?: string; effort?: string },
  current: string | null | undefined,
): { change: { model?: string; effort?: string } } | { problem: string } {
  let model: string | undefined
  if (asked.model !== undefined) {
    if (!models) return { problem: 'Pi has not listed its models yet. Try again in a moment.' }
    const found = resolveModel(models.models, asked.model)
    if ('problem' in found) return found
    model = found.model
  }
  const named = model ?? current
  const known = models?.models.find((choice) => `${choice.provider}/${choice.id}` === named)
  if (asked.effort !== undefined && known && !known.thinking.includes(asked.effort)) {
    return { problem: `${known.name} offers these thinking levels: ${known.thinking.join(', ')}.` }
  }
  return { change: { ...(model === undefined ? {} : { model }), ...(asked.effort === undefined ? {} : { effort: asked.effort }) } }
}
