import type { ProviderAccess } from '#shared/protocol/models.ts'

/**
 * The accounts the setup looks for and the one sign-in it offers. Pi owns every account, so this only reads what
 * the models slice says. See _specs/025-onboarding.
 */

/**
 * The OpenAI subscription Pi can sign in to, which is the one sign-in the setup offers for now. Found by what it
 * is, not by one fixed id, since Pi names it and the sample data names it differently.
 */
export function codexProvider(providers: readonly ProviderAccess[]): ProviderAccess | null {
  const subscriptions = providers.filter((provider) => provider.signIn?.subscription === true && /openai|codex|chatgpt/i.test(`${provider.id} ${provider.name}`))
  return subscriptions.find(({ id }) => id === 'openai-codex') ?? subscriptions[0] ?? null
}

/** The names of the providers Pi reaches now, in Pi's order. */
export function connectedNames(providers: readonly ProviderAccess[]): string[] {
  return providers.filter((provider) => provider.connected).map((provider) => provider.name)
}
