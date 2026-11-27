/**
 * Builds the Mac app for one chip from one commit, signed with a Developer ID, notarized and stapled:
 *
 *   node scripts/package/build.ts --chip aarch64|x86_64 --commit <sha> [--work <folder, dist/build by default>]
 *
 * From the environment, never printed:
 *   APPLE_SIGNING_IDENTITY        "Developer ID Application: <name> (<team id>)", or - for an ad hoc proof run
 *   APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
 *                                 an App Store Connect API key (recommended), or
 *   APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID
 *                                 an Apple ID with an app-specific password
 *   TAURI_SIGNING_PRIVATE_KEY     the updater key file's path, or its content
 *
 * The commit is exported with `git archive` and built with its own scripts, so the working folder never reaches a
 * release: install its packages from the store, download the official Node for the chip and check it against
 * SHASUMS256.txt, stage, sign every Mach-O file, check the stage runs alone, `tauri build` (which signs the app,
 * notarizes and staples it, and makes the DMG and the updater archive from the stapled app), check every Mach-O file
 * in the app, the updater archive and its signature, open the app on a throwaway home, notarize and staple the DMG,
 * and check what Gatekeeper says. Only then are the DMG and the archive copied to dist/built/<chip>, where
 * `release.ts` finds them.
 *
 * An ad hoc identity runs every step but notarization, and then stops with what notarization is missing. Nothing it
 * signed is ever sent to Apple, and nothing of it reaches dist/built.
 */
import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { checksumOf, nodeBuild } from '../../host/src/pi/node.ts'
import { nodeArch } from './binaries.ts'
import { CHIPS, type Chip } from './feed.ts'
import { describeSignature, signatureSummary } from './sign.ts'
import { notarizationVerdict, notarytoolCredentials, releaseSigning, signatureProblems, type NotaryAuth, type ReleaseSigning } from './signing.ts'
import { isInside, machOFilesUnder } from './tree.ts'
import { updaterSignatureProblems } from './updater-signature.ts'

const REPO = resolve(import.meta.dirname, '..', '..')
const USAGE = 'Usage: node scripts/package/build.ts --chip aarch64|x86_64 --commit <sha> [--work <folder>]'
const NOTARY_VARS = ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']
const SECRET_VARS = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']
const OPEN_MS = 90_000
const STOP_MS = 15_000

class Stop extends Error {}

/** A path as the report shows it: from the repository when it is inside it. */
const shown = (path: string) => (isInside(REPO, path) ? relative(REPO, path) : path)

/** Runs a program and returns what it printed. A failure names the label, never the arguments, which may hold secrets. */
function run(label: string, command: string, args: readonly string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error) throw new Stop(`${label} could not start: ${result.error.message}`)
  const printed = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`
  if (result.status !== 0) throw new Stop(`${label} failed with ${result.status}:\n${printed.trim()}`)
  return printed
}

/** Runs a long step with its output shown as it comes. */
function step(label: string, command: string, args: readonly string[], options: SpawnSyncOptions = {}): void {
  console.log(`\n== ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw new Stop(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Stop(`${label} failed with ${result.status}.`)
}

function buildArguments(args: readonly string[]): { chip: Chip; commit: string; work: string } {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index]!, args[index + 1]]
    if (!['--chip', '--commit', '--work'].includes(flag)) throw new Stop(`Unknown option: ${flag}\n${USAGE}`)
    if (!value || value.startsWith('--')) throw new Stop(`${flag} needs a value.\n${USAGE}`)
    values.set(flag, value)
  }
  const chip = values.get('--chip') as Chip | undefined
  const commit = values.get('--commit')
  if (!chip || !CHIPS.includes(chip)) throw new Stop(`--chip is ${CHIPS.join(' or ')}.\n${USAGE}`)
  if (!commit) throw new Stop(`--commit names the commit to build.\n${USAGE}`)
  return { chip, commit, work: resolve(values.get('--work') ?? join(REPO, 'dist', 'build')) }
}

