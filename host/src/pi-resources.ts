import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { piAgentDirFor } from './integrations.ts'
import type { ExtensionSource, PiExtension, PiPackageInfo } from './pi-extensions.ts'
import { loadPiCodingAgent, piCodingAgentFile } from './pi.ts'
import type { PiSkill, SkillSource } from './skills.ts'

/**
 * Skills and Pi extensions over Pi's own code (_specs/039-skills-and-extensions). Pi's resources are what `pi config`
 * lists for the user: `DefaultPackageManager.resolve` over Pi's settings, told to skip a package that is missing, so
 * nothing is installed. A skill is what `loadSkills` reads from its file. A turn off or on is what `pi config` writes
 * for a press of space (`ResourceList.toggleResource`). Updates are what Pi's startup notice checks
 * (`checkForAvailableUpdates`), which only reads. Pi does not export its config selector or its list of built-in
 * extensions by name, so they are imported by their files next to Pi's entry, as Integrations does Pi's MCP code.
 */

/** One resource as Pi resolves it. Only what this file reads. */
interface PiResolvedResource {
  path: string
  enabled: boolean
  metadata: { source: string; scope: string; origin: 'package' | 'top-level'; baseDir?: string }
}

interface PiResolvedPaths {
  extensions: PiResolvedResource[]
  skills: PiResolvedResource[]
  prompts: PiResolvedResource[]
  themes: PiResolvedResource[]
}

interface PiSettings {
  drainErrors(): { error: Error }[]
  flush(): Promise<void>
}

/** How Pi reads a package source (`DefaultPackageManager.parseSource`). Private in Pi's types. */
interface PiParsedSource {
  type: 'npm' | 'git' | 'local'
  name?: string
  host?: string
  path?: string
  pinned?: boolean
}

interface PiPackageManager {
  resolve(onMissing: (source: string) => Promise<'install' | 'skip' | 'error'>): Promise<PiResolvedPaths>
  listConfiguredPackages(): { source: string; scope: 'user' | 'project'; installedPath?: string }[]
  checkForAvailableUpdates(): Promise<{ source: string }[]>
  parseSource?(source: string): PiParsedSource
}

interface PiLoadedSkills {
  skills: { name: string; description: string; filePath: string; disableModelInvocation: boolean }[]
  diagnostics: { type: string; message: string; collision?: { winnerPath: string; loserPath: string } }[]
}

/** The exports of Pi's entry this file uses. */
interface PiResourcesSdk {
  SettingsManager: { create(cwd: string, agentDir: string, options: { projectTrusted: boolean }): PiSettings }
  DefaultPackageManager: new (options: { cwd: string; agentDir: string; settingsManager: PiSettings; builtinExtensions: string[] }) => PiPackageManager
  loadSkills(options: { cwd: string; agentDir: string; skillPaths: string[]; includeDefaults: boolean }): PiLoadedSkills
}

/** `pi config`'s list. Its items and its toggle are private in Pi's types, so they are reached by name and checked first. */
interface PiResourceList {
  flatItems?: { type: string; item?: { path: string; resourceType: string; enabled: boolean } }[]
  toggleResource?(item: unknown): boolean | undefined
}

interface PiConfigSelectorModule {
  ConfigSelectorComponent: new (
    resolved: { global: PiResolvedPaths; project: PiResolvedPaths },
    settings: PiSettings,
    cwd: string,
    agentDir: string,
    onClose: () => void,
    onExit: () => void,
    requestRender: () => void,
    terminalHeight: number,
    writeScope: 'global',
    projectModeAvailable: boolean,
  ) => { getResourceList(): PiResourceList }
}

interface PiBuiltInsModule {
  builtInExtensions: { name: string }[]
}

const BUILTIN = 'builtin:'
const nothing = () => {}

interface PiView {
  settings: PiSettings
  manager: PiPackageManager
  /** What Pi could not read in its settings, in its own words. */
  problems: string[]
}

