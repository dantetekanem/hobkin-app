import type { KeyHelp, ProviderAccess } from '#shared/protocol/models.ts'

/**
 * How to give Pi an API key without the key passing through the app. The routes are Pi's own
 * (`docs/providers.md` in `@earendil-works/pi-coding-agent`): an environment variable, or a key in `auth.json`
 * that is a command Pi runs, here the macOS Keychain.
 */

/** Providers that need more than a key, in Pi's words ("Provider Specific Config"). The Keychain line alone would not do. */
const NEEDS_MORE: Record<string, string> = {
  azure: 'Azure also needs AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME.',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway also needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID.',
  'cloudflare-workers-ai': 'Cloudflare Workers AI also needs CLOUDFLARE_ACCOUNT_ID.',
}

/** Cloud credentials, in Pi's words. */
export const CLOUD_ROUTES: Record<string, { label: string; setup: string }> = {
  'amazon-bedrock': {
    label: 'An AWS profile, access keys or a Bedrock bearer token',
    setup: 'Set AWS_PROFILE, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK, and AWS_REGION when the profile does not give one.',
  },
  'google-vertex': {
    label: 'Google application default credentials',
    setup: 'Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION, then run `gcloud auth application-default login`.',
  },
}

/** A provider id, plain enough to stand in a shell command. The command registry checks the same. */
const PLAIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** The Keychain item that holds a provider's key. Named for Pi, so it never collides with another item. */
export function keychainRoute(provider: string): { store: string; line: string } {
  if (!PLAIN_ID.test(provider)) throw Error(`"${provider}" is not a provider id.`)
  const service = `'pi-${provider}'`
  return {
    // `-w` last asks for the key in Terminal, so it is typed there and never passes through the app.
    store: `security add-generic-password -a "$USER" -s ${service} -U -w`,
    // Pi runs a key that starts with "!" when it needs the key, and keeps what it prints in memory only.
    line: `!security find-generic-password -ws ${service}`,
  }
}

/** What to tell the user about a provider's key. `keychain` is false where there is no Keychain. */
export function keyHelpFor(provider: ProviderAccess, { keychain }: { keychain: boolean }): KeyHelp {
  const cloud = CLOUD_ROUTES[provider.id]
  const env = provider.apiKey?.env[0] ?? null
  const extra = NEEDS_MORE[provider.id] ?? null
  return {
    provider: provider.id,
    label: provider.apiKey?.label ?? `${provider.name} credentials`,
    env,
    keychain: keychain && env && !extra && !cloud ? keychainRoute(provider.id) : null,
    note: extra ?? (cloud ? cloud.setup : env ? null : `${provider.name} does not take an API key here. Set it up in Pi with /login ${provider.id}.`),
    connected: provider.connected,
  }
}