/** What must be in place before anything is built, so a missing credential never costs a whole build. */
function preflight(signing: ReleaseSigning, triple: string): void {
  const problems: string[] = []
  if (!signing.identity) problems.push(...signing.problems)
  else if (!signing.adHoc) {
    problems.push(...signing.problems)
    const identities = run('security find-identity', 'security', ['find-identity', '-v', '-p', 'codesigning'])
    if (!identities.includes(signing.identity)) problems.push('APPLE_SIGNING_IDENTITY is not among the valid code signing identities `security find-identity -v -p codesigning` lists.')
    if (signing.notary?.route === 'api-key' && !existsSync(signing.notary.keyPath)) problems.push('APPLE_API_KEY_PATH names no file.')
  }
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) problems.push("TAURI_SIGNING_PRIVATE_KEY is not set: the updater key file's path, or its content. Without it no installed app could take the update.")
  if (spawnSync('cargo', ['--version']).status !== 0) problems.push('cargo is not on the PATH. Run `. "$HOME/.cargo/env"` first.')
  else if (!run('rustup target list', 'rustup', ['target', 'list', '--installed']).split('\n').includes(triple)) problems.push(`Rust has no ${triple} target. Run \`rustup target add ${triple}\`.`)
  if (problems.length) throw new Stop(`Nothing was built:\n- ${problems.join('\n- ')}`)
}

/** The commit's files, exported with git archive into a fresh folder. */
function exportCommit(commit: string, work: string): string {
  const source = join(work, commit, 'src')
  rmSync(join(work, commit), { recursive: true, force: true })
  mkdirSync(source, { recursive: true })
  const tar = join(work, commit, 'src.tar')
  run('git archive', 'git', ['-C', REPO, 'archive', '--format=tar', '-o', tar, commit])
  run('tar', '/usr/bin/tar', ['-xf', tar, '-C', source])
  rmSync(tar)
  return source
}

/** The official Node the commit's hobkin pins, for the chip, downloaded once and checked against nodejs.org's SHASUMS256.txt. */
async function officialNode(source: string, chip: Chip, work: string): Promise<string> {
  const manifest = JSON.parse(readFileSync(join(source, 'packages', 'hobkin', 'package.json'), 'utf8')) as { devEngines?: { runtime?: { version?: string } } }
  const version = manifest.devEngines?.runtime?.version
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Stop("packages/hobkin/package.json pins no exact Node version in devEngines.runtime.version.")
  const build = nodeBuild(version, 'darwin', nodeArch(chip))!
  const folder = join(work, 'node', `v${version}-darwin-${nodeArch(chip)}`)
  const node = join(folder, 'bin', 'node')
  if (existsSync(node)) return node

  console.log(`\n== Node ${version} for ${chip}, from ${build.url}`)
  const fetched = async (url: string) => {
    const answer = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!answer.ok) throw new Stop(`nodejs.org answered ${answer.status} for ${url}.`)
    return answer
  }
  const expected = checksumOf(await (await fetched(build.sums)).text(), build.file)
  if (!expected) throw new Stop(`nodejs.org's SHASUMS256.txt lists no ${build.file}.`)
  const archive = Buffer.from(await (await fetched(build.url)).arrayBuffer())
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) throw new Stop(`${build.file} does not match its checksum in SHASUMS256.txt.`)
  console.log(`  sha256 ${actual} matches SHASUMS256.txt`)

  mkdirSync(join(work, 'node'), { recursive: true })
  const unpacking = mkdtempSync(join(work, 'node', 'unpacking-'))
  try {
    writeFileSync(join(unpacking, build.file), archive)
    run('tar', '/usr/bin/tar', ['-xzf', join(unpacking, build.file), '-C', unpacking, '--strip-components', '1', `${build.file.replace(/\.tar\.gz$/, '')}/bin/node`])
    mkdirSync(join(folder, 'bin'), { recursive: true })
    renameSync(join(unpacking, 'bin', 'node'), node)
  } finally {
    rmSync(unpacking, { recursive: true, force: true })
  }
  return node
}

/** The environment without any secret: what every step but `tauri build` gets. */
function withoutSecrets(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of [...SECRET_VARS, ...NOTARY_VARS]) delete env[name]
  return env
}

