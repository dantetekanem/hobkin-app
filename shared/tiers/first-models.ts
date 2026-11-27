/**
 * hobkin's first model and tiers, picked from the account Pi reaches when the first-run setup finds or signs in to one,
 * so a new person's chat, routines and agents run without opening Settings. See _specs/017-model-tiers, "The first
 * models". Pure rules only, shared by the host and the window.
 *
 * One provider gives them all. hobkin supports OpenAI and Claude Code, and its agents need Pi, so a new person needs an
 * API key or the OpenAI subscription; Claude's subscription is used through Claude Code agents, not through Pi. With
 * several connected, the one picked is the first of: the OpenAI subscription, then a provider reached any other way
 * than a subscription's sign-in (a key, the environment, the cloud, a launcher), then the other subscriptions. Within
 * each, `PROVIDER_ORDER` first, then Pi's own order.
 *
 * Within it, everything starts on Pi's own default model for the provider, the one Pi switches to after a sign-in
 * (`defaultModelPerProvider` in pi-coding-agent's model resolver), or, with no default Pi can use, the first model Pi
 * lists that thinks. hobkin and mid think at medium, Pi's own starting level; high at high; max at the most that model
 * allows. Fast takes the cheapest model of the same kind (the id's first word, such as `gpt` or `claude`) that reaches
 * the default's strongest level and costs less by Pi's prices, at low; with none, the default at low. Every level moves
 * to the nearest one its model has.
 */
import type { ModelChoice as PiModel, ModelsState, ProviderAccess } from '../protocol/models.ts'
import { effortsOf, qualifiedId } from './from-pi.ts'
import { EFFORTS, clampEffort, type Effort, type TierId } from './tiers.ts'

/** Which providers come first among those connected the same way, in this order. The user can change it. */
export const PROVIDER_ORDER = ['openai-codex', 'openai'] as const

/** A model and thinking level, with the name Pi gives the model, for hobkin to say what it picked. */
export interface Picked {
  /** Pi's `provider/id`. */
  model: string
  name: string
  effort: Effort
}

export interface FirstPick {
  provider: { id: string; name: string }
  /** hobkin's own model, for the main chat. */
  lead: Picked
  tiers: Record<TierId, Picked>
}

/** What the host's `tiers.first` did: what it set, or why it set nothing (a model or tier was chosen before, or Pi reaches no model). */
export type FirstModels = ({ set: true } & FirstPick) | { set: false; why: 'chosen' | 'no-model' }

const bySubscription = ({ connectedBy, signIn }: ProviderAccess): boolean => connectedBy === 'sign-in' && signIn?.subscription === true

/** The OpenAI subscription first, then whatever is reached another way than a subscription, then the other subscriptions. */
function standing(provider: ProviderAccess): number {
  if (provider.id === 'openai-codex' || (provider.id === 'openai' && bySubscription(provider))) return 0
  return bySubscription(provider) ? 2 : 1
}

/** Where a provider stands in the written order. One it does not name comes after every one it does. */
function writtenPlace({ id }: ProviderAccess): number {
  const place = (PROVIDER_ORDER as readonly string[]).indexOf(id)
  return place === -1 ? PROVIDER_ORDER.length : place
}

/** A connected provider with the models Pi lists for it, in Pi's order, and where Pi lists the provider. */
interface Usable {
  provider: ProviderAccess
  piPlace: number
  own: [PiModel, ...PiModel[]]
}

const isUsable = (entry: Omit<Usable, 'own'> & { own: PiModel[] }): entry is Usable => entry.provider.connected && entry.own.length > 0

/** By standing, then the written order, then Pi's order. */
function byPreference(a: Usable, b: Usable): number {
  const stands = standing(a.provider) - standing(b.provider)
  if (stands !== 0) return stands

  const written = writtenPlace(a.provider) - writtenPlace(b.provider)
  if (written !== 0) return written

  return a.piPlace - b.piPlace
}

/** The connected provider the first models come from. Null when Pi can use none. */
function preferred({ providers, models }: ModelsState): Usable | null {
  const usable = providers
    .map((provider, piPlace) => ({ provider, piPlace, own: models.filter((model) => model.provider === provider.id) }))
    .filter(isUsable)

  return usable.sort(byPreference)[0] ?? null
}

/** Pi lists `off` for a model that cannot think, so thinking means a level above it. */
const thinks = (model: PiModel): boolean => effortsOf(model.thinking).some((effort) => effort !== 'off')

/** The most the model allows. One that lists no level Pi knows is asked for off, which Pi runs every model at. */
function strongest(model: PiModel): Effort {
  const offered = effortsOf(model.thinking)
  return EFFORTS.toReversed().find((effort) => offered.includes(effort)) ?? 'off'
}

/** A model's kind: its id's first word, such as `gpt`, `claude` or `moonshotai`. */
const kindOf = ({ id }: PiModel): string => id.split(/[-/]/)[0] ?? id

/** What a million tokens in and out cost by Pi's prices, or null when Pi knows none. */
const priceOf = ({ cost }: PiModel): number | null => (cost ? cost.input + cost.output : null)

/** The cheapest model of the default's kind that thinks as hard as the default can and costs less. Null when none does. */
function cheaperOfKind(own: readonly PiModel[], anchor: PiModel): PiModel | null {
  const ceiling = priceOf(anchor)
  if (ceiling === null) return null

  const reach = EFFORTS.indexOf(strongest(anchor))
  const isCandidate = (model: PiModel): boolean => thinks(model) && kindOf(model) === kindOf(anchor) && EFFORTS.indexOf(strongest(model)) >= reach

  let cheapest: { model: PiModel; price: number } | null = null
  for (const model of own) {
    const price = priceOf(model)
    if (price === null || price >= ceiling || !isCandidate(model)) continue
    // A tie keeps the one Pi lists first.
    if (!cheapest || price < cheapest.price) cheapest = { model, price }
  }
  return cheapest?.model ?? null
}

/** A model at a thinking level, moved to the nearest one the model has. */
function pickedAt(model: PiModel, effort: Effort): Picked {
  return {
    model: qualifiedId(model),
    name: model.name,
    effort: clampEffort({ efforts: effortsOf(model.thinking) }, effort),
  }
}

/** hobkin's model and each tier, from the models Pi can use now. Null when Pi reaches no provider it lists a model for. */
export function pickFirstModels(state: ModelsState): FirstPick | null {
  const found = preferred(state)
  if (!found) return null

  const { provider, own } = found
  const anchor = own.find((model) => model.id === provider.defaultModel) ?? own.find(thinks) ?? own[0]
  const fast = cheaperOfKind(own, anchor) ?? anchor

  return {
    provider: { id: provider.id, name: provider.name },
    lead: pickedAt(anchor, 'medium'),
    tiers: {
      fast: pickedAt(fast, 'low'),
      mid: pickedAt(anchor, 'medium'),
      high: pickedAt(anchor, 'high'),
      max: pickedAt(anchor, strongest(anchor)),
    },
  }
}