/** Pi's settings and package manager at `agentDir`, and `pi config`'s own turn off or on, over Pi's code loaded once. */
async function piAt({ agentDir, cwd }: { agentDir: string; cwd: string }) {
  const [sdk, selector, builtIns] = (await Promise.all([
    loadPiCodingAgent(),
    import(piCodingAgentFile('./modes/interactive/components/config-selector.js')),
    import(piCodingAgentFile('./extensions/index.js')),
  ])) as unknown as [PiResourcesSdk, PiConfigSelectorModule, PiBuiltInsModule]
  if (typeof selector.ConfigSelectorComponent !== 'function') throw Error('this Pi has no pi config selector where hobkin looks for it')
  const builtinExtensions = builtIns.builtInExtensions.map(({ name }) => name)

  /** Pi's settings as they are now. Only the user's own: a project's settings are never read. */
  const open = (): PiView => {
    const settings = sdk.SettingsManager.create(cwd, agentDir, { projectTrusted: false })
    const problems = settings.drainErrors().map(({ error }) => `Pi could not read its settings: ${error.message}`)
    const manager = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager: settings, builtinExtensions })
    if (typeof manager.parseSource !== 'function') throw Error('this Pi reads package sources in a way hobkin does not know')
    return { settings, manager, problems }
  }

  /** Every resource as `pi config` lists it. Told to skip what is missing, Pi's resolver installs nothing: Pi does it itself when it next starts. */
  const read = async (): Promise<PiView & { resolved: PiResolvedPaths }> => {
    const view = open()
    const resolved = await view.manager.resolve(async () => 'skip')
    const usersOwn = (resources: PiResolvedResource[]) => resources.filter(({ metadata }) => metadata.scope !== 'project')

    return {
      ...view,
      resolved: {
        extensions: usersOwn(resolved.extensions),
        skills: usersOwn(resolved.skills),
        prompts: usersOwn(resolved.prompts),
        themes: usersOwn(resolved.themes),
      },
    }
  }

  /** What `pi config` does when space is pressed on this resource: the entry it writes, through Pi's settings code. */
  const setEnabled = async (type: 'skills' | 'extensions', path: string, on: boolean): Promise<void> => {
    const { settings, resolved, problems } = await read()
    // Pi does not write a settings file it could not read, so the reason goes back instead.
    if (problems.length > 0) throw Error(problems.join(' '))

    // `pi config`'s own screen, built but never drawn or closed, for its list and the toggle behind its space key.
    const terminalRows = 24
    const configScreen = new selector.ConfigSelectorComponent({ global: resolved, project: resolved }, settings, cwd, agentDir, nothing, nothing, nothing, terminalRows, 'global', false)
    const list = configScreen.getResourceList()
    if (!Array.isArray(list.flatItems) || typeof list.toggleResource !== 'function') throw Error('this Pi has no pi config toggle where hobkin looks for it. pi config in a terminal still does it')

    const listed = list.flatItems.find((entry) => entry.type === 'item' && entry.item?.resourceType === type && entry.item.path === path)
    if (!listed?.item) throw Error('pi config does not list it')
    if (listed.item.enabled === on) return

    list.toggleResource(listed.item)
    await settings.flush()
    const errors = settings.drainErrors()
    if (errors.length > 0) throw Error(errors.map(({ error }) => error.message).join(' '))
  }

  return { sdk, settingsPath: join(agentDir, 'settings.json'), open, read, setEnabled }
}

/** A package's short name: its npm name, its git repository, or its folder's name. */
function nameOf(parsed: PiParsedSource, source: string, folder: string | undefined): string {
  if (parsed.type === 'npm' && parsed.name) return parsed.name
  if (parsed.type === 'git' && parsed.host && parsed.path) return `${parsed.host}/${parsed.path}`
  return basename(folder ?? source)
}

