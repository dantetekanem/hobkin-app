/**
 * Checks an updater archive's `.sig` against the public key in the release config, as an installed app checks a
 * download before it installs it. Tauri signs with minisign: Ed25519 over the archive's BLAKE2b-512 hash, then over
 * that signature and its trusted comment. Tauri only warns when its private key is not the config's, and an app would
 * then refuse every update, so the release build checks the pair itself.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'

const decoded = (base64: string) => Buffer.from(base64.trim(), 'base64').toString('utf8')

/** The lines of a minisign box that carry data: every line but the comments. */
function dataLines(box: string): string[] {
  return box.split('\n').filter((line) => line && !line.startsWith('untrusted comment:'))
}

function ed25519Key(raw: Buffer) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
}

/** Why the archive would be refused with this signature and key, or nothing when an installed app would accept it. */
export function updaterSignatureProblems(archive: Uint8Array, signature: string, publicKey: string): string[] {
  const [keyLine] = dataLines(decoded(publicKey))
  const key = Buffer.from(keyLine ?? '', 'base64')
  if (key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed') return ['the public key in the release config is not a minisign key']

  const [signatureLine, trustedLine, globalLine] = dataLines(decoded(signature))
  const signed = Buffer.from(signatureLine ?? '', 'base64')
  const algorithm = signed.subarray(0, 2).toString()
  if (signed.length !== 74 || !['Ed', 'ED'].includes(algorithm) || !trustedLine?.startsWith('trusted comment: ') || !globalLine) {
    return ['the .sig file is not a minisign signature']
  }
  if (!signed.subarray(2, 10).equals(key.subarray(2, 10))) return ['the archive was signed with another key than the one in the release config']

  const publicKeyObject = ed25519Key(key.subarray(10))
  const message = algorithm === 'ED' ? createHash('blake2b512').update(archive).digest() : Buffer.from(archive)
  const problems: string[] = []
  if (!verify(null, message, publicKeyObject, signed.subarray(10))) problems.push('the signature does not match the archive')
  const trusted = Buffer.from(trustedLine.slice('trusted comment: '.length))
  if (!verify(null, Buffer.concat([signed.subarray(10), trusted]), publicKeyObject, Buffer.from(globalLine, 'base64'))) {
    problems.push("the signature's trusted comment does not match it")
  }
  return problems
}
