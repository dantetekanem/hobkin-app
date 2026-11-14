import { scrubText } from '#shared/integrations/redact.ts'
import { EXTENSIONS_UNKNOWN, type ExtensionEntry, type ExtensionsState, type PiPackage } from '#shared/pi-resources/wire.ts'
import { Unavailable } from './commands.ts'
import { shownPath } from './skills.ts'

/**
 * Pi extensions (_specs/039-skills-and-extensions): every package in Pi's settings, with its extensions, and the
 * extensions in Pi's own folder, its settings and Pi itself, as `pi config` lists them for the user. Turning one off or
 * on runs the code `pi config` runs (pi-resources.ts). Updates come from Pi's own check, which only reads: nothing is
 * ever installed, updated or removed here.
 */

/** One extension as Pi has it, with its path as it is on disk. */
export interface PiExtension {
  path: string
  name: string
  /** Its file. Null for one built into Pi. */
  file: string | null
  enabled: boolean
  from: ExtensionEntry['from']
  /** The package it comes from, by its source as Pi's settings write it. */
  package: string | null
}

/** One package in Pi's settings, with its folder as it is on disk. */
export interface PiPackageInfo {
  source: string
  name: string
  kind: PiPackage['kind']
  version: string | null
  folder: string | null
  installed: boolean
  pinned: boolean
  skills: number
}

/** Pi's packages and extensions over its own code, or a stand-in in tests. */
export interface ExtensionSource {
  /** The settings file that turning an extension off or on writes. */
  readonly settingsPath: string
  /** Every package and extension as `pi config` lists them, in Pi's order, and what Pi could not read. It installs nothing. */
  list(): Promise<{ packages: PiPackageInfo[]; extensions: PiExtension[]; problems: string[] }>
  /** Turns one extension off or on through `pi config`'s own code. Throws with Pi's reason when it could not write. */
  setEnabled(path: string, on: boolean): Promise<void>
  /** Pi's own check for updates: the sources of the packages a newer version waits for. It only reads. */
  updates(): Promise<string[]>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Whether Pi's check looks at a package at all. It never checks a folder on this Mac, a pinned package or a missing one. */
const checkable = (pkg: PiPackageInfo) => pkg.installed && !pkg.pinned && pkg.kind !== 'local'

const entryOf = (extension: PiExtension): ExtensionEntry => ({
  path: extension.path,
  name: extension.name,
  file: extension.file === null ? null : shownPath(extension.file),
  on: extension.enabled,
  from: extension.from,
})

export interface PiExtensionsOptions {
  /** Pi's packages and extensions. Opened when first needed, since it loads Pi. */
  source: () => Promise<ExtensionSource>
  log?: (line: string) => void
}

export class PiExtensions {
  private current: ExtensionsState = EXTENSIONS_UNKNOWN
  private opened: Promise<ExtensionSource> | null = null
  private reading: Promise<ExtensionsState> | null = null
  private checking: Promise<ExtensionsState> | null = null
  private listed: Awaited<ReturnType<ExtensionSource['list']>> = { packages: [], extensions: [], problems: [] }
  /** What Pi's last check looked at, and what it found an update for, by source. */
  private checked = new Set<string>()
  private available = new Set<string>()
  private readonly options: PiExtensionsOptions

  constructor(options: PiExtensionsOptions) {
    this.options = options
  }

  get state(): ExtensionsState {
    return this.current
  }