function versionIn(folder: string): string | null {
  try {
    const { version } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

/** The packages in the user's own settings, in their order, with their short names. */
function packagesOf(manager: PiPackageManager): { source: string; parsed: PiParsedSource; name: string; folder: string | undefined }[] {
  return manager
    .listConfiguredPackages()
    .filter(({ scope }) => scope === 'user')
    .map(({ source, installedPath }) => {
      const parsed = manager.parseSource!(source)
      return { source, parsed, name: nameOf(parsed, source, installedPath), folder: installedPath }
    })
}

/** A skill resource is its file. A folder holds it as SKILL.md, as Pi's resource loader reads it. */
function skillFile(path: string): string {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, 'SKILL.md')) ? join(path, 'SKILL.md') : path
  } catch {
    return path
  }
}

function realFile(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** The name Pi falls back on for a file it does not read: the folder of a SKILL.md, or the file's own name. */
const fallbackName = (file: string) => (basename(file) === 'SKILL.md' ? basename(dirname(file)) : basename(file).replace(/\.md$/, ''))

function skillOrigin({ metadata }: PiResolvedResource, agentDir: string): PiSkill['from'] {
  if (metadata.origin === 'package') return 'package'
  if (metadata.source === 'local') return 'settings'
  // Pi finds the rest in its own skills folder, or in the Agent Skills one under the home folder (`~/.agents`), each with its own base.
  const inAgentSkills = metadata.baseDir !== undefined && basename(metadata.baseDir) === '.agents' && resolve(metadata.baseDir) !== resolve(agentDir)
  return inAgentSkills ? 'agents' : 'folder'
}

/** The package a skill comes from, by its source and short name, or null for one that comes from no package. */
function packageOf({ metadata }: PiResolvedResource, names: ReadonlyMap<string, string>): PiSkill['package'] {
  if (metadata.origin !== 'package') return null
  return { source: metadata.source, name: names.get(metadata.source) ?? basename(metadata.source) }
}

/** For each file Pi drops because an earlier skill has its name, the file it keeps instead, from `loadSkills`' own reports. */
function keptInstead(diagnostics: PiLoadedSkills['diagnostics']): Map<string, string> {
  const kept = new Map<string, string>()
  for (const { type, collision } of diagnostics) {
    if (type === 'collision' && collision) kept.set(collision.loserPath, collision.winnerPath)
  }
  return kept
}

/** Why Pi reads no skill in a file, in its own words. */
const problemIn = (diagnostics: PiLoadedSkills['diagnostics']) => diagnostics.find(({ type }) => type !== 'collision')?.message ?? 'Pi does not read it as a skill.'

function extensionOrigin({ metadata }: PiResolvedResource): PiExtension['from'] {
  if (metadata.source === 'builtin') return 'built-in'
  if (metadata.origin === 'package') return 'package'
  return metadata.source === 'local' ? 'settings' : 'folder'
}

/** An extension's name as `pi config` shows it: a built-in's own, or the file with its folder when the folder says more. */
function extensionName({ path, metadata }: PiResolvedResource): string {
  if (metadata.source === 'builtin') return path.slice(BUILTIN.length)
  const folder = basename(dirname(path))
  return folder === 'extensions' ? basename(path) : `${folder}/${basename(path)}`
}

/** The start of a file, at most `limit` bytes. */
function readStart(path: string, limit: number): { text: string; cut: boolean } {
  const descriptor = openSync(path, 'r')
  try {
    const size = fstatSync(descriptor).size
    const buffer = Buffer.alloc(Math.min(size, limit))
    const read = readSync(descriptor, buffer, 0, buffer.length, 0)
    return { text: buffer.subarray(0, read).toString('utf8'), cut: size > limit }
  } finally {
    closeSync(descriptor)
  }
}

/** Pi's skills in `agentDir`: every one `pi config` lists for the user, each as Pi's own `loadSkills` reads it. */
export async function piSkillSource({ agentDir, cwd }: { agentDir: string; cwd: string }): Promise<SkillSource> {
  const pi = await piAt({ agentDir, cwd })
  const loadSkills = (skillPaths: string[]) => pi.sdk.loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false })

  return {
    settingsPath: pi.settingsPath,
    list: async () => {
      const { resolved, manager, problems } = await pi.read()
      const names = new Map(packagesOf(manager).map(({ source, name }) => [source, name]))
      // One file at a time, so each says what Pi reads in it even when another has its name.
      const files = resolved.skills.map((resource) => {
        const file = skillFile(resource.path)
        const one = loadSkills([file])
        return { resource, file, skill: one.skills[0] ?? null, diagnostics: one.diagnostics }
      })
      // Then the ones that are on, together and in Pi's order, as Pi loads them: the first of a name is the one it keeps.
      const together = loadSkills(files.filter(({ resource }) => resource.enabled).map(({ file }) => file))
      const shadowedBy = keptInstead(together.diagnostics)

      const skills = files.map(({ resource, file, skill, diagnostics }): PiSkill => ({
        path: resource.path,
        file: realFile(file),
        enabled: resource.enabled,
        from: skillOrigin(resource, agentDir),
        package: packageOf(resource, names),
        name: skill?.name ?? fallbackName(file),
        description: skill?.description ?? '',
        commandOnly: skill?.disableModelInvocation ?? false,
        shadowedBy: shadowedBy.get(file) ?? null,
        problem: skill ? null : problemIn(diagnostics),
      }))
      return { skills, problems }
    },
    setEnabled: (path, on) => pi.setEnabled('skills', path, on),
    read: (path, limit) => readStart(skillFile(path), limit),
  }
}