/** The environment `tauri build` gets: the identity, the updater key, and the chosen notary route only, never for an ad hoc build. */
function tauriEnvironment(signing: ReleaseSigning, work: string): NodeJS.ProcessEnv {
  // A certificate in the environment would make Tauri sign from a keychain of its own, apart from the staged files'.
  const env: NodeJS.ProcessEnv = { ...withoutSecrets(), CI: 'true', CARGO_TARGET_DIR: join(work, 'target'), APPLE_SIGNING_IDENTITY: signing.identity! }
  for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) if (process.env[name] !== undefined) env[name] = process.env[name]
  const notary = signing.notary
  if (notary?.route === 'api-key') Object.assign(env, { APPLE_API_KEY: notary.keyId, APPLE_API_ISSUER: notary.issuer, APPLE_API_KEY_PATH: notary.keyPath })
  if (notary?.route === 'apple-id') Object.assign(env, { APPLE_ID: notary.appleId, APPLE_PASSWORD: notary.password, APPLE_TEAM_ID: notary.teamId })
  return env
}

interface Bundle {
  version: string
  app: string
  dmg: string
  archive: string
  signature: string
}

function bundleOf(work: string, triple: string, chip: Chip): Bundle {
  const folder = join(work, 'target', triple, 'release', 'bundle')
  const app = join(folder, 'macos', 'hobkin.app')
  const version = run('plutil', 'plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents', 'Info.plist')]).trim()
  const bundle = {
    version,
    app,
    dmg: join(folder, 'dmg', `hobkin_${version}_${chip === 'x86_64' ? 'x64' : 'aarch64'}.dmg`),
    archive: join(folder, 'macos', 'hobkin.app.tar.gz'),
    signature: join(folder, 'macos', 'hobkin.app.tar.gz.sig'),
  }
  for (const file of [bundle.dmg, bundle.archive, bundle.signature]) if (!existsSync(file)) throw new Stop(`The build made no ${file}.`)
  return bundle
}

const cdHash = (app: string) => /^CDHash=(\w+)$/m.exec(run('codesign -dvvv', 'codesign', ['-dvvv', app]))?.[1] ?? null

/** Every Mach-O file in the app is signed as a notarized release needs, and the bundle verifies as a whole. */
function checkSignatures(app: string, identity: string): void {
  console.log(`\n== Mach-O files in ${shown(app)}`)
  const problems: string[] = []
  for (const path of machOFilesUnder(app)) {
    const description = describeSignature(join(app, path))
    console.log(`  ${path}  ${signatureSummary(description)}`)
    problems.push(...signatureProblems(description, identity).map((problem) => `${path}: ${problem}`))
  }
  console.log('\n== codesign --verify --deep --strict --verbose=2')
  const verified = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { encoding: 'utf8' })
  console.log(`${verified.stdout}${verified.stderr}`.trim())
  if (verified.status !== 0) problems.push('the app does not verify')
  if (problems.length) throw new Stop(`The app is not signed as a notarized release needs:\n- ${problems.join('\n- ')}`)
}

/** The updater archive holds this very app, and its signature is one the release's public key accepts. */
function checkUpdaterArchive(bundle: Bundle, source: string, stapled: boolean): void {
  console.log('\n== updater archive')
  const config = JSON.parse(readFileSync(join(source, 'scripts', 'package', 'tauri.release.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string } } }
  const problems = updaterSignatureProblems(readFileSync(bundle.archive), readFileSync(bundle.signature, 'utf8'), config.plugins.updater.pubkey)
  const unpacked = mkdtempSync(join(tmpdir(), 'hobkin-archive-'))
  try {
    run('tar', '/usr/bin/tar', ['-xzf', bundle.archive, '-C', unpacked])
    const inner = join(unpacked, 'hobkin.app')
    if (spawnSync('codesign', ['--verify', '--deep', '--strict', inner]).status !== 0) problems.push("the archive's app does not verify")
    if (cdHash(inner) !== cdHash(bundle.app)) problems.push("the archive's app is not the app that was signed")
    if (stapled) {
      const validated = spawnSync('xcrun', ['stapler', 'validate', inner], { encoding: 'utf8' })
      console.log(`  stapler validate (archive's app): ${`${validated.stdout}${validated.stderr}`.trim()}`)
      if (validated.status !== 0) problems.push("the archive's app has no stapled ticket")
    }
  } finally {
    rmSync(unpacked, { recursive: true, force: true })
  }
  if (problems.length) throw new Stop(`The updater archive cannot go out:\n- ${problems.join('\n- ')}`)
  console.log(`  ${shown(bundle.archive)}: the app inside is the signed one (CDHash ${cdHash(bundle.app)}), and its signature matches the release config's public key`)
}

const answers = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.end()
      done(true)
    })
    socket.on('error', () => done(false))
  })

