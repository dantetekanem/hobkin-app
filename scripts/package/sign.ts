/**
 * Signs every Mach-O file in a staged package before the Tauri build seals it into the app:
 *
 *   APPLE_SIGNING_IDENTITY=<Developer ID Application identity, or - for ad hoc> node scripts/package/sign.ts [<package folder, dist/package by default>]
 *
 * Tauri signs the app's own executable and the bundle, and leaves its resources as they are. Notarization rejects an
 * app that holds any Mach-O file without a Developer ID signature, the hardened runtime and a secure timestamp, so the
 * carried Node and the native modules are signed here first. Node gets the entitlements for its chip, which replace
 * the ones its own release asks for (`get-task-allow` among them, which notarization rejects). Native modules get
 * none: only an executable's entitlements count. Each file is verified and described afterwards.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { nodeArch } from './binaries.ts'
import type { Chip } from './feed.ts'
import { codesignArguments, signatureProblems } from './signing.ts'
import { machOFilesUnder } from './tree.ts'

const NODE = 'node/bin/node'

/** The entitlements file the carried Node is signed with on a chip. */
export const nodeEntitlements = (chip: Chip) => join(import.meta.dirname, `node-${nodeArch(chip)}.entitlements.plist`)

function codesign(args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync('codesign', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  // codesign reports on stderr.
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/** How codesign describes a file's signature: its flags line and who signed it. */
export function describeSignature(path: string): string {
  return codesign(['-dvv', path]).output
}

/** The lines of a description worth showing beside a file. */
export const signatureSummary = (description: string): string =>
  description
    .split('\n')
    .filter((line) => /^(CodeDirectory|Signature=|Authority=Developer ID Application|Timestamp=|TeamIdentifier=)/.test(line))
    .map((line) => line.replace(/^CodeDirectory .*?(flags=\S+).*$/, '$1'))
    .join('  ')

export interface SignedFile {
  path: string
  summary: string
}

/** Signs and verifies every Mach-O file under a staged package. It throws, naming each file, when any fails. */
export function signPackage(root: string, identity: string): SignedFile[] {
  const { chip } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { chip?: Chip }
  if (!chip) throw Error(`${root}/manifest.json names no chip. Stage it again with this version of stage.ts.`)
  const files = machOFilesUnder(root)
  if (!files.includes(NODE)) throw Error(`${root} has no ${NODE} to sign.`)
  const problems: string[] = []
  const signed: SignedFile[] = []
  for (const path of files) {
    const file = join(root, path)
    const made = codesign([...codesignArguments(identity, path === NODE ? nodeEntitlements(chip) : null), file])
    if (made.status !== 0) {
      problems.push(`${path} could not be signed: ${made.output.trim()}`)
      continue
    }
    const verified = codesign(['--verify', '--strict', file])
    if (verified.status !== 0) problems.push(`${path} does not verify: ${verified.output.trim()}`)
    const description = describeSignature(file)
    problems.push(...signatureProblems(description, identity).map((problem) => `${path}: ${problem}`))
    signed.push({ path, summary: signatureSummary(description) })
  }
  if (problems.length) throw Error(`The staged Mach-O files are not all signed:\n- ${problems.join('\n- ')}`)
  return signed
}

if (import.meta.main) {
  try {
    const identity = process.env.APPLE_SIGNING_IDENTITY
    if (!identity) throw Error('APPLE_SIGNING_IDENTITY is not set: a Developer ID Application identity, or - to sign ad hoc.')
    const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', 'dist', 'package'))
    const signed = signPackage(root, identity)
    console.log(`Signed ${signed.length} Mach-O files in ${root}${identity === '-' ? ' ad hoc' : ''}, with the hardened runtime:`)
    for (const { path, summary } of signed) console.log(`  ${path}  ${summary}`)
  } catch (error) {
    console.error(`sign: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