  /** Reads Pi's packages and extensions again. A read already under way answers this one too. */
  refresh(): Promise<ExtensionsState> {
    this.reading ??= this.look().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  /** Asks Pi whether its packages have updates. A check already under way answers this one too. */
  checkUpdates(): Promise<ExtensionsState> {
    this.checking ??= this.check().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  turnOff(path: string): Promise<ExtensionsState> {
    return this.turn(path, false)
  }

  turnOn(path: string): Promise<ExtensionsState> {
    return this.turn(path, true)
  }

  /** Writes the change through Pi, then reads Pi's list again, so what the page shows is what Pi now has. */
  private async turn(path: string, on: boolean): Promise<ExtensionsState> {
    const source = await this.source()
    const extension = await this.known(source, path)
    try {
      await source.setEnabled(path, on)
    } catch (error) {
      throw new Unavailable(`Pi could not turn ${extension.name} ${on ? 'on' : 'off'}: ${scrubText(messageOf(error))}`)
    }

    const state = await this.relist(source)
    const unchanged = this.extensionAt(path)?.enabled === !on
    if (unchanged) throw new Unavailable(`Pi still has ${extension.name} ${on ? 'off' : 'on'}. Its settings are in ${state.settings ?? 'settings.json'}.`)
    return state
  }

  /** The extension at this path, reading Pi's list again when the last one does not have it. */
  private async known(source: ExtensionSource, path: string): Promise<PiExtension> {
    if (!this.extensionAt(path)) await this.relist(source)
    const extension = this.extensionAt(path)
    if (!extension) throw new Unavailable(`Pi has no extension at ${shownPath(path)}.`)
    return extension
  }

  private extensionAt(path: string): PiExtension | undefined {
    return this.listed.extensions.find((candidate) => candidate.path === path)
  }

  private async look(): Promise<ExtensionsState> {
    const source = await this.source().catch(() => null)
    return source ? this.relist(source) : this.current
  }

  private async check(): Promise<ExtensionsState> {
    const source = await this.source()
    if (this.current.readAt === null) await this.relist(source)

    this.change({ updates: { ...this.current.updates, checking: true } })
    let found: string[]
    try {
      found = await source.updates()
    } catch (error) {
      this.change({ updates: { ...this.current.updates, checking: false } })
      throw new Unavailable(`Pi could not check for updates: ${scrubText(messageOf(error))}`)
    }

    this.checked = new Set(this.listed.packages.filter(checkable).map((pkg) => pkg.source))
    this.available = new Set(found)
    return this.change({
      ...this.composed(),
      updates: { checking: false, checkedAt: new Date().toISOString() },
    })
  }

  /** Pi's code, loaded once. When this Pi does not have what the page uses, the page says so. */
  private source(): Promise<ExtensionSource> {
    this.opened ??= this.options.source().catch((error: unknown) => {
      this.opened = null
      const message = `Pi extensions could not load Pi's code: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      this.change({ error: message })
      throw new Unavailable(message)
    })
    return this.opened
  }

  private async relist(source: ExtensionSource): Promise<ExtensionsState> {
    try {
      this.listed = await source.list()
    } catch (error) {
      const message = `Could not read Pi's packages and extensions: ${scrubText(messageOf(error))}`
      this.options.log?.(message)
      return this.change({ settings: shownPath(source.settingsPath), error: message })
    }
    return this.change({
      ...this.composed(),
      settings: shownPath(source.settingsPath),
      problems: this.listed.problems.map((problem) => scrubText(problem)),
      readAt: new Date().toISOString(),
      error: null,
    })
  }

  /** The packages with their extensions and what Pi's last check found, then the extensions of no package. */
  private composed(): Pick<ExtensionsState, 'packages' | 'own' | 'builtIn'> {
    const { packages, extensions } = this.listed
    return {
      packages: packages.map((pkg) => ({
        source: scrubText(pkg.source),
        name: pkg.name,
        kind: pkg.kind,
        version: pkg.version,
        folder: pkg.folder === null ? null : shownPath(pkg.folder),
        installed: pkg.installed,
        pinned: pkg.pinned,
        update: this.updateOf(pkg),
        extensions: extensions.filter((extension) => extension.package === pkg.source).map(entryOf),
        skills: pkg.skills,
      })),
      own: extensions.filter(({ from }) => from === 'folder' || from === 'settings').map(entryOf),
      builtIn: extensions.filter(({ from }) => from === 'built-in').map(entryOf),
    }
  }

  /** What Pi's last check found for a package, or null when that check did not look at it. */
  private updateOf(pkg: PiPackageInfo): PiPackage['update'] {
    if (!this.checked.has(pkg.source) || !checkable(pkg)) return null
    return this.available.has(pkg.source) ? 'available' : 'none'
  }

  private change(change: Partial<ExtensionsState>): ExtensionsState {
    this.current = { ...this.current, ...change }
    return this.current
  }
}