/**
 * Opens the built app on a throwaway HOME, hobkin home and Pi folder, and waits for the host it starts: on the Node in
 * the app, listening on a port of its own. Then quits the app and waits for the host to go with it.
 */
async function openApp(app: string): Promise<void> {
  console.log('\n== opening the app on a throwaway home')
  const trial = mkdtempSync(join(tmpdir(), 'hobkin-open-check-'))
  const [user, home, pi] = ['user', 'home', 'pi'].map((name) => join(trial, name))
  for (const folder of [user, home, pi]) mkdirSync(folder)
  const carried = join(app, 'Contents', 'Resources', 'node', 'bin', 'node')
  const child = spawn(join(app, 'Contents', 'MacOS', 'hobkin'), [], {
    env: { HOME: user, CFFIXED_USER_HOME: user, HOBKIN_CLIENT_HOME: home, PI_CODING_AGENT_DIR: pi, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    stdio: 'ignore',
  })
  const exited = new Promise<void>((done) => child.on('exit', () => done()))
  let host: { pid: number; port: number } | null = null
  try {
    const deadline = Date.now() + OPEN_MS
    while (Date.now() < deadline && !host) {
      await delay(250)
      try {
        const saved = JSON.parse(readFileSync(join(home, 'client', 'host.json'), 'utf8')) as { pid?: number; port?: number }
        if (Number.isInteger(saved.pid) && Number.isInteger(saved.port) && (await answers(saved.port!))) host = { pid: saved.pid!, port: saved.port! }
      } catch {
        // Not written yet.
      }
    }
    if (!host) throw new Stop(`The app started no host on its throwaway home within ${OPEN_MS / 1000} seconds.`)
    const command = spawnSync('ps', ['-o', 'command=', '-p', String(host.pid)], { encoding: 'utf8' }).stdout.trim()
    if (!command.startsWith(`${carried} host/src/main.ts`)) throw new Stop(`The app's host runs ${command}, not the Node in the app.`)
    console.log(`  host pid ${host.pid} on port ${host.port}: ${command.replaceAll(app, '<app>').replaceAll(trial, '<trial>')}`)
  } finally {
    child.kill('SIGTERM')
    await Promise.race([exited, delay(STOP_MS)])
    child.kill('SIGKILL')
    if (host) {
      const deadline = Date.now() + STOP_MS
      while (Date.now() < deadline && spawnSync('kill', ['-0', String(host.pid)]).status === 0) await delay(250)
      if (spawnSync('kill', ['-0', String(host.pid)]).status === 0) {
        process.kill(host.pid, 'SIGKILL')
        rmSync(trial, { recursive: true, force: true })
        throw new Stop('The host was still running after the app quit.')
      }
      console.log('  the app quit, and its host went with it')
    }
    rmSync(trial, { recursive: true, force: true })
  }
}

/** Signs the DMG, has Apple notarize it, and staples the ticket. The app inside was notarized and stapled by Tauri. */
function notarizeDmg(bundle: Bundle, identity: string, notary: NotaryAuth): void {
  console.log('\n== notarizing the DMG')
  if (spawnSync('xcrun', ['stapler', 'validate', bundle.app]).status !== 0) throw new Stop('Tauri did not staple a notarization ticket to the app, so the DMG and the updater archive hold an app without one.')
  run('codesign the DMG', 'codesign', ['--force', '--sign', identity, '--timestamp', bundle.dmg])
  const submitted = spawnSync('xcrun', ['notarytool', 'submit', bundle.dmg, '--wait', '--output-format', 'json', ...notarytoolCredentials(notary)], { encoding: 'utf8' })
  const verdict = notarizationVerdict(String(submitted.stdout || submitted.stderr))
  console.log(`  submission ${verdict.id}: ${verdict.status}`)
  if (!verdict.accepted) {
    const log = spawnSync('xcrun', ['notarytool', 'log', verdict.id, ...notarytoolCredentials(notary)], { encoding: 'utf8' })
    throw new Stop(`Apple did not accept the DMG (${verdict.status}). Its log:\n${`${log.stdout}${log.stderr}`.trim()}`)
  }
  run('stapler staple', 'xcrun', ['stapler', 'staple', bundle.dmg])
}

/** What Gatekeeper and the stapler say of the app and the DMG, as a Mac that downloads them would ask. */
function checkGatekeeper(bundle: Bundle): void {
  const checks: [string, string, string[]][] = [
    ['codesign --verify --deep --strict --verbose=2 (app)', 'codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle.app]],
    ['spctl -a -vvv -t exec (app)', 'spctl', ['-a', '-vvv', '-t', 'exec', bundle.app]],
    ['spctl -a -vvv -t open --context context:primary-signature (DMG)', 'spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', bundle.dmg]],
    ['stapler validate (app)', 'xcrun', ['stapler', 'validate', bundle.app]],
    ['stapler validate (DMG)', 'xcrun', ['stapler', 'validate', bundle.dmg]],
  ]
  const failed: string[] = []
  for (const [label, command, args] of checks) {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    console.log(`\n== ${label}\n${`${result.stdout}${result.stderr}`.trim()}`)
    if (result.status !== 0) failed.push(label)
  }
  if (failed.length) throw new Stop(`Gatekeeper would not open the release:\n- ${failed.join('\n- ')}`)
}

async function build(args: readonly string[]): Promise<void> {
  const { chip, commit: named, work } = buildArguments(args)
  const triple = `${chip}-apple-darwin`
  const signing = releaseSigning(process.env)
  preflight(signing, triple)
  const commit = run('git rev-parse', 'git', ['-C', REPO, 'rev-parse', '--verify', `${named}^{commit}`]).trim()
  if (signing.adHoc) console.log('A proof run: everything is signed ad hoc, and the run stops before notarization. Nothing is sent to Apple.')
  console.log(`Building hobkin for ${chip} from ${commit}, in ${work}.`)

  const source = exportCommit(commit, work)
  const plain = { cwd: source, env: withoutSecrets() }
  step('install the commit\'s packages from the store', 'pnpm', ['install', '--offline', '--frozen-lockfile', '--trust-lockfile', '--ignore-scripts'], plain)
  const node = await officialNode(source, chip, work)
  const scripts = join(source, 'scripts', 'package')
  step('stage', process.execPath, [join(scripts, 'stage.ts'), '--client', source, '--client-commit', commit, '--runtime', join(source, 'packages', 'hobkin'), '--runtime-commit', commit, '--chip', chip, '--node', node], plain)
  step('sign the staged Mach-O files', process.execPath, [join(scripts, 'sign.ts')], plain)
  step('check the stage runs alone', process.execPath, [join(scripts, 'check.ts')], plain)
  // An earlier build's files are never taken for this one's.
  rmSync(join(work, 'target', triple, 'release', 'bundle'), { recursive: true, force: true })
  step('tauri build', join(source, 'node_modules', '.bin', 'tauri'), ['build', '--config', 'scripts/package/tauri.release.conf.json', '--target', triple], { cwd: source, env: tauriEnvironment(signing, work) })

  const bundle = bundleOf(work, triple, chip)
  checkSignatures(bundle.app, signing.identity!)
  checkUpdaterArchive(bundle, source, false)
  await openApp(bundle.app)

  if (!signing.notary) {
    throw new Stop(`hobkin ${bundle.version} for ${chip} is built and signed in ${shown(bundle.app)}, but not notarized, so it is not copied to dist/built and release.ts cannot publish it. Nothing was sent to Apple.\n- ${signing.problems.join('\n- ')}`)
  }
  notarizeDmg(bundle, signing.identity!, signing.notary)
  checkUpdaterArchive(bundle, source, true)
  checkGatekeeper(bundle)

  const out = join(REPO, 'dist', 'built', chip)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const file of [bundle.dmg, bundle.archive, bundle.signature]) copyFileSync(file, join(out, file.split('/').pop()!))
  writeFileSync(join(out, 'build.json'), `${JSON.stringify({ version: bundle.version, chip, commit, dmg: bundle.dmg.split('/').pop(), notarized: true }, null, 2)}\n`)
  console.log(`\nhobkin ${bundle.version} for ${chip} is signed, notarized and stapled, in ${shown(out)}. Run release.ts once every chip is built.`)
}

if (import.meta.main) {
  build(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`\nbuild: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
