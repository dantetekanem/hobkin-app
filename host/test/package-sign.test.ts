import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { codesignArguments, notarizationVerdict, notarytoolCredentials, releaseSigning, signatureProblems } from '../../scripts/package/signing.ts'
import { updaterSignatureProblems } from '../../scripts/package/updater-signature.ts'

const IDENTITY = 'Developer ID Application: Some Maker (ABCDE12345)'
const API_KEY = { APPLE_API_KEY: 'KEY123', APPLE_API_ISSUER: 'issuer-uuid', APPLE_API_KEY_PATH: '/keys/AuthKey_KEY123.p8' }
const APPLE_ID = { APPLE_ID: 'maker@example.invalid', APPLE_PASSWORD: 'abcd-efgh-ijkl-mnop', APPLE_TEAM_ID: 'ABCDE12345' }

test('reads the signing identity and the notary credentials from the environment, by either route', () => {
  assert.deepEqual(releaseSigning({ APPLE_SIGNING_IDENTITY: IDENTITY, ...API_KEY }), {
    identity: IDENTITY,
    adHoc: false,
    notary: { route: 'api-key', keyId: 'KEY123', issuer: 'issuer-uuid', keyPath: '/keys/AuthKey_KEY123.p8' },
    problems: [],
  })
  assert.deepEqual(releaseSigning({ APPLE_SIGNING_IDENTITY: IDENTITY, ...APPLE_ID }).notary, {
    route: 'apple-id',
    appleId: 'maker@example.invalid',
    password: 'abcd-efgh-ijkl-mnop',
    teamId: 'ABCDE12345',
  })
  // Tauri, which notarizes the app, takes the Apple ID when both are whole, so the DMG goes the same way.
  assert.equal(releaseSigning({ APPLE_SIGNING_IDENTITY: IDENTITY, ...API_KEY, ...APPLE_ID }).notary?.route, 'apple-id')
  assert.equal(releaseSigning({ APPLE_SIGNING_IDENTITY: '0123456789ABCDEF0123456789ABCDEF01234567', ...API_KEY }).problems.length, 0, "a certificate's SHA-1 names it too")
})

test('says which variables are missing, never what any of them holds', () => {
  const nothing = releaseSigning({})
  assert.equal(nothing.identity, null)
  assert.equal(nothing.notary, null)
  assert.match(nothing.problems.join('\n'), /APPLE_SIGNING_IDENTITY is not set/)
  assert.match(nothing.problems.join('\n'), /APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH.*APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID/s)

  const partial = releaseSigning({ APPLE_SIGNING_IDENTITY: IDENTITY, APPLE_ID: APPLE_ID.APPLE_ID, APPLE_PASSWORD: APPLE_ID.APPLE_PASSWORD })
  assert.equal(partial.notary, null)
  assert.deepEqual(partial.problems, ['The Apple ID route needs APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID: APPLE_TEAM_ID is not set.'])
  const keyWithoutFile = releaseSigning({ APPLE_SIGNING_IDENTITY: IDENTITY, APPLE_API_KEY: 'KEY123', APPLE_API_ISSUER: 'issuer-uuid' })
  assert.match(keyWithoutFile.problems.join('\n'), /APPLE_API_KEY_PATH is not set/)

  const words = [nothing, partial, keyWithoutFile].flatMap((signing) => signing.problems).join('\n')
  for (const secret of [APPLE_ID.APPLE_ID, APPLE_ID.APPLE_PASSWORD, 'issuer-uuid', 'KEY123']) assert.ok(!words.includes(secret), `a problem names ${secret}`)

  assert.match(releaseSigning({ APPLE_SIGNING_IDENTITY: 'Apple Development: Some Maker (ABCDE12345)', ...API_KEY }).problems.join('\n'), /Developer ID Application/)
})

test('an ad hoc identity is a proof run, which can never be notarized', () => {
  const proof = releaseSigning({ APPLE_SIGNING_IDENTITY: '-', ...API_KEY })
  assert.equal(proof.adHoc, true)
  assert.equal(proof.notary, null, 'nothing signed ad hoc is ever sent to Apple')
  assert.match(proof.problems.join('\n'), /ad hoc/)
})

test('signs with the hardened runtime and a secure timestamp, except an ad hoc signature, which has no timestamp', () => {
  assert.deepEqual(codesignArguments(IDENTITY, '/pkg/node-arm64.entitlements'), [
    '--force', '--sign', IDENTITY, '--options', 'runtime', '--timestamp', '--entitlements', '/pkg/node-arm64.entitlements',
  ])
  assert.deepEqual(codesignArguments('-', null), ['--force', '--sign', '-', '--options', 'runtime', '--timestamp=none'])
})