/** Pi's packages and extensions in `agentDir`, as `pi config` lists them for the user, and Pi's own check for updates. */
export async function piExtensionSource({ agentDir, cwd }: { agentDir: string; cwd: string }): Promise<ExtensionSource> {
  const pi = await piAt({ agentDir, cwd })

  return {
    settingsPath: pi.settingsPath,
    list: async () => {
      const { resolved, manager, problems } = await pi.read()
      const packages = packagesOf(manager).map(
        ({ source, parsed, name, folder }): PiPackageInfo => ({
          source,
          name,
          kind: parsed.type,
          version: folder ? versionIn(folder) : null,
          folder: folder ?? null,
          installed: folder !== undefined,
          pinned: parsed.pinned === true,
          skills: resolved.skills.filter(({ metadata }) => metadata.origin === 'package' && metadata.source === source).length,
        }),
      )
      const extensions = resolved.extensions.map(
        (resource): PiExtension => ({
          path: resource.path,
          name: extensionName(resource),
          file: resource.metadata.source === 'builtin' ? null : resource.path,
          enabled: resource.enabled,
          from: extensionOrigin(resource),
          package: resource.metadata.origin === 'package' ? resource.metadata.source : null,
        }),
      )
      return { packages, extensions, problems }
    },
    setEnabled: (path, on) => pi.setEnabled('extensions', path, on),
    updates: async () => {
      // Offline, Pi checks nothing (its own reading of PI_OFFLINE), and "no update found" would then be wrong.
      const offline = /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? '')
      if (offline) throw Error('PI_OFFLINE is set, so Pi checks nothing')

      const found = await pi.open().manager.checkForAvailableUpdates()
      return found.map(({ source }) => source)
    },
  }
}

/**
 * The Pi folder a host uses unless it is handed a source (023-integrations, `piAgentDirFor`): Pi's own for a live
 * host, and for a scripted one the folder in PI_CODING_AGENT_DIR or its own agent folder in the home. Pi runs its
 * commands, such as `npm view`, from that folder too.
 */
async function agentDirFor({ live, root }: { live: boolean; root: string }): Promise<string> {
  const pi = await loadPiCodingAgent()
  return piAgentDirFor({ live, root, env: process.env, piAgentDir: () => pi.getAgentDir() })
}

export async function piSkillSourceFor(where: { live: boolean; root: string }): Promise<SkillSource> {
  const agentDir = await agentDirFor(where)
  return piSkillSource({ agentDir, cwd: agentDir })
}

export async function piExtensionSourceFor(where: { live: boolean; root: string }): Promise<ExtensionSource> {
  const agentDir = await agentDirFor(where)
  return piExtensionSource({ agentDir, cwd: agentDir })
}
