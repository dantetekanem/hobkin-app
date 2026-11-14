import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SkillEntry, SkillsState } from '#shared/pi-resources/wire.ts'
import { DEV_UI_ORIGIN } from '../src/access.ts'
import { Unavailable } from '../src/commands.ts'
import { startHost } from '../src/host.ts'
import { piSkillSource } from '../src/pi-resources.ts'
import { Skills, type PiSkill, type SkillSource } from '../src/skills.ts'
import { piFolder, piPackage, readSettings, skill, withEnvironment, writeSettings } from './pi-folder.ts'
import { afterTest, Client, temporaryDirectory } from './support.ts'

/** Skills over Pi's own code, on the test's Pi folder. */
const skillsOf = (agentDir: string) => new Skills({ source: () => piSkillSource({ agentDir, cwd: agentDir }) })

const named = (state: SkillsState, name: string, from?: SkillEntry['from']): SkillEntry => {
  const found = state.skills.find((entry) => entry.name === name && (from === undefined || entry.from === from))
  assert.ok(found, `${name} is listed`)
  return found
}

test("lists every skill Pi resolves, with Pi's own name and description", async (t) => {
  const { root, agentDir, home } = piFolder(t)
  skill(join(agentDir, 'skills', 'alpha'), { name: 'alpha', description: 'Writes the alpha report.' })
  skill(join(agentDir, 'skills', 'quiet'), { name: 'quiet', description: 'Runs only when named.', 'disable-model-invocation': true })
  skill(join(agentDir, 'skills', 'blank'), { name: 'blank' })
  skill(join(agentDir, 'skills', 'resting'), { name: 'resting', description: 'Turned off before.' })
  // Reached through a link, the way skills kept in another folder are.
  const kept = join(root, 'kept-skills', 'linked')
  skill(kept, { name: 'linked', description: 'Kept in another folder.' })
  symlinkSync(kept, join(agentDir, 'skills', 'linked'))
  skill(join(home, '.agents', 'skills', 'shared'), { name: 'shared', description: 'From the Agent Skills folder.' })
  // A package brings a skill of its own, and one more named alpha, which Pi does not load.
  const tools = piPackage(join(root, 'pi-tools'), 'pi-tools', { version: '1.2.0', skills: { gamma: 'Gamma, from a package.', alpha: 'Another alpha.' } })
  writeSettings(agentDir, { theme: 'dark', skills: ['-skills/resting/SKILL.md'], packages: [tools] })

  const state = await skillsOf(agentDir).refresh()

  assert.equal(state.error, null)
  assert.equal(state.settings, join(agentDir, 'settings.json'))
  // Pi's order depends on how the folders read, so the skills are compared by name.
  const listed = state.skills.map(({ name, on, from, commandOnly }) => [name, on, from, commandOnly])
  const byName = listed.toSorted((left, right) => String(left).localeCompare(String(right)))
  assert.deepEqual(
    byName,
    [
      ['alpha', true, 'folder', false],
      ['alpha', true, 'package', false],
      ['blank', true, 'folder', false],
      ['gamma', true, 'package', false],
      ['linked', true, 'folder', false],
      ['quiet', true, 'folder', true],
      ['resting', false, 'folder', false],
      ['shared', true, 'agents', false],
    ],
  )
  assert.equal(named(state, 'alpha', 'folder').description, 'Writes the alpha report.')
  assert.equal(named(state, 'gamma').description, 'Gamma, from a package.')
  assert.deepEqual(named(state, 'gamma').package, { source: tools, name: 'pi-tools' })
  assert.equal(named(state, 'alpha', 'folder').package, null)
  // The link leads to the file to change.
  assert.equal(named(state, 'linked').path, join(agentDir, 'skills', 'linked', 'SKILL.md'))
  assert.equal(named(state, 'linked').file, join(kept, 'SKILL.md'))
  // Pi keeps the first skill of a name.
  assert.equal(named(state, 'alpha', 'package').shadowedBy, join(agentDir, 'skills', 'alpha', 'SKILL.md'))
  assert.equal(named(state, 'alpha', 'folder').shadowedBy, null)
  // A skill file with no description is one Pi does not load, and it says why.
  assert.match(named(state, 'blank').problem ?? '', /description is required/)
  assert.equal(named(state, 'alpha', 'folder').problem, null)
})

