import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { afterTest, temporaryDirectory } from './support.ts'

/**
 * A Pi folder of a test's own, for the tests of Skills and Pi extensions (039-skills-and-extensions): skills, packages,
 * extensions and Pi's settings, with a home folder of its own, so the Agent Skills folder Pi reads under the home folder
 * (~/.agents/skills) is the test's too. The user's ~/.pi and ~/.agents are never read.
 */

const FAKE_NPM = fileURLToPath(new URL('./fixtures/fake-npm.mjs', import.meta.url))

/** Sets environment variables for one test, and puts back what was there. */
export function withEnvironment(t: TestContext, values: Record<string, string | undefined>): void {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]))
  const apply = (next: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  apply(values)
  afterTest(t, () => apply(before))
}

export interface PiFolder {
  /** The test's own folder, which holds everything below. */
  root: string
  /** The Pi agent folder: settings.json, skills, extensions, and the npm and git installs. */
  agentDir: string
  /** The home folder Pi sees for this test. */
  home: string
}

export function piFolder(t: TestContext): PiFolder {
  const root = temporaryDirectory(t)
  const agentDir = join(root, 'pi-agent')
  const home = join(root, 'home')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(home, { recursive: true })
  // Pi reads the home folder from HOME. Offline mode would skip the update check these tests make.
  withEnvironment(t, { HOME: home, PI_OFFLINE: undefined, PI_CODING_AGENT_DIR: undefined })
  return { root, agentDir, home }
}

/** A skill folder with its SKILL.md. Returns the file. */
export function skill(folder: string, frontmatter: Record<string, string | boolean>, body?: string): string {
  mkdirSync(folder, { recursive: true })
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${String(value)}`)
  const file = join(folder, 'SKILL.md')
  writeFileSync(file, `---\n${lines.join('\n')}\n---\n\n${body ?? `# ${String(frontmatter.name)}\n\nThe steps.\n`}`)
  return file
}

export function writeSettings(agentDir: string, settings: Record<string, unknown>): void {
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
}

export const readSettings = (agentDir: string): Record<string, unknown> => JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>

export interface PackageShape {
  version: string
  /** Extension files, from the package's folder down. */
  extensions?: string[]
  /** Skills by name, each with its description. */
  skills?: Record<string, string>
}

/** A Pi package in `folder`: a package.json with a `pi` manifest, and its extensions and skills. Returns the folder. */
export function piPackage(folder: string, name: string, { version, extensions = [], skills = {} }: PackageShape): string {
  mkdirSync(folder, { recursive: true })
  for (const file of extensions) {
    mkdirSync(dirname(join(folder, file)), { recursive: true })
    writeFileSync(join(folder, file), 'export default function extension() {}\n')
  }
  for (const [skillName, description] of Object.entries(skills)) skill(join(folder, 'skills', skillName), { name: skillName, description })
  const pi = {
    ...(extensions.length > 0 ? { extensions: extensions.map((file) => `./${file}`) } : {}),
    ...(Object.keys(skills).length > 0 ? { skills: ['./skills'] } : {}),
  }
  writeFileSync(join(folder, 'package.json'), `${JSON.stringify({ name, version, keywords: ['pi-package'], pi }, null, 2)}\n`)
  return folder
}

/** A package installed from npm where Pi keeps them, under the agent folder. */
export const npmPackage = (agentDir: string, name: string, shape: PackageShape): string => piPackage(join(agentDir, 'npm', 'node_modules', name), name, shape)

export interface FakeNpm {
  /** What to put in Pi's settings as `npmCommand`. */
  command: string[]
  /** Every call Pi made to it, as its arguments. */
  calls(): string[][]
}

/** The stand-in npm, answering `npm view` from `versions` (the newest version of each package by name). */
export function fakeNpm(root: string, versions: Record<string, string>): FakeNpm {
  const registry = join(root, 'npm-registry.json')
  const globalRoot = join(root, 'global-npm')
  mkdirSync(globalRoot, { recursive: true })
  writeFileSync(registry, JSON.stringify({ root: globalRoot, versions }))
  return {
    command: [process.execPath, FAKE_NPM, registry],
    calls: () =>
      existsSync(`${registry}.log`)
        ? readFileSync(`${registry}.log`, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as string[])
        : [],
  }
}

/** git with no configuration of the user's own, so their hooks, signing and identity never come into a test. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
}

export interface GitPackage {
  /** As Pi's settings write it. */
  source: string
  /** Where Pi keeps the clone. */
  clone: string
  /** Puts a newer commit on the remote, which the clone does not have. */
  advance(): void
  /** Where the clone's own idea of the remote branch points: a fetch would move it. */
  remoteHeadInClone(): string
}

/**
 * A package Pi installed from git: a clone where Pi keeps them, whose remote is a repository in the test's folder, so
 * a check reaches no network. `path` is the repository as Pi names it, such as `example.com/test/pi-git`.
 */
export function gitPackage(root: string, agentDir: string, path: string, shape: PackageShape): GitPackage {
  const remote = join(root, 'remotes', `${path.replaceAll('/', '-')}.git`)
  const work = join(root, 'work', path.replaceAll('/', '-'))
  mkdirSync(remote, { recursive: true })
  git(remote, 'init', '--bare', '--initial-branch=main', '--quiet')
  piPackage(work, path.split('/').at(-1)!, shape)
  git(work, 'init', '--initial-branch=main', '--quiet')
  git(work, 'add', '.')
  git(work, 'commit', '--quiet', '-m', 'First version')
  git(work, 'remote', 'add', 'origin', remote)
  git(work, 'push', '--quiet', 'origin', 'main')
  const clone = join(agentDir, 'git', path)
  mkdirSync(dirname(clone), { recursive: true })
  git(root, 'clone', '--quiet', remote, clone)
  return {
    source: `git:${path}`,
    clone,
    advance: () => {
      writeFileSync(join(work, 'CHANGELOG.md'), '## 1.1.0\n')
      git(work, 'add', '.')
      git(work, 'commit', '--quiet', '-m', 'A newer version')
      git(work, 'push', '--quiet', 'origin', 'main')
    },
    remoteHeadInClone: () => git(clone, 'rev-parse', 'origin/main'),
  }
}