test('hands notarytool the credentials of the route the environment chose', () => {
  assert.deepEqual(notarytoolCredentials({ route: 'api-key', keyId: 'KEY123', issuer: 'issuer-uuid', keyPath: '/keys/k.p8' }), [
    '--key', '/keys/k.p8', '--key-id', 'KEY123', '--issuer', 'issuer-uuid',
  ])
  assert.deepEqual(notarytoolCredentials({ route: 'apple-id', appleId: 'a@example.invalid', password: 'pw', teamId: 'T' }), [
    '--apple-id', 'a@example.invalid', '--password', 'pw', '--team-id', 'T',
  ])
})

const SIGNED = [
  'Executable=/app/node',
  'CodeDirectory v=20500 size=1120432 flags=0x10000(runtime) hashes=35003+7 location=embedded',
  `Authority=${IDENTITY}`,
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=Nov 26, 2026 at 9:00:00 PM',
  'TeamIdentifier=ABCDE12345',
].join('\n')
const AD_HOC = ['CodeDirectory v=20400 size=525 flags=0x10002(adhoc,runtime) hashes=13+0 location=embedded', 'Signature=adhoc', 'TeamIdentifier=not set'].join('\n')

test('a signature passes with the hardened runtime, and for a Developer ID with its identity and a secure timestamp', () => {
  assert.deepEqual(signatureProblems(SIGNED, IDENTITY), [])
  assert.deepEqual(signatureProblems(AD_HOC, '-'), [])
  assert.match(signatureProblems(SIGNED.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), IDENTITY).join('\n'), /hardened runtime/)
  assert.match(signatureProblems(SIGNED.replace(/^Timestamp=.*$/m, 'Signed Time=Nov 26, 2026'), IDENTITY).join('\n'), /secure timestamp/)
  assert.match(signatureProblems(SIGNED.replace(IDENTITY, 'Developer ID Application: Node.js Foundation (HX7739G8FX)'), IDENTITY).join('\n'), /not signed by/)
  assert.match(signatureProblems(AD_HOC, IDENTITY).join('\n'), /not signed by/)
  assert.match(signatureProblems('/app/x.node: code object is not signed at all', '-').join('\n'), /not signed/)
})

test("reads notarytool's verdict", () => {
  assert.deepEqual(notarizationVerdict('{"id":"abc-123","status":"Accepted","message":"Processing complete"}'), { id: 'abc-123', status: 'Accepted', accepted: true })
  assert.deepEqual(notarizationVerdict('{"id":"abc-123","status":"Invalid","message":"Processing complete"}'), { id: 'abc-123', status: 'Invalid', accepted: false })
  assert.throws(() => notarizationVerdict('Error: HTTP status code: 401.'), /notarytool/)
})

/** A minisign key and signature made the way Tauri's updater makes them: BLAKE2b-512 of the file, signed with Ed25519. */
function minisign(archive: Uint8Array, id = [1, 2, 3, 4, 5, 6, 7, 8], trusted = 'timestamp:1764208800\tfile:hobkin.app.tar.gz') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url')
  const keyId = Buffer.from(id)
  const box = (lines: string[]) => Buffer.from(`${lines.join('\n')}\n`).toString('base64')
  const signed = sign(null, createHash('blake2b512').update(archive).digest(), privateKey)
  const global = sign(null, Buffer.concat([signed, Buffer.from(trusted)]), privateKey)
  return {
    publicKey: box(['untrusted comment: minisign public key: 0807060504030201', Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')]),
    signature: box(['untrusted comment: signature from tauri secret key', Buffer.concat([Buffer.from('ED'), keyId, signed]).toString('base64'), `trusted comment: ${trusted}`, global.toString('base64')]),
  }
}

test("an updater archive passes only with a signature the release's public key made over that very archive", () => {
  const archive = new TextEncoder().encode('a signed, stapled hobkin.app, archived')
  const made = minisign(archive)
  assert.deepEqual(updaterSignatureProblems(archive, made.signature, made.publicKey), [])
  assert.match(updaterSignatureProblems(new TextEncoder().encode('another archive'), made.signature, made.publicKey).join('\n'), /does not match the archive/)
  assert.match(updaterSignatureProblems(archive, made.signature, minisign(archive, [8, 7, 6, 5, 4, 3, 2, 1]).publicKey).join('\n'), /another key/)
  assert.match(updaterSignatureProblems(archive, 'bm90IGEgc2lnbmF0dXJl', made.publicKey).join('\n'), /not a minisign signature/)
})