test("off and on go through pi config's own toggle, and Pi agrees", async (t) => {
  const { root, agentDir } = piFolder(t)
  const alpha = skill(join(agentDir, 'skills', 'alpha'), { name: 'alpha', description: 'Writes the alpha report.' })
  const tools = piPackage(join(root, 'pi-tools'), 'pi-tools', { version: '1.2.0', skills: { gamma: 'Gamma, from a package.' } })
  writeSettings(agentDir, { theme: 'dark', somethingPiDoesNotKnow: { kept: true }, packages: [tools] })
  const text = readFileSync(alpha, 'utf8')
  const skills = skillsOf(agentDir)
  await skills.refresh()

  let state = await skills.turnOff(alpha)
  assert.equal(named(state, 'alpha').on, false)
  let written = readSettings(agentDir)
  assert.deepEqual(written.skills, ['-skills/alpha/SKILL.md'], "pi config's own exclusion for it")
  assert.equal(written.theme, 'dark')
  assert.deepEqual(written.somethingPiDoesNotKnow, { kept: true })
  assert.equal(readFileSync(alpha, 'utf8'), text, 'the skill file stays as it was')

  state = await skills.turnOn(alpha)
  assert.equal(named(state, 'alpha').on, true)
  assert.deepEqual(readSettings(agentDir).skills, ['+skills/alpha/SKILL.md'])

  // A package's skill is filtered in the package's own entry.
  const gamma = named(state, 'gamma').path
  state = await skills.turnOff(gamma)
  assert.equal(named(state, 'gamma').on, false)
  written = readSettings(agentDir)
  assert.deepEqual(written.packages, [{ source: tools, skills: ['-skills/gamma/SKILL.md'] }])

  // Pi itself, read from scratch, sees the same.
  const again = await skillsOf(agentDir).refresh()
  assert.equal(named(again, 'gamma').on, false)
  assert.equal(named(again, 'alpha').on, true)
})

test("reads only a skill on Pi's list, with its description and the rest of its file", async (t) => {
  const { root, agentDir } = piFolder(t)
  const alpha = skill(join(agentDir, 'skills', 'alpha'), { name: 'alpha', description: 'Writes the alpha report.' }, '# Alpha\n\nRead the notes first.\n')
  const long = skill(join(agentDir, 'skills', 'long'), { name: 'long', description: 'A very long skill.' }, `# Long\n\n${'Step by step. '.repeat(30_000)}\n`)
  const secret = join(root, 'secret.md')
  writeFileSync(secret, '---\nname: secret\ndescription: Not a skill of Pi.\n---\n\nPrivate.\n')
  const skills = skillsOf(agentDir)
  await skills.refresh()

  assert.deepEqual(await skills.read(alpha), { path: alpha, name: 'alpha', description: 'Writes the alpha report.', body: '# Alpha\n\nRead the notes first.', cut: false })

  const cut = await skills.read(long)
  assert.equal(cut.cut, true)
  assert.ok(cut.body.length <= 256 * 1024, 'at most 256 KB of it')
  assert.ok(cut.body.startsWith('# Long'))

  await assert.rejects(skills.read(secret), (error: unknown) => error instanceof Unavailable && /not one of Pi's skills/.test(error.message))
})

/** One skill as a stand-in Pi has it. */
const piSkill = (path: string, enabled = true): PiSkill => ({
  path,
  file: path,
  enabled,
  from: 'folder',
  package: null,
  name: 'alpha',
  description: 'Writes the alpha report.',
  commandOnly: false,
  shadowedBy: null,
  problem: null,
})

test('a change Pi does not take is reported, not shown as done', async () => {
  const path = '/pi/skills/alpha/SKILL.md'
  const source: SkillSource = {
    settingsPath: '/pi/settings.json',
    list: async () => ({ skills: [piSkill(path)], problems: [] }),
    setEnabled: async () => {},
    read: () => ({ text: '', cut: false }),
  }
  const skills = new Skills({ source: async () => source })
  await skills.refresh()
  await assert.rejects(skills.turnOff(path), (error: unknown) => error instanceof Unavailable && /Pi still has alpha on/.test(error.message))
  assert.equal(skills.state.skills[0]?.on, true)
})

test('a Pi without what Skills uses says so on the page, and nothing breaks', async () => {
  const lines: string[] = []
  const skills = new Skills({ source: async () => Promise.reject(Error('Cannot find module config-selector.js')), log: (line) => lines.push(line) })
  const state = await skills.refresh()
  assert.match(state.error ?? '', /Skills could not load Pi's code: Cannot find module config-selector\.js/)
  await assert.rejects(skills.turnOff('/pi/skills/alpha/SKILL.md'), Unavailable)
  assert.equal(lines.length > 0, true, 'and the host log says it too')
})

test('a scripted host reads the skills of its own Pi folder', { timeout: 30000 }, async (t) => {
  const root = temporaryDirectory(t)
  withEnvironment(t, { HOME: join(root, 'away'), PI_CODING_AGENT_DIR: undefined, PI_OFFLINE: undefined })
  mkdirSync(join(root, 'away'), { recursive: true })
  const home = join(root, 'home')
  const own = join(home, 'client', 'scripted-agent')
  const file = skill(join(own, 'skills', 'alpha'), { name: 'alpha', description: 'Writes the alpha report.' })
  const host = await startHost({ root: home, origins: [DEV_UI_ORIGIN] })
  afterTest(t, () => host.close())
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const state = await client.run<SkillsState>('skills.refresh')
  assert.equal(state.settings, join(own, 'settings.json'))
  assert.deepEqual(
    state.skills.map(({ name, path }) => [name, path]),
    [['alpha', file]],
  )
})
