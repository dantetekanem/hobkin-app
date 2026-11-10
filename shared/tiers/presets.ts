/**
 * The first tiers for a provider, as the first-run setup proposes them. See _specs/025-onboarding.
 *
 * Built the way Pi starts a provider. Pi keeps one default model per provider (`defaultModelPerProvider` in
 * pi-coding-agent's `dist/core/model-resolver.js`), switches to it after a sign-in
 * (`dist/modes/interactive/interactive-mode.js`, after the login finishes), and starts it at its default thinking
 * level, medium (`DEFAULT_THINKING_LEVEL` in `dist/core/defaults.js`). With no default for the provider it takes the
 * first model it lists (`findInitialModel` in the same resolver). The host sends that default with each provider.
 *
 * hobkin and the four tiers all start on that model. The tiers differ in how hard it thinks: fast low, mid medium,
 * high high, max the most the model allows (xhigh at most, the strongest level hobkin takes), each moved to the
 * nearest level the model has. A model that cannot think runs every tier with thinking off. Pure rules only.
 */
import { EFFORTS, clampEffort, type Effort, type ModelChoice, type TierSetting, type TiersConfig } from './tiers.ts'

export interface PresetProvider {
  /** Pi's id for the provider, such as `openai`. */
  id: string
  /** Its name, as `choicesFromPi` labels its models. */
  name: string
  /** Pi's default model id for the provider, as the models slice sends it. */
  defaultModel?: string
}

export interface Preset {
  config: TiersConfig
  /** The model hobkin and every tier start on. */
  model: ModelChoice
  /** `pi`: Pi's own default for the provider. `first`: no default Pi can use now, so the first model Pi lists that thinks. */
  source: 'pi' | 'first'
}

/** The provider's own models, in the order Pi lists them. */
export function providerChoices(choices: readonly ModelChoice[], provider: PresetProvider): ModelChoice[] {
  return choices.filter((choice) => choice.provider === provider.name)
}

/**
 * Whether the choice is the model Pi calls `id` within the provider. `choicesFromPi` names a model `provider/id`,
 * and an id that has a slash in it already is matched as it stands too.
 */
function isNamed(choice: ModelChoice, provider: PresetProvider, id: string): boolean {
  return choice.id === `${provider.id}/${id}` || choice.id === id
}

/** Pi lists "off" for a model that cannot think, so thinking means a level above it. */
function thinks(model: ModelChoice): boolean {
  return model.efforts.some((effort) => effort !== 'off')
}

const MOST_THINKING = EFFORTS[EFFORTS.length - 1]

/** The most the model allows: off for a model that cannot think. One that names no levels at all is asked for the most there is. */
function strongest(model: ModelChoice): Effort {
  return EFFORTS.toReversed().find((effort) => model.efforts.includes(effort)) ?? MOST_THINKING
}

/** The tiers for a provider, from the models Pi can use now. Null when Pi can use none of the provider's models. */
export function presetFor(choices: readonly ModelChoice[], provider: PresetProvider): Preset | null {
  const own = providerChoices(choices, provider)
  const { defaultModel } = provider
  const piModel = defaultModel === undefined ? undefined : own.find((choice) => isNamed(choice, provider, defaultModel))
  const model = piModel ?? own.find(thinks) ?? own[0]
  if (!model) return null

  const thinking = (effort: Effort): TierSetting => ({ model: model.id, effort: clampEffort(model, effort) })

  return {
    config: {
      lead: thinking('medium'),
      tiers: {
        fast: thinking('low'),
        mid: thinking('medium'),
        high: thinking('high'),
        max: thinking(strongest(model)),
      },
    },
    model,
    source: piModel ? 'pi' : 'first',
  }
}
