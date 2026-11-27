/**
 * Pure rules for signing and notarizing a release: what the environment must hold, the arguments `codesign` and
 * `notarytool` get, and how their output is read. Problems name variables, never what they hold.
 */

/** How notarytool signs in to Apple: an App Store Connect API key (recommended), or an Apple ID with an app password. */
export type NotaryAuth =
  | { route: 'api-key'; keyId: string; issuer: string; keyPath: string }
  | { route: 'apple-id'; appleId: string; password: string; teamId: string }

export interface ReleaseSigning {
  /** APPLE_SIGNING_IDENTITY: a Developer ID Application identity, or `-` for an ad hoc proof run. */
  identity: string | null
  adHoc: boolean
  /** The credentials notarization uses. Never set for an ad hoc identity, so nothing signed ad hoc goes to Apple. */
  notary: NotaryAuth | null
  /** Why a release could not be signed and notarized as it stands. */
  problems: string[]
}

const API_KEY_VARS = ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH'] as const
const APPLE_ID_VARS = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'] as const
const SHA1 = /^[0-9A-Fa-f]{40}$/

type Environment = Readonly<Record<string, string | undefined>>

/** Names joined for a sentence: `A`, `A and B`, `A, B and C`. */
function listed(names: readonly string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

interface Route {
  /** Some of the route's variables are set, so the user meant to take it. */
  started: boolean
  missing: string[]
}

function route(env: Environment, names: readonly string[]): Route {
  const missing = names.filter((name) => !env[name])
  return { started: missing.length < names.length, missing }
}

const isWhole = ({ started, missing }: Route) => started && missing.length === 0

function routeProblem(name: string, names: readonly string[], { missing }: Route): string {
  const verb = missing.length > 1 ? 'are' : 'is'
  return `The ${name} route needs ${listed(names)}: ${listed(missing)} ${verb} not set.`
}

function notaryFrom(env: Environment): { notary: NotaryAuth | null; problems: string[] } {
  const appleId = route(env, APPLE_ID_VARS)
  const apiKey = route(env, API_KEY_VARS)

  // Tauri, which notarizes the app inside the build, takes the Apple ID route when it is whole, so the DMG does too.
  if (isWhole(appleId)) {
    const notary: NotaryAuth = {
      route: 'apple-id',
      appleId: env.APPLE_ID!,
      password: env.APPLE_PASSWORD!,
      teamId: env.APPLE_TEAM_ID!,
    }
    return { notary, problems: [] }
  }
  if (isWhole(apiKey)) {
    const notary: NotaryAuth = {
      route: 'api-key',
      keyId: env.APPLE_API_KEY!,
      issuer: env.APPLE_API_ISSUER!,
      keyPath: env.APPLE_API_KEY_PATH!,
    }
    return { notary, problems: [] }
  }

  const problems: string[] = []
  if (apiKey.started) problems.push(routeProblem('App Store Connect API key', API_KEY_VARS, apiKey))
  if (appleId.started) problems.push(routeProblem('Apple ID', APPLE_ID_VARS, appleId))
  if (problems.length === 0) {
    problems.push(`Notarization needs an App Store Connect API key (${listed(API_KEY_VARS)}) or an Apple ID with an app-specific password (${listed(APPLE_ID_VARS)}). None of them is set.`)
  }
  return { notary: null, problems }
}

/** The signing identity and notary credentials the environment holds, and what is missing for a notarized release. */
export function releaseSigning(env: Environment): ReleaseSigning {
  const identity = env.APPLE_SIGNING_IDENTITY || null
  const adHoc = identity === '-'
  const problems: string[] = []
  if (!identity) {
    problems.push('APPLE_SIGNING_IDENTITY is not set. Set it to the Developer ID Application identity `security find-identity -v -p codesigning` lists, or to - for an ad hoc proof run that stops before notarization.')
  } else if (adHoc) {
    problems.push('APPLE_SIGNING_IDENTITY is - , an ad hoc signature, which Apple does not notarize. Set it to a Developer ID Application identity.')
  } else if (!identity.startsWith('Developer ID Application: ') && !SHA1.test(identity)) {
    problems.push('APPLE_SIGNING_IDENTITY must name a Developer ID Application identity (or its SHA-1): Apple notarizes no other kind.')
  }
  const notary = notaryFrom(env)
  return {
    identity,
    adHoc,
    notary: adHoc ? null : notary.notary,
    problems: [...problems, ...notary.problems],
  }
}

/** codesign's arguments: the hardened runtime always, and a secure timestamp from Apple for any identity but ad hoc. */
export function codesignArguments(identity: string, entitlements: string | null): string[] {
  return [
    '--force',
    '--sign',
    identity,
    '--options',
    'runtime',
    identity === '-' ? '--timestamp=none' : '--timestamp',
    ...(entitlements ? ['--entitlements', entitlements] : []),
  ]
}

/** notarytool's sign-in arguments for a route. They hold secrets, so they are passed as arguments and never printed. */
export function notarytoolCredentials(auth: NotaryAuth): string[] {
  return auth.route === 'api-key'
    ? ['--key', auth.keyPath, '--key-id', auth.keyId, '--issuer', auth.issuer]
    : ['--apple-id', auth.appleId, '--password', auth.password, '--team-id', auth.teamId]
}

const RUNTIME_FLAG = 0x10000

/**
 * Why a signature, as `codesign -dvv` describes it, is not one a notarized release can carry: it must have the
 * hardened runtime, and a Developer ID one must be that identity's, with a secure timestamp (`Timestamp=`, not the
 * `Signed Time=` an untimestamped signature shows).
 */
export function signatureProblems(description: string, identity: string): string[] {
  if (/not signed at all/.test(description)) return ['it is not signed']
  const problems: string[] = []
  const flags = /\bflags=0x([0-9a-f]+)/.exec(description)
  if (!flags || !(Number.parseInt(flags[1]!, 16) & RUNTIME_FLAG)) problems.push('it is not signed with the hardened runtime')
  if (identity === '-') {
    if (!/^Signature=adhoc$/m.test(description)) problems.push('it is not signed ad hoc')
    return problems
  }
  // A certificate's SHA-1 never appears in the description, so only the kind of identity can be checked for it.
  const byHash = SHA1.test(identity)
  const signedBy = byHash ? /^Authority=Developer ID Application: /m.test(description) : description.split('\n').includes(`Authority=${identity}`)
  if (!signedBy) problems.push(`it is not signed by ${byHash ? 'a Developer ID Application identity' : 'APPLE_SIGNING_IDENTITY'}`)
  if (!/^Timestamp=/m.test(description)) problems.push('its signature has no secure timestamp')
  return problems
}

export interface NotarizationVerdict {
  id: string
  status: string
  accepted: boolean
}

/** What `notarytool submit --wait --output-format json` printed. */
export function notarizationVerdict(output: string): NotarizationVerdict {
  let parsed: { id?: unknown; status?: unknown }
  try {
    parsed = JSON.parse(output) as typeof parsed
  } catch {
    throw Error(`notarytool did not answer with its JSON verdict: ${output.trim().slice(0, 300)}`)
  }
  if (typeof parsed.id !== 'string' || typeof parsed.status !== 'string') throw Error('notarytool answered without a submission id and status.')
  return { id: parsed.id, status: parsed.status, accepted: parsed.status === 'Accepted' }
}
